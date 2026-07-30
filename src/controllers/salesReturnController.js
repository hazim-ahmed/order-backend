const { Op } = require('sequelize');
const { randomBytes } = require('crypto');
const {
  SalesReturn,
  SalesReturnItem,
  Order,
  OrderItem,
  Product,
  Client,
  User,
  CreditNote,
  sequelize
} = require('../models');
const { notifyRole, notifyUser } = require('../services/notificationService');

const RETURN_STATUSES = {
  REQUESTED: 'return_requested',
  SALES_APPROVED: 'sales_approved',
  FINANCE_APPROVED: 'finance_approved',
  IN_TRANSIT: 'in_transit',
  DRIVER_DELIVERED: 'driver_delivered',
  RETURNED_TO_WAREHOUSE: 'returned_to_warehouse',
  CREDIT_NOTE_ISSUED: 'credit_note_issued',
  REJECTED: 'rejected'
};

const REFUND_MODES = ['good_only', 'good_and_damaged', 'all'];

const generateReferenceNumber = (prefix) => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomHex = randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${dateStr}-${randomHex}`;
};

const createUniqueReferenceNumber = async (model, field, prefix, transaction) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = generateReferenceNumber(prefix);
    const existing = await model.findOne({ where: { [field]: value }, transaction });
    if (!existing) return value;
  }
  throw new Error('تعذر توليد رقم مرجعي فريد، يرجى المحاولة مرة أخرى.');
};

const parsePositiveNumber = (value, message) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(message);
  return number;
};

const getRefundableTons = (mode, goodTons, damagedTons, missingTons) => {
  switch (mode) {
    case 'good_only':
      return goodTons;
    case 'all':
      return goodTons + damagedTons + missingTons;
    case 'good_and_damaged':
    default:
      return goodTons + damagedTons;
  }
};

const createSalesReturn = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { order_id, reason, items, driver_id } = req.body;

    if (!order_id) throw new Error('رقم الطلب الأصلي مطلوب.');
    if (!reason || !reason.trim()) throw new Error('سبب طلب الإرجاع مطلوب.');
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('يجب إضافة صنف واحد على الأقل للمرتجع.');
    }

    const originalOrder = await Order.findByPk(order_id, {
      include: [{ model: OrderItem, as: 'items' }],
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!originalOrder) {
      throw new Error(`الطلب الأصلي برقم المعرف ${order_id} غير موجود.`);
    }

    if (req.user.role === 'sales_rep' && originalOrder.sales_rep_id !== req.user.id && originalOrder.created_by !== req.user.id) {
      throw new Error('عذراً، لا تملك صلاحية لطلب مرتجع لطلب لا يخصك.');
    }

    const allowedOrderStatuses = ['delivered', 'returned_to_warehouse', 'failed_delivery'];
    if (!allowedOrderStatuses.includes(originalOrder.status)) {
      throw new Error(`لا يمكن إنشاء طلب مرتجع لطلب بحالة "${originalOrder.status}". يجب أن يكون الطلب مسلماً أو فشل تسليمه.`);
    }

    const previousReturns = await SalesReturn.findAll({
      where: {
        order_id: originalOrder.id,
        status: { [Op.ne]: RETURN_STATUSES.REJECTED }
      },
      include: [{ model: SalesReturnItem, as: 'items' }],
      transaction
    });

    const previousReturnedByProduct = {};
    for (const previousReturn of previousReturns) {
      for (const previousItem of previousReturn.items || []) {
        const productId = Number(previousItem.product_id);
        previousReturnedByProduct[productId] = (previousReturnedByProduct[productId] || 0) + Number(previousItem.requested_tons || 0);
      }
    }

    const return_number = await createUniqueReferenceNumber(SalesReturn, 'return_number', 'RET', transaction);
    let total_requested_tons = 0;
    let total_refund_amount = 0;
    const itemsToCreate = [];
    const processedProductIds = new Set();

    for (const item of items) {
      const productId = Number(item.product_id);
      if (!Number.isInteger(productId) || productId <= 0) {
        throw new Error('معرف المنتج غير صالح في قائمة المرتجع.');
      }
      if (processedProductIds.has(productId)) {
        throw new Error(`تم تكرار المنتج رقم ${productId} في قائمة المرتجع.`);
      }
      processedProductIds.add(productId);

      const requestedQty = parsePositiveNumber(
        item.requested_tons ?? item.quantity_tons ?? item.quantity,
        'الكمية المطلوبة غير صالحة للصنف.'
      );

      const origItem = originalOrder.items.find(i => Number(i.product_id) === productId);
      if (!origItem) {
        throw new Error(`المنتج رقم ${productId} غير موجود في الطلب الأصلي ولا يمكن إرجاعه.`);
      }

      const previouslyReturned = previousReturnedByProduct[productId] || 0;
      const availableQty = Number(origItem.quantity_tons || 0) - previouslyReturned;
      if (requestedQty > availableQty + 0.0005) {
        throw new Error(`الكمية المرتجعة للمنتج ${productId} تتجاوز الكمية المتاحة للإرجاع. المتاح: ${Math.max(0, availableQty).toFixed(3)} طن.`);
      }

      const unitPrice = Number(origItem.price_per_ton_snapshot || 0);
      const subtotal = requestedQty * unitPrice;

      total_requested_tons += requestedQty;
      total_refund_amount += subtotal;
      itemsToCreate.push({
        product_id: productId,
        requested_tons: requestedQty,
        unit_price: unitPrice,
        subtotal_refund: subtotal
      });
    }

    const salesReturn = await SalesReturn.create({
      return_number,
      order_id: originalOrder.id,
      client_id: originalOrder.client_id,
      created_by: req.user.id,
      driver_id: driver_id || null,
      status: RETURN_STATUSES.REQUESTED,
      reason: reason.trim(),
      original_order_status: originalOrder.status,
      total_requested_tons,
      total_refund_amount
    }, { transaction });

    for (const itemData of itemsToCreate) {
      itemData.sales_return_id = salesReturn.id;
    }
    await SalesReturnItem.bulkCreate(itemsToCreate, { transaction });

    originalOrder.status = 'return_requested';
    originalOrder.return_requested_at = new Date();
    await originalOrder.save({ transaction });

    await transaction.commit();

    notifyRole('sales_manager', 'new_return_requested', {
      message: `طلب مرتجع مبيعات جديد بحاجة للمراجعة: ${salesReturn.return_number}`,
      returnId: salesReturn.id
    });
    notifyRole('admin', 'new_return_requested', {
      message: `طلب مرتجع جديد صادر من المبيعات: ${salesReturn.return_number}`,
      returnId: salesReturn.id
    });

    res.status(201).json({
      message: 'تم تقديم طلب مرتجع المبيعات بنجاح.',
      salesReturn
    });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ error: error.message });
  }
};

const getSalesReturns = async (req, res) => {
  try {
    const { role, id } = req.user;
    const { page = 1, limit = 50, status } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const whereClause = {};
    if (role === 'sales_manager') {
      whereClause.status = RETURN_STATUSES.REQUESTED;
    } else if (status) {
      const statuses = String(status).split(',').map(item => item.trim()).filter(Boolean);
      whereClause.status = statuses.length > 1 ? { [Op.in]: statuses } : statuses[0];
    }

    if (role === 'sales_rep') {
      const repOrders = await Order.findAll({ where: { sales_rep_id: id }, attributes: ['id'] });
      const repOrderIds = repOrders.map(o => o.id);
      whereClause[Op.or] = [
        { created_by: id },
        { order_id: { [Op.in]: repOrderIds } }
      ];
    } else if (role === 'driver') {
      whereClause.driver_id = id;
    }

    const { count, rows: returns } = await SalesReturn.findAndCountAll({
      where: whereClause,
      distinct: true,
      include: [
        { model: Client, as: 'client', attributes: ['id', 'name', 'phone', 'address'] },
        { model: User, as: 'createdBy', attributes: ['id', 'name', 'username', 'role'] },
        { model: User, as: 'driver', attributes: ['id', 'name', 'username', 'phone'] },
        { model: Order, as: 'order', attributes: ['id', 'order_number', 'total_amount', 'status'] },
        {
          model: SalesReturnItem,
          as: 'items',
          include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'erp_id'] }]
        },
        { model: CreditNote, as: 'creditNote' }
      ],
      order: [['createdAt', 'DESC']],
      limit: limitNum,
      offset
    });

    res.status(200).json({
      total: count,
      page: pageNum,
      totalPages: Math.ceil(count / limitNum),
      returns
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getSalesReturnById = async (req, res) => {
  try {
    const { id } = req.params;
    const salesReturn = await SalesReturn.findByPk(id, {
      include: [
        { model: Client, as: 'client' },
        { model: User, as: 'createdBy', attributes: ['id', 'name', 'username', 'role'] },
        { model: User, as: 'driver', attributes: ['id', 'name', 'username', 'phone'] },
        { model: Order, as: 'order' },
        {
          model: SalesReturnItem,
          as: 'items',
          include: [{ model: Product, as: 'product' }]
        },
        { model: CreditNote, as: 'creditNote' }
      ]
    });

    if (!salesReturn) {
      return res.status(404).json({ error: 'طلب المرتجع غير موجود.' });
    }

    const { role, id: userId } = req.user;
    if (role === 'sales_rep' && salesReturn.created_by !== userId && salesReturn.order?.sales_rep_id !== userId) {
      return res.status(403).json({ error: 'لا تملك صلاحية لعرض هذا المرتجع.' });
    }
    if (role === 'driver' && salesReturn.driver_id !== userId) {
      return res.status(403).json({ error: 'لا تملك صلاحية لعرض هذا المرتجع.' });
    }

    res.status(200).json({ salesReturn });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const approveSalesReturn = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { approval_stage, action = 'approve', rejection_reason, driver_id, refund_mode } = req.body;

    const salesReturn = await SalesReturn.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!salesReturn) throw new Error('طلب المرتجع غير موجود.');

    if (action === 'reject') {
      if (!['return_requested', 'sales_approved'].includes(salesReturn.status)) {
        throw new Error('لا يمكن رفض مرتجع بهذه الحالة.');
      }
      if (!rejection_reason || !String(rejection_reason).trim()) {
        throw new Error('سبب رفض طلب الإرجاع مطلوب.');
      }

      salesReturn.status = RETURN_STATUSES.REJECTED;
      salesReturn.rejection_reason = String(rejection_reason).trim();
      await salesReturn.save({ transaction });

      const originalOrder = await Order.findByPk(salesReturn.order_id, { transaction, lock: transaction.LOCK.UPDATE });
      if (originalOrder) {
        originalOrder.status = salesReturn.original_order_status || 'delivered';
        await originalOrder.save({ transaction });
      }

      await transaction.commit();
      notifyUser(salesReturn.created_by, 'return_rejected', {
        message: `تم رفض طلب المرتجع ${salesReturn.return_number}: ${salesReturn.rejection_reason}`
      });
      return res.status(200).json({ message: 'تم رفض طلب المرتجع.', salesReturn });
    }

    if (approval_stage === 'finance' && req.user.role !== 'admin') {
      throw new Error('الاعتماد المالي للمرتجعات محصور بدور admin فقط.');
    }

    if (salesReturn.status !== RETURN_STATUSES.REQUESTED) {
      throw new Error('لا يمكن اعتماد مرتجع بهذه الحالة. يجب أن يكون بانتظار الاعتماد.');
    }

    const normalizedRefundMode = REFUND_MODES.includes(refund_mode) ? refund_mode : 'good_and_damaged';

    if (approval_stage === 'finance') {
      salesReturn.status = RETURN_STATUSES.FINANCE_APPROVED;
      salesReturn.finance_approved_at = new Date();
    } else {
      salesReturn.status = RETURN_STATUSES.SALES_APPROVED;
      salesReturn.sales_approved_at = new Date();
      salesReturn.refund_mode = normalizedRefundMode;
    }

    if (driver_id) {
      const driver = await User.findByPk(driver_id, { transaction });
      if (!driver || driver.role !== 'driver') {
        throw new Error('المستخدم المحدد ليس سائقاً صالحاً.');
      }
      salesReturn.driver_id = driver.id;
      salesReturn.status = RETURN_STATUSES.IN_TRANSIT;
    }

    await salesReturn.save({ transaction });
    await transaction.commit();

    notifyRole('inventory_manager', 'return_approved', {
      message: `طلب مرتجع معتمد بانتظار الاستلام بالمخزن: ${salesReturn.return_number}`,
      returnId: salesReturn.id
    });

    res.status(200).json({ message: 'تم اعتماد طلب المرتجع بنجاح.', salesReturn });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ error: error.message });
  }
};

const assignDriverForReturn = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { driver_id } = req.body;

    if (!driver_id) throw new Error('معرف السائق مطلوب.');

    const salesReturn = await SalesReturn.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!salesReturn) throw new Error('طلب المرتجع غير موجود.');

    if (!['sales_approved', 'finance_approved'].includes(salesReturn.status)) {
      throw new Error('لا يمكن إسناد سائق إلا بعد اعتماد المبيعات.');
    }

    const driver = await User.findByPk(driver_id, { transaction });
    if (!driver || driver.role !== 'driver') {
      throw new Error('المستخدم المحدد ليس سائقاً صالحاً.');
    }

    salesReturn.driver_id = driver.id;
    salesReturn.status = RETURN_STATUSES.IN_TRANSIT;
    await salesReturn.save({ transaction });
    await transaction.commit();

    notifyUser(driver.id, 'return_transport_assigned', {
      message: `تم إسناد نقل بضاعة مرتجعة إليك: ${salesReturn.return_number}`,
      returnId: salesReturn.id
    });

    res.status(200).json({ message: 'تم إسناد السائق لنقل المرتجع.', salesReturn });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ error: error.message });
  }
};

const confirmDriverDelivery = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;

    const salesReturn = await SalesReturn.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!salesReturn) throw new Error('طلب المرتجع غير موجود.');
    if (salesReturn.status !== RETURN_STATUSES.IN_TRANSIT) {
      throw new Error('المرتجع ليس في حالة نقل حالياً.');
    }
    if (Number(salesReturn.driver_id) !== Number(req.user.id)) {
      throw new Error('لا تملك صلاحية على هذا المرتجع.');
    }

    salesReturn.status = RETURN_STATUSES.DRIVER_DELIVERED;
    salesReturn.driver_delivered_at = new Date();
    await salesReturn.save({ transaction });
    await transaction.commit();

    notifyRole('inventory_manager', 'return_driver_delivered', {
      message: `السائق أكد تسليم المرتجع ${salesReturn.return_number} للمستودع. يرجى الفحص والتأكيد.`,
      returnId: salesReturn.id
    });

    res.status(200).json({ message: 'تم تأكيد تسليم البضاعة المرتجعة للمستودع.', salesReturn });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ error: error.message });
  }
};

const inspectSalesReturn = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { items, inspection_notes } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('تفاصيل أطنان الفحص لكل صنف مطلوبة.');
    }

    const salesReturn = await SalesReturn.findByPk(id, {
      include: [{ model: SalesReturnItem, as: 'items' }],
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!salesReturn) throw new Error('طلب المرتجع غير موجود.');

    const allowedStatuses = [
      RETURN_STATUSES.SALES_APPROVED,
      RETURN_STATUSES.FINANCE_APPROVED,
      RETURN_STATUSES.IN_TRANSIT,
      RETURN_STATUSES.DRIVER_DELIVERED
    ];
    if (!allowedStatuses.includes(salesReturn.status)) {
      throw new Error('يجب اعتماد المرتجع قبل فحصه واستلامه بالمخزن.');
    }

    const inputProductIds = new Set(items.map(item => Number(item.product_id)));
    const missingDbItems = salesReturn.items.filter(item => !inputProductIds.has(Number(item.product_id)));
    if (missingDbItems.length > 0) {
      throw new Error('يجب إرسال نتائج الفحص لكل أصناف المرتجع.');
    }

    let totalGoodTons = 0;
    let totalDamagedTons = 0;
    let totalMissingTons = 0;
    let newRefundAmount = 0;
    const refundMode = salesReturn.refund_mode || 'good_and_damaged';

    for (const itemInput of items) {
      const dbItem = salesReturn.items.find(i => Number(i.product_id) === Number(itemInput.product_id));
      if (!dbItem) throw new Error(`الصنف رقم ${itemInput.product_id} غير موجود في المرتجع.`);

      const requestedTons = Number(dbItem.requested_tons || 0);
      const goodTons = Number(itemInput.verified_good_tons || 0);
      const damagedTons = Number(itemInput.verified_damaged_tons || 0);
      let missingTons = Number(itemInput.verified_missing_tons || 0);

      if (goodTons < 0 || damagedTons < 0 || missingTons < 0) {
        throw new Error('قيم الأطنان الفعلية يجب أن تكون موجبة.');
      }

      const enteredTotal = goodTons + damagedTons + missingTons;
      if (enteredTotal > requestedTons + 0.0005) {
        throw new Error(`إجمالي الأطنان المدخلة للمنتج ${dbItem.product_id} (${enteredTotal}) يتجاوز الكمية المطلوبة (${requestedTons}).`);
      }
      if (enteredTotal < requestedTons) {
        missingTons += requestedTons - enteredTotal;
      }

      const refundableTons = getRefundableTons(refundMode, goodTons, damagedTons, missingTons);
      dbItem.verified_good_tons = goodTons;
      dbItem.verified_damaged_tons = damagedTons;
      dbItem.verified_missing_tons = missingTons;
      dbItem.subtotal_refund = refundableTons * Number(dbItem.unit_price || 0);
      await dbItem.save({ transaction });

      totalGoodTons += goodTons;
      totalDamagedTons += damagedTons;
      totalMissingTons += missingTons;
      newRefundAmount += Number(dbItem.subtotal_refund || 0);

      if (goodTons > 0) {
        const product = await Product.findByPk(dbItem.product_id, { transaction, lock: transaction.LOCK.UPDATE });
        if (product) {
          product.stock_quantity = Number(product.stock_quantity || 0) + goodTons;
          await product.save({ transaction });
        }
      }
    }

    salesReturn.verified_good_tons = totalGoodTons;
    salesReturn.verified_damaged_tons = totalDamagedTons;
    salesReturn.verified_missing_tons = totalMissingTons;
    salesReturn.total_refund_amount = newRefundAmount;
    salesReturn.inspection_notes = inspection_notes || null;
    salesReturn.inspected_at = new Date();
    salesReturn.returned_at = new Date();
    salesReturn.status = RETURN_STATUSES.RETURNED_TO_WAREHOUSE;

    const origOrder = await Order.findByPk(salesReturn.order_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (origOrder) {
      origOrder.status = 'returned_to_warehouse';
      origOrder.returned_at = new Date();
      await origOrder.save({ transaction });
    }

    await salesReturn.save({ transaction });
    await transaction.commit();

    notifyRole('admin', 'return_inspected', {
      message: `تم فحص المرتجع ${salesReturn.return_number} واستلامه بالمخزن. جاهز لإصدار الإشعار الدائن.`,
      returnId: salesReturn.id
    });

    res.status(200).json({
      message: 'تم فحص المرتجع وإعادة إدخال البضاعة السليمة للمخزون بنجاح.',
      salesReturn
    });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ error: error.message });
  }
};

const issueCreditNote = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;

    const salesReturn = await SalesReturn.findByPk(id, {
      include: [{ model: CreditNote, as: 'creditNote' }],
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!salesReturn) throw new Error('طلب المرتجع غير موجود.');
    if (salesReturn.creditNote) throw new Error('تم إصدار إشعار دائن لهذا المرتجع سابقاً.');
    if (salesReturn.status !== RETURN_STATUSES.RETURNED_TO_WAREHOUSE) {
      throw new Error('يجب فحص المرتجع واستلامه بالمخزن أولاً قبل إصدار الإشعار الدائن.');
    }

    const subtotal = Number(salesReturn.total_refund_amount || 0);
    const tax_amount = subtotal * 0.15;
    const total_amount = subtotal + tax_amount;
    const credit_note_number = await createUniqueReferenceNumber(CreditNote, 'credit_note_number', 'CN', transaction);

    const creditNote = await CreditNote.create({
      credit_note_number,
      sales_return_id: salesReturn.id,
      client_id: salesReturn.client_id,
      subtotal,
      tax_amount,
      total_amount,
      status: 'ISSUED'
    }, { transaction });

    salesReturn.status = RETURN_STATUSES.CREDIT_NOTE_ISSUED;
    salesReturn.credit_note_issued_at = new Date();
    await salesReturn.save({ transaction });

    await transaction.commit();

    notifyUser(salesReturn.created_by, 'credit_note_issued', {
      message: `تم إصدار الإشعار الدائن ${credit_note_number} بمبلغ ${total_amount.toFixed(2)} ريال.`
    });

    res.status(201).json({
      message: 'تم إصدار الإشعار الدائن بنجاح.',
      creditNote,
      salesReturn
    });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  createSalesReturn,
  getSalesReturns,
  getSalesReturnById,
  approveSalesReturn,
  assignDriverForReturn,
  confirmDriverDelivery,
  inspectSalesReturn,
  issueCreditNote
};