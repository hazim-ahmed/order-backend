// ==============================================================================
// طھط§ط±ظٹط® ط§ظ„طھط¹ط¯ظٹظ„: 2026-07-22
// ط§ظ„ظˆط¸ظٹظپط©: ط§ظ„ظ…طھط­ظƒظ… ط§ظ„ط®ط§طµ ط¨ط¬ظ…ظٹط¹ ط¹ظ…ظ„ظٹط§طھ ط§ظ„ط·ظ„ط¨ط§طھ (Orders Controller)
// ط§ظ„ط³ظٹط§ظ‚: ظٹط¶ظ…ظ† ط­ظ…ط§ظٹط© ط§ظ„ظ…ظ„ظƒظٹط© ط§ظ„ط£ظپظ‚ظٹط© (IDOR Protection) ظˆطھط£ظ…ظٹظ† طھط³ظ„ط³ظ„ ط§ظ„ظ…ظˆط§ظپظ‚ط§طھ ظ…ط¹ State Machine
// ==============================================================================

const { Op } = require('sequelize');
const { randomBytes } = require('crypto');
const { Order, OrderItem, Product, Client, User, OrderStatusLog, sequelize } = require('../models');
const { transitionOrder } = require('../services/stateMachine');
const { notifyRole, notifyUser } = require('../services/notificationService');
const { addDecimal, divideDecimal, multiplyDecimal } = require('../utils/decimal');

const isDev = process.env.NODE_ENV !== 'production';

// ==============================================================================
// طھط§ط±ظٹط® ط§ظ„طھط¹ط¯ظٹظ„: 2026-07-22
// ط§ظ„ظˆط¸ظٹظپط©: ط¯ط§ظ„ط© ط§ظ„طھط­ظ‚ظ‚ ط§ظ„ظ…ط±ظƒط²ظٹ ظ…ظ† ط§ظ„ظ…ظ„ظƒظٹط© ط§ظ„ط£ظپظ‚ظٹط© ظ„ظ‚ط±ط§ط،ط© ط¨ظٹط§ظ†ط§طھ ط§ظ„ط·ظ„ط¨ (Row-Level Authorization)
// ط§ظ„ط³ظٹط§ظ‚: طھط­ظ„ ط«ط؛ط±ط© IDOR (Fix-Sec - Section 6) ظ„ط­ط¸ط± ظˆطµظˆظ„ ط§ظ„ظ…ط³طھط®ط¯ظ… ظ„ط·ظ„ط¨ط§طھ ظ„ط§ طھظ‚ط¹ ط¶ظ…ظ† ط§ط®طھطµط§طµظ‡
// ==============================================================================
const canAccessOrder = (user, order) => {
  if (user.role === 'admin') return true;
  if (user.role === 'sales_manager') return true;
  if (user.role === 'sales_rep' && (order.sales_rep_id === user.id || order.created_by === user.id)) return true;
  if (user.role === 'driver' && order.driver_id === user.id) return true;
  if (user.role === 'inventory_manager') {
    const inventoryStatuses = [
      'pending_inventory_approval', 'processing_in_warehouse',
      'assigned_to_driver', 'ready_for_pickup',
      'picked_up_by_driver', 'delivered', 'failed_delivery',
      'return_requested', 'returned_to_warehouse'
    ];
    if (inventoryStatuses.includes(order.status)) return true;
    if (order.status === 'cancelled' && order.sales_approved_at !== null) return true;
    return false;
  }
  return false;
};

/**
 * ط¥ظ†ط´ط§ط، ط·ظ„ط¨ ط¬ط¯ظٹط¯ (ظٹط³طھط®ط¯ظ…ظ‡ ظ…ظ†ط¯ظˆط¨ ط§ظ„ظ…ط¨ظٹط¹ط§طھ)
 * [طھظ… ط§ظ„ط¥طµظ„ط§ط­]: طھط­ظ‚ظ‚ طµط§ط±ظ… ظ…ظ† ط§ظ„ظ…ط¯ط®ظ„ط§طھ + ط³ط¬ظ„ ط¥ظ†ط´ط§ط، ط§ظ„ط·ظ„ط¨
 */
const createOrder = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { 
      client_name, 
      client_id, 
      items, 
      delivery_type = 'delivery',
      pickup_driver_name,
      pickup_vehicle_plate,
      pickup_receiver_id,
      freight_rate = 0,
      freight_unit = 'kg'
    } = req.body;
    
    // [ط¥طµظ„ط§ط­] ط§ظ„طھط­ظ‚ظ‚ ط§ظ„طµط§ط±ظ… ظ…ظ† ط§ظ„ظ…ط¯ط®ظ„ط§طھ
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('ظٹط¬ط¨ ط¥ط¶ط§ظپط© ط£طµظ†ط§ظپ ظ„ظ„ط·ظ„ط¨ (items ظٹط¬ط¨ ط£ظ† طھظƒظˆظ† ظ…طµظپظˆظپط© ط؛ظٹط± ظپط§ط±ط؛ط©).');
    }

    let finalClientId = client_id;

    // ط¥ط°ط§ طھظ… طھظ…ط±ظٹط± ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„ ط¨ط¯ظ„ط§ظ‹ ظ…ظ† ط§ظ„ظ…ط¹ط±ظپطŒ ظ†ط¨ط­ط« ط¹ظ†ظ‡ ط£ظˆ ظ†ظ†ط´ط¦ظ‡
    if (client_name && !client_id) {
      let client = await Client.findOne({ where: { name: client_name }, transaction });
      if (!client) {
        client = await Client.create({ name: client_name }, { transaction });
      }
      finalClientId = client.id;
    }

    // [ط¥طµظ„ط§ط­] ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظˆط¬ظˆط¯ ط§ظ„ط¹ظ…ظٹظ„ ط¹ظ†ط¯ طھظ…ط±ظٹط± client_id
    if (client_id && !client_name) {
      const existingClient = await Client.findByPk(client_id, { transaction });
      if (!existingClient) {
        throw new Error(`ط§ظ„ط¹ظ…ظٹظ„ ط°ظˆ ط§ظ„ظ…ط¹ط±ظپ ${client_id} ط؛ظٹط± ظ…ظˆط¬ظˆط¯ ظپظٹ ط§ظ„ظ†ط¸ط§ظ….`);
      }
    }

    if (!finalClientId) {
      throw new Error('ط§ظ„ط±ط¬ط§ط، طھط­ط¯ظٹط¯ ط§ظ„ط¹ظ…ظٹظ„ (ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„ ط£ظˆ ظ…ط¹ط±ظپ ط§ظ„ط¹ظ…ظٹظ„).');
    }

    // [ط¥طµظ„ط§ط­ M-3] طھظˆظ„ظٹط¯ ط±ظ‚ظ… ط·ظ„ط¨ ظپط±ظٹط¯ ط¨ط§ط³طھط®ط¯ط§ظ… crypto ط¨ط¯ظ„ط§ظ‹ ظ…ظ† Math.random()
    // توليد رقم طلب فريد داخل نفس transaction قبل إنشاء السجل.
    const order_number = await createUniqueOrderNumber(transaction);

    let total_tons = 0;
    let products_amount = 0;
    
    // ط¥ظ†ط´ط§ط، ط§ظ„ط·ظ„ط¨
    const order = await Order.create({
      order_number,
      client_id: finalClientId,
      sales_rep_id: req.user.id,
      status: 'pending_sales_approval',
      delivery_type: delivery_type === 'customer_pickup' ? 'customer_pickup' : 'delivery',
      pickup_driver_name: pickup_driver_name || null,
      pickup_vehicle_plate: pickup_vehicle_plate || null,
      pickup_receiver_id: pickup_receiver_id || null,
      total_tons: 0,
      total_amount: 0,
      freight_rate: Number(freight_rate) || 0,
      freight_unit: freight_unit === 'ton' ? 'ton' : 'kg',
      freight_amount: 0
    }, { transaction });

    const orderItemsToCreate = [];

    // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط§ظ„ط£طµظ†ط§ظپ ظˆط­ط³ط§ط¨ ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ ط¨ظ†ط§ط،ظ‹ ط¹ظ„ظ‰ ط§ظ„ط³ط¹ط± ط§ظ„ظ…ط¯ط®ظ„ ظ…ظ† ط§ظ„ظ…ظ†ط¯ظˆط¨ (ظ…ط¹ طھط¬ظ…ظٹط¯ ط§ظ„ط³ط¹ط± ظˆط¯ط¹ظ… ظˆط­ط¯ط§طھ ظƒط¬ظ… / ط·ظ†)
    for (const item of items) {
      const rawUnit = (item.unit || item.weight_unit || 'kg').toString().toLowerCase().trim();
      const isKg = rawUnit === 'kg' || rawUnit === 'ظƒط¬ظ…' || rawUnit === 'ظƒظٹظ„ظˆ' || rawUnit === 'ظƒظٹظ„ظˆط¬ط±ط§ظ…';
      const unit = isKg ? 'kg' : 'ton';
      
      const rawQty = Number(item.quantity !== undefined && item.quantity !== null && item.quantity !== '' ? item.quantity : item.quantity_tons);
      if (!Number.isFinite(rawQty) || rawQty <= 0) {
        throw new Error(`ط§ظ„ظƒظ…ظٹط© ط؛ظٹط± طµط§ظ„ط­ط© ظ„ظ„طµظ†ظپ: ${item.product_name || item.product_id || 'ط؛ظٹط± ظ…ط³ظ…ظ‰'}.`);
      }

      // طھط­ظˆظٹظ„ ط§ظ„ظƒظ…ظٹط© ط¥ظ„ظ‰ ط£ط·ظ†ط§ظ† ظ„ظ„ط­ط³ط§ط¨ط§طھ ط§ظ„ظ…ط±ظƒط²ظٹط© ظˆط§ظ„ظ…ط§ظ„ظٹط©
      const quantity_tons = isKg ? divideDecimal(rawQty, 1000) : rawQty;

      let product;
      if (item.product_id) {
        product = await Product.findByPk(item.product_id, { transaction });
      } else if (item.product_name) {
        product = await Product.findOne({ where: { name: item.product_name.trim() }, transaction });
      }
      
      if (!product) throw new Error(`ط§ظ„ظ…ظ†طھط¬ ${item.product_name || item.product_id} ط؛ظٹط± ظ…ظˆط¬ظˆط¯ ظپظٹ ط§ظ„ظ†ط¸ط§ظ…`);

      // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ…ط§ ط¥ط°ط§ ظƒط§ظ† ط§ظ„ظ…ظ†ط¯ظˆط¨ ظ‚ط¯ ط­ط¯ط¯ ط³ط¹ط±ط§ظ‹ ظ…ط®طµطµط§ظ‹ ظ„ظ„ظˆط­ط¯ط© ط§ظ„ظ…ط®طھط§ط±ط© (ط±ظٹط§ظ„/ظƒط¬ظ… ط£ظˆ ط±ظٹط§ظ„/ط·ظ†)
      const inputUnitPrice = Number(item.price_per_unit !== undefined && item.price_per_unit !== null && item.price_per_unit !== '' ? item.price_per_unit : item.custom_price);

      let priceSnapshot;
      if (Number.isFinite(inputUnitPrice) && inputUnitPrice > 0) {
        // طھط­ظˆظٹظ„ ط³ط¹ط± ط§ظ„ظˆط­ط¯ط© ط¥ظ„ظ‰ ط³ط¹ط± ظ„ظƒظ„ ط·ظ† ظ„ظ„ظ€ snapshot ظˆط§ظ„ط¹ظ…ظ„ظٹط§طھ ط§ظ„ظ…ط§ظ„ظٹط© ط§ظ„ظ…ط±ظƒط²ظٹط©
        priceSnapshot = isKg ? (inputUnitPrice * 1000) : inputUnitPrice;
      } else {
        // ط§ظ„ط§ط¹طھظ…ط§ط¯ ط¹ظ„ظ‰ ط³ط¹ط± ط§ظ„ظƒطھط§ظ„ظˆط¬ ط§ظ„ظ‚ظٹط§ط³ظٹ ظپظٹ ط­ط§ظ„ ط¹ط¯ظ… طھط­ط¯ظٹط¯ ط³ط¹ط± ظ…ط®طµطµ ظ…ظ† ط§ظ„ظ…ظ†ط¯ظˆط¨
        priceSnapshot = Number(product.current_price_per_ton);
      }

      total_tons = addDecimal(total_tons, quantity_tons);
      products_amount = addDecimal(products_amount, multiplyDecimal(quantity_tons, Number(priceSnapshot)));

      orderItemsToCreate.push({
        order_id: order.id,
        product_id: product.id,
        quantity_tons: quantity_tons,
        entered_quantity: rawQty,
        unit: unit,
        price_per_ton_snapshot: priceSnapshot
      });
    }

    // ط­ظپط¸ ط§ظ„ط£طµظ†ط§ظپ
    await OrderItem.bulkCreate(orderItemsToCreate, { transaction });

    // طھط­ط¯ظٹط« ط§ظ„ظ…ط¬ط§ظ…ظٹط¹ ظˆط¥ظ„ط؛ط§ط، ط±ط³ظˆظ… ط§ظ„ط­ظ…ظˆظ„ط© ط§ظ„ظ…ط³طھظ‚ظ„ط©
    order.total_tons = total_tons;
    order.freight_rate = 0;
    order.freight_unit = 'kg';
    order.freight_amount = 0;
    order.total_amount = products_amount;
    await order.save({ transaction });

    // [ط¥طµظ„ط§ط­] ط¥ط¶ط§ظپط© ط³ط¬ظ„ ط¥ظ†ط´ط§ط، ط§ظ„ط·ظ„ط¨ ظپظٹ OrderStatusLog
    await OrderStatusLog.create({
      order_id: order.id,
      from_status: null,
      to_status: 'pending_sales_approval',
      changed_by: req.user.id,
      note: 'ط¥ظ†ط´ط§ط، ط·ظ„ط¨ ط¬ط¯ظٹط¯'
    }, { transaction });

    await transaction.commit();

    // ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± ظ„ظ…ط¯ظٹط± ط§ظ„ظ…ط¨ظٹط¹ط§طھ ط¨ظˆط¬ظˆط¯ ط·ظ„ط¨ ط¬ط¯ظٹط¯
    notifyRole('sales_manager', 'new_order_pending', {
      message: `ط·ظ„ط¨ ط¬ط¯ظٹط¯ ط¨ط­ط§ط¬ط© ظ„ظ„ظ…ظˆط§ظپظ‚ط©: ${order.order_number}`,
      orderId: order.id
    });

    res.status(201).json({ message: 'طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ط·ظ„ط¨ ط¨ظ†ط¬ط§ط­.', order });

  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ error: error.message });
  }
};

// يولد رقم طلب بثمانية رموز عشوائية لتقليل احتمالات التصادم.
const generateOrderNumber = () => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomHex = randomBytes(4).toString('hex').toUpperCase();
  return `KMT-${dateStr}-${randomHex}`;
};

// يتحقق من تفرد رقم الطلب قبل الحفظ ويعيد المحاولة عدة مرات عند التصادم.
const createUniqueOrderNumber = async (transaction) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const orderNumber = generateOrderNumber();
    const existingOrder = await Order.findOne({ where: { order_number: orderNumber }, transaction });
    if (!existingOrder) return orderNumber;
  }
  throw new Error('تعذر توليد رقم طلب فريد، يرجى المحاولة مرة أخرى.');
};
/**
 * طھط؛ظٹظٹط± ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ (ط§ط³طھط¯ط¹ط§ط، State Machine)
 */
const changeOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetStatus, payload } = req.body;

    const updatedOrder = await transitionOrder(id, targetStatus, req.user, payload);

    // ط¥ط´ط¹ط§ط±ط§طھ ظˆط£ط­ط¯ط§ط« ظ„ط§ط­ظ‚ط© ط¨ظ†ط§ط،ظ‹ ط¹ظ„ظ‰ ط§ظ„ط­ط§ظ„ط© ط§ظ„ط¬ط¯ظٹط¯ط©
    switch (targetStatus) {
      case 'pending_inventory_approval':
        notifyRole('inventory_manager', 'order_approved_by_sales', { message: `ط·ظ„ط¨ ظ…ط¹طھظ…ط¯ ظ„ظ„طھط­ط¶ظٹط±: ${updatedOrder.order_number}`, orderId: id });
        notifyUser(updatedOrder.sales_rep_id, 'order_status_changed', { message: `طھظ…طھ ط§ظ„ظ…ظˆط§ظپظ‚ط© ط¹ظ„ظ‰ ط·ظ„ط¨ظƒ: ${updatedOrder.order_number}`, status: targetStatus });
        break;
      case 'rejected_by_sales':
        notifyUser(updatedOrder.sales_rep_id, 'order_status_changed', { message: `طھظ… ط±ظپط¶ ط·ظ„ط¨ظƒ: ${updatedOrder.order_number}`, status: targetStatus });
        break;
      case 'assigned_to_driver':
        notifyUser(updatedOrder.driver_id, 'new_delivery_assigned', { message: `طھظ… ط¥ط³ظ†ط§ط¯ ط·ظ„ط¨ ط¬ط¯ظٹط¯ ط¥ظ„ظٹظƒ: ${updatedOrder.order_number}`, orderId: id });
        break;
      case 'delivered':
        // [طھظ… ط§ظ„ط¥طµظ„ط§ط­] طھظ… ظ†ظ‚ظ„ ط¥طµط¯ط§ط± ط§ظ„ظپط§طھظˆط±ط© ظ„ظٹظƒظˆظ† ط¯ط§ط®ظ„ ط§ظ„ظ€ Transaction ظپظٹ stateMachine.js
        notifyRole('admin', 'order_delivered', { message: `طھظ… طھط³ظ„ظٹظ… ط§ظ„ط·ظ„ط¨ ظˆط¥طµط¯ط§ط± ط§ظ„ظپط§طھظˆط±ط©: ${updatedOrder.order_number}` });
        notifyUser(updatedOrder.sales_rep_id, 'order_delivered', { message: `طھظ… طھط³ظ„ظٹظ… ط·ظ„ط¨ظƒ ط¨ظ†ط¬ط§ط­: ${updatedOrder.order_number}` });
        break;
      case 'failed_delivery':
      case 'return_requested':
        notifyRole('inventory_manager', 'return_action_required', { message: `ط§ظ„ط³ط§ط¦ظ‚ ظٹط·ظ„ط¨ ط¥ط¬ط±ط§ط، ظ„ط·ظ„ط¨: ${updatedOrder.order_number}` });
        break;
    }

    res.status(200).json({
      message: 'طھظ… طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ ط¨ظ†ط¬ط§ط­.',
      order: updatedOrder
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

/**
 * ط¬ظ„ط¨ ط¬ظ…ظٹط¹ ط§ظ„ط·ظ„ط¨ط§طھ ط§ظ„ط®ط§طµط© ط¨ط§ظ„ظ…ط³طھط®ط¯ظ… ط¨ط­ط³ط¨ ط¯ظˆط±ظ‡
 * [طھظ… ط§ظ„ط¥طµظ„ط§ط­]: ط¥ط¶ط§ظپط© pagination ظˆ filters ظ…ط¹ ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط§ظ„طµظ„ط§ط­ظٹط§طھ ظˆطھظ‡ظٹط¦ط© ط§ظ„ظ…ط¯ط®ظ„ط§طھ
 */
const getOrders = async (req, res) => {
  try {
    const { role, id } = req.user;
    let whereClause = {};

    // [ط¥طµظ„ط§ط­] ط¯ط¹ظ… ط§ظ„ظپظ„ط§طھط± ظ…ظ† query params ظ…ط¹ طھط¹ظ‚ظٹظ… ط§ظ„ظ‚ظٹظ… ظ„ظ„ظ€ pagination ظˆط§ظ„ظ€ limits
    const { page = 1, limit = 50, status, date_from, date_to, client_id: filterClientId, driver_id: filterDriverId } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    // ظپظ„طھط±ط© ط§ظ„ط·ظ„ط¨ط§طھ ط¨ظ†ط§ط،ظ‹ ط¹ظ„ظ‰ ط§ظ„ط¯ظˆط± ظˆط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط§ظ„طµظ„ط§ط­ظٹط§طھ ظ„ظ…ظ†ط¹ طھط³ط±ظٹط¨ ط§ظ„ط­ط§ظ„ط§طھ ط؛ظٹط± ط§ظ„ظ…طµط±ط­ ط¨ظ‡ط§
    if (role === 'sales_rep') {
      whereClause.sales_rep_id = id;
      if (status) {
        whereClause.status = status;
      }
    } else if (role === 'driver') {
      whereClause.driver_id = id;
      if (status) {
        whereClause.status = status;
      }
    } else if (role === 'inventory_manager') {
      const allowedInventoryStatuses = [
        'pending_inventory_approval', 'processing_in_warehouse', 'assigned_to_driver',
        'ready_for_pickup', 'picked_up_by_driver', 'delivered', 'failed_delivery',
        'return_requested', 'returned_to_warehouse', 'cancelled'
      ];
      if (status) {
        if (allowedInventoryStatuses.includes(status)) {
          whereClause.status = status;
          if (status === 'cancelled') {
            whereClause.sales_approved_at = { [Op.ne]: null };
          }
        } else {
          whereClause.status = 'none'; // ظ„ظ…ظ†ط¹ ظ‚ط±ط§ط،ط© ط·ظ„ط¨ط§طھ ظ„ظ… طھطµظ„ ط§ظ„ظ…ط®ط²ظ† ط¨ط¹ط¯
        }
      } else {
        whereClause[Op.or] = [
          {
            status: {
              [Op.in]: [
                'pending_inventory_approval', 'processing_in_warehouse', 'assigned_to_driver',
                'ready_for_pickup', 'picked_up_by_driver', 'delivered', 'failed_delivery',
                'return_requested', 'returned_to_warehouse'
              ]
            }
          },
          {
            status: 'cancelled',
            sales_approved_at: { [Op.ne]: null }
          }
        ];
      }
    } else {
      // admin ط£ظˆ sales_manager ظٹط±ظ‰ ظƒظ„ ط§ظ„ط·ظ„ط¨ط§طھ
      if (status) {
        whereClause.status = status;
      }
    }

    // [ط¥طµظ„ط§ط­] طھط·ط¨ظٹظ‚ ظپظ„ط§طھط± ط¥ط¶ط§ظپظٹط©
    if (filterClientId && (role === 'admin' || role === 'sales_manager')) {
      whereClause.client_id = filterClientId;
    }
    if (filterDriverId && (role === 'admin' || role === 'inventory_manager')) {
      whereClause.driver_id = filterDriverId;
    }
    if (date_from || date_to) {
      whereClause.createdAt = {};
      if (date_from) whereClause.createdAt[Op.gte] = new Date(date_from);
      if (date_to) whereClause.createdAt[Op.lte] = new Date(date_to + 'T23:59:59');
    }

    // ظ‚ظپظ„ ظ†ظ‡ط§ط¦ظٹ ظ„ظ†ط·ط§ظ‚ ط§ظ„ط³ط§ط¦ظ‚: ظ„ط§ ظٹظ…ظƒظ† ظ„ط£ظٹ ظپظ„طھط± ط£ظˆ طھط¹ط¯ظٹظ„ ظ„ط§ط­ظ‚ ط£ظ† ظٹط¹ط±ط¶ ظ„ظ‡ ط·ظ„ط¨ط§طھ ط؛ظٹط± ظ…ط³ظ†ط¯ط© ظ„ظ‡.
    if (role === 'driver') {
      whereClause.driver_id = id;
    }

    const { count, rows: orders } = await Order.findAndCountAll({
      where: whereClause,
      distinct: true,
      include: [
        { model: OrderItem, as: 'items', include: ['product'] },
        'client',
        { association: 'salesRep', attributes: ['id', 'name'] },
        'invoice',
        { association: 'documentUsage', include: [{ association: 'book', attributes: ['id', 'book_number'] }] },
        { association: 'statusLogs', include: [{ association: 'changedBy', attributes: ['id', 'username', 'name'] }] }
      ],
      order: [['createdAt', 'DESC']],
      limit: limitNum,
      offset
    });

    res.status(200).json({
      orders,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(count / limitNum)
      }
    });
  } catch (error) {
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * ط¬ظ„ط¨ طھظپط§طµظٹظ„ ط·ظ„ط¨ ظ…ط­ط¯ط¯
 * [طھظ… ط§ظ„ط¥طµظ„ط§ط­]: ط¥ط¶ط§ظپط© ظپط­طµ طµظ„ط§ط­ظٹط§طھ canAccessOrder
 */
const getOrderById = async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, {
      include: [
        { model: OrderItem, as: 'items', include: ['product'] },
        'statusLogs',
        'client',
        'invoice'
      ]
    });

    if (!order) {
      return res.status(404).json({ error: 'ط§ظ„ط·ظ„ط¨ ط؛ظٹط± ظ…ظˆط¬ظˆط¯.' });
    }

    // [ط¥طµظ„ط§ط­ ط£ظ…ظ†ظٹ] ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† طµظ„ط§ط­ظٹط© ط§ظ„ظˆطµظˆظ„
    if (!canAccessOrder(req.user, order)) {
      return res.status(403).json({ error: 'ظ„ط§ طھظ…ظ„ظƒ طµظ„ط§ط­ظٹط© ظ„ظ„ظˆطµظˆظ„ ظ„طھظپط§طµظٹظ„ ظ‡ط°ط§ ط§ظ„ط·ظ„ط¨.' });
    }

    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * طھط­ط¯ظٹط« ط¨ظٹط§ظ†ط§طھ طھط±ط­ظٹظ„ ط³ظ†ط¯ ط§ظ„طھط³ظ„ظٹظ… ط¥ظ„ظ‰ ط§ظ„ظ†ط¸ط§ظ… ط§ظ„ط±ط¦ظٹط³ظٹ ط¨ظˆط§ط³ط·ط© ط§ظ„ظ…ظ†ط¯ظˆط¨.
 */
const updateDocumentPosting = async (req, res) => {
  try {
    const { id } = req.params;
    const { document_posted_to_erp, erp_invoice_number } = req.body;

    const order = await Order.findByPk(id, {
      include: ['client', 'invoice']
    });

    if (!order) {
      return res.status(404).json({ error: 'ط§ظ„ط·ظ„ط¨ ط؛ظٹط± ظ…ظˆط¬ظˆط¯.' });
    }

    if (!canAccessOrder(req.user, order)) {
      return res.status(403).json({ error: 'ظ„ط§ طھظ…ظ„ظƒ طµظ„ط§ط­ظٹط© ظ„طھط­ط¯ظٹط« ظ‡ط°ط§ ط§ظ„ط·ظ„ط¨.' });
    }

    if (req.user.role !== 'sales_rep' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'ظ‡ط°ط§ ط§ظ„ط¥ط¬ط±ط§ط، ظ…طھط§ط­ ظ„ظ„ظ…ظ†ط¯ظˆط¨ ظپظ‚ط·.' });
    }

    if (order.status !== 'delivered') {
      return res.status(400).json({ error: 'ظٹظ…ظƒظ† طھط­ط¯ظٹط« ط¨ظٹط§ظ†ط§طھ ط§ظ„طھط±ط­ظٹظ„ ظ„ظ„ط·ظ„ط¨ط§طھ ط§ظ„ظ…ط³طھظ„ظ…ط© ظپظ‚ط·.' });
    }

    const posted = document_posted_to_erp === true || document_posted_to_erp === 1 || document_posted_to_erp === 'true' || document_posted_to_erp === '1';
    const invoiceNumber = posted ? String(erp_invoice_number || '').trim() : '';

    if (posted && !invoiceNumber) {
      return res.status(400).json({ error: 'ط±ظ‚ظ… ظپط§طھظˆط±ط© ط§ظ„ظ†ط¸ط§ظ… ط§ظ„ط±ط¦ظٹط³ظٹ ظ…ط·ظ„ظˆط¨ ط¹ظ†ط¯ طھط£ظƒظٹط¯ طھط±ط­ظٹظ„ ط§ظ„ط³ظ†ط¯.' });
    }

    if (invoiceNumber) {
      const duplicateOrder = await Order.findOne({
        where: {
          erp_invoice_number: invoiceNumber,
          id: { [Op.ne]: order.id }
        }
      });

      if (duplicateOrder) {
        return res.status(409).json({ error: 'ط±ظ‚ظ… ظپط§طھظˆط±ط© ط§ظ„ظ†ط¸ط§ظ… ط§ظ„ط±ط¦ظٹط³ظٹ ظ…ط³طھط®ط¯ظ… ط¨ط§ظ„ظپط¹ظ„ ظپظٹ ط·ظ„ط¨ ط¢ط®ط±.' });
      }
    }

    order.document_posted_to_erp = posted;
    order.erp_invoice_number = invoiceNumber || null;
    order.document_posted_at = posted ? (order.document_posted_at || new Date()) : null;
    await order.save();

    res.status(200).json({
      message: 'طھظ… طھط­ط¯ظٹط« ط¨ظٹط§ظ†ط§طھ طھط±ط­ظٹظ„ ط§ظ„ط³ظ†ط¯ ط¨ظ†ط¬ط§ط­.',
      order
    });
  } catch (error) {
    const duplicateCode = error.parent?.code || error.original?.code;
    if (error.name === 'SequelizeUniqueConstraintError' || duplicateCode === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'ط±ظ‚ظ… ظپط§طھظˆط±ط© ط§ظ„ظ†ط¸ط§ظ… ط§ظ„ط±ط¦ظٹط³ظٹ ظ…ط³طھط®ط¯ظ… ط¨ط§ظ„ظپط¹ظ„ ظپظٹ ط·ظ„ط¨ ط¢ط®ط±.' });
    }
    res.status(400).json({ error: error.message });
  }
};
module.exports = {
  createOrder,
  changeOrderStatus,
  getOrders,
  getOrderById,
  updateDocumentPosting
};

