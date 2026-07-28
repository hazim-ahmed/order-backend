// ==============================================================================
// تاريخ التعديل: 2026-07-22
// الوظيفة: مدير الحالات والانتقالات لطلب التوريد (State Machine Service)
// السياق: يضمن انضباط تسلسل موافقات الطلب بين المسؤولين (Fix-Sec - Section 2) ويطبق فصل المهام
// ==============================================================================

const crypto = require('crypto');
const { Op } = require('sequelize');
const { Order, OrderItem, Product, OrderStatusLog, User, DeliveryDocument, SalesReturn, SalesReturnItem, DeliveryDocumentBook, DeliveryDocumentUsage, sequelize } = require('../models');


// مصفوفة القواعد والانتقالات (Transitions Matrix)
const transitions = [
  // من المندوب لمدير المبيعات
  { from: 'pending_sales_approval', to: 'pending_inventory_approval', roles: ['sales_manager', 'admin'] },
  { from: 'pending_sales_approval', to: 'rejected_by_sales', roles: ['sales_manager', 'admin'] },
  
  // المخزن
  { from: 'pending_inventory_approval', to: 'processing_in_warehouse', roles: ['inventory_manager', 'admin'] },
  { from: 'processing_in_warehouse', to: 'assigned_to_driver', roles: ['inventory_manager', 'admin'] },
  { from: 'processing_in_warehouse', to: 'ready_for_pickup', roles: ['inventory_manager', 'admin'] },
  { from: 'processing_in_warehouse', to: 'delivered', roles: ['inventory_manager', 'admin'] },
  { from: 'assigned_to_driver', to: 'ready_for_pickup', roles: ['inventory_manager', 'admin'] },
  { from: 'assigned_to_driver', to: 'delivered', roles: ['inventory_manager', 'admin'] },
  { from: 'ready_for_pickup', to: 'delivered', roles: ['inventory_manager', 'admin'] },
  
  // السائق
  { from: 'ready_for_pickup', to: 'picked_up_by_driver', roles: ['driver', 'admin'] },
  { from: 'picked_up_by_driver', to: 'delivered', roles: ['driver', 'admin'] },
  { from: 'picked_up_by_driver', to: 'failed_delivery', roles: ['driver', 'admin'] },
  { from: 'failed_delivery', to: 'return_requested', roles: ['driver', 'admin'] },
  
  // المخزن يستلم المرتجع
  { from: 'return_requested', to: 'returned_to_warehouse', roles: ['inventory_manager', 'admin'] },
  
  // المحاسب/الأدمن يلغي
  { from: 'pending_sales_approval', to: 'cancelled', roles: ['admin'] },
  { from: 'pending_inventory_approval', to: 'cancelled', roles: ['admin'] },
  { from: 'processing_in_warehouse', to: 'cancelled', roles: ['admin'] },
  { from: 'assigned_to_driver', to: 'cancelled', roles: ['admin'] },
  { from: 'ready_for_pickup', to: 'cancelled', roles: ['admin'] }
];

// ==============================================================================
// تاريخ التعديل: 2026-07-22
// الوظيفة: فحص إمكانية تنفيذ الانتقال بناءً على الحالة الحالية ودور المستخدم
// ==============================================================================
const canTransition = (currentStatus, newStatus, userRole) => {
  return transitions.some(t => 
    t.from === currentStatus && 
    t.to === newStatus && 
    t.roles.includes(userRole)
  );
};

// ==============================================================================
// تاريخ التعديل: 2026-07-22
// الوظيفة: دالة الانتقال الرئيسية بين حالات الطلب مع فحص الصلاحيات وفصل المهام
// ==============================================================================
const transitionOrder = async (orderId, targetStatus, user, payload = {}) => {
  // فتح Transaction لضمان الذرية (Atomicity)
  const transaction = await sequelize.transaction();

  try {
    // 1. جلب الطلب مع عناصره وقفل الصف لمنع التعديل المتزامن
    const order = await Order.findByPk(orderId, {
      include: [{ model: OrderItem, as: 'items' }],
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!order) {
      throw new Error('الطلب غير موجود.');
    }

    const currentStatus = order.status;

    // معالجة حالة النقرات المتكررة أو التزامن (Idempotent State Check)
    if (currentStatus === targetStatus) {
      if (targetStatus === 'rejected_by_sales' && payload.rejection_reason) {
        order.rejection_reason = payload.rejection_reason;
        await order.save({ transaction });
      }
      await transaction.commit();
      return order;
    }

    // 2. التحقق من الصلاحية والتسلسل
    if (!canTransition(currentStatus, targetStatus, user.role)) {
      throw new Error(`انتقال غير صالح أو لا تملك الصلاحية. من: ${currentStatus} إلى: ${targetStatus}`);
    }

    // ==============================================================================
    // تاريخ التعديل: 2026-07-22
    // الوظيفة: تطبيق شرط فصل المهام (Segregation of Duties) لحظر الموافقة الذاتية
    // السياق: يمنع المستخدم من الموافقة على طلب قام بإنشائه بنفسه (Fix-Sec - Section 3)
    // ==============================================================================
    if (targetStatus === 'pending_inventory_approval' && order.created_by === user.id && user.role !== 'admin') {
      throw new Error('حظر أمني: لا يجوز للمستخدم الموافقة الذاتية على طلب أنشأه بنفسه (Segregation of Duties)');
    }

    // 3. تطبيق القواعد بحسب الحالة المستهدفة

    // رفض مدير المبيعات
    if (targetStatus === 'rejected_by_sales') {
      if (!payload.rejection_reason) throw new Error('سبب الرفض مطلوب.');
      order.rejection_reason = payload.rejection_reason;
      order.sales_manager_id = user.id;
    }

    // قبول مدير المبيعات
    if (targetStatus === 'pending_inventory_approval') {
      order.sales_manager_id = user.id;
      order.sales_approved_at = new Date();
    }

    // بدء التجهيز (LOCK.UPDATE + DEDUCT)
    if (targetStatus === 'processing_in_warehouse') {
      order.inventory_manager_id = user.id;
      order.processing_started_at = new Date();

      for (const item of order.items) {
        // حجز المنتج ومنع التعارض
        const product = await Product.findByPk(item.product_id, {
          transaction,
          lock: transaction.LOCK.UPDATE
        });

        if (!product) {
          throw new Error(`المنتج ذو المعرف ${item.product_id} غير موجود.`);
        }

        // إلغاء قيود فحص التوفر (السماح بالمعالجة حتى لو كانت الكمية 0 أو بالسالب)
        product.stock_quantity = Number(product.stock_quantity) - Number(item.quantity_tons);
        await product.save({ transaction });
      }

      // [إصلاح] تسجيل علامة خصم المخزون لمنع الخصم المزدوج
      order.inventory_deducted_at = new Date();
    }

    // تعيين سائق
    if (targetStatus === 'assigned_to_driver') {
      if (!payload.driver_id) throw new Error('معرف السائق مطلوب.');
      
      // [إصلاح أمني] التحقق من أن المستخدم المحدد هو سائق نشط
      const driver = await User.findByPk(payload.driver_id, { transaction });
      if (!driver) {
        throw new Error('السائق المحدد غير موجود في النظام.');
      }
      if (driver.role !== 'driver') {
        throw new Error(`المستخدم "${driver.name}" ليس سائقاً. دوره الحالي: ${driver.role}`);
      }
      if (!driver.is_active) {
        throw new Error(`حساب السائق "${driver.name}" معطل. لا يمكن إسناد طلبات له.`);
      }

      order.driver_id = payload.driver_id;
      order.driver_assigned_at = new Date();
    }

    // جاهز للتحميل
    if (targetStatus === 'ready_for_pickup') {
      order.ready_at = new Date();
      if (payload.pickup_driver_name) order.pickup_driver_name = payload.pickup_driver_name;
      if (payload.pickup_vehicle_plate) order.pickup_vehicle_plate = payload.pickup_vehicle_plate;
      if (payload.pickup_receiver_id) order.pickup_receiver_id = payload.pickup_receiver_id;
    }

    // استلام السائق
    if (targetStatus === 'picked_up_by_driver') {
      if (order.driver_id !== user.id && user.role !== 'admin') throw new Error('هذا الطلب مسند لسائق آخر.');
      order.picked_up_at = new Date();
      
      const rawTimeout = Number(payload.timeoutMinutes) || 120;
      const timeoutMinutes = Math.min(1440, Math.max(15, rawTimeout)); // ضبط المهلة بين 15 دقيقة و 24 ساعة
      const deadline = new Date();
      deadline.setMinutes(deadline.getMinutes() + timeoutMinutes);
      order.timeout_deadline = deadline;
    }

    // التسليم النهائي
    if (targetStatus === 'delivered') {
      const isInventoryManager = user.role === 'inventory_manager';
      const docId = payload.delivery_document_id;
      let docRecord = null;

      if (docId) {
        docRecord = await DeliveryDocument.findByPk(docId, { transaction });
        if (!docRecord) {
          throw new Error('مستند التسليم المحدد غير موجود.');
        }
        if (docRecord.uploaded_by !== user.id && user.role !== 'admin') {
          throw new Error('لا تملك صلاحية لربط هذا المستند بالطلب.');
        }
        if (docRecord.status === 'attached' && docRecord.order_id !== order.id) {
          throw new Error('مستند التسليم مرتبط بطلب آخر بالفعل.');
        }
      }

      const imageUrl = docRecord
        ? `/api/upload/documents/${docRecord.id}/view`
        : payload.delivery_image_url;

      if (isInventoryManager) {
        if (!imageUrl || !String(imageUrl).trim()) {
          throw new Error('رفع مستند/صورة إثبات استلام البضاعة إجباري.');
        }
        if (!payload.delivery_reference_number || !String(payload.delivery_reference_number).trim()) {
          throw new Error('كتابة الرقم المرجعي لسند الاستلام إجباري.');
        }
        if (!payload.pickup_driver_name || !String(payload.pickup_driver_name).trim()) {
          throw new Error('كتابة اسم سائق/مستلم العميل إجباري عند تحويل وتسليم الطلب من المستودع.');
        }
        if (!payload.pickup_vehicle_plate || !String(payload.pickup_vehicle_plate).trim()) {
          throw new Error('كتابة رقم لوحة سيارة/شاحنة العميل إجباري عند تحويل وتسليم الطلب من المستودع.');
        }

        order.delivery_type = 'customer_pickup';
        order.pickup_driver_name = String(payload.pickup_driver_name).trim();
        order.pickup_vehicle_plate = String(payload.pickup_vehicle_plate).trim();
        if (payload.pickup_receiver_id) order.pickup_receiver_id = String(payload.pickup_receiver_id).trim();
        order.delivery_reference_number = String(payload.delivery_reference_number).trim();
        order.delivery_image_url = String(imageUrl).trim();
        order.delivered_at = new Date();
      } else {
        if (order.driver_id !== user.id && user.role !== 'admin') throw new Error('لا تملك صلاحية تسليم هذا الطلب.');
        if (!imageUrl) throw new Error('رفع مستند/صورة إثبات التسليم إجباري.');
        if (!payload.delivery_reference_number || !String(payload.delivery_reference_number).trim()) {
          throw new Error('كتابة الرقم المرجعي لسند الاستلام إجباري.');
        }
        
        // التحقق من تجاوز المهلة (مع استثناء المدير)
        if (user.role !== 'admin' && order.timeout_deadline && new Date() > new Date(order.timeout_deadline)) {
           throw new Error('لقد تجاوزت المهلة المحددة، يرجى مراجعة المحاسب.');
        }

        const docRefStr = String(payload.delivery_reference_number).trim();
        const docNum = parseInt(docRefStr, 10);

        // إذا كان الرقم المكتوب حقولاً رقمية، نفحص الربط بدفاتر السائقين
        if (!isNaN(docNum)) {
          // 1. فحص هل الرقم مستخدم سابقاً فورياً
          const existingUsage = await DeliveryDocumentUsage.findOne({
            where: { document_number: docNum },
            transaction
          });
          if (existingUsage) {
            throw new Error(`رقم السند المكتوب (${docNum}) مستخدم مسبقاً في طلب آخر.`);
          }

          // 2. فحص هل الرقم يقع داخل نطاق دفتر نشط ومصروف لهذا السائق
          const targetDriverId = order.driver_id || user.id;
          const matchingBook = await DeliveryDocumentBook.findOne({
            where: {
              driver_id: targetDriverId,
              status: { [Op.in]: ['assigned', 'partially_used'] },
              start_number: { [Op.lte]: docNum },
              end_number: { [Op.gte]: docNum }
            },
            transaction
          });

          if (!matchingBook) {
            throw new Error(`رقم السند المكتوب (${docNum}) ليس ضمن أي دفتر نشط ومصروف للسائق الحالي.`);
          }

          // 3. تسجيل الاستخدام وتحديث حالة الدفتر داخل نفس الـ Transaction
          await DeliveryDocumentUsage.create({
            book_id: matchingBook.id,
            order_id: order.id,
            driver_id: targetDriverId,
            document_number: docNum,
            used_at: new Date()
          }, { transaction });

          matchingBook.used_documents_count += 1;
          matchingBook.remaining_documents_count -= 1;
          if (matchingBook.remaining_documents_count <= 0) {
            matchingBook.status = 'exhausted';
            matchingBook.closed_at = new Date();
          } else {
            matchingBook.status = 'partially_used';
          }
          await matchingBook.save({ transaction });
        }

        order.delivery_image_url = String(imageUrl).trim();
        order.delivery_reference_number = docRefStr;
        order.delivered_at = new Date();
      }


      // تحويل حالة مستند التخزين إلى 'attached'
      if (docRecord) {
        docRecord.order_id = order.id;
        docRecord.status = 'attached';
        docRecord.attached_at = new Date();
        await docRecord.save({ transaction });
      }

      // إرسال إشعار لحظي لمندوب المبيعات لتنزيل/ترحيل المستند للـ ERP
      if (order.sales_rep_id) {
        const { notifyUser } = require('./notificationService');
        notifyUser(order.sales_rep_id, 'ORDER_DELIVERED_WITH_PROOF', {
          order_id: order.id,
          order_number: order.order_number,
          message: `تم تسليم الطلب رقم ${order.order_number}. يمكنك الآن مشاهدة وتحميل مستند التسليم لترحيله إلى النظام الرئيسي.`,
          document_url: String(imageUrl).trim(),
          document_id: docRecord ? docRecord.id : null
        });
      }
    }

    // فشل التسليم
    if (targetStatus === 'failed_delivery') {
      if (order.driver_id !== user.id && user.role !== 'admin') throw new Error('لا تملك صلاحية على هذا الطلب.');
      if (!payload.note) throw new Error('سبب الفشل مطلوب.');
      order.failed_at = new Date();
    }

    // طلب إرجاع
    if (targetStatus === 'return_requested') {
      if (order.driver_id && order.driver_id !== user.id && user.role !== 'admin' && user.role !== 'sales_manager' && user.role !== 'sales_rep') {
        throw new Error('لا تملك صلاحية على هذا الطلب.');
      }
      order.return_requested_at = new Date();

      // إنشاء سجل المرتجع تلقائياً في جدول sales_returns لتزامن الواجهات
      const existingReturn = await SalesReturn.findOne({ where: { order_id: order.id }, transaction });
      if (!existingReturn) {
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
        const return_number = `RET-${dateStr}-${randomHex}`;

        const totalTons = order.items ? order.items.reduce((s, i) => s + Number(i.quantity_tons || 0), 0) : 0;
        const totalAmount = Number(order.total_amount || 0);

        const newReturn = await SalesReturn.create({
          return_number,
          order_id: order.id,
          client_id: order.client_id,
          created_by: user.id,
          driver_id: order.driver_id || null,
          status: 'return_requested',
          reason: payload.reason || payload.note || 'طلب إرجاع عبر النظام',
          original_order_status: order.status,
          total_requested_tons: totalTons,
          total_refund_amount: totalAmount
        }, { transaction });

        if (order.items && order.items.length > 0) {
          const itemsToCreate = order.items.map(item => ({
            sales_return_id: newReturn.id,
            product_id: item.product_id,
            requested_tons: Number(item.quantity_tons),
            unit_price: Number(item.price_per_ton_snapshot || 0),
            subtotal_refund: Number(item.quantity_tons) * Number(item.price_per_ton_snapshot || 0)
          }));
          await SalesReturnItem.bulkCreate(itemsToCreate, { transaction });
        }
      }
    }

    // المرتجع والإلغاء (Release Inventory)
    // [إصلاح] استخدام inventory_deducted_at بدلاً من فحص الحالة فقط
    const shouldRestoreInventory = (targetStatus === 'cancelled' || targetStatus === 'returned_to_warehouse') 
      && order.inventory_deducted_at 
      && !order.inventory_restored_at;

    if (targetStatus === 'cancelled') {
      order.cancellation_reason = payload.cancellation_reason || 'تم الإلغاء بواسطة المحاسب';
      order.cancelled_at = new Date();
    }

    if (targetStatus === 'returned_to_warehouse') {
      // التحقق التسلسلي الصارم: مسؤول المبيعات يجب أن يوافق أولاً
      const salesRet = await SalesReturn.findOne({ where: { order_id: order.id }, transaction });
      if (salesRet && salesRet.status === 'return_requested') {
        throw new Error('لا يمكن استلام أو فحص المرتجع بالمستودع قبل اعتماد وموافقة مدير المبيعات عليه أولاً.');
      }
      order.returned_at = new Date();
    }

    if (shouldRestoreInventory) {
      // إرجاع المخزون
      for (const item of order.items) {
        const product = await Product.findByPk(item.product_id, {
          transaction,
          lock: transaction.LOCK.UPDATE
        });

        if (product) {
          product.stock_quantity = Number(product.stock_quantity) + Number(item.quantity_tons);
          await product.save({ transaction });
        }
      }
      // [إصلاح] تسجيل أن المخزون تم إرجاعه لمنع الإرجاع المزدوج
      order.inventory_restored_at = new Date();
    }

    // 4. تحديث الحالة
    order.status = targetStatus;
    await order.save({ transaction });

    // [إصلاح 1.7] ربط الفاتورة بـ Transaction التسليم
    if (targetStatus === 'delivered') {
      const { generateInvoice } = require('./invoiceService');
      await generateInvoice(order.id, { transaction });
    }

    // 5. إنشاء سجل للتدقيق (Audit)
    await OrderStatusLog.create({
      order_id: order.id,
      from_status: currentStatus,
      to_status: targetStatus,
      changed_by: user.id,
      note: payload.note || payload.rejection_reason || payload.cancellation_reason || null
    }, { transaction });

    await transaction.commit();
    return order;

  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

module.exports = {
  transitionOrder,
  canTransition
};
