require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function init() {
  const host = process.env.DB_HOST || 'db';
  const port = parseInt(process.env.DB_PORT, 10) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASS || '';
  const database = process.env.DB_NAME || 'kmt_oms';

  console.log(`⏳ Connecting to MySQL server at ${host}...`);

  // Wait loop for MySQL to be ready
  let connection;
  let retries = 20;
  while (retries > 0) {
    try {
      connection = await mysql.createConnection({
        host,
        port,
        user,
        password,
        connectTimeout: 10000
      });
      console.log('✅ Connected to MySQL server.');
      break;
    } catch (err) {
      console.log(`⚠️ MySQL not ready yet: ${err.message}. Retrying in 3 seconds... (${retries} retries left)`);
      retries -= 1;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  if (!connection) {
    console.error('❌ Could not connect to MySQL server.');
    process.exit(1);
  }

  // Create database if not exists
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\`;`);
  console.log(`✅ Database "${database}" checked/created.`);
  await connection.end();

  // Sync schema via Sequelize
  const { sequelize, User } = require('../src/models');

  console.log('🔄 Syncing database schema...');
  await sequelize.sync({ force: false });
  console.log('✅ Database schema synchronized.');

  // Initial Admin User Setup (only if specified via environment variables)
  const userCount = await User.count();
  if (userCount === 0) {
    const adminUser = process.env.INITIAL_ADMIN_USERNAME;
    const adminPass = process.env.INITIAL_ADMIN_PASSWORD;

    if (adminUser && adminPass) {
      console.log(`👥 Seeding initial admin user "${adminUser}"...`);
      const hashedPassword = await bcrypt.hash(adminPass, 12);
      await User.create({
        name: 'مدير النظام',
        username: adminUser,
        password_hash: hashedPassword,
        role: 'admin',
        is_active: true
      });
      console.log('✅ Initial admin user created successfully.');
    } else {
      console.log('👥 No users found. Skipping dummy seeding. Admin must create users from scratch via UI/setup.');
    }
  } else {
    console.log('ℹ️ Database already initialized with existing users.');
  }

  process.exit(0);
}

init().catch(err => {
  console.error('❌ Error during database initialization:', err);
  process.exit(1);
});
