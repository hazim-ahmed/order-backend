// ==============================================================================
// تاريخ التعديل والإنشاء: 2026-07-22
// الوظيفة: ملف الثوابت الموحد لأحداث الـ WebSocket والتنبيهات الفورية (Socket.io Events)
// السياق: يضمن توحيد أسماء الأحداث بين الباك اند والفرونت اند وتفادي الأخطاء الإملائية
// مرجع الأمان: Phase 3.2 - WebSocket Naming Standardization & Audit
// ==============================================================================

/**
 * قائمة الأحداث الموحدة للاتصال اللحظي في نظام KMT OMS
 */
const SOCKET_EVENTS = {
  // تحديث حالة الطلب
  ORDER_STATUS_CHANGED: 'orderStatusChanged',

  // طلب جديد بانتظار الموافقة
  NEW_ORDER_PENDING: 'newOrderPending',

  // إسناد الرحلة/الطلب لسائق
  DRIVER_ASSIGNED: 'driverAssigned',

  // إشعار موجه عام
  GENERAL_NOTIFICATION: 'generalNotification',

  // بث سجلات النظام والمراقبة الحية
  SYSTEM_LOG: 'systemLog',
};

module.exports = SOCKET_EVENTS;
