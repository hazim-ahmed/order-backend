const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج أصناف مرتجع المبيعات (Sales Return Item Model)
 * يمثل كل صنف/منتج داخل طلب الإرجاع مع تفاصيل الأطنان والأسعار
 */
const SalesReturnItem = sequelize.define('SalesReturnItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  sales_return_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'معرف طلب المرتجع الرئيسي'
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'معرف المنتج المرتجع'
  },
  requested_tons: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'الكمية المطلوب إرجاعها بالطن'
  },
  verified_good_tons: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'الكمية الفعالية السليمة بالطن'
  },
  verified_damaged_tons: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'الكمية التالفة بالطن'
  },
  verified_missing_tons: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'الكمية المفقودة بالطن'
  },  unit_price: {
    type: DataTypes.DECIMAL(15, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'سعر طن البضاعة المحسوب من الطلب الأصلي'
  },
  subtotal_refund: {
    type: DataTypes.DECIMAL(15, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'إجمالي الاسترداد المالي لهذا الصنف'
  }
}, {
  tableName: 'sales_return_items',
  timestamps: false
});

module.exports = SalesReturnItem;

