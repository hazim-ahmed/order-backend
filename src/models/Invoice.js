const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج الفاتورة (Invoice Model)
 * لا يتم إنشاؤه إلا عند نجاح التسليم (delivered).
 * يحتوي على الإجمالي ورابط لنسخة الـ PDF المصدرة.
 * 
 * [تم الإصلاح]: إضافة قيد unique على order_id لمنع تكرار الفواتير
 */
const Invoice = sequelize.define('Invoice', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  // [إصلاح] إضافة order_id بشكل صريح مع قيد unique
  order_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    comment: 'معرف الطلب المرتبط - فريد لمنع تكرار الفواتير لنفس الطلب'
  },
  total_amount: {
    type: DataTypes.DECIMAL(15, 3),
    allowNull: false,
    comment: 'الإجمالي النهائي للفاتورة'
  },
  issued_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false,
    comment: 'تاريخ إصدار الفاتورة الفعلي'
  },
  pdf_url: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'رابط ملف الـ PDF المحفوظ على الخادم'
  }
}, {
  tableName: 'invoices',
  timestamps: false // issued_at يغني عن ذلك
});

module.exports = Invoice;
