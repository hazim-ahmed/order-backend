const { Op } = require('sequelize');
const { sequelize, User, DeliveryDocumentBatch, DeliveryDocumentBook, DeliveryDocumentUsage, Order } = require('../models');
const { doRangesOverlap, calculateBatchDetails } = require('../utils/rangeValidationHelper');

/**
 * دالة مساعدة لإنشاء رقم تسلسلي فريد
 */
function generateReferenceCode(prefix) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${dateStr}-${randomNum}`;
}

async function getNextStartNumber(options = {}) {
  const latestBatch = await DeliveryDocumentBatch.findOne({
    attributes: ['id', 'end_number'],
    order: [['end_number', 'DESC']],
    ...options
  });

  return {
    latestBatch,
    nextStartNumber: latestBatch ? Number(latestBatch.end_number) + 1 : null
  };
}

/**
 * 1. إنشاء أمر صرف دفاتر جديد من المسؤول إلى أمين المخزن
 * POST /api/delivery-document-batches
 */
exports.createBatch = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { inventory_manager_id, start_number, book_size, books_count, notes } = req.body;
    const { latestBatch, nextStartNumber } = await getNextStartNumber({
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const effectiveStartNumber = latestBatch ? nextStartNumber : start_number;

    // 1. التحقق من المدخلات الأساسية
    if (!inventory_manager_id || !effectiveStartNumber || !book_size || !books_count) {
      await transaction.rollback();
      return res.status(400).json({ error: 'جميع الحقول الأساسية مطلوبة (أمين المخزن، بداية السند، مدى الدفتر، عدد الدفاتر).' });
    }

    // 2. التحقق من أمين المخزن
    const invManager = await User.findByPk(inventory_manager_id);
    if (!invManager || !['inventory_manager', 'admin'].includes(invManager.role)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'المستخدم المحدد كأمين مخزن غير موجود أو لا يملك صلاحية أمين مخزن.' });
    }

    // 3. حساب التفاصيل والتحقق من القيم الرقمية
    let batchDetails;
    try {
      batchDetails = calculateBatchDetails(effectiveStartNumber, book_size, books_count);
    } catch (err) {
      await transaction.rollback();
      return res.status(400).json({ error: err.message });
    }

    // 4. التحقق من عدم تداخل النطاق مع أي أمر صرف أو دفتر قائم مسبقاً
    const existingBatches = await DeliveryDocumentBatch.findAll({
      attributes: ['id', 'batch_number', 'start_number', 'end_number']
    });

    for (const b of existingBatches) {
      if (doRangesOverlap(batchDetails.start_number, batchDetails.end_number, b.start_number, b.end_number)) {
        await transaction.rollback();
        return res.status(400).json({
          error: `نطاق السندات المطلوب [${batchDetails.start_number} - ${batchDetails.end_number}] يتداخل مع أمر صرف قائم مسبقاً برقم ${b.batch_number} بالنطاق [${b.start_number} - ${b.end_number}].`
        });
      }
    }

    // 5. إنشاء أمر الصرف الرئيسي
    const batchNumber = generateReferenceCode('BATCH');
    const newBatch = await DeliveryDocumentBatch.create({
      batch_number: batchNumber,
      inventory_manager_id: invManager.id,
      start_number: batchDetails.start_number,
      book_size: batchDetails.book_size,
      books_count: batchDetails.books_count,
      total_documents: batchDetails.total_documents,
      end_number: batchDetails.end_number,
      created_by: req.user.id,
      notes: notes || null
    }, { transaction });

    // 6. تقسيم وإنشاء الدفاتر الفرعية تلقائياً
    const booksToCreate = batchDetails.subBooks.map((sub, idx) => ({
      batch_id: newBatch.id,
      book_number: generateReferenceCode(`BOOK-${idx + 1}`),
      inventory_manager_id: invManager.id,
      driver_id: null,
      start_number: sub.start_number,
      end_number: sub.end_number,
      total_documents: sub.total_documents,
      used_documents_count: 0,
      remaining_documents_count: sub.total_documents,
      status: 'available',
      notes: null
    }));

    const createdBooks = await DeliveryDocumentBook.bulkCreate(booksToCreate, { transaction, returning: true });

    await transaction.commit();

    return res.status(201).json({
      message: 'تم إنشاء أمر صرف الدفاتر وتقسيمها بنجاح.',
      batch: newBatch,
      books: createdBooks,
      auto_start_number: batchDetails.start_number,
      previous_end_number: latestBatch ? latestBatch.end_number : null
    });

  } catch (error) {
    await transaction.rollback();
    console.error('Error creating delivery document batch:', error);
    return res.status(500).json({ error: 'حدث خطأ في السيرفر أثناء إنشاء أمر الصرف.' });
  }
};

/**
 * 2. عرض أوامر الصرف
 * GET /api/delivery-document-batches
 */
exports.getBatches = async (req, res) => {
  try {
    const { inventory_manager_id } = req.query;
    const where = {};

    if (inventory_manager_id) {
      where.inventory_manager_id = inventory_manager_id;
    } else if (req.user.role === 'inventory_manager') {
      where.inventory_manager_id = req.user.id;
    }

    const batches = await DeliveryDocumentBatch.findAll({
      where,
      include: [
        { model: User, as: 'inventoryManager', attributes: ['id', 'name', 'username'] },
        { model: User, as: 'createdBy', attributes: ['id', 'name', 'username'] },
        { model: DeliveryDocumentBook, as: 'books' }
      ],
      order: [['createdAt', 'DESC']]
    });

    const { nextStartNumber } = await getNextStartNumber();

    return res.status(200).json({ batches, next_start_number: nextStartNumber });
  } catch (error) {
    console.error('Error fetching delivery document batches:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء استرجاع أوامر الصرف.' });
  }
};

/**
 * 3. عرض الدفاتر (مع فلاتر البحث)
 * GET /api/delivery-document-books
 */
exports.getBooks = async (req, res) => {
  try {
    const { status, inventory_manager_id, driver_id } = req.query;
    const where = {};

    if (status) {
      where.status = status;
    }

    if (req.user.role === 'driver') {
      where.driver_id = req.user.id;
    } else if (driver_id) {
      where.driver_id = driver_id;
    }

    if (req.user.role === 'inventory_manager') {
      where.inventory_manager_id = req.user.id;
    } else if (inventory_manager_id) {
      where.inventory_manager_id = inventory_manager_id;
    }

    const books = await DeliveryDocumentBook.findAll({
      where,
      include: [
        { model: User, as: 'inventoryManager', attributes: ['id', 'name', 'username'] },
        { model: User, as: 'driver', attributes: ['id', 'name', 'username', 'phone'] },
        { model: User, as: 'assignedBy', attributes: ['id', 'name', 'username'] },
        { model: DeliveryDocumentBatch, as: 'batch', attributes: ['id', 'batch_number'] },
        { 
          model: DeliveryDocumentUsage, 
          as: 'usages',
          attributes: ['id', 'document_number', 'used_at', 'order_id'],
          include: [{ model: Order, as: 'order', attributes: ['id', 'order_number'] }]
        }
      ],
      order: [['start_number', 'ASC']]
    });

    return res.status(200).json({ books });
  } catch (error) {
    console.error('Error fetching delivery document books:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء استرجاع الدفاتر.' });
  }
};

/**
 * 4. صرف دفتر لسائق من قبل أمين المخزن
 * POST /api/delivery-document-books/:id/assign-driver
 */
exports.assignBookToDriver = async (req, res) => {
  try {
    const { id } = req.params;
    const { driver_id, notes } = req.body;

    if (!driver_id) {
      return res.status(400).json({ error: 'يرجى اختيار السائق المطلوب صرف الدفتر له.' });
    }

    const book = await DeliveryDocumentBook.findByPk(id);
    if (!book) {
      return res.status(404).json({ error: 'الدفتر المطلوب غير موجود.' });
    }

    if (req.user.role === 'inventory_manager' && book.inventory_manager_id !== req.user.id) {
      return res.status(403).json({ error: 'لا تملك صلاحية صرف هذا الدفتر لأنه ليس في عهدتك.' });
    }

    if (book.status !== 'available') {
      return res.status(400).json({ error: 'هذا الدفتر غير متاح للصرف (تم صرفه أو إغلاقه مسبقاً).' });
    }

    const driver = await User.findByPk(driver_id);
    if (!driver || driver.role !== 'driver') {
      return res.status(400).json({ error: 'المستخدم المحدد غير موجود أو ليس بدور سائق.' });
    }

    // فحص ما إذا كان لدى السائق دفاتر نشطة سابقة تحتوي على سندات متبقية
    const previousActiveBooks = await DeliveryDocumentBook.findAll({
      where: {
        driver_id: driver.id,
        status: { [Op.in]: ['assigned', 'partially_used'] },
        remaining_documents_count: { [Op.gt]: 0 }
      }
    });

    let warningInfo = null;
    if (previousActiveBooks.length > 0) {
      const totalRemaining = previousActiveBooks.reduce((sum, b) => sum + b.remaining_documents_count, 0);
      const ranges = previousActiveBooks.map(b => `[${b.start_number} - ${b.end_number}] (متبقي: ${b.remaining_documents_count})`).join(', ');

      warningInfo = {
        has_remaining_slips: true,
        remaining_count: totalRemaining,
        active_books_count: previousActiveBooks.length,
        details: `تنبيه: السائق ${driver.name} لديه ${totalRemaining} سندا متبقيا غير مستخدم في الدفاتر التالية: ${ranges}`
      };
    }

    // إجراء الصرف
    book.driver_id = driver.id;
    book.assigned_by = req.user.id;
    book.assigned_at = new Date();
    book.status = 'assigned';
    if (notes) book.notes = notes;

    await book.save();

    // إرسال إشعار لحظي عبر WebSocket للسائق
    try {
      const { notifyUser } = require('../services/notificationService');
      notifyUser(driver.id, 'DELIVERY_BOOK_ASSIGNED', {
        book_id: book.id,
        book_number: book.book_number,
        start_number: book.start_number,
        end_number: book.end_number,
        warning: warningInfo,
        message: warningInfo
          ? `تم صرف دفتر جديد لك برقم ${book.book_number} (النطاق: ${book.start_number} - ${book.end_number}). لديك أيضاً ${warningInfo.remaining_count} سندا غير مستخدم من دفاتر سابقة.`
          : `تم صرف دفتر جديد لك برقم ${book.book_number} (النطاق: ${book.start_number} - ${book.end_number}).`
      });
    } catch (notifErr) {
      console.error('فشل إرسال إشعار صرف الدفتر للسائق:', notifErr.message);
    }

    return res.status(200).json({
      message: `تم صرف الدفتر ${book.book_number} بنجاح للسائق ${driver.name}.`,
      book,
      warning: warningInfo
    });

  } catch (error) {
    console.error('Error assigning book to driver:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء صرف الدفتر للسائق.' });
  }
};

/**
 * 5. استرجاع السندات المتبقية والدفاتر النشطة لسائق معين أو للسائق الحالي
 * GET /api/delivery-document-books/driver-slips
 */
exports.getDriverSlipsSummary = async (req, res) => {
  try {
    const requestedDriverId = req.query.driver_id ? Number(req.query.driver_id) : null;
    const isDriver = req.user.role === 'driver';
    const isInventoryManager = req.user.role === 'inventory_manager';
    const targetDriverId = isDriver ? req.user.id : requestedDriverId;

    const baseWhere = isDriver
      ? { driver_id: req.user.id }
      : { driver_id: { [Op.ne]: null } };

    if (isInventoryManager) {
      baseWhere.inventory_manager_id = req.user.id;
    }

    const summaryBooks = await DeliveryDocumentBook.findAll({
      where: baseWhere,
      include: [
        { model: User, as: 'driver', attributes: ['id', 'name', 'username', 'phone'] }
      ],
      order: [['driver_id', 'ASC'], ['start_number', 'ASC']]
    });

    const driversMap = new Map();
    for (const book of summaryBooks) {
      if (!book.driver_id || !book.driver) continue;

      if (!driversMap.has(book.driver_id)) {
        driversMap.set(book.driver_id, {
          driver_id: book.driver_id,
          driver: book.driver,
          books_count: 0,
          active_books_count: 0,
          completed_books_count: 0,
          total_documents: 0,
          used_documents_count: 0,
          remaining_documents_count: 0,
          has_incomplete_books: false
        });
      }

      const summary = driversMap.get(book.driver_id);
      summary.books_count += 1;
      summary.total_documents += Number(book.total_documents || 0);
      summary.used_documents_count += Number(book.used_documents_count || 0);
      summary.remaining_documents_count += Number(book.remaining_documents_count || 0);

      if (['assigned', 'partially_used'].includes(book.status) && Number(book.remaining_documents_count || 0) > 0) {
        summary.active_books_count += 1;
        summary.has_incomplete_books = true;
      }

      if (['exhausted', 'closed'].includes(book.status) || Number(book.remaining_documents_count || 0) <= 0) {
        summary.completed_books_count += 1;
      }
    }

    const driversSummary = Array.from(driversMap.values()).sort((a, b) => {
      if (a.has_incomplete_books !== b.has_incomplete_books) return a.has_incomplete_books ? -1 : 1;
      return String(a.driver?.name || '').localeCompare(String(b.driver?.name || ''), 'ar');
    });

    const detailsWhere = { ...baseWhere };
    if (targetDriverId) {
      detailsWhere.driver_id = targetDriverId;
    } else if (!isDriver) {
      detailsWhere.status = { [Op.in]: ['assigned', 'partially_used'] };
      detailsWhere.remaining_documents_count = { [Op.gt]: 0 };
    }

    const books = await DeliveryDocumentBook.findAll({
      where: detailsWhere,
      include: [
        { model: User, as: 'driver', attributes: ['id', 'name', 'username', 'phone'] },
        { model: User, as: 'inventoryManager', attributes: ['id', 'name', 'username'] },
        { model: DeliveryDocumentBatch, as: 'batch', attributes: ['id', 'batch_number'] },
        {
          model: DeliveryDocumentUsage,
          as: 'usages',
          attributes: ['id', 'document_number', 'used_at', 'order_id'],
          include: [
            {
              model: Order,
              as: 'order',
              attributes: ['id', 'order_number', 'status', 'client_id', 'sales_rep_id', 'driver_id'],
              include: [
                { association: 'client', attributes: ['id', 'name'] },
                { association: 'salesRep', attributes: ['id', 'name', 'username'] }
              ]
            }
          ]
        }
      ],
      order: [['start_number', 'ASC']]
    });

    const booksSummary = books.map(book => {
      const usageByNumber = new Map(book.usages.map(usage => [Number(usage.document_number), usage]));
      const unusedNumbers = [];
      const usedSlips = [];
      const slipNumbers = [];

      for (let num = Number(book.start_number); num <= Number(book.end_number); num++) {
        const usage = usageByNumber.get(num);
        if (usage) {
          const usedSlip = {
            id: usage.id,
            document_number: usage.document_number,
            used_at: usage.used_at,
            order: usage.order ? {
              id: usage.order.id,
              order_number: usage.order.order_number,
              status: usage.order.status,
              client: usage.order.client || null,
              salesRep: usage.order.salesRep || null
            } : null
          };
          usedSlips.push(usedSlip);
          slipNumbers.push({ document_number: num, status: 'used', usage: usedSlip });
        } else {
          unusedNumbers.push(num);
          slipNumbers.push({ document_number: num, status: 'remaining', usage: null });
        }
      }

      return {
        id: book.id,
        book_number: book.book_number,
        batch: book.batch,
        driver: book.driver,
        inventoryManager: book.inventoryManager,
        start_number: book.start_number,
        end_number: book.end_number,
        total_documents: book.total_documents,
        used_documents_count: book.used_documents_count,
        remaining_documents_count: book.remaining_documents_count,
        status: book.status,
        assigned_at: book.assigned_at,
        unused_numbers: unusedNumbers,
        used_slips: usedSlips,
        slip_numbers: slipNumbers
      };
    });

    const totalRemainingSlips = booksSummary.reduce((sum, b) => sum + Number(b.remaining_documents_count || 0), 0);
    const totalUsedSlips = booksSummary.reduce((sum, b) => sum + Number(b.used_documents_count || 0), 0);

    return res.status(200).json({
      driver_id: targetDriverId,
      drivers_summary: driversSummary,
      total_remaining_slips: totalRemainingSlips,
      total_used_slips: totalUsedSlips,
      active_books: booksSummary,
      books: booksSummary
    });

  } catch (error) {
    console.error('Error fetching driver slips summary:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء استرجاع ملخص سندات السائق.' });
  }
};

/**
 * 6. تصدير تقرير الدفاتر وسجلات الاستخدام إلى ملف Excel للمطابقة
 * GET /api/delivery-document-books/export/excel
 */
exports.exportDeliveryBooksExcel = async (req, res) => {
  try {
    const exceljs = require('exceljs');
    const workbook = new exceljs.Workbook();
    workbook.creator = 'KMT OMS System';
    workbook.created = new Date();

    // Sheet 1: الدفاتر المصروفة
    const sheetBooks = workbook.addWorksheet('سجل الدفاتر المصروفة', { views: [{ rightToLeft: true }] });
    sheetBooks.columns = [
      { header: 'رقم الدفتر', key: 'book_number', width: 22 },
      { header: 'رقم أمر الصرف', key: 'batch_number', width: 22 },
      { header: 'أمين المخزن', key: 'inv_manager', width: 20 },
      { header: 'السائق المصروف له', key: 'driver', width: 20 },
      { header: 'بداية الرقم', key: 'start_number', width: 14 },
      { header: 'نهاية الرقم', key: 'end_number', width: 14 },
      { header: 'إجمالي السندات', key: 'total_documents', width: 15 },
      { header: 'المستخدَم', key: 'used_count', width: 12 },
      { header: 'المتبقي', key: 'remaining_count', width: 12 },
      { header: 'الحالة', key: 'status', width: 16 },
      { header: 'تاريخ الصرف', key: 'assigned_at', width: 20 }
    ];

    const books = await DeliveryDocumentBook.findAll({
      include: [
        { model: User, as: 'inventoryManager', attributes: ['name'] },
        { model: User, as: 'driver', attributes: ['name'] },
        { model: DeliveryDocumentBatch, as: 'batch', attributes: ['batch_number'] }
      ],
      order: [['start_number', 'ASC']]
    });

    books.forEach(b => {
      sheetBooks.addRow({
        book_number: b.book_number,
        batch_number: b.batch?.batch_number || '-',
        inv_manager: b.inventoryManager?.name || '-',
        driver: b.driver?.name || 'غير مصروف',
        start_number: b.start_number,
        end_number: b.end_number,
        total_documents: b.total_documents,
        used_count: b.used_documents_count,
        remaining_count: b.remaining_documents_count,
        status: b.status,
        assigned_at: b.assigned_at ? new Date(b.assigned_at).toLocaleString('ar-EG') : '-'
      });
    });

    // Sheet 2: سجل استخدام أرقام السندات
    const sheetUsages = workbook.addWorksheet('سجل استخدام السندات في الطلبات', { views: [{ rightToLeft: true }] });
    sheetUsages.columns = [
      { header: 'رقم السند الورقي', key: 'document_number', width: 20 },
      { header: 'رقم الدفتر', key: 'book_number', width: 22 },
      { header: 'رقم الطلب', key: 'order_number', width: 20 },
      { header: 'السائق', key: 'driver_name', width: 20 },
      { header: 'تاريخ الاستخدام', key: 'used_at', width: 20 }
    ];

    const usages = await DeliveryDocumentUsage.findAll({
      include: [
        { model: DeliveryDocumentBook, as: 'book', attributes: ['book_number'] },
        { model: Order, as: 'order', attributes: ['order_number'] },
        { model: User, as: 'driver', attributes: ['name'] }
      ],
      order: [['used_at', 'DESC']]
    });

    usages.forEach(u => {
      sheetUsages.addRow({
        document_number: u.document_number,
        book_number: u.book?.book_number || '-',
        order_number: u.order?.order_number || '-',
        driver_name: u.driver?.name || '-',
        used_at: u.used_at ? new Date(u.used_at).toLocaleString('ar-EG') : '-'
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="delivery_document_books_report.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exporting delivery document books excel:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء تصدير التقرير إلى Excel.' });
  }
};

