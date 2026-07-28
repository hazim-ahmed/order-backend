const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج استخدام رقم السند (DeliveryDocumentUsage Model)
 * يربط بين رقم السند المسجل، الدفتر المصدر، الطلب المسلم، والسائق
 */
const DeliveryDocumentUsage = sequelize.define('DeliveryDocumentUsage', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  book_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'المعرف المرجعي للدفتر المستخدم منه السند'
  },
  order_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'المعرف المرجعي للطلب المسلم بهذه السند'
  },
  driver_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'المعرف المرجعي للسائق الذي استخدم السند'
  },
  document_number: {
    type: DataTypes.INTEGER,
    unique: true,
    allowNull: false,
    comment: 'رقم السند الورقي المستخدم (فريد عالمياً على مستوى النظام)'
  },
  used_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'تاريخ وتوقيت استخدام رقم السند في التسليم'
  }
}, {
  tableName: 'delivery_document_usages',
  timestamps: true,
  indexes: [
    { fields: ['document_number'], unique: true },
    { fields: ['book_id'] },
    { fields: ['order_id'] },
    { fields: ['driver_id'] }
  ]
});

module.exports = DeliveryDocumentUsage;
