const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, SystemSetting, sequelize } = require('../models');

const COMPANY_SETTING_KEYS = [
  'company.name',
  'company.phone',
  'company.email',
  'company.address',
  'company.tax_number',
  'company.commercial_registration',
  'system.timezone',
  'system.currency'
];

const normalizeText = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
};

const issueToken = (user) => jwt.sign(
  { id: user.id, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRE || '7d' }
);

const ensureSettingsTable = async () => {
  await SystemSetting.sync();
};

const hasActiveAdmin = async (transaction) => {
  const adminCount = await User.count({
    where: { role: 'admin', is_active: true },
    transaction
  });
  return adminCount > 0;
};

const serializeSettings = (settings) => settings.reduce((result, setting) => {
  result[setting.key] = setting.value;
  return result;
}, {});

const upsertSetting = async (key, value, type = 'string', transaction) => {
  const [setting, created] = await SystemSetting.findOrCreate({
    where: { key },
    defaults: { key, value, type },
    transaction
  });

  if (!created) {
    await setting.update({ value, type }, { transaction });
  }

  return setting;
};

exports.getSetupStatus = async (req, res) => {
  try {
    await ensureSettingsTable();

    const [initialized, usersCount, companySettings] = await Promise.all([
      hasActiveAdmin(),
      User.count(),
      SystemSetting.findAll({ where: { key: COMPANY_SETTING_KEYS } })
    ]);

    res.status(200).json({
      initialized,
      admin_exists: initialized,
      users_count: usersCount,
      company: serializeSettings(companySettings)
    });
  } catch (error) {
    console.error('Setup Status Error:', error);
    res.status(500).json({ error: 'تعذر قراءة حالة تهيئة النظام' });
  }
};

exports.initializeSystem = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    await ensureSettingsTable();

    if (await hasActiveAdmin(transaction)) {
      await transaction.rollback();
      return res.status(409).json({ error: 'تمت تهيئة النظام مسبقاً ولا يمكن إعادة التهيئة من هذه الواجهة' });
    }

    const {
      company_name,
      company_phone,
      company_email,
      company_address,
      tax_number,
      commercial_registration,
      timezone = 'Asia/Riyadh',
      currency = 'SAR',
      admin_name,
      admin_username,
      admin_email,
      admin_phone,
      admin_password
    } = req.body;

    const normalizedCompanyName = normalizeText(company_name);
    const normalizedAdminName = normalizeText(admin_name);
    const normalizedUsername = normalizeText(admin_username);

    if (!normalizedCompanyName) {
      await transaction.rollback();
      return res.status(400).json({ error: 'اسم الشركة مطلوب لإكمال التهيئة' });
    }

    if (!normalizedAdminName || !normalizedUsername || !admin_password) {
      await transaction.rollback();
      return res.status(400).json({ error: 'اسم المسؤول واسم المستخدم وكلمة المرور مطلوبة' });
    }

    if (String(admin_password).length < 8) {
      await transaction.rollback();
      return res.status(400).json({ error: 'كلمة مرور المسؤول يجب أن تكون 8 أحرف على الأقل' });
    }

    const existingUsername = await User.findOne({
      where: { username: normalizedUsername },
      transaction
    });

    if (existingUsername) {
      await transaction.rollback();
      return res.status(409).json({ error: 'اسم المستخدم مستخدم مسبقاً' });
    }

    const passwordHash = await bcrypt.hash(admin_password, 12);
    const admin = await User.create({
      name: normalizedAdminName,
      username: normalizedUsername,
      phone: normalizeText(admin_phone),
      email: normalizeText(admin_email),
      password_hash: passwordHash,
      role: 'admin',
      is_active: true
    }, { transaction });

    const settings = {
      'company.name': normalizedCompanyName,
      'company.phone': normalizeText(company_phone),
      'company.email': normalizeText(company_email),
      'company.address': normalizeText(company_address),
      'company.tax_number': normalizeText(tax_number),
      'company.commercial_registration': normalizeText(commercial_registration),
      'system.timezone': normalizeText(timezone) || 'Asia/Riyadh',
      'system.currency': normalizeText(currency) || 'SAR',
      'setup.completed_at': new Date().toISOString(),
      'setup.completed_by_user_id': String(admin.id)
    };

    for (const [key, value] of Object.entries(settings)) {
      await upsertSetting(key, value, 'string', transaction);
    }

    await transaction.commit();

    const token = issueToken(admin);

    res.status(201).json({
      message: 'تمت تهيئة النظام وإنشاء حساب المسؤول بنجاح',
      token,
      user: {
        id: admin.id,
        name: admin.name,
        role: admin.role
      },
      company: settings
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Initialize System Error:', error);
    res.status(500).json({ error: 'تعذر إكمال تهيئة النظام' });
  }
};
