/**
 * src/services/erpSync.js
 * خدمة المزامنة مع نظام الـ ERP (Mocked)
 */

const { Client, Product } = require('../models');
const cron = require('node-cron');

/**
 * دالة تحاكي الاتصال بـ API الخاص بـ ERP لجلب البيانات
 * في الواقع سيتم استخدام axios.get('ERP_URL')
 */
const fetchMockERPData = async () => {
  // محاكاة تأخير الشبكة
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        clients: [
          { erp_id: 'ERP-C-100', name: 'مصنع الأمل للبلوك', phone: '0500000001', address: 'الرياض - المنطقة الصناعية الأولى' },
          { erp_id: 'ERP-C-101', name: 'شركة البناء الحديث', phone: '0500000002', address: 'جدة - الصناعية' }
        ],
        products: [
          { erp_id: 'ERP-P-200', name: 'أسمنت بورتلاندي', current_price_per_ton: 210.500 },
          { erp_id: 'ERP-P-201', name: 'رمل مغسول', current_price_per_ton: 45.000 },
          { erp_id: 'ERP-P-202', name: 'بحص (حصى)', current_price_per_ton: 55.000 }
        ]
      });
    }, 1500);
  });
};

/**
 * تنفيذ عملية المزامنة
 */
const syncWithERP = async () => {
  console.log('🔄 جاري بدء المزامنة مع الـ ERP...');
  
  try {
    const data = await fetchMockERPData();

    // 1. مزامنة العملاء
    for (const clientData of data.clients) {
      const [client, created] = await Client.findOrCreate({
        where: { erp_id: clientData.erp_id },
        defaults: {
          name: clientData.name,
          phone: clientData.phone,
          address: clientData.address,
          synced_at: new Date()
        }
      });

      if (!created) {
        // تحديث البيانات إذا كان موجوداً
        client.name = clientData.name;
        client.phone = clientData.phone;
        client.address = clientData.address;
        client.synced_at = new Date();
        await client.save();
      }
    }

    // 2. مزامنة المنتجات والأسعار
    for (const productData of data.products) {
      const [product, created] = await Product.findOrCreate({
        where: { erp_id: productData.erp_id },
        defaults: {
          name: productData.name,
          current_price_per_ton: productData.current_price_per_ton,
          stock_quantity: 0, // المخزون لا يأتي من الـ ERP حسب المتطلبات، فقط الأسعار
          unit: 'kg'
        }
      });

      if (!created) {
        // تحديث السعر فقط (لا نمس المخزون الداخلي)
        product.name = productData.name;
        product.current_price_per_ton = productData.current_price_per_ton;
        await product.save();
      }
    }

    console.log('✅ اكتملت المزامنة بنجاح مع الـ ERP.');
  } catch (error) {
    console.error('❌ فشل المزامنة مع الـ ERP:', error);
  }
};

/**
 * بدء مهمة المزامنة المجدولة (كل 30 دقيقة)
 */
const startERPSyncJob = () => {
  cron.schedule('*/30 * * * *', () => {
    syncWithERP();
  });
};

module.exports = {
  syncWithERP,
  startERPSyncJob
};
