const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج أمر صرف دفاتر سندات التسليم (DeliveryDocumentBatch Model)
 * يمثل أمر الصرف الصادر من المسؤول العام لأمين المخزن
 */
const DeliveryDocumentBatch = sequelize.define('DeliveryDocumentBatch', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  batch_number: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    comment: 'رقم مرجعي فريد لأمر الصرف بصيغة BATCH-YYYYMMDD-XXXX'
  },
  inventory_manager_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'معرف أمين المخزن المستلم للدفاتر'
  },
  start_number: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'بداية رقم أول سند في هذا الأمر'
  },
  book_size: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'مدى الدفتر الواحد (عدد السندات بكل دفتر)'
  },
  books_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'عدد الدفاتر المصروفة في الأمر'
  },
  total_documents: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'إجمالي عدد السندات في هذا الأمر (مدى الدفتر × عدد الدفاتر)'
  },
  end_number: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'آخر رقم سند في هذا الأمر'
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'معرف المسؤول الذي أنشأ أمر الصرف'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'ملاحظات اختيارية على أمر الصرف'
  }
}, {
  tableName: 'delivery_document_book_batches',
  timestamps: true,
  indexes: [
    { fields: ['batch_number'], unique: true },
    { fields: ['inventory_manager_id'] },
    { fields: ['created_by'] },
    { fields: ['start_number', 'end_number'] }
  ]
});

module.exports = DeliveryDocumentBatch;
