/**
 * src/jobs/driverTimeoutMonitor.js
 * مهمة مجدولة (Cron Job) تراقب السائقين الذين تجاوزوا المهلة المحددة
 * 
 * [تم الإصلاح]:
 *  - منع تكرار الإشعارات باستخدام حقل timeout_notified_at
 *  - تسجيل الحدث في OrderStatusLog
 */

const cron = require('node-cron');
const { Op } = require('sequelize');
const { Order, OrderStatusLog } = require('../models');
const { notifyRole } = require('../services/notificationService');

/**
 * دالة بدء المراقبة
 * تعمل كل 5 دقائق
 */
const startDriverTimeoutMonitor = () => {
  cron.schedule('*/5 * * * *', async () => {
    console.log('⏳ تشغيل مهمة فحص مهلة السائقين (Timeout Monitor)...');

    try {
      const now = new Date();

      // [إصلاح] البحث فقط عن الطلبات التي لم يتم إشعارها من قبل
      const overdueOrders = await Order.findAll({
        where: {
          status: 'picked_up_by_driver',
          timeout_deadline: {
            [Op.lt]: now
          },
          timeout_notified_at: {
            [Op.is]: null  // فقط الطلبات التي لم يرسل لها إشعار
          }
        }
      });

      if (overdueOrders.length > 0) {
        console.log(`⚠️ تم العثور على ${overdueOrders.length} طلبات تجاوزت المهلة المحددة.`);

        for (const order of overdueOrders) {
          // إرسال إشعار فوري للمحاسبين
          notifyRole('admin', 'driver_timeout', {
            message: `السائق تجاوز المهلة للطلب رقم ${order.order_number}`,
            order_id: order.id,
            driver_id: order.driver_id
          });

          // [إصلاح] تسجيل الحدث في audit log
          await OrderStatusLog.create({
            order_id: order.id,
            from_status: 'picked_up_by_driver',
            to_status: 'picked_up_by_driver', // لم تتغير الحالة
            changed_by: null, // النظام هو من سجل الحدث
            note: `تنبيه: السائق تجاوز المهلة المحددة (${order.timeout_deadline})`
          });

          // [إصلاح] تحديث علامة الإشعار لمنع التكرار
          order.timeout_notified_at = now;
          await order.save();
        }
      }

    } catch (error) {
      console.error('❌ خطأ أثناء فحص مهلة السائقين:', error);
    }
  });
};

module.exports = {
  startDriverTimeoutMonitor
};
