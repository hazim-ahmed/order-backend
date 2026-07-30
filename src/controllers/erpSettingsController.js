const { ERPSettings } = require('../models');

// يحول سجل إعدادات ERP إلى استجابة آمنة لا تحتوي كلمة المرور.
const toSafeSettings = (settings) => {
  if (!settings) return null;
  return {
    id: settings.id,
    base_url: settings.base_url,
    login_company: settings.login_company,
    username: settings.username,
    app_type: settings.app_type,
    app_version: settings.app_version,
    allowed_hosts: settings.allowed_hosts,
    is_active: settings.is_active,
    has_password: Boolean(settings.password_encrypted),
    updatedAt: settings.updatedAt
  };
};

// يجلب إعدادات ERP النشطة بدون كشف كلمة المرور.
const getERPSettings = async (req, res) => {
  try {
    const settings = await ERPSettings.findOne({ where: { is_active: true }, order: [['updatedAt', 'DESC']] });
    res.status(200).json({ settings: toSafeSettings(settings) });
  } catch (error) {
    console.error('erpSettingsController.getERPSettings Error:', error);
    res.status(500).json({ error: 'تعذر جلب إعدادات ERP.' });
  }
};

// يحفظ إعدادات ERP بكلمة مرور مشفرة ولا يعيد السر في الاستجابة.
const saveERPSettings = async (req, res) => {
  try {
    const { base_url, login_company, username, password, app_type, app_version, allowed_hosts } = req.body;
    if (!base_url || !login_company || !username) {
      return res.status(400).json({ error: 'رابط ERP واسم الشركة واسم المستخدم مطلوبة.' });
    }

    const settings = await ERPSettings.findOne({ where: { is_active: true }, order: [['updatedAt', 'DESC']] });
    const payload = {
      base_url: String(base_url).trim(),
      login_company: String(login_company).trim(),
      username: String(username).trim(),
      app_type: app_type || 'desktop',
      app_version: app_version || '1.0.0',
      allowed_hosts: allowed_hosts ? String(allowed_hosts).trim() : null,
      is_active: true
    };

    if (password) {
      Object.assign(payload, ERPSettings.encryptPassword(password));
    } else if (!settings) {
      return res.status(400).json({ error: 'كلمة مرور ERP مطلوبة عند إنشاء الإعدادات لأول مرة.' });
    }

    const savedSettings = settings
      ? await settings.update(payload)
      : await ERPSettings.create(payload);

    res.status(200).json({ message: 'تم حفظ إعدادات ERP بنجاح.', settings: toSafeSettings(savedSettings) });
  } catch (error) {
    console.error('erpSettingsController.saveERPSettings Error:', error);
    res.status(500).json({ error: 'تعذر حفظ إعدادات ERP.' });
  }
};

module.exports = {
  getERPSettings,
  saveERPSettings
};