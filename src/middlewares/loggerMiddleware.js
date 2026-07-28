// ==============================================================================
// تاريخ التعديل والإنشاء: 2026-07-22
// الوظيفة: Middleware تسجيل وقياس كافة الطلبات والأخطاء في خادم الباك اند
// السياق: يلتقط كل طلب HTTP يحصل بالنظام ويحسب زمن استجابته ويسجله في سجلات النظام
// مرجع الأمان والتشغيل: Live Request Monitoring & Audit Logging
// ==============================================================================

const { addLog } = require('../services/loggerService');

/**
 * ==============================================================================
 * تاريخ التعديل: 2026-07-22
 * الوظيفة: برمجية وسيطة لالتقاط وتسجيل أداء وتفاصيل كل طلب HTTP
 * ==============================================================================
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();

  // الاستماع لانتهاء الاستجابة لحساب الوقت والحالة
  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    // استثناء طلبات الفحص العادية الصامتة لتقليل الضوضاء غير الضرورية
    if (req.originalUrl === '/' && statusCode === 200) return;

    let level = 'INFO';
    if (statusCode >= 500) {
      level = 'ERROR';
    } else if (statusCode >= 400) {
      level = 'WARN';
    }

    const message = `${req.method} ${req.originalUrl} - ${statusCode} (${durationMs}ms)`;
    const category = req.originalUrl.startsWith('/api/auth') ? 'AUTH' : 'HTTP';

    addLog({
      level,
      category,
      message,
      statusCode,
      durationMs,
      user: req.user ? { id: req.user.id, username: req.user.username || req.user.email, role: req.user.role } : null,
      details: {
        ip: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent'],
        query: Object.keys(req.query).length ? req.query : undefined
      }
    });
  });

  next();
}

module.exports = { requestLogger };
