const jwt = require('jsonwebtoken');
const { User } = require('../models');

/**
 * Middleware: authenticateToken
 * يقوم بفحص ترويسة الطلب (Authorization Header) للبحث عن رمز JWT.
 * بعد فك التشفير، يتحقق من أن المستخدم لا يزال نشطاً في قاعدة البيانات.
 * هذا يمنع المستخدمين المعطلين من استخدام توكنات قديمة.
 */
exports.authenticateToken = async (req, res, next) => {
  // 1. استخراج الرمز من الـ Header (صيغة Bearer Token)
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // 2. إذا لم يتم إرسال رمز، يتم رفض الطلب
  if (!token) {
    return res.status(401).json({ error: 'غير مصرح لك بالوصول. الرجاء تسجيل الدخول.' });
  }

  try {
    // 3. التحقق من صحة الرمز باستخدام المفتاح السري
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 4. [إصلاح أمني] جلب المستخدم من قاعدة البيانات والتأكد من:
    //    - المستخدم موجود
    //    - is_active = true
    //    - الدور الحالي مطابق لما في التوكن
    const user = await User.findByPk(decoded.id, {
      attributes: ['id', 'name', 'username', 'role', 'is_active']
    });

    if (!user) {
      return res.status(401).json({ error: 'المستخدم غير موجود. قد يكون تم حذف الحساب.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'تم تعطيل حسابك. يرجى مراجعة مسؤول النظام.' });
    }

    if (user.role !== decoded.role) {
      return res.status(403).json({ error: 'تم تغيير صلاحياتك. يرجى تسجيل الدخول مجدداً.' });
    }

    // 5. حفظ بيانات المستخدم في كائن الطلب والانتقال للدالة التالية
    req.user = { id: user.id, name: user.name, role: user.role };
    next();

  } catch (err) {
    return res.status(403).json({ error: 'رمز التوثيق غير صالح أو منتهي الصلاحية.' });
  }
};

/**
 * Middleware: requireRole
 * مصمم لتطبيق نظام الصلاحيات (RBAC).
 * يستقبل مصفوفة بالأدوار المسموح لها بالوصول لهذا المسار.
 * يجب استدعاؤه *بعد* authenticateToken لضمان وجود req.user.
 * 
 * @param {Array} allowedRoles - مصفوفة بالأدوار المسموحة (مثال: ['admin', 'sales_manager'])
 */
exports.requireRole = (allowedRoles) => {
  return (req, res, next) => {
    // 1. التحقق مما إذا كان دور المستخدم الحالي موجوداً ضمن الأدوار المسموحة
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'صلاحياتك لا تسمح لك بالقيام بهذا الإجراء.' });
    }
    
    // 2. إذا كان مصرحاً له، يتم الانتقال إلى الـ Controller
    next();
  };
};
