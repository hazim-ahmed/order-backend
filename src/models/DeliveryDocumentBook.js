const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج دفتر سندات التسليم الفرعي (DeliveryDocumentBook Model)
 * يمثل دفتر السندات الفعلي الذي يتم تقسميه من أمر الصرف وتخصيصه لسائق
 */
const DeliveryDocumentBook = sequelize.define('DeliveryDocumentBook', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  batch_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'المعرف المرجعي لأمر الصرف التابع له الدفتر'
  },
  book_number: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    comment: 'رقم الدفتر الظاهر بصيغة BOOK-YYYYMMDD-XXXX'
  },
  inventory_manager_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'معرف أمين المخزن الذي يملك الدفتر للتوزيع'
  },
  driver_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null,
    comment: 'معرف السائق المصروف له الدفتر (فارغ في حال كان الدفتر متاحاً)'
  },
  start_number: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'بداية نطاق أرقام السندات في هذا الدفتر'
  },
  end_number: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'نهاية نطاق أرقام السندات في هذا الدفتر'
  },
  total_documents: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'إجمالي عدد السندات في الدفتر'
  },
  used_documents_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'عدد السندات المستخدمة بالفعل في الطلبات'
  },
  remaining_documents_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'عدد السندات المتبقية غير المستخدمة'
  },
  status: {
    type: DataTypes.ENUM('available', 'assigned', 'partially_used', 'exhausted', 'closed', 'cancelled'),
    defaultValue: 'available',
    allowNull: false,
    comment: 'حالة الدفتر التشغيلية'
  },
  assigned_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'معرف أمين المخزن الذي قام بصرف الدفتر للسائق'
  },
  assigned_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'توقيت صرف الدفتر للسائق'
  },
  closed_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'توقيت إغلاق أو اكتمال الدفتر'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'ملاحظات اختيارية عند الصرف أو الإغلاق'
  }
}, {
  tableName: 'delivery_document_books',
  timestamps: true,
  indexes: [
    { fields: ['book_number'], unique: true },
    { fields: ['batch_id'] },
    { fields: ['inventory_manager_id'] },
    { fields: ['driver_id'] },
    { fields: ['status'] },
    { fields: ['start_number', 'end_number'] }
  ]
});

module.exports = DeliveryDocumentBook;
