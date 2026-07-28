const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج تتبع موقع السائق (DriverLocation Model)
 * يسجل إحداثيات السائق أثناء توصيل الطلب لاستخدامها في الخرائط.
 */
const DriverLocation = sequelize.define('DriverLocation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  // driver_id, order_id (يتم الربط في index.js)
  latitude: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: false,
    comment: 'خط العرض الجغرافي'
  },
  longitude: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: false,
    comment: 'خط الطول الجغرافي'
  },
  recorded_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false,
    comment: 'وقت التقاط الموقع'
  }
}, {
  tableName: 'driver_locations',
  timestamps: false // recorded_at يغني عن ذلك
});

module.exports = DriverLocation;
