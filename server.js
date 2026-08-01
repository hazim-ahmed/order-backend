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
const erpSettingsRoutes = require('./src/routes/erpSettingsRoutes');
const categoryRoutes = require('./src/routes/categoryRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');
const salesReturnRoutes = require('./src/routes/salesReturnRoutes');
const deliveryDocumentBookRoutes = require('./src/routes/deliveryDocumentBookRoutes');

const app = express();

// Render يرسل X-Forwarded-For عبر reverse proxy، وهذا الإعداد يجعل rate limit يحسب IP الصحيح.
const trustProxyValue = process.env.TRUST_PROXY || (process.env.NODE_ENV === 'production' ? '1' : '0');
if (trustProxyValue !== '0' && trustProxyValue !== 'false') {
  const numericTrustProxy = Number(trustProxyValue);
  app.set('trust proxy', Number.isNaN(numericTrustProxy) ? trustProxyValue : numericTrustProxy);
}

const server = http.createServer(app);

initWebSocket(server);
startDriverTimeoutMonitor();
startDatabaseBackupJob();
startERPSyncJob();

// يقرأ قائمة الأصول المسموحة من متغيرات البيئة ويدعم الفصل بالفواصل.
const parseAllowedOrigins = (...values) => {
  return Array.from(new Set(values
    .filter(Boolean)
    .flatMap(value => String(value).split(','))
    .map(value => value.trim())
    .filter(Boolean)));
};

// نسمح محليا بمنافذ التطوير فقط خارج الإنتاج لتجنب فتح CORS على منصات عامة.
const localDevOrigins = ['http://localhost', 'http://localhost:80', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3000', 'http://127.0.0.1'];
const allowedOrigins = parseAllowedOrigins(process.env.CLIENT_URL, process.env.FRONTEND_URL);
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(...localDevOrigins.filter(origin => !allowedOrigins.includes(origin)));
}

// يفحص الأصل الوارد بدقة؛ في الإنتاج لا توجد سماحات wildcard على نطاقات الاستضافة العامة.
const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;

  try {
    const parsedOrigin = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname);
  } catch (error) {
    return false;
  }
};

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
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
app.use('/api/erp-settings', erpSettingsRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/sales-returns', salesReturnRoutes);
app.use('/api/delivery-document-books-manager', deliveryDocumentBookRoutes);

app.get('/', (req, res) => {
  res.send('مرحباً بك في نظام إدارة الطلبات KMT OMS - الخادم يعمل بنجاح');
});

// يعالج أي خطأ غير ملتقط من Express برسالة عامة في الإنتاج.
app.use((err, req, res, next) => {
  console.error('Unhandled Express error:', err);
  if (res.headersSent) return next(err);
  const statusCode = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' ? 'حدث خطأ داخلي في الخادم.' : err.message;
  return res.status(statusCode).json({ error: message });
});
async function runStartupChecks() {
  try {
    const { User } = require('./src/models');
    const userCount = await User.count();
    if (userCount === 0) {
      console.log('قاعدة البيانات فارغة. سيتم توجيه المستخدم إلى واجهة تهيئة النظام لإنشاء حساب المسؤول.');
    }
  } catch (seedErr) {
    console.error('تحذير فحص الحسابات الأولية:', seedErr.message);
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
    await runStartupChecks();
  } catch (error) {
    console.error('فشل الاتصال بقاعدة البيانات:', error);
  }
});