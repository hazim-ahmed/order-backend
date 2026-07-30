// ==============================================================================
// تاريخ التعديل: 2026-07-25
// الوظيفة: إدارة رفع وتخزين ومعاينة ومشاركة مستندات وإثباتات التسليم
// السياق: يعتمد على multipart/form-data، مفحوص بالبايتات السحرية، محسن بـ Sharp ومربوط بـ Storage Abstraction Layer
// ==============================================================================

const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { authenticateToken } = require('../middlewares/auth');
const { DeliveryDocument, Order, User } = require('../models');
const { storage } = require('../services/storage');
const ImageProcessor = require('../services/imageProcessor');

// حماية كافة مسارات المرفقات والمستندات بالمصادقة
router.use(authenticateToken);

// معدّل تحديد الطلبات (Rate Limiting) على مسار الرفع لحظر هجمات الغمر
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 30, // حد أقصى 30 عملية رفع لكل 15 دقيقة
  message: { error: 'تم تجاوز حد عمليات الرفع المسموح به. يرجى المحاولة بعد قليل.' }
});

// إعداد Multer لتخزين الملف مؤقتًا في الذاكرة (Memory Storage)
const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5 ميجابايت كحد أقصى
});

/**
 * فحص البايتات السحرية (Magic Bytes) للملف لمنع تزوير MIME أو الامتداد
 * @param {Buffer} buffer
 * @returns {Promise<{ mime: string, ext: string }|null>}
 */
async function detectFileType(buffer) {
  try {
    const FileType = require('file-type');
    const result = await FileType.fromBuffer(buffer);
    return result || null;
  } catch (err) {
    console.error('❌ Error detecting file magic bytes:', err);
    return null;
  }
}

// ==============================================================================
// POST /api/upload/delivery
// رفع مستند/صورة إثبات التسليم بـ multipart/form-data
// ==============================================================================
router.post('/delivery', uploadLimiter, (req, res) => {
  multerUpload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'حجم الملف يتجاوز الحد المسموح به (5 ميجابايت).' });
      }
      return res.status(400).json({ error: `خطأ في رفع الملف: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'لم يتم توفير ملف محدد في الطلب.' });
    }

    const originalBuffer = req.file.buffer;
    let storedObjectKey = null;
    let storedThumbKey = null;

    try {
      // 1. التحقق الأمن من محتوى البايتات السحرية (Magic Bytes)
      const detected = await detectFileType(originalBuffer);
      const allowedMimes = ['image/jpeg', 'image/png', 'application/pdf'];

      if (!detected || !allowedMimes.includes(detected.mime)) {
        return res.status(400).json({
          error: 'نوع محتوى الملف غير مسموح به. يُقبل فقط صور (JPG, PNG) أو مستندات (PDF) صحيحة.'
        });
      }

      // 2. معالجة وتصغير الصورة بـ Sharp (أو استثناء PDF)
      const processed = await ImageProcessor.process({
        buffer: originalBuffer,
        mimeType: detected.mime
      });

      // 3. إنشاء مفاتيح عشوائية وآمنة للملف في نظام التخزين
      const now = new Date();
      const yearMonth = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
      const uniqueId = crypto.randomUUID();

      storedObjectKey = `delivery/${yearMonth}/${uniqueId}${processed.extension}`;
      if (processed.thumbnailBuffer) {
        storedThumbKey = `delivery/${yearMonth}/${uniqueId}_thumb${processed.extension}`;
      }

      // 4. رفع الملف الرئيسي و Thumbnail إلى مزود التخزين المعتمد
      const driverName = process.env.STORAGE_DRIVER || 'local';
      await storage.store({
        buffer: processed.optimizedBuffer,
        key: storedObjectKey,
        contentType: processed.mimeType
      });

      if (processed.thumbnailBuffer && storedThumbKey) {
        await storage.store({
          buffer: processed.thumbnailBuffer,
          key: storedThumbKey,
          contentType: processed.mimeType
        });
      }

      // 5. إنشاء سجل المرفق في قاعدة البيانات باختبار ذري (Atomic Transaction)
      let docRecord;
      try {
        docRecord = await DeliveryDocument.create({
          order_id: req.body.order_id ? Number(req.body.order_id) : null,
          uploaded_by: req.user.id,
          storage_driver: driverName,
          object_key: storedObjectKey,
          thumbnail_key: storedThumbKey,
          original_name: req.file.originalname,
          mime_type: processed.mimeType,
          size_bytes: processed.optimizedBuffer.length,
          checksum: processed.checksum,
          status: 'temporary'
        });
      } catch (dbError) {
        // آلية التعويض الذري: حذف الملفات المرفوعة من التخزين في حال فشل تسجيل قاعدة البيانات
        console.error('❌ DB creation failed. Cleaning up uploaded storage files...', dbError);
        if (storedObjectKey) await storage.delete({ key: storedObjectKey });
        if (storedThumbKey) await storage.delete({ key: storedThumbKey });
        throw dbError;
      }

      // 6. الحصول على رابط المعاينة والتحميل
      const publicUrl = await storage.getDownloadUrl({ key: storedObjectKey });
      const thumbUrl = storedThumbKey ? await storage.getDownloadUrl({ key: storedThumbKey }) : publicUrl;

      return res.status(201).json({
        message: 'تم رفع ومناقلة إثبات التسليم بنجاح.',
        document_id: docRecord.id,
        url: publicUrl,
        thumbnail_url: thumbUrl,
        filename: path.basename(storedObjectKey)
      });
    } catch (error) {
      console.error('❌ Error processing delivery upload:', error);
      return res.status(500).json({ error: error.message || 'حدث خطأ داخلي أثناء معالجة المستند.' });
    }
  });
});

// ==============================================================================
// GET /api/documents/:id/view
// معاينة أو عرض المستند المرفوع بحسب الصلاحية
// ==============================================================================
router.get('/documents/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const isThumb = req.query.thumbnail === 'true';

    const doc = await DeliveryDocument.findByPk(id, {
      include: [{ model: Order, as: 'order' }]
    });

    if (!doc || doc.status === 'deleted') {
      return res.status(404).json({ error: 'المستند المطلوب غير موجود أو تم حذفه.' });
    }

    // التحقق من الصلاحيات (Admin, Inventory Manager, Sales Manager, Sales Rep, Driver, or Client)
    const userRole = req.user.role;
    if (doc.order) {
      const isOwnerDriver = doc.order.driver_id === req.user.id;
      const isOwnerSalesRep = doc.order.sales_rep_id === req.user.id;
      const isOwnerClient = doc.order.client_id === req.user.client_id;
      const isStaff = ['admin', 'inventory_manager', 'sales_manager', 'accountant'].includes(userRole);

      if (!isStaff && !isOwnerDriver && !isOwnerSalesRep && !isOwnerClient) {
        return res.status(403).json({ error: 'لا تملك صلاحية للوصول إلى هذا المستند.' });
      }
    } else {
      // مستند مؤقت غير مرتبط بطلب بعد: يُسمح فقط للرافع أو الأدمن
      if (doc.uploaded_by !== req.user.id && userRole !== 'admin') {
        return res.status(403).json({ error: 'لا تملك صلاحية للوصول إلى هذا المستند المؤقت.' });
      }
    }

    const keyToServe = (isThumb && doc.thumbnail_key) ? doc.thumbnail_key : doc.object_key;

    // إذا كان التخزين S3، يتم إرجاع رابط موقع أومناقلته بـ Redirect
    if (doc.storage_driver === 's3') {
      const signedUrl = await storage.getDownloadUrl({ key: keyToServe, expiresIn: 300 });
      return res.redirect(signedUrl);
    }

    // إذا كان التخزين محلي، يتم تدفق الملف مع ترويسة Cache-Control آمنة
    const fs = require('fs');
    const localUploadDir = process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, '../../uploads');
    const filePath = path.join(localUploadDir, keyToServe);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'ملف التخزين المحلي غير موجود على القرص.' });
    }

    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(filePath);
  } catch (error) {
    console.error('❌ Error viewing document:', error);
    return res.status(500).json({ error: 'تعذر عرض المستند المطلوب.' });
  }
});

// ==============================================================================
// GET /api/documents/:id/download
// تنزيل المستند المرفوع بصيغة مسمّاة وآمنة
// ==============================================================================
router.get('/documents/:id/download', async (req, res) => {
  try {
    const { id } = req.params;

    const doc = await DeliveryDocument.findByPk(id, {
      include: [{ model: Order, as: 'order' }]
    });

    if (!doc || doc.status === 'deleted') {
      return res.status(404).json({ error: 'المستند المطلوب غير موجود.' });
    }

    // التحقق من الصلاحيات
    const userRole = req.user.role;
    if (doc.order) {
      const isOwnerDriver = doc.order.driver_id === req.user.id;
      const isOwnerSalesRep = doc.order.sales_rep_id === req.user.id;
      const isOwnerClient = doc.order.client_id === req.user.client_id;
      const isStaff = ['admin', 'inventory_manager', 'sales_manager', 'accountant'].includes(userRole);

      if (!isStaff && !isOwnerDriver && !isOwnerSalesRep && !isOwnerClient) {
        return res.status(403).json({ error: 'لا تملك صلاحية لتنزيل هذا المستند.' });
      }
    } else {
      if (doc.uploaded_by !== req.user.id && userRole !== 'admin') {
        return res.status(403).json({ error: 'لا تملك صلاحية لتنزيل هذا المستند.' });
      }
    }

    const safeDownloadName = `Delivery_Proof_${doc.order?.order_number || doc.id}${path.extname(doc.object_key)}`;

    if (doc.storage_driver === 's3') {
      const signedUrl = await storage.getDownloadUrl({ key: doc.object_key, expiresIn: 300 });
      return res.redirect(signedUrl);
    }

    const fs = require('fs');
    const localUploadDir = process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, '../../uploads');
    const filePath = path.join(localUploadDir, doc.object_key);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'ملف التخزين غير موجود.' });
    }

    return res.download(filePath, safeDownloadName);
  } catch (error) {
    console.error('❌ Error downloading document:', error);
    return res.status(500).json({ error: 'تعذر تنزيل المستند.' });
  }
});

// ==============================================================================
// DELETE /api/documents/:id
// حماية المرفق ومنع الحذف أو التعديل بعد الارتباط بالطلب
// ==============================================================================
router.delete('/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await DeliveryDocument.findByPk(id);

    if (!doc || doc.status === 'deleted') {
      return res.status(404).json({ error: 'المستند المطلوب غير موجود.' });
    }

    // حظر الحذف إذا كان المستند مرتبطاً بطلب نهائي (attached)
    if (doc.status === 'attached' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'عذراً، لا يمكن حذف أو تعديل مستند التسليم بعد اعتماده وارتباطه بالطلب.' });
    }

    if (doc.uploaded_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'لا تملك صلاحية لحذف هذا المستند.' });
    }
    const previousStatus = doc.status;
    const previousDeletedAt = doc.deleted_at;

    doc.status = 'deleted';
    doc.deleted_at = new Date();
    await doc.save();

    try {
      if (doc.object_key) await storage.delete({ key: doc.object_key });
      if (doc.thumbnail_key) await storage.delete({ key: doc.thumbnail_key });
    } catch (storageError) {
      doc.status = previousStatus;
      doc.deleted_at = previousDeletedAt;
      await doc.save();
      throw storageError;
    }

    res.status(200).json({ message: 'تم حذف المستند بنجاح.' });
  } catch (error) {
    res.status(500).json({ error: 'تعذر حذف المستند.' });
  }
});

// المسار التوافقي لقراءة الملفات القديمة
router.get('/file/:folder/:filename', (req, res) => {
  try {
    const { folder, filename } = req.params;
    const safeFolder = path.basename(folder);
    const safeFilename = path.basename(filename);
    const fs = require('fs');

    const filePath = path.join(__dirname, '../../uploads', safeFolder, safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'الملف المطلوب غير موجود' });
    }

    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: 'تعذر الوصول للملف' });
  }
});

module.exports = router;
