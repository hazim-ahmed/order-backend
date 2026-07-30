// ==============================================================================
// تاريخ الإنشاء والتعديل: 2026-07-22
// الوظيفة: مصفوفة الصلاحيات المركزية لنظام إدارة الطلبات (KMT OMS Centralized RBAC)
// السياق: تمثل مصدر الحقيقة الوحيد للصلاحيات لحل ثغرة تشتت الفحوصات (Fix-Sec - Section 1)
// ==============================================================================

/**
 * مصفوفة تحديد الأدوار المخولة لكل إجراء في النظام
 */
const PERMISSIONS = {
  // صلاحيات إنشاء وتصفح الطلبات
  'order:create':             ['sales_rep', 'admin'],
  'order:view_own':            ['sales_rep', 'driver'],
  'order:view_all':           ['admin', 'sales_manager', 'inventory_manager'],

  // موافقات وإلغاءات المبيعات
  'order:approve_sales':      ['sales_manager', 'admin'],
  'order:reject_sales':       ['sales_manager', 'admin'],

  // عمليات وإجابات المستودع
  'order:approve_inventory':  ['inventory_manager', 'admin'],
  'order:reject_inventory':   ['inventory_manager', 'admin'],
  'order:ready_for_pickup':   ['inventory_manager', 'admin'],

  // إسناد واستلام الرحلات للسائقين
  'order:assign_driver':      ['inventory_manager', 'admin'],
  'order:pickup_driver':      ['driver', 'admin'],
  'order:confirm_delivery':   ['driver', 'inventory_manager', 'admin'],
  'order:fail_delivery':      ['driver', 'admin'],

  // إرجاع وإلغاء كلي
  'order:return_warehouse':   ['inventory_manager', 'admin'],
  'order:cancel':             ['admin'],
};

// ==============================================================================
// تاريخ التعديل: 2026-07-22
// الوظيفة: Middleware التحقق الموحد من صلاحية المستخدم (Deny-by-Default Authorization)
// السياق: يمنع الوصول لأي route إلا إذا كان دور المستخدم مدرجاً في قائمة الصلاحية المطلوبة
// ==============================================================================
function authorize(permission) {
  return (req, res, next) => {
    // 1. التحقق من وجود الصلاحية في المصدر الرئيسي
    const allowedRoles = PERMISSIONS[permission];
    if (!allowedRoles) {
      return res.status(500).json({ 
        error: `خطأ بنيوي: الصلاحية المطلوبة "${permission}" غير معرّفة في مصفوفة الصلاحيات المركزية` 
      });
    }

    // 2. التحقق من وجود المستخدم ودوره المصرح
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول أولاً' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: `غير مصرح: دورك الحالي (${req.user.role}) لا يمتلك صلاحية (${permission})` 
      });
    }

    // السماح بالمرور
    next();
  };
}

module.exports = {
  PERMISSIONS,
  authorize
};
