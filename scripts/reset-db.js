require('dotenv').config();
const { sequelize } = require('../src/models');

/**
 * Script: reset-db.js
 * تصفير ومسح قاعدة البيانات بالكامل لإتاحة البدء من الصفر
 */
async function resetDatabase() {
  console.log('🔄 جاري تصفير ومسح كافة بيانات قاعدة البيانات...');
  try {
    // إعادة بناء وتفريغ الجداول بالكامل
    await sequelize.sync({ force: true });
    console.log('✅ تم تصفير قاعدة البيانات بنجاح! كود وقواعد البيانات الآن خالية 100%.');
    console.log('👉 النظام الآن جاهز تماماً للبدء من الصفر عبر واجهة التهيئة /setup.');
    process.exit(0);
  } catch (error) {
    console.error('❌ حدث خطأ أثناء تصفير قاعدة البيانات:', error.message);
    process.exit(1);
  }
}

resetDatabase();
