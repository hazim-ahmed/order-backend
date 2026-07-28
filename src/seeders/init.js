const bcrypt = require('bcryptjs');
const { sequelize, User, Client, Product } = require('../models');

// ==============================================================================
// تاريخ التعديل: 2026-07-22
// الوظيفة: دالة زرع البيانات الأولية للاختبار (Seeder)
// السياق: يحل ثغرة استخدام force:true والسكربتات الخطيرة في الإنتاج (Backend Audit - Section 6)
// ==============================================================================
const seedDatabase = async () => {
  try {
    // تعليق أمني: حظر تشغيل السكربت الذي يمسح الجداول في بيئة الإنتاج فوراً
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ حظر أمني: يمنع تشغيل seeder زرع البيانات مسح الجداول (force: true) في بيئة الإنتاج!');
      process.exit(1);
    }

    // 1. مزامنة قاعدة البيانات وإعادة إنشائها (تحذير: سيمسح البيانات القديمة)
    console.log('🔄 جاري إعادة تهيئة قاعدة البيانات...');
    await sequelize.sync({ force: true });
    
    // 2. إنشاء كلمة مرور مشفرة موحدة للحسابات الاختبارية
    const defaultPassword = await bcrypt.hash('123456', 10);

    // 3. إنشاء حسابات المستخدمين (الأدوار المختلفة)
    console.log('👥 جاري إنشاء حسابات المستخدمين...');
    await User.bulkCreate([
      { name: 'أحمد المحاسب', username: 'admin1', password_hash: defaultPassword, role: 'admin' },
      { name: 'خالد مدير المبيعات', username: 'manager1', password_hash: defaultPassword, role: 'sales_manager' },
      { name: 'عمر المندوب', username: 'rep1', password_hash: defaultPassword, role: 'sales_rep' },
      { name: 'سالم أمين المخزن', username: 'inventory1', password_hash: defaultPassword, role: 'inventory_manager' },
      { name: 'يوسف السائق', username: 'driver1', password_hash: defaultPassword, role: 'driver' }
    ]);

    // 4. إنشاء عملاء اختبار
    console.log('🏢 جاري إنشاء العملاء...');
    await Client.bulkCreate([
      { name: 'مصنع الحديد والصلب', erp_id: 'C-001', phone: '0500000001', address: 'المنطقة الصناعية الأولى' },
      { name: 'مصنع البلاستيك الوطني', erp_id: 'C-002', phone: '0500000002', address: 'المنطقة الصناعية الثانية' }
    ]);

    // 5. إنشاء مواد خام بأسعار افتراضية وكميات مخزون
    console.log('📦 جاري إنشاء المواد الخام...');
    await Product.bulkCreate([
      { name: 'مادة خام أ (بودرة)', unit: 'kg', current_price_per_ton: 0.500, stock_quantity: 150000.000, erp_id: 'P-001' },
      { name: 'مادة خام ب (سائل)', unit: 'kg', current_price_per_ton: 0.350, stock_quantity: 50000.000, erp_id: 'P-002' },
      { name: 'مادة خام ج (حبيبات)', unit: 'kg', current_price_per_ton: 0.800, stock_quantity: 10000.000, erp_id: 'P-003' }
    ]);

    console.log('✅ تم الانتهاء من زرع البيانات بنجاح! يمكنك الآن تسجيل الدخول بكلمة المرور 123456');
    process.exit(0); // إنهاء العملية بنجاح
  } catch (error) {
    console.error('❌ حدث خطأ أثناء زرع البيانات:', error);
    process.exit(1);
  }
};

seedDatabase();
