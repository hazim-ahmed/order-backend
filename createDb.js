const mysql = require('mysql2/promise');

async function createDb() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
    });
    
    await connection.query('CREATE DATABASE IF NOT EXISTS kmt_oms;');
    console.log('✅ تم إنشاء قاعدة البيانات kmt_oms بنجاح!');
    process.exit(0);
  } catch (error) {
    console.error('❌ حدث خطأ:', error);
    process.exit(1);
  }
}

createDb();
