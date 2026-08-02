const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * نموذج الطلب (Order Model)
 * يمثل دورة حياة الطلب الأساسية ويمر بـ 12 حالة محددة مسبقاً.
 * يخزن توقيتات الانتقال والمستخدمين المعينين في كل مرحلة.
 */
const Order = sequelize.define('Order', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  order_number: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    comment: 'رقم مرجعي فريد للطلب بصيغة KMT-YYYYMMDD-XXXX'
  },
  delivery_type: {
    type: DataTypes.ENUM('delivery', 'customer_pickup'),
    defaultValue: 'delivery',
    allowNull: false,
    comment: 'طريقة التسليم: توصيل أسطول الشركة (delivery) أم استلام مباشر من المستودع (customer_pickup)'
  },
  pickup_driver_name: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'اسم سائق العميل / الناقل في حالة الاستلام المباشر'
  },
  pickup_vehicle_plate: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'رقم لوحة مركبة العميل في حالة الاستلام المباشر'
  },
  pickup_receiver_id: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'رقم هوية أو إثبات المستلم من طرف العميل'
  },
  // مفاتيح خارجية (ستتم إضافتها عبر index.js)
  // client_id, sales_rep_id, sales_manager_id, inventory_manager_id, driver_id
  status: {
    type: DataTypes.ENUM(
      'pending_sales_approval',
      'rejected_by_sales',
      'pending_inventory_approval',
      'processing_in_warehouse',
      'assigned_to_driver',
      'ready_for_pickup',
      'picked_up_by_driver',
      'delivered',
      'failed_delivery',
      'return_requested',
      'returned_to_warehouse',
      'cancelled'
    ),
    defaultValue: 'pending_sales_approval',
    allowNull: false,
    comment: 'حالة الطلب الحالية وفقاً لآلة الحالات (State Machine)'
  },
  rejection_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'سبب الرفض من قبل مدير المبيعات'
  },
  cancellation_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'سبب الإلغاء من قبل المحاسب/الأدمن'
  },
  total_tons: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'إجمالي الكمية المطلوبة بالطن'
  },
  shipped_tons: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: true,
    defaultValue: null,
    comment: 'إجمالي الكمية المشحونة الفعلية للمطابقة'
  },
  total_amount: {
    type: DataTypes.DECIMAL(15, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'الإجمالي المالي للطلب'
  },
  freight_rate: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'سعر الحموله للوحدة المختارة (طن / كجم)'
  },
  freight_unit: {
    type: DataTypes.ENUM('ton', 'kg'),
    allowNull: false,
    defaultValue: 'kg',
    comment: 'وحدة حساب سعر الحموله (ton / kg)'
  },
  freight_amount: {
    type: DataTypes.DECIMAL(15, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'إجمالي تكلفة الحموله (السعر * الكمية بالوحدة)'
  },
  // الطوابع الزمنية للتدقيق (Auditing)
  sales_approved_at: { type: DataTypes.DATE, allowNull: true },
  processing_started_at: { type: DataTypes.DATE, allowNull: true },
  driver_assigned_at: { type: DataTypes.DATE, allowNull: true },
  ready_at: { type: DataTypes.DATE, allowNull: true },
  picked_up_at: { type: DataTypes.DATE, allowNull: true },
  delivered_at: { type: DataTypes.DATE, allowNull: true },
  failed_at: { type: DataTypes.DATE, allowNull: true },
  return_requested_at: { type: DataTypes.DATE, allowNull: true },
  returned_at: { type: DataTypes.DATE, allowNull: true },
  cancelled_at: { type: DataTypes.DATE, allowNull: true },
  timeout_deadline: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'الموعد النهائي لتسليم الطلب قبل إطلاق تحذير Timeout'
  },
  delivery_image_url: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'رابط صورة مستند التسليم، إجباري عند تحويل الحالة إلى delivered'
  },
  delivery_reference_number: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'الرقم المرجعي لسند الاستلام المرفوع من السائق'
  },
  document_posted_to_erp: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  erp_invoice_number: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: 'idx_orders_erp_invoice_number_unique'
  },
  document_posted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // [إصلاح] حقول تتبع حالة المخزون لمنع الخصم/الإرجاع المزدوج
  inventory_deducted_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'تاريخ خصم المخزون الفعلي - يمنع الخصم المزدوج'
  },
  inventory_restored_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'تاريخ إرجاع المخزون - يمنع الإرجاع المزدوج'
  },
  // [إصلاح] حقل لمنع تكرار إشعارات تجاوز المهلة
  timeout_notified_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'تاريخ إرسال إشعار تجاوز المهلة - يمنع التكرار'
  }
}, {
  tableName: 'orders',
  timestamps: true, // يوفر حقل createdAt المذكور في المتطلبات
});

module.exports = Order;
