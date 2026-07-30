/**
 * src/services/notificationService.js
 * خدمة إدارة الإشعارات الفورية باستخدام Socket.io
 */

const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

// استيراد نموذج المستخدم للتحقق الحي من قاعدة البيانات
const { User } = require('../models');
const SOCKET_EVENTS = require('../constants/socketEvents');

let io;

// يقرأ أصول Socket.io المسموحة من CLIENT_URL و FRONTEND_URL مع دعم القيم المفصولة بفواصل.
const parseSocketOrigins = (...values) => {
  return Array.from(new Set(values
    .filter(Boolean)
    .flatMap(value => String(value).split(','))
    .map(value => value.trim())
    .filter(Boolean)));
};

// يضيف أصول التطوير المحلية فقط خارج الإنتاج حتى لا تصبح قاعدة الإنتاج مفتوحة.
const getSocketAllowedOrigins = () => {
  const origins = parseSocketOrigins(process.env.CLIENT_URL, process.env.FRONTEND_URL);
  if (process.env.NODE_ENV !== 'production') {
    const localOrigins = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3000'];
    origins.push(...localOrigins.filter(origin => !origins.includes(origin)));
  }
  return origins;
};
// ==============================================================================
// تاريخ التعديل: 2026-07-22
// الوظيفة: تهيئة خادم Socket.io وتطبيق برمجية المصادقة المشددة للاتصالات اللحظية
// السياق: يفحص نشاط حساب المستخدم في قاعدة البيانات عند كل اتصال لمنع المحظورين من استلام الإشعارات
// المدخلات: كائن خادم الـ HTTP
// المخرجات: تهيئة كائن io وتوصيل الغرف الصلاحياتية
// مرجع الأمان: Backend Audit Sec 5 & Phase 3.2 WebSocket Security
// ==============================================================================
const initWebSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: getSocketAllowedOrigins(),
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // ==============================================================================
  // تاريخ التعديل: 2026-07-22
  // الوظيفة: Middleware المصادقة المشددة لاتصال WebSocket
  // السياق: يضمن الاستعلام الحي من قاعدة البيانات للتأكد من حالة حساب المستخدم (is_active)
  // المدخلات: socket.handshake.auth.token
  // المخرجات: قبول الاتصال وتعيين socket.user أو رفضه بـ Error
  // ==============================================================================
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) {
        return next(new Error('تسجيل الدخول مطلوب للاتصال بالإشعارات.'));
      }

      // فك التوكن والتأكد من الصلاحية
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded || !decoded.id) {
        return next(new Error('رمز المصادقة غير صالح.'));
      }

      // فحص حي من قاعدة البيانات للتأكد من وجود المستخدم ونشاط حسابه
      const user = await User.findByPk(decoded.id);
      if (!user || !user.is_active) {
        return next(new Error('الحساب غير نشط أو تم إلغاؤه من قبل الإدارة.'));
      }

      // تخزين بيانات المستخدم المؤكدة في كائن الـ socket
      socket.user = {
        id: user.id,
        role: user.role,
        full_name: user.full_name,
        email: user.email
      };

      next();
    } catch (err) {
      console.error('❌ خطأ في مصادقة اتصال WebSocket:', err.message);
      return next(new Error('فشلت عملية مصادقة الاتصال اللحظي.'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 مستخدم متصل وموثق عبر WebSocket: ${socket.user.id} (${socket.user.role})`);

    // إلحاق المستخدم بغرفة الدور الوظيفي وغرفة المستخدم الشخصية
    socket.join(`role_${socket.user.role}`);
    socket.join(`user_${socket.user.id}`);

    socket.on('disconnect', () => {
      console.log(`🔌 قطع اتصال WebSocket: ${socket.user.id}`);
    });
  });
};

/**
 * إرسال إشعار لدور وظيفي محدد
 * @param {string} role - الدور الوظيفي (مثال: 'inventory_manager')
 * @param {string} event - اسم الحدث
 * @param {object} data - البيانات المرسلة
 */
const notifyRole = (role, event, data) => {
  if (io) {
    io.to(`role_${role}`).emit(event, data);
  }
};

/**
 * إرسال إشعار لمستخدم محدد
 * @param {number} userId - معرف المستخدم
 * @param {string} event - اسم الحدث
 * @param {object} data - البيانات المرسلة
 */
const notifyUser = (userId, event, data) => {
  if (io) {
    io.to(`user_${userId}`).emit(event, data);
  }
};

module.exports = {
  initWebSocket,
  notifyRole,
  notifyUser
};
