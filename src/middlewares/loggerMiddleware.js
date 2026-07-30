// ==============================================================================
// تاريخ التعديل والإنشاء: 2026-07-22
// الوظيفة: Middleware تسجيل وقياس كافة الطلبات والأخطاء في خادم الباك اند
// السياق: يلتقط كل طلب HTTP يحصل بالنظام ويحسب زمن استجابته ويسجله في سجلات النظام
// مرجع الأمان والتشغيل: Live Request Monitoring & Audit Logging
// ==============================================================================

const { addLog } = require('../services/loggerService');

// قائمة مفاتيح query التي لا يجب حفظ قيمها في السجلات.
const SENSITIVE_QUERY_KEYS = ['token', 'access_token', 'refresh_token', 'password', 'secret', 'api_key', 'key'];

// يخفي القيم الحساسة من query params مع إبقاء أسماء الحقول لأغراض التشخيص.
const redactSensitiveQuery = (query = {}) => {
  const redacted = {};
  for (const [key, value] of Object.entries(query)) {
    const normalizedKey = key.toLowerCase();
    redacted[key] = SENSITIVE_QUERY_KEYS.some(sensitiveKey => normalizedKey.includes(sensitiveKey)) ? '[REDACTED]' : value;
  }
  return redacted;
};

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
    const safeQuery = redactSensitiveQuery(req.query);

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
        query: Object.keys(safeQuery).length ? safeQuery : undefined
      }
    });
  });

  next();
}

module.exports = { requestLogger };
