const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج المنتج / المادة الخام (Product Model)
 * يمثل المواد الخام المتاحة للبيع بالطن.
 * يتضمن السعر الحالي والكمية المتاحة في المخزون.
 */
const Product = sequelize.define('Product', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'اسم المادة الخام'
  },
  unit: {
    type: DataTypes.STRING,
    defaultValue: 'kg',
    comment: 'وحدة القياس المعتمدة'
  },
  current_price_per_ton: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    comment: 'السعر الحالي للطن (قابل للتغير ولن يؤثر على الطلبات السابقة)'
  },
  stock_quantity: {
    type: DataTypes.DECIMAL(12, 3),
    defaultValue: 0.000,
    comment: 'الكمية المتاحة حالياً في المستودع بالطن'
  },
  erp_id: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: true,
    comment: 'المعرف الخارجي للصنف في نظام الـ ERP'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'وصف المنتج'
  },
  category_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'معرف القسم المرتبط'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'حالة المنتج (نشط / غير نشط)'
  }
}, {
  tableName: 'products',
  timestamps: true // لإنشاء createdAt و updatedAt
});

module.exports = Product;
