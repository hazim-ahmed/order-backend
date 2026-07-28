const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج الإشعار الدائن (Credit Note Model)
 * يمثل المستند المالي الصادر للعميل لخصم قيمة المرتجع من مديونيته
 */
const CreditNote = sequelize.define('CreditNote', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  credit_note_number: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    comment: 'رقم مرجعي فريد للإشعار الدائن بصيغة CN-YYYYMMDD-XXXX'
  },
  sales_return_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    comment: 'معرف طلب المرتجع المرتبط'
  },
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'معرف العميل'
  },
  subtotal: {
    type: DataTypes.DECIMAL(15, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'المبلغ قبل الضريبة'
  },
  tax_amount: {
    type: DataTypes.DECIMAL(15, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'مبلغ ضريبة القيمة المضافة'
  },
  total_amount: {
    type: DataTypes.DECIMAL(15, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'الإجمالي الصافي للإشعار الدائن'
  },
  status: {
    type: DataTypes.ENUM('ISSUED', 'VOID'),
    defaultValue: 'ISSUED',
    allowNull: false
  },
  issued_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false
  }
}, {
  tableName: 'credit_notes',
  timestamps: false
});

module.exports = CreditNote;
