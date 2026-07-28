const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج مستندات التسليم (DeliveryDocument Model)
 * يمثل المستندات المرفوعة كإثبات تسليم للطلبات (صور أو PDF)
 */
const DeliveryDocument = sequelize.define('DeliveryDocument', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    comment: 'المعرف الفريد للمستند (UUID)'
  },
  order_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'المعرف المرجعي للطلب المرتبط'
  },
  uploaded_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'معرف المستخدم الذي قام برفع الملف'
  },
  storage_driver: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'local',
    comment: 'نوع مزود التخزين المستخدم (local / s3)'
  },
  object_key: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'مفتاح المستند في نظام التخزين الكائني'
  },
  thumbnail_key: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'مفتاح الصورة المصغرة والمعاينة إن وجدت'
  },
  original_name: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'الاسم الأصلي للملف المرفوع'
  },
  mime_type: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'نوع وسائط المستند (MIME Type) المفحوص بالمحتوى'
  },
  size_bytes: {
    type: DataTypes.BIGINT,
    allowNull: false,
    comment: 'حجم الملف بالبايت'
  },
  checksum: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'التوقيع التشفيري SHA-256 للملف'
  },
  status: {
    type: DataTypes.ENUM('temporary', 'attached', 'deleted'),
    defaultValue: 'temporary',
    allowNull: false,
    comment: 'حالة المرفق (مؤقت / مرتبط بطلب / محذوف)'
  },
  attached_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'تاريخ ربط المرفق بالطلب النهائي'
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'تاريخ إزالة المستند إن تم حذفه'
  }
}, {
  tableName: 'delivery_documents',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['order_id'] },
    { fields: ['uploaded_by'] },
    { fields: ['status', 'created_at'] }
  ]
});

module.exports = DeliveryDocument;
