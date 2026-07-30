const { sequelize } = require('../models');

// قائمة ترقيات schema المنقولة من تشغيل السيرفر إلى سكربت migration مستقل.
const schemaStatements = [
  { name: 'erp_settings.create_table', sql: "CREATE TABLE IF NOT EXISTS erp_settings (id INT AUTO_INCREMENT PRIMARY KEY, base_url VARCHAR(255) NOT NULL, login_company VARCHAR(255) NOT NULL, username VARCHAR(255) NOT NULL, password_encrypted TEXT NOT NULL, password_iv VARCHAR(255) NOT NULL, password_auth_tag VARCHAR(255) NOT NULL, app_type VARCHAR(255) NOT NULL DEFAULT 'desktop', app_version VARCHAR(255) NOT NULL DEFAULT '1.0.0', allowed_hosts TEXT NULL, is_active TINYINT(1) NOT NULL DEFAULT 1, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;", ignoreCodes: [] },
  { name: 'orders.shipped_tons', sql: "ALTER TABLE orders ADD COLUMN shipped_tons DECIMAL(12,3) NULL DEFAULT NULL AFTER total_tons;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'orders.delivery_reference_number', sql: "ALTER TABLE orders ADD COLUMN delivery_reference_number VARCHAR(255) NULL DEFAULT NULL AFTER delivery_image_url;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'orders.delivery_type', sql: "ALTER TABLE orders ADD COLUMN delivery_type ENUM('delivery', 'customer_pickup') NOT NULL DEFAULT 'delivery';", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'orders.pickup_driver_name', sql: "ALTER TABLE orders ADD COLUMN pickup_driver_name VARCHAR(255) NULL DEFAULT NULL;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'orders.pickup_vehicle_plate', sql: "ALTER TABLE orders ADD COLUMN pickup_vehicle_plate VARCHAR(255) NULL DEFAULT NULL;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'orders.pickup_receiver_id', sql: "ALTER TABLE orders ADD COLUMN pickup_receiver_id VARCHAR(255) NULL DEFAULT NULL;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'order_items.unit', sql: "ALTER TABLE order_items ADD COLUMN unit VARCHAR(50) NOT NULL DEFAULT 'kg';", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'order_items.entered_quantity', sql: "ALTER TABLE order_items ADD COLUMN entered_quantity DECIMAL(12,3) NULL DEFAULT NULL;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'orders.freight_rate', sql: "ALTER TABLE orders ADD COLUMN freight_rate DECIMAL(12,3) NOT NULL DEFAULT 0;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'orders.freight_unit', sql: "ALTER TABLE orders ADD COLUMN freight_unit VARCHAR(50) NOT NULL DEFAULT 'kg';", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'orders.freight_amount', sql: "ALTER TABLE orders ADD COLUMN freight_amount DECIMAL(15,3) NOT NULL DEFAULT 0;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'sales_return_items.verified_missing_tons', sql: "ALTER TABLE sales_return_items ADD COLUMN verified_missing_tons DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER verified_damaged_tons;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'sales_returns.verified_missing_tons', sql: "ALTER TABLE sales_returns ADD COLUMN verified_missing_tons DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER verified_damaged_tons;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'sales_returns.status_enum', sql: "ALTER TABLE sales_returns MODIFY COLUMN status ENUM('return_requested','sales_approved','finance_approved','in_transit','driver_delivered','inspected','returned_to_warehouse','credit_note_issued','rejected') NOT NULL DEFAULT 'return_requested';", ignoreCodes: [] },
  { name: 'sales_returns.refund_mode', sql: "ALTER TABLE sales_returns ADD COLUMN refund_mode ENUM('good_only','good_and_damaged','all') NULL DEFAULT NULL AFTER rejection_reason;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'sales_returns.original_order_status', sql: "ALTER TABLE sales_returns ADD COLUMN original_order_status VARCHAR(255) NULL DEFAULT NULL AFTER refund_mode;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'sales_returns.driver_delivered_at', sql: "ALTER TABLE sales_returns ADD COLUMN driver_delivered_at DATETIME NULL DEFAULT NULL AFTER finance_approved_at;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'sales_returns.return_inventory_restored_at', sql: "ALTER TABLE sales_returns ADD COLUMN return_inventory_restored_at DATETIME NULL DEFAULT NULL AFTER returned_at;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'orders.document_posted_to_erp', sql: "ALTER TABLE orders ADD COLUMN document_posted_to_erp TINYINT(1) NOT NULL DEFAULT 0 AFTER delivery_reference_number;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'orders.erp_invoice_number', sql: "ALTER TABLE orders ADD COLUMN erp_invoice_number VARCHAR(255) NULL DEFAULT NULL AFTER document_posted_to_erp;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'orders.document_posted_at', sql: "ALTER TABLE orders ADD COLUMN document_posted_at DATETIME NULL DEFAULT NULL AFTER erp_invoice_number;", ignoreCodes: ['ER_DUP_FIELDNAME'] },
  { name: 'orders.idx_orders_erp_invoice_number_unique', sql: "ALTER TABLE orders ADD UNIQUE INDEX idx_orders_erp_invoice_number_unique (erp_invoice_number);", ignoreCodes: ['ER_DUP_KEYNAME'] }
];

// يستخرج كود خطأ MySQL من طبقات Sequelize المختلفة.
const getMysqlErrorCode = (error) => {
  return error?.parent?.code || error?.original?.code || error?.code || null;
};

// يقرر هل الفشل متوقع بسبب تطبيق migration سابقا أم يجب إيقاف التنفيذ.
const isIgnorableMigrationError = (error, ignoreCodes = []) => {
  const code = getMysqlErrorCode(error);
  return code && ignoreCodes.includes(code);
};

// يشغل كل تحديثات schema بالتتابع مع تسجيل واضح وعدم إخفاء الأخطاء غير المتوقعة.
const runAllMigrations = async ({ logger = console } = {}) => {
  for (const statement of schemaStatements) {
    try {
      await sequelize.query(statement.sql);
      logger.log(`Migration applied: ${statement.name}`);
    } catch (error) {
      if (isIgnorableMigrationError(error, statement.ignoreCodes)) {
        logger.log(`Migration skipped: ${statement.name} already exists`);
        continue;
      }
      logger.error(`Migration failed: ${statement.name}`);
      throw error;
    }
  }
};

module.exports = {
  schemaStatements,
  runAllMigrations
};