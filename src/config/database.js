// إعداد مكتبة التعامل مع قاعدة البيانات Sequelize
const { Sequelize } = require('sequelize');
require('dotenv').config();

/**
 * تهيئة كائن الاتصال بقاعدة البيانات
 * نستخدم متغيرات البيئة المحملة من ملف .env لتأمين البيانات الحساسة
 * تم إضافة إعدادات pool للحفاظ على استقرار الاتصال ومنع سقوط الخادم تحت الضغط
 * 
 * [تم الإصلاح]: نقل استدعاء testConnection() إلى server.js لمنع الاتصال التلقائي عند الاستيراد
 */
const sequelize = new Sequelize(
  process.env.DB_NAME, 
  process.env.DB_USER, 
  process.env.DB_PASS, 
  {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    dialect: 'mysql', // تحديد نوع قاعدة البيانات كموجه في الخطة
    logging: false, // تعطيل السجلات الكثيفة لـ Sequelize في الطرفية لتبقى نظيفة
    dialectOptions: {
      connectTimeout: 60000 // إعطاء مهلة 60 ثانية للاتصال لتجنب مشاكل بطء الاتصال
    },
    pool: {
      max: 10,       // أقصى عدد للاتصالات المتزامنة
      min: 0,        // أقل عدد للاتصالات (صفر يسمح بإغلاقها عند الخمول)
      acquire: 30000, // أقصى وقت بالميللي ثانية لمحاولة جلب اتصال قبل رمي خطأ
      idle: 10000    // أقصى وقت يبقى فيه الاتصال خاملاً قبل إغلاقه
    }
  }
);

module.exports = sequelize;
