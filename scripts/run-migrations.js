require('dotenv').config();

const { sequelize } = require('../src/models');
const { runAllMigrations } = require('../src/migrations/001_initial_schema_updates');

// يشغل ترقيات قاعدة البيانات يدويا قبل النشر بدلا من تشغيل DDL عند إقلاع السيرفر.
const main = async () => {
  try {
    await sequelize.authenticate();
    await runAllMigrations();
    console.log('All migrations completed successfully.');
  } catch (error) {
    console.error('Migration runner failed:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
};

main();