const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج أصناف الطلب (OrderItem Model)
 * يمثل الأصناف والكميات المحددة داخل كل طلب.
 * الأهم: تجميد السعر في `price_per_ton_snapshot` حتى لا يتأثر الفواتير بتغير الأسعار لاحقاً.
 */
const OrderItem = sequelize.define('OrderItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  // order_id, product_id (يتم ربطهم في index.js)
  quantity_tons: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    comment: 'الكمية المطلوبة بالطن لهذا الصنف'
  },
  entered_quantity: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: true,
    comment: 'الكمية المدخلة حسب الوحدة المختارة (كجم أو طن)'
  },
  unit: {
    type: DataTypes.STRING,
    defaultValue: 'kg',
    comment: 'وحدة القياس المختارة للصنف (ton / kg)'
  },
  price_per_ton_snapshot: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    comment: 'لقطة لسعر الطن وقت تقديم الطلب لتجميده من التغييرات اللاحقة'
  }
}, {
  tableName: 'order_items',
  timestamps: false // لا نحتاج توقيتات للأصناف لأنها تتبع وقت الطلب نفسه
});

module.exports = OrderItem;
