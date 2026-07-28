/**
 * src/controllers/reportController.js
 * متحكم تقارير الإدارة الشاملة (المطابقة، المناديب، المبيعات والمخزون)
 * تعمل كافة العمليات والحسابات على نظامنا المحلي 100% بدون أي مساس بنظام الـ ERP
 */

const { Op } = require('sequelize');
const exceljs = require('exceljs');
const { Order, OrderItem, Product, Client, User } = require('../models');

const isDev = process.env.NODE_ENV !== 'production';

/**
 * جلب بيانات التقرير الشامل والمطابقة (Comprehensive Admin Dashboard Data)
 */
const getComprehensiveReport = async (req, res) => {
  try {
    const { date_from, date_to, sales_rep_id, status } = req.query;

    // شروط فلترة الطلبات
    let whereClause = {};

    if (status) {
      whereClause.status = status;
    }

    if (sales_rep_id) {
      whereClause.sales_rep_id = sales_rep_id;
    }

    if (date_from || date_to) {
      whereClause.createdAt = {};
      if (date_from) whereClause.createdAt[Op.gte] = new Date(date_from);
      if (date_to) whereClause.createdAt[Op.lte] = new Date(date_to + 'T23:59:59');
    }

    // 1. جلب كافة الطلبات مع علاقاتها
    const orders = await Order.findAll({
      where: whereClause,
      include: [
        { model: Client, as: 'client' },
        { model: User, as: 'salesRep', attributes: ['id', 'name', 'email', 'phone'] },
        { model: User, as: 'driver', attributes: ['id', 'name'] },
        { 
          model: OrderItem, 
          as: 'items', 
          include: [{ model: Product, as: 'product' }] 
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    // 2. جلب جميع المناديب المسجلين للنظام
    const salesReps = await User.findAll({
      where: { role: 'sales_rep' },
      attributes: ['id', 'name', 'email', 'phone', 'is_active']
    });

    // 3. جلب جميع المنتجات
    const allProducts = await Product.findAll();

    // -------------------------------------------------------------
    // أ: حسابات المطابقة والشحن (Shipping Tonnage Audit & Variance)
    // -------------------------------------------------------------
    let totalRequestedTons = 0;
    let totalShippedTons = 0;
    let totalRevenue = 0;
    let discrepancyCount = 0;

    const shippingReconciliation = orders.map(order => {
      const reqTons = Number(order.total_tons) || 0;
      // إذا لم يحدد شحن خاص، تعتبر الكمية المشحونة هي الكمية المطلوبة للطلبات المسلمة
      const shipTons = order.shipped_tons !== null && order.shipped_tons !== undefined
        ? Number(order.shipped_tons) 
        : (['delivered', 'picked_up_by_driver', 'assigned_to_driver', 'ready_for_pickup'].includes(order.status) ? reqTons : 0);

      const variance = Number((shipTons - reqTons).toFixed(3));
      
      let variance_status = 'matched'; // مطابق
      if (variance > 0.001) {
        variance_status = 'over_shipped'; // زيادة شحن عن المطلوب
        discrepancyCount++;
      } else if (variance < -0.001) {
        variance_status = 'under_shipped'; // نقص شحن عن المطلوب
        discrepancyCount++;
      }

      totalRequestedTons += reqTons;
      totalShippedTons += shipTons;
      totalRevenue += Number(order.total_amount) || 0;

      return {
        id: order.id,
        order_number: order.order_number,
        client_name: order.client?.name || 'عميل غير محدد',
        sales_rep_name: order.salesRep?.name || 'غير محدد',
        driver_name: order.driver?.name || 'لم يُعين',
        status: order.status,
        requested_tons: reqTons,
        shipped_tons: shipTons,
        variance_tons: variance,
        variance_status,
        total_amount: Number(order.total_amount) || 0,
        createdAt: order.createdAt
      };
    });

    // -------------------------------------------------------------
    // ب: تقرير أداء المناديب وتفاصيل المنتجات لكل مندوب
    // -------------------------------------------------------------
    const salesRepsReportMap = {};

    // تهيئة المناديب
    salesReps.forEach(rep => {
      salesRepsReportMap[rep.id] = {
        id: rep.id,
        name: rep.name,
        email: rep.email,
        phone: rep.phone,
        totalOrders: 0,
        totalRequestedTons: 0,
        totalShippedTons: 0,
        totalAmount: 0,
        productsMap: {} // { product_name: { quantity_tons, total_amount, orders_count } }
      };
    });

    // تجميع الطلبات حسب المناديب
    orders.forEach(order => {
      const repId = order.sales_rep_id;
      if (!repId) return;

      if (!salesRepsReportMap[repId]) {
        salesRepsReportMap[repId] = {
          id: repId,
          name: order.salesRep?.name || `مندوب #${repId}`,
          email: order.salesRep?.email || '',
          phone: order.salesRep?.phone || '',
          totalOrders: 0,
          totalRequestedTons: 0,
          totalShippedTons: 0,
          totalAmount: 0,
          productsMap: {}
        };
      }

      const repData = salesRepsReportMap[repId];
      const reqTons = Number(order.total_tons) || 0;
      const shipTons = order.shipped_tons !== null && order.shipped_tons !== undefined
        ? Number(order.shipped_tons) 
        : (['delivered', 'picked_up_by_driver'].includes(order.status) ? reqTons : 0);

      repData.totalOrders += 1;
      repData.totalRequestedTons += reqTons;
      repData.totalShippedTons += shipTons;
      repData.totalAmount += Number(order.total_amount) || 0;

      // تفكيك أصناف الطلب للمندوب
      if (order.items && Array.isArray(order.items)) {
        order.items.forEach(item => {
          const prodName = item.product?.name || item.product_name || `منتج #${item.product_id}`;
          const qty = Number(item.quantity_tons) || 0;
          const price = Number(item.price_per_ton_snapshot) || Number(item.product?.current_price_per_ton) || 0;
          const itemAmount = qty * price;

          if (!repData.productsMap[prodName]) {
            repData.productsMap[prodName] = {
              product_name: prodName,
              quantity_tons: 0,
              total_amount: 0,
              orders_count: 0
            };
          }

          repData.productsMap[prodName].quantity_tons += qty;
          repData.productsMap[prodName].total_amount += itemAmount;
          repData.productsMap[prodName].orders_count += 1;
        });
      }
    });

    // تحويل خريطة المناديب لمصفوفة جاهزة للواجهة
    const salesRepsReport = Object.values(salesRepsReportMap).map(rep => ({
      ...rep,
      totalRequestedTons: Number(rep.totalRequestedTons.toFixed(3)),
      totalShippedTons: Number(rep.totalShippedTons.toFixed(3)),
      totalAmount: Number(rep.totalAmount.toFixed(2)),
      productsList: Object.values(rep.productsMap).map(p => ({
        ...p,
        quantity_tons: Number(p.quantity_tons.toFixed(3)),
        total_amount: Number(p.total_amount.toFixed(2))
      }))
    }));

    // -------------------------------------------------------------
    // جـ: ملخص المنتجات والتطابق المخزني
    // -------------------------------------------------------------
    const productsReportMap = {};

    allProducts.forEach(p => {
      productsReportMap[p.id] = {
        id: p.id,
        name: p.name,
        stock_quantity: Number(p.stock_quantity) || 0,
        current_price_per_ton: Number(p.current_price_per_ton) || 0,
        totalOrderedTons: 0,
        totalDeliveredTons: 0,
        totalRevenue: 0,
        ordersCount: 0
      };
    });

    orders.forEach(order => {
      if (order.items && Array.isArray(order.items)) {
        order.items.forEach(item => {
          const pId = item.product_id;
          if (pId && productsReportMap[pId]) {
            const qty = Number(item.quantity_tons) || 0;
            const price = Number(item.price_per_ton_snapshot) || Number(productsReportMap[pId].current_price_per_ton) || 0;
            
            productsReportMap[pId].totalOrderedTons += qty;
            productsReportMap[pId].totalRevenue += qty * price;
            productsReportMap[pId].ordersCount += 1;

            if (order.status === 'delivered') {
              productsReportMap[pId].totalDeliveredTons += qty;
            }
          }
        });
      }
    });

    const productsSummaryReport = Object.values(productsReportMap).map(p => ({
      ...p,
      totalOrderedTons: Number(p.totalOrderedTons.toFixed(3)),
      totalDeliveredTons: Number(p.totalDeliveredTons.toFixed(3)),
      totalRevenue: Number(p.totalRevenue.toFixed(2))
    }));

    // الرد النهائي
    res.status(200).json({
      summary: {
        totalOrdersCount: orders.length,
        totalRequestedTons: Number(totalRequestedTons.toFixed(3)),
        totalShippedTons: Number(totalShippedTons.toFixed(3)),
        varianceTons: Number((totalShippedTons - totalRequestedTons).toFixed(3)),
        totalRevenue: Number(totalRevenue.toFixed(2)),
        discrepancyCount
      },
      shippingReconciliation,
      salesRepsReport,
      productsSummaryReport
    });

  } catch (error) {
    console.error('❌ Error in getComprehensiveReport:', error);
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ أثناء إعداد التقرير الشامل.' });
  }
};

/**
 * تحديث كمية الشحن الفعلية لطلب معين لتسجيل موازين القبانات المطابقة
 */
const updateShippedTons = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { shipped_tons } = req.body;

    const shipVal = Number(shipped_tons);
    if (!Number.isFinite(shipVal) || shipVal < 0) {
      return res.status(400).json({ error: 'الكمية المشحونة يجب أن تكون رقماً موجباً أو صفر.' });
    }

    const order = await Order.findByPk(orderId);
    if (!order) {
      return res.status(404).json({ error: 'الطلب غير موجود.' });
    }

    order.shipped_tons = shipVal;
    await order.save();

    res.status(200).json({
      message: `تم تحديث كمية الشحن الفعلية للطلب ${order.order_number} بنجاح (${shipVal} طن).`,
      order
    });
  } catch (error) {
    console.error('❌ Error in updateShippedTons:', error);
    res.status(500).json({ error: isDev ? error.message : 'فشل تحديث كمية الشحن.' });
  }
};

/**
 * تصدير التقرير الشامل بـ 3 أوراق عمل في ملف Excel واحد
 */
const exportExcelReport = async (req, res) => {
  try {
    const orders = await Order.findAll({
      include: [
        { model: Client, as: 'client' },
        { model: User, as: 'salesRep' },
        { model: User, as: 'driver' },
        { model: OrderItem, as: 'items', include: [{ model: Product, as: 'product' }] }
      ],
      order: [['createdAt', 'DESC']]
    });

    const salesReps = await User.findAll({ where: { role: 'sales_rep' } });
    const allProducts = await Product.findAll();

    const workbook = new exceljs.Workbook();

    // ---------------------------------------------------------
    // ورقة 1: مطابقة كميات الشحن
    // ---------------------------------------------------------
    const sheet1 = workbook.addWorksheet('مطابقة كميات الشحن');
    sheet1.columns = [
      { header: 'رقم الطلب', key: 'order_number', width: 22 },
      { header: 'العميل', key: 'client_name', width: 25 },
      { header: 'المندوب', key: 'sales_rep', width: 22 },
      { header: 'السائق', key: 'driver', width: 22 },
      { header: 'الكمية المطلوبة (طن)', key: 'requested_tons', width: 20 },
      { header: 'الكمية المشحونة (طن)', key: 'shipped_tons', width: 20 },
      { header: 'الفارق (طن)', key: 'variance_tons', width: 15 },
      { header: 'حالة المطابقة', key: 'variance_status', width: 18 },
      { header: 'الإجمالي (ريال)', key: 'total_amount', width: 18 },
      { header: 'حالة الطلب', key: 'status', width: 22 },
      { header: 'تاريخ الطلب', key: 'created_at', width: 22 }
    ];
    sheet1.getRow(1).font = { bold: true, size: 11 };

    orders.forEach(o => {
      const reqTons = Number(o.total_tons) || 0;
      const shipTons = o.shipped_tons !== null && o.shipped_tons !== undefined 
        ? Number(o.shipped_tons) 
        : (['delivered', 'picked_up_by_driver'].includes(o.status) ? reqTons : 0);
      const varTons = Number((shipTons - reqTons).toFixed(3));
      
      let varStatusText = 'مطابق';
      if (varTons > 0.001) varStatusText = 'زيادة شحن (+)';
      else if (varTons < -0.001) varStatusText = 'نقص شحن (-)';

      sheet1.addRow({
        order_number: o.order_number,
        client_name: o.client?.name || 'غير محدد',
        sales_rep: o.salesRep?.name || 'غير محدد',
        driver: o.driver?.name || 'لم يُعين',
        requested_tons: reqTons,
        shipped_tons: shipTons,
        variance_tons: varTons,
        variance_status: varStatusText,
        total_amount: Number(o.total_amount) || 0,
        status: o.status,
        created_at: new Date(o.createdAt).toLocaleString('ar-SA')
      });
    });

    // ---------------------------------------------------------
    // ورقة 2: أداء المناديب والأصناف
    // ---------------------------------------------------------
    const sheet2 = workbook.addWorksheet('أداء المناديب والمنتجات');
    sheet2.columns = [
      { header: 'اسم المندوب', key: 'name', width: 25 },
      { header: 'البريد الإلكتروني', key: 'email', width: 25 },
      { header: 'عدد الطلبات', key: 'orders', width: 15 },
      { header: 'إجمالي الطن المطلوب', key: 'req_tons', width: 20 },
      { header: 'إجمالي الطن المشحون', key: 'ship_tons', width: 20 },
      { header: 'مجموع المبيعات (ريال)', key: 'amount', width: 22 },
      { header: 'الأصناف المطلوبة', key: 'products', width: 45 }
    ];
    sheet2.getRow(1).font = { bold: true, size: 11 };

    salesReps.forEach(rep => {
      const repOrders = orders.filter(o => o.sales_rep_id === rep.id);
      let rReqTons = 0;
      let rShipTons = 0;
      let rAmount = 0;
      const pSummary = {};

      repOrders.forEach(o => {
        const reqT = Number(o.total_tons) || 0;
        const shipT = o.shipped_tons !== null ? Number(o.shipped_tons) : (o.status === 'delivered' ? reqT : 0);
        rReqTons += reqT;
        rShipTons += shipT;
        rAmount += Number(o.total_amount) || 0;

        if (o.items) {
          o.items.forEach(it => {
            const pName = it.product?.name || `منتج #${it.product_id}`;
            const q = Number(it.quantity_tons) || 0;
            pSummary[pName] = (pSummary[pName] || 0) + q;
          });
        }
      });

      const prodText = Object.entries(pSummary)
        .map(([pName, q]) => `${pName} (${q} طن)`)
        .join(' | ');

      sheet2.addRow({
        name: rep.name,
        email: rep.email || '-',
        orders: repOrders.length,
        req_tons: Number(rReqTons.toFixed(3)),
        ship_tons: Number(rShipTons.toFixed(3)),
        amount: Number(rAmount.toFixed(2)),
        products: prodText || 'لا توجد طلبات'
      });
    });

    // ---------------------------------------------------------
    // ورقة 3: حركة المنتجات والمخزون
    // ---------------------------------------------------------
    const sheet3 = workbook.addWorksheet('حركة المنتجات والمخزون');
    sheet3.columns = [
      { header: 'اسم المنتج', key: 'name', width: 30 },
      { header: 'سعر الطن (ريال)', key: 'price', width: 18 },
      { header: 'المخزون الحالي (طن)', key: 'stock', width: 20 },
      { header: 'إجمالي الطن المطلوب', key: 'ordered', width: 20 },
      { header: 'إجمالي الطن المسلم', key: 'delivered', width: 20 },
      { header: 'إجمالي الإيراد (ريال)', key: 'revenue', width: 22 }
    ];
    sheet3.getRow(1).font = { bold: true, size: 11 };

    allProducts.forEach(p => {
      let ordTons = 0;
      let delTons = 0;
      let rev = 0;

      orders.forEach(o => {
        if (o.items) {
          o.items.forEach(it => {
            if (it.product_id === p.id) {
              const q = Number(it.quantity_tons) || 0;
              const price = Number(it.price_per_ton_snapshot) || Number(p.current_price_per_ton) || 0;
              ordTons += q;
              rev += q * price;
              if (o.status === 'delivered') delTons += q;
            }
          });
        }
      });

      sheet3.addRow({
        name: p.name,
        price: Number(p.current_price_per_ton) || 0,
        stock: Number(p.stock_quantity) || 0,
        ordered: Number(ordTons.toFixed(3)),
        delivered: Number(delTons.toFixed(3)),
        revenue: Number(rev.toFixed(2))
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Comprehensive_OMS_Report_${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('❌ Error in exportExcelReport:', error);
    res.status(500).json({ error: 'فشل تصدير التقرير الشامل.' });
  }
};

const { getLogs, clearLogs } = require('../services/loggerService');

// ==============================================================================
// تاريخ التعديل: 2026-07-22
// الوظيفة: جلب سجلات ومؤشرات صحة النظام والمراقبة الحية (System Health & Logs Monitoring)
// السياق: تزويد لوحة تحكم الإدارة برؤية فورية لأداء السيرفر، الميموري، واستجابة الطلبات
// ==============================================================================
const getSystemLogs = async (req, res) => {
  try {
    const { level, category, search, limit } = req.query;
    const data = getLogs({ level, category, search, limit });
    res.status(200).json(data);
  } catch (error) {
    console.error('❌ Error fetching system logs:', error);
    res.status(500).json({ error: 'فشل في جلب سجلات النظام.' });
  }
};

// ==============================================================================
// تاريخ التعديل: 2026-07-22
// الوظيفة: تفريغ سجلات الذاكرة من قبل مدير النظام
// ==============================================================================
const clearSystemLogs = async (req, res) => {
  try {
    const result = clearLogs();
    res.status(200).json(result);
  } catch (error) {
    console.error('❌ Error clearing system logs:', error);
    res.status(500).json({ error: 'فشل في تفريغ السجلات.' });
  }
};

module.exports = {
  getComprehensiveReport,
  updateShippedTons,
  exportExcelReport,
  getSystemLogs,
  clearSystemLogs
};
