// ==============================================================================
// تاريخ التعديل: 2026-07-22
// الوظيفة: مسارات الطلبات ومخطط الصلاحيات المركزية (Order Operations Routes)
// السياق: ربط المسارات بـ permissions.js لضمان طبقة تحقق مركزية (Fix-Sec - Section 1)
// ==============================================================================

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { authorize } = require('../config/permissions');
const { createOrder, changeOrderStatus, getOrders, getOrderById, updateDocumentPosting } = require('../controllers/orderController');

// حماية جميع مسارات الطلبات بـ Middleware المصادقة التأكيدي
router.use(authenticateToken);

/**
 * @route   POST /api/orders
 * @desc    إنشاء طلب جديد
 * @access  مندوب المبيعات والأدمن
 */
router.post('/', authorize('order:create'), createOrder);

/**
 * @route   GET /api/orders
 * @desc    جلب قائمة الطلبات (مفلترة بحسب نطاق الصلاحيات الأفقي للمستخدم)
 * @access  جميع المستخدمين المصادقين
 */
router.get('/', getOrders);

/**
 * @route   PATCH /api/orders/:id/document-posting
 * @desc    تحديث علامة ترحيل سند التسليم ورقم فاتورة النظام الرئيسي
 * @access  مندوب المبيعات صاحب الطلب أو الأدمن
 */
router.patch('/:id/document-posting', updateDocumentPosting);
/**
 * @route   GET /api/orders/:id
 * @desc    جلب تفاصيل طلب محدد مع فحص الملكية الأفقية (IDOR Protection)
 * @access  جميع المستخدمين المصادقين وفقاً للصلاحيات
 */
router.get('/:id', getOrderById);

/**
 * @route   POST /api/orders/:id/transition
 * @desc    تغيير حالة الطلب وإدارة تسلسل الموافقة بين المسؤولين
 * @access  يتم الفحص المزدوج داخل stateMachine.js لمقاطعة الصلاحيات والحالات
 */
router.post('/:id/transition', changeOrderStatus);

module.exports = router;

