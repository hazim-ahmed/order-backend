/**
 * src/services/invoiceService.js
 * خدمة إصدار الفواتير بصيغة PDF وتوليد السجلات في قاعدة البيانات
 * 
 * [تم الإصلاح]:
 *  - جعل generateInvoice idempotent: إذا وجدت فاتورة للطلب يرجعها بدل إنشاء جديدة
 *  - منع تكرار الفواتير
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { Invoice, Order, OrderItem, Client, Product } = require('../models');

/**
 * توليد فاتورة لطلب محدد وإنشاء ملف PDF الخاص بها
 * [إصلاح] Idempotent: يتحقق أولاً إن كانت الفاتورة موجودة مسبقاً
 * @param {number} orderId - معرف الطلب
 */
const generateInvoice = async (orderId, options = {}) => {
  const { transaction } = options;
  try {
    // [إصلاح] التحقق من وجود فاتورة مسبقة لهذا الطلب
    const existingInvoice = await Invoice.findOne({ where: { order_id: orderId }, transaction });
    if (existingInvoice) {
      console.log(`ℹ️ فاتورة موجودة مسبقاً للطلب #${orderId}، لن يتم إنشاء فاتورة مكررة.`);
      return existingInvoice;
    }

    // 1. جلب بيانات الطلب بالكامل
    const order = await Order.findByPk(orderId, {
      include: [
        { model: Client, as: 'client' },
        { model: OrderItem, as: 'items', include: [{ model: Product, as: 'product' }] }
      ],
      transaction
    });

    if (!order) {
      throw new Error('الطلب غير موجود.');
    }

    if (order.status !== 'delivered') {
      throw new Error('لا يمكن إصدار فاتورة لطلب لم يتم تسليمه بعد.');
    }

    // التأكد من وجود مجلد الفواتير
    const invoicesDir = path.join(__dirname, '../../uploads/invoices');
    if (!fs.existsSync(invoicesDir)) {
      fs.mkdirSync(invoicesDir, { recursive: true });
    }

    const fileName = `invoice_${order.order_number}_${Date.now()}.pdf`;
    const filePath = path.join(invoicesDir, fileName);
    const pdfUrl = `/uploads/invoices/${fileName}`;

    // 2. إنشاء ملف PDF
    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(fs.createWriteStream(filePath));

    // عنوان الفاتورة
    doc.fontSize(20).text('Invoice (KMT OMS)', { align: 'center' });
    doc.moveDown();

    // بيانات العميل والطلب
    doc.fontSize(12).text(`Order Number: ${order.order_number}`);
    doc.text(`Date: ${new Date().toLocaleDateString()}`);
    doc.text(`Client Name: ${order.client?.name || 'N/A'}`);
    doc.text(`Total Amount: ${order.total_amount} SAR`);
    doc.moveDown();

    // جدول الأصناف مبسط
    doc.text('Items:', { underline: true });
    doc.moveDown(0.5);
    order.items.forEach(item => {
      doc.text(`- Product: ${item.product?.name || 'N/A'} | Quantity: ${item.quantity_tons} Tons | Price/Ton: ${item.price_per_ton_snapshot}`);
    });

    doc.moveDown(2);
    doc.text('Thank you for your business.', { align: 'center' });

    doc.end();

    // 3. إنشاء سجل الفاتورة في قاعدة البيانات
    const invoice = await Invoice.create({
      order_id: order.id,
      total_amount: order.total_amount,
      issued_at: new Date(),
      pdf_url: pdfUrl
    }, { transaction });

    console.log(`✅ تم إصدار فاتورة بنجاح للطلب: ${order.order_number}`);
    return invoice;

  } catch (error) {
    console.error('❌ خطأ في توليد الفاتورة:', error);
    throw error;
  }
};

module.exports = {
  generateInvoice
};
