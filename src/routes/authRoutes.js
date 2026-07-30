// ==============================================================================
// تاريخ التعديل: 2026-07-22
// الوظيفة: مسارات المصادقة وتسجيل الدخول وتحديد محاولات التخمين
// السياق: حظر هجمات Brute Force مع السماح للمحاولات الصريحة وعدم قفل الحسابات الحقيقية
// مرجع الأمان: Backend Audit Section 1 & Auth Protection
// ==============================================================================

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/auth');

// ==============================================================================
// تاريخ التعديل: 2026-07-22
// الوظيفة: محدد محاولات تسجيل الدخول المرن (30 محاولة / 15 دقيقة)
// السياق: تخطي احتساب الطلبات الناجحة لمنع القفل العشوائي للمستخدمين
// ==============================================================================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 10, // 10 محاولة
  skipSuccessfulRequests: true, // عدم احتساب المحاولات الناجحة
  message: { error: 'تم تجاوز عدد محاولات تسجيل الدخول الخاطئة المسموح بها. يرجى المحاولة بعد 15 دقيقة.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * مسار تسجيل الدخول المباشر لحسابات النظام
 * POST /api/auth/login
 */
router.post('/login', loginLimiter, authController.login);

/**
 * مسار جلب بيانات المستخدم الحالي
 * GET /api/auth/me
 */
router.get('/me', authenticateToken, authController.getMe);

module.exports = router;
