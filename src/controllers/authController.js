const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User } = require('../models');

/**
 * Controller: authController
 * يتعامل مع عمليات تسجيل الدخول وجلب بيانات المستخدم الحالي.
 */

/**
 * دالة تسجيل الدخول (Login)
 * تستقبل اسم المستخدم وكلمة المرور من الطلب (Request).
 * تبحث عن المستخدم، تتحقق من صحة كلمة المرور، وتصدر رمز JWT إذا كانت صحيحة.
 */
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // 1. التحقق من إرسال البيانات
    if (!username || !password) {
      return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
    }

    // 2. البحث عن المستخدم في قاعدة البيانات والتأكد من أنه نشط
    const user = await User.findOne({ where: { username, is_active: true } });
    if (!user) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    // 3. التحقق من تطابق كلمة المرور المشفرة
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    // 4. إنشاء رمز التوثيق (JWT Token) بصلاحية موحدة لجميع المستخدمين عبر الويب
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    // 6. إرجاع الرد الناجح مع الرمز وبيانات المستخدم الأساسية
    res.status(200).json({
      message: 'تم تسجيل الدخول بنجاح',
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم' });
  }
};

/**
 * دالة جلب البيانات الشخصية (Get Me)
 * تستخدم للتحقق من هوية المستخدم بعد تسجيل دخوله باستخدام الـ Token.
 * تقوم بإرجاع كافة بيانات المستخدم المسجلة باستثناء كلمة المرور المشفرة.
 */
exports.getMe = async (req, res) => {
  try {
    // req.user يتم تعيينه بواسطة الـ Middleware (authenticateToken)
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password_hash'] } // استبعاد كلمة المرور من الرد
    });

    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error('Get Me Error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم' });
  }
};
