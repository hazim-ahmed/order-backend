const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج العميل / المصنع (Client Model)
 * يمثل الجهة التي يتم توصيل المواد الخام إليها.
 * يحتوي على رابط `erp_id` لتسهيل مزامنة بياناته مع نظام الـ ERP الخارجي.
 */
const Client = sequelize.define('Client', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'اسم المصنع أو العميل'
  },
  erp_id: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: true,
    comment: 'المعرف الخارجي في نظام الـ ERP للمزامنة'
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'هاتف التواصل مع العميل'
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'العنوان الجغرافي للمصنع لتسهيل وصول السائق'
  },
  synced_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'تاريخ آخر مزامنة لبيانات هذا العميل مع الـ ERP'
  }
}, {
  tableName: 'clients',
  timestamps: false // سنكتفي بـ synced_at للمزامنة إذا لم نحتاج التتبع
});

module.exports = Client;
