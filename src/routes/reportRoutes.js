const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/auth');
const {
  getComprehensiveReport,
  updateShippedTons,
  exportExcelReport,
  getSystemLogs,
  clearSystemLogs
} = require('../controllers/reportController');

// كل مسارات التقارير تحتاج مصادقة قبل تطبيق صلاحيات الدور.
router.use(authenticateToken);

// التقرير الشامل محصور بالإدارة لأنه يعرض بيانات مالية وتشغيلية كاملة.
router.get('/comprehensive', requireRole(['admin']), getComprehensiveReport);

// تحديث كمية الشحن الفعلية مسموح للإدارة وأمين المخزن لأنه جزء من المطابقة التشغيلية.
router.put('/shipped-tons/:orderId', requireRole(['admin', 'inventory_manager']), updateShippedTons);

// تصدير Excel محصور بالإدارة لأنه يخرج ملفا شاملا خارج النظام.
router.get('/excel', requireRole(['admin']), exportExcelReport);

// سجلات النظام محصورة بالإدارة فقط.
router.get('/system-logs', requireRole(['admin']), getSystemLogs);

// تفريغ سجلات النظام محصور بالإدارة فقط.
router.delete('/system-logs', requireRole(['admin']), clearSystemLogs);

module.exports = router;