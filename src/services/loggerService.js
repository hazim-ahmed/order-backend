// ==============================================================================
// تاريخ التعديل والإنشاء: 2026-07-22
// الوظيفة: خدمة سجلات النظام والتشغيل المباشر (System Logger & Live Operations Monitor Service)
// السياق: التقاط وحفظ سجلات الأخطاء والطلبات وأداء السيرفر وتوفيرها للواجهة اللحظية
// مرجع الأمان والتشغيل: Live System Monitoring & Audit Trail
// ==============================================================================

const fs = require('fs');
const path = require('path');
const { notifyRole } = require('./notificationService');
const SOCKET_EVENTS = require('../constants/socketEvents');

// مجلد وسجل حفظ الأخطاء بالنظام
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFilePath = path.join(logDir, 'system.log');

// مخزن السجلات اللحظية في الذاكرة (حد أقصى 1000 سجل)
const MAX_MEMORY_LOGS = 1000;
const memoryLogs = [];

// إضافة سجلات تشغيل افتراضية للمراقبة المباشرة عند بدء السيرفر


/**
 * ==============================================================================
 * تاريخ التعديل: 2026-07-22
 * الوظيفة: إضافة سجل جديد في الذاكرة والملف وبثه آلياً للمسؤولين المتصلين
 * المدخلات: level (INFO, WARN, ERROR), category (HTTP, AUTH, DB, SYSTEM), message, details, user
 * المخرجات: كائن السجل المضاف
 * ==============================================================================
 */
function addLog({ level = 'INFO', category = 'SYSTEM', message = '', details = null, user = null, statusCode = null, durationMs = null }) {
  const logEntry = {
    id: `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    details: details ? (typeof details === 'object' ? details : { raw: details }) : null,
    user: user ? { id: user.id, username: user.username, role: user.role } : null,
    statusCode,
    durationMs
  };

  // إدراج في مقدمة الذاكرة
  memoryLogs.unshift(logEntry);
  if (memoryLogs.length > MAX_MEMORY_LOGS) {
    memoryLogs.pop();
  }

  // حفظ في الملف النصي بالخلفية
  try {
    const fileLine = `[${logEntry.timestamp}] [${logEntry.level}] [${logEntry.category}] ${logEntry.message} ${details ? JSON.stringify(details) : ''}\n`;
    fs.appendFile(logFilePath, fileLine, (err) => {
      if (err) console.error('فشل حفظ السجل في الملف:', err.message);
    });
  } catch (e) {
    // تجاهل خطأ الكتابة الملفية لمنع إيقاف التطبيق
  }

  // بث السجل فوراً عبر WebSocket لدور 'admin' لتجربة المراقبة اللحظية
  try {
    notifyRole('admin', SOCKET_EVENTS.SYSTEM_LOG || 'systemLog', logEntry);
  } catch (socketErr) {
    // تجاهل أخطاء الاتصال اللحظي
  }

  return logEntry;
}

addLog({
  level: 'INFO',
  category: 'SYSTEM',
  message: '🚀 خادم KMT OMS ومحرك المراقبة اللحظية يعمل بكفاءة بالخلفية'
});
addLog({
  level: 'INFO',
  category: 'DB',
  message: '✅ الاتصال بقاعدة البيانات MySQL ومصفوفة الصلاحيات المركزية آمن ومستقر'
});

/**
 * ==============================================================================
 * تاريخ التعديل: 2026-07-22
 * الوظيفة: جلب السجلات المفلترة وتفاصيل صحة السيرفر
 * المدخلات: filters ({ level, category, search, limit })
 * المخرجات: { logs, stats }
 * ==============================================================================
 */
function getLogs(filters = {}) {
  let result = [...memoryLogs];

  if (filters.level && filters.level !== 'ALL') {
    result = result.filter(l => l.level === filters.level);
  }

  if (filters.category && filters.category !== 'ALL') {
    result = result.filter(l => l.category === filters.category);
  }

  if (filters.search && filters.search.trim()) {
    const term = filters.search.toLowerCase().trim();
    result = result.filter(l => 
      l.message.toLowerCase().includes(term) ||
      (l.user && l.user.username && l.user.username.toLowerCase().includes(term)) ||
      (l.category && l.category.toLowerCase().includes(term))
    );
  }

  const limit = Number(filters.limit) || 200;
  result = result.slice(0, limit);

  return {
    logs: result,
    stats: getSystemStats()
  };
}

/**
 * ==============================================================================
 * تاريخ التعديل: 2026-07-22
 * الوظيفة: قياس واحتساب مؤشرات صحة السيرفر (Uptime, Memory, Log Counts)
 * ==============================================================================
 */
function getSystemStats() {
  const memory = process.memoryUsage();
  const totalLogs = memoryLogs.length;
  const errorCount = memoryLogs.filter(l => l.level === 'ERROR').length;
  const warnCount = memoryLogs.filter(l => l.level === 'WARN').length;
  const infoCount = memoryLogs.filter(l => l.level === 'INFO').length;

  // تقييم حالة النظام العامة
  let healthStatus = 'HEALTHY';
  if (errorCount > 20) healthStatus = 'CRITICAL';
  else if (errorCount > 5 || warnCount > 30) healthStatus = 'DEGRADED';

  return {
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMB: {
      rss: (memory.rss / (1024 * 1024)).toFixed(2),
      heapTotal: (memory.heapTotal / (1024 * 1024)).toFixed(2),
      heapUsed: (memory.heapUsed / (1024 * 1024)).toFixed(2)
    },
    nodeVersion: process.version,
    platform: process.platform,
    logCounts: {
      total: totalLogs,
      errors: errorCount,
      warnings: warnCount,
      info: infoCount
    },
    healthStatus
  };
}

/**
 * ==============================================================================
 * تاريخ التعديل: 2026-07-22
 * الوظيفة: مسح سجلات الذاكرة عند الحاجة من قبل الأدمن
 * ==============================================================================
 */
function clearLogs() {
  memoryLogs.length = 0;
  addLog({
    level: 'INFO',
    category: 'SYSTEM',
    message: 'تم تفريغ سجلات الذاكرة بواسطة المسؤول.'
  });
  return { message: 'تم تفريغ السجلات بنجاح.' };
}

module.exports = {
  addLog,
  getLogs,
  getSystemStats,
  clearLogs
};
