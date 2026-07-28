/**
 * src/controllers/userController.js
 * [إصلاح أمني C-2 + C-3 + H-3]:
 *  - C-2: استبعاد password_hash من جميع الردود
 *  - C-3: تشفير كلمة المرور عند الإنشاء
 *  - H-3: whitelist صريح للحقول القابلة للتعديل
 *  - L-4: Soft Delete (تعطيل الحساب بدلاً من حذفه)
 */

const bcrypt = require('bcryptjs');
const { User } = require('../models');

// الحقول الآمنة المرسلة في الرد (بدون كلمة المرور)
const SAFE_ATTRIBUTES = { exclude: ['password_hash'] };

// الأدوار المسموح بها
const VALID_ROLES = ['admin', 'sales_manager', 'sales_rep', 'inventory_manager', 'driver'];

/**
 * جلب جميع المستخدمين (بدون password_hash)
 */
const getAll = async (req, res) => {
  try {
    const { role, is_active } = req.query;
    const where = {};

    if (role) {
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: 'الدور المطلوب غير صالح.' });
      }
      where.role = role;
    }

    if (is_active !== undefined) {
      where.is_active = String(is_active) === 'true';
    }

    const data = await User.findAll({
      where,
      attributes: SAFE_ATTRIBUTES,
      order: [['name', 'ASC']]
    });

    res.status(200).json({ users: data });
  } catch (error) {
    console.error('userController.getAll Error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * جلب مستخدم محدد (بدون password_hash)
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await User.findByPk(id, { attributes: SAFE_ATTRIBUTES });
    if (!item) return res.status(404).json({ error: 'المستخدم غير موجود.' });
    res.status(200).json({ user: item });
  } catch (error) {
    console.error('userController.getById Error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * إنشاء مستخدم جديد مع تشفير كلمة المرور [إصلاح C-3]
 */
const create = async (req, res) => {
  try {
    const { name, username, password, role, phone, email } = req.body;

    // التحقق من الحقول المطلوبة
    if (!name?.trim()) return res.status(400).json({ error: 'الاسم الكامل مطلوب.' });
    if (!username?.trim()) return res.status(400).json({ error: 'اسم المستخدم مطلوب.' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'كلمة المرور مطلوبة ويجب أن تكون 6 أحرف على الأقل.' });
    if (!role || !VALID_ROLES.includes(role)) return res.status(400).json({ error: `الدور غير صالح. الأدوار المتاحة: ${VALID_ROLES.join(', ')}` });

    // التحقق من عدم تكرار اسم المستخدم
    const existingUser = await User.findOne({ where: { username: username.trim() } });
    if (existingUser) return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل. الرجاء اختيار اسم آخر.' });

    // [إصلاح C-3] تشفير كلمة المرور قبل الحفظ
    const password_hash = await bcrypt.hash(password, 12);

    const newUser = await User.create({
      name: name.trim(),
      username: username.trim().toLowerCase(),
      password_hash,
      role,
      phone: phone || null,
      email: email || null,
      is_active: true
    });

    // إرجاع البيانات بدون كلمة المرور [إصلاح C-2]
    const { password_hash: _, ...safeUser } = newUser.toJSON();
    res.status(201).json({ message: 'تم إنشاء المستخدم بنجاح.', user: safeUser });

  } catch (error) {
    console.error('userController.create Error:', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل.' });
    }
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * تحديث بيانات مستخدم مع whitelist صارم [إصلاح H-3]
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, password, role, is_active, phone, email } = req.body;

    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود.' });

    // [إصلاح H-3] whitelist صريح — يُقبل فقط ما هو مدرج هنا
    const updateData = {};
    if (name?.trim()) updateData.name = name.trim();
    if (role && VALID_ROLES.includes(role)) updateData.role = role;
    if (typeof is_active === 'boolean') updateData.is_active = is_active;
    if (phone !== undefined) updateData.phone = phone || null;
    if (email !== undefined) updateData.email = email || null;

    // حظر تغيير دور أو تعطيل آخر حساب Admin نشط [إصلاح H-17]
    if (user.role === 'admin' && (updateData.role !== 'admin' || updateData.is_active === false)) {
      const activeAdminCount = await User.count({ where: { role: 'admin', is_active: true } });
      if (activeAdminCount <= 1) {
        return res.status(400).json({ error: 'لا يمكن تعطيل أو تغيير دور آخر حساب Admin نشط في النظام.' });
      }
    }

    // تشفير كلمة المرور الجديدة إن وُجدت [إصلاح C-3]
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.' });
      updateData.password_hash = await bcrypt.hash(password, 12);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'لم يتم تمرير أي بيانات للتحديث.' });
    }

    await user.update(updateData);

    // إرجاع البيانات بدون كلمة المرور [إصلاح C-2]
    const updatedUser = await User.findByPk(id, { attributes: SAFE_ATTRIBUTES });
    res.status(200).json({ message: 'تم تحديث بيانات المستخدم بنجاح.', user: updatedUser });

  } catch (error) {
    console.error('userController.update Error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * [إصلاح L-4] Soft Delete: تعطيل الحساب بدلاً من حذفه نهائياً
 * هذا يحفظ سجلات التدقيق ويمنع فقدان البيانات المرتبطة بالمستخدم
 */
const remove = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود.' });

    // منع تعطيل الحساب الوحيد بصلاحية admin
    if (user.role === 'admin') {
      const activeAdminCount = await User.count({ where: { role: 'admin', is_active: true } });
      if (activeAdminCount <= 1) {
        return res.status(400).json({ error: 'لا يمكن تعطيل آخر حساب Admin في النظام.' });
      }
    }

    await user.update({ is_active: false });
    res.status(200).json({ message: `تم تعطيل حساب المستخدم "${user.username}" بنجاح.` });

  } catch (error) {
    console.error('userController.remove Error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم.' });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove
};
