const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SalesReturn = sequelize.define('SalesReturn', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  return_number: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    comment: 'رقم مرجعي فريد للمرتجع بصيغة RET-YYYYMMDD-XXXX'
  },
  order_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'معرف الطلب الأصلي'
  },
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'معرف العميل'
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'معرف المستخدم الذي أنشأ طلب الإرجاع'
  },
  driver_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'معرف السائق المكلف بنقل المرتجع إلى المخزن'
  },
  status: {
    type: DataTypes.ENUM(
      'return_requested',
      'sales_approved',
      'finance_approved',
      'in_transit',
      'driver_delivered',
      'inspected',
      'returned_to_warehouse',
      'credit_note_issued',
      'rejected'
    ),
    defaultValue: 'return_requested',
    allowNull: false,
    comment: 'حالة المرتجع الحالية'
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'سبب تقديم طلب الإرجاع'
  },
  rejection_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'سبب الرفض في حال تم رفض الطلب'
  },
  refund_mode: {
    type: DataTypes.ENUM('good_only', 'good_and_damaged', 'all'),
    allowNull: true,
    defaultValue: null,
    comment: 'طريقة حساب التعويض: سليم فقط، سليم وتالف، أو كل الكميات'
  },
  original_order_status: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'حالة الطلب الأصلية قبل إنشاء المرتجع'
  },
  total_requested_tons: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'إجمالي الكمية المطلوب إرجاعها بالطن'
  },
  verified_good_tons: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'الكمية السليمة المقبولة بعد الفحص'
  },
  verified_damaged_tons: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'الكمية التالفة بعد الفحص'
  },
  verified_missing_tons: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'الكمية المفقودة أثناء فحص المرتجع'
  },
  total_refund_amount: {
    type: DataTypes.DECIMAL(15, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'المبلغ المسترد الإجمالي'
  },
  inspection_notes: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'ملاحظات أمين المخزن عند الفحص والوزن'
  },
  sales_approved_at: { type: DataTypes.DATE, allowNull: true },
  finance_approved_at: { type: DataTypes.DATE, allowNull: true },
  driver_delivered_at: { type: DataTypes.DATE, allowNull: true },
  inspected_at: { type: DataTypes.DATE, allowNull: true },
  returned_at: { type: DataTypes.DATE, allowNull: true },
  credit_note_issued_at: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'sales_returns',
  timestamps: true
});

module.exports = SalesReturn;