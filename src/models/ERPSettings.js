const { DataTypes } = require('sequelize');
const crypto = require('crypto');
const sequelize = require('../config/database');

// يشتق مفتاح تشفير ثابت من متغير بيئة مخصص أو JWT_SECRET كحل احتياطي.
const getEncryptionKey = () => {
  const keyMaterial = process.env.ERP_SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!keyMaterial) throw new Error('ERP_SETTINGS_ENCRYPTION_KEY أو JWT_SECRET مطلوب لتشفير إعدادات ERP.');
  return crypto.createHash('sha256').update(keyMaterial).digest();
};

// يشفر كلمة مرور ERP قبل حفظها في قاعدة البيانات.
const encryptPassword = (password) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]);
  return {
    password_encrypted: encrypted.toString('hex'),
    password_iv: iv.toString('hex'),
    password_auth_tag: cipher.getAuthTag().toString('hex')
  };
};

// يفك تشفير كلمة مرور ERP للاستخدام الداخلي فقط ولا يعيدها في API.
const decryptPassword = (settings) => {
  if (!settings?.password_encrypted || !settings?.password_iv || !settings?.password_auth_tag) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(settings.password_iv, 'hex'));
  decipher.setAuthTag(Buffer.from(settings.password_auth_tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(settings.password_encrypted, 'hex')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
};

const ERPSettings = sequelize.define('ERPSettings', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  base_url: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'رابط API لنظام ERP الخارجي'
  },
  login_company: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'اسم الشركة المستخدم لتسجيل الدخول في ERP'
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'اسم مستخدم ERP'
  },
  password_encrypted: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'كلمة مرور ERP مشفرة بتشفير AES-GCM'
  },
  password_iv: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'قيمة IV الخاصة بتشفير كلمة المرور'
  },
  password_auth_tag: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'وسم التحقق الخاص بتشفير كلمة المرور'
  },
  app_type: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'desktop'
  },
  app_version: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '1.0.0'
  },
  allowed_hosts: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'قائمة نطاقات ERP المسموحة مفصولة بفواصل'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: 'erp_settings',
  timestamps: true
});

ERPSettings.encryptPassword = encryptPassword;
ERPSettings.decryptPassword = decryptPassword;

module.exports = ERPSettings;