const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج سجل حالات الطلب (OrderStatusLog Model)
 * يستخدم للتدقيق (Auditing) وتتبع كل انتقال في آلة الحالات (State Machine)
 * يسجل من الذي قام بالتغيير ومتى ولماذا (إن وجد).
 */
const OrderStatusLog = sequelize.define('OrderStatusLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  // order_id, changed_by (يتم الربط في index.js)
  from_status: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'الحالة السابقة للطلب (null في حال الإنشاء الأول)'
  },
  to_status: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'الحالة الجديدة التي انتقل إليها الطلب'
  },
  note: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'أي ملاحظات إضافية أثناء النقل (مثل سبب الرفض أو الفشل)'
  }
}, {
  tableName: 'order_status_logs',
  timestamps: true,
  updatedAt: false // نحتاج فقط createdAt لمعرفة وقت النقل
});

module.exports = OrderStatusLog;
