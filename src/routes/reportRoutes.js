// ==============================================================================
// تاريخ التعديل: 2026-07-22
// الوظيفة: مسارات تقارير الإدارة وسجلات النظام والمراقبة الحية
// السياق: تم إدراج مسارات جلب وتفريغ سجلات الأخطاء والمراقبة اللحظية للسيرفر
// مرجع الأمان: System Monitoring & Audit Log Authorization
// ==============================================================================

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

// حماية مسارات التقارير بالإدارة فقط
router.use(authenticateToken);
router.use(requireRole(['admin']));

/**
 * @route   GET /api/reports/comprehensive
 * @desc    جلب بيانات التقارير الشاملة ومطابقة الشحن وأداء المناديب
 */
router.get('/comprehensive', getComprehensiveReport);

/**
 * @route   PUT /api/reports/shipped-tons/:orderId
 * @desc    تحديث كمية الشحن الفعلية لطلب معين للمطابقة
 */
router.put('/shipped-tons/:orderId', updateShippedTons);

/**
 * @route   GET /api/reports/excel
 * @desc    تصدير التقرير الشامل بـ 3 أوراق عمل في ملف Excel واحد
 */
router.get('/excel', exportExcelReport);

/**
 * @route   GET /api/reports/system-logs
 * @desc    جلب سجلات النظام والمؤشرات اللحظية لأداء السيرفر والميموري
 */
router.get('/system-logs', getSystemLogs);

/**
 * @route   DELETE /api/reports/system-logs
 * @desc    تفريغ سجلات الذاكرة بالنظام
 */
router.delete('/system-logs', clearSystemLogs);

module.exports = router;
