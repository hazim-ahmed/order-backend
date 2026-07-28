require('dotenv').config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('خطأ حرج: JWT_SECRET غير موجود أو قصير جداً. يجب أن يكون 32 حرفاً على الأقل.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const http = require('http');
const helmet = require('helmet');
const path = require('path');
const { sequelize } = require('./src/models');

const { initWebSocket } = require('./src/services/notificationService');
const { startDriverTimeoutMonitor } = require('./src/jobs/driverTimeoutMonitor');
const { startDatabaseBackupJob } = require('./src/jobs/databaseBackup');
const { startERPSyncJob } = require('./src/services/erpSync');
const { requestLogger } = require('./src/middlewares/loggerMiddleware');
const { authenticateToken } = require('./src/middlewares/auth');
const { startCleanupScheduler } = require('./src/services/cleanupJob');

const setupRoutes = require('./src/routes/setupRoutes');
const authRoutes = require('./src/routes/authRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const coreRoutes = require('./src/routes/coreRoutes');
const userRoutes = require('./src/routes/userRoutes');
const clientRoutes = require('./src/routes/clientRoutes');
const productRoutes = require('./src/routes/productRoutes');
const categoryRoutes = require('./src/routes/categoryRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');
const salesReturnRoutes = require('./src/routes/salesReturnRoutes');
const deliveryDocumentBookRoutes = require('./src/routes/deliveryDocumentBookRoutes');

const app = express();
const server = http.createServer(app);

initWebSocket(server);
startDriverTimeoutMonitor();
startDatabaseBackupJob();
startERPSyncJob();

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(u => u.trim())
  : ['http://localhost', 'http://localhost:80', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3000', 'http://127.0.0.1'];

app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://127.0.0.1') ||
      origin.endsWith('.onrender.com') ||
      origin.endsWith('.vercel.app')
    ) {
      callback(null, true);
    } else {
      callback(new Error('غير مسموح بطلب المصدر عبر إعدادات CORS.'));
    }
  },
  credentials: true
}));

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(requestLogger);

app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

app.get('/health/ready', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.status(200).json({ status: 'ready', database: 'connected', timestamp: new Date() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected', error: err.message });
  }
});

app.use('/uploads', authenticateToken, express.static(path.join(__dirname, 'uploads')));

app.use('/api/setup', setupRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/core', coreRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/sales-returns', salesReturnRoutes);
app.use('/api/delivery-document-books-manager', deliveryDocumentBookRoutes);

app.get('/', (req, res) => {
  res.send('مرحباً بك في نظام إدارة الطلبات KMT OMS - الخادم يعمل بنجاح');
});

async function runStartupMigrations() {
  try {
    const { User } = require('./src/models');
    const userCount = await User.count();
    if (userCount === 0) {
      console.log('قاعدة البيانات فارغة. سيتم توجيه المستخدم إلى واجهة تهيئة النظام لإنشاء حساب المسؤول.');
    }
  } catch (seedErr) {
    console.error('تحذير فحص الحسابات الأولية:', seedErr.message);
  }

  const schemaUpdates = [
    "ALTER TABLE orders ADD COLUMN shipped_tons DECIMAL(12,3) NULL DEFAULT NULL AFTER total_tons;",
    "ALTER TABLE orders ADD COLUMN delivery_reference_number VARCHAR(255) NULL DEFAULT NULL AFTER delivery_image_url;",
    "ALTER TABLE orders ADD COLUMN delivery_type ENUM('delivery', 'customer_pickup') NOT NULL DEFAULT 'delivery';",
    "ALTER TABLE orders ADD COLUMN pickup_driver_name VARCHAR(255) NULL DEFAULT NULL;",
    "ALTER TABLE orders ADD COLUMN pickup_vehicle_plate VARCHAR(255) NULL DEFAULT NULL;",
    "ALTER TABLE orders ADD COLUMN pickup_receiver_id VARCHAR(255) NULL DEFAULT NULL;",
    "ALTER TABLE order_items ADD COLUMN unit VARCHAR(50) NOT NULL DEFAULT 'kg';",
    "ALTER TABLE order_items ADD COLUMN entered_quantity DECIMAL(12,3) NULL DEFAULT NULL;",
    "ALTER TABLE orders ADD COLUMN freight_rate DECIMAL(12,3) NOT NULL DEFAULT 0;",
    "ALTER TABLE orders ADD COLUMN freight_unit VARCHAR(50) NOT NULL DEFAULT 'kg';",
    "ALTER TABLE orders ADD COLUMN freight_amount DECIMAL(15,3) NOT NULL DEFAULT 0;",
    "ALTER TABLE sales_return_items ADD COLUMN verified_missing_tons DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER verified_damaged_tons;",
    "ALTER TABLE sales_returns ADD COLUMN verified_missing_tons DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER verified_damaged_tons;",
    "ALTER TABLE sales_returns MODIFY COLUMN status ENUM('return_requested','sales_approved','finance_approved','in_transit','driver_delivered','inspected','returned_to_warehouse','credit_note_issued','rejected') NOT NULL DEFAULT 'return_requested';",
    "ALTER TABLE sales_returns ADD COLUMN refund_mode ENUM('good_only','good_and_damaged','all') NULL DEFAULT NULL AFTER rejection_reason;",
    "ALTER TABLE sales_returns ADD COLUMN original_order_status VARCHAR(255) NULL DEFAULT NULL AFTER refund_mode;",
    "ALTER TABLE sales_returns ADD COLUMN driver_delivered_at DATETIME NULL DEFAULT NULL AFTER finance_approved_at;",
    "ALTER TABLE orders ADD COLUMN document_posted_to_erp TINYINT(1) NOT NULL DEFAULT 0 AFTER delivery_reference_number;",
    "ALTER TABLE orders ADD COLUMN erp_invoice_number VARCHAR(255) NULL DEFAULT NULL AFTER document_posted_to_erp;",
    "ALTER TABLE orders ADD COLUMN document_posted_at DATETIME NULL DEFAULT NULL AFTER erp_invoice_number;",
    "ALTER TABLE orders ADD UNIQUE INDEX idx_orders_erp_invoice_number_unique (erp_invoice_number);"
  ];

  for (const statement of schemaUpdates) {
    try {
      await sequelize.query(statement);
    } catch (colErr) {}
  }

  try {
    const { DeliveryDocumentBatch, DeliveryDocumentBook, DeliveryDocumentUsage, SystemSetting } = require('./src/models');
    await DeliveryDocumentBatch.sync();
    await DeliveryDocumentBook.sync();
    await DeliveryDocumentUsage.sync();
    await SystemSetting.sync();
    console.log('تم تأكيد/مزامنة جداول دفاتر سندات التسليم وإعدادات النظام بنجاح.');
  } catch (syncErr) {
    console.error('خطأ في مزامنة جداول دفاتر سندات التسليم أو إعدادات النظام:', syncErr.message);
  }
}

const PORT = process.env.PORT || 5000;

server.listen(PORT, async () => {
  console.log(`السيرفر يعمل على المنفذ ${PORT}`);
  startCleanupScheduler();

  try {
    await sequelize.authenticate();
    console.log('تم تأكيد الاتصال بقاعدة البيانات.');
    await runStartupMigrations();
  } catch (error) {
    console.error('فشل الاتصال بقاعدة البيانات:', error);
  }
});