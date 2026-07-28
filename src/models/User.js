const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج المستخدم (User Model)
 * يمثل هذا النموذج كافة المستخدمين للنظام بصلاحياتهم المختلفة
 * (المندوب، مدير المبيعات، أمين المخزن، السائق، المحاسب)
 * يحتوي على بيانات الدخول والاسم والدور الوظيفي.
 */
const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'الاسم الكامل للمستخدم'
  },
  username: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    comment: 'اسم المستخدم المستخدم في تسجيل الدخول'
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'رقم هاتف المستخدم للتواصل'
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isEmail: true
    },
    comment: 'البريد الإلكتروني للمستخدم'
  },
  password_hash: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'كلمة المرور المشفرة (لا تحفظ أبداً كنص صريح)'
  },
  role: {
    type: DataTypes.ENUM('sales_rep', 'sales_manager', 'inventory_manager', 'driver', 'admin'),
    allowNull: false,
    comment: 'الدور الوظيفي الذي يحدد الصلاحيات بناءً على المتطلبات'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'يستخدم لإيقاف الحساب دون حذفه (Soft Disable)'
  }
}, {
  tableName: 'users',
  timestamps: true, // سينشئ تلقائياً حقول createdAt و updatedAt
});

module.exports = User;
