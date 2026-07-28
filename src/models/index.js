const sequelize = require('../config/database');

// استيراد كافة النماذج
const User = require('./User');
const Client = require('./Client');
const Product = require('./Product');
const Order = require('./Order');
const OrderItem = require('./OrderItem');
const Invoice = require('./Invoice');
const OrderStatusLog = require('./OrderStatusLog');
const DriverLocation = require('./DriverLocation');
const Category = require('./Category');
const SalesReturn = require('./SalesReturn');
const SalesReturnItem = require('./SalesReturnItem');
const CreditNote = require('./CreditNote');
const DeliveryDocument = require('./DeliveryDocument');
const DeliveryDocumentBatch = require('./DeliveryDocumentBatch');
const DeliveryDocumentBook = require('./DeliveryDocumentBook');
const DeliveryDocumentUsage = require('./DeliveryDocumentUsage');
const SystemSetting = require('./SystemSetting');

/**
 * بناء العلاقات (Associations) بين الجداول في قاعدة البيانات
 */

// --- علاقات دفاتر سندات التسليم ---
User.hasMany(DeliveryDocumentBatch, { foreignKey: 'inventory_manager_id', as: 'receivedBatches' });
User.hasMany(DeliveryDocumentBatch, { foreignKey: 'created_by', as: 'createdBatches' });
DeliveryDocumentBatch.belongsTo(User, { foreignKey: 'inventory_manager_id', as: 'inventoryManager' });
DeliveryDocumentBatch.belongsTo(User, { foreignKey: 'created_by', as: 'createdBy' });

DeliveryDocumentBatch.hasMany(DeliveryDocumentBook, { foreignKey: 'batch_id', as: 'books', onDelete: 'CASCADE' });
DeliveryDocumentBook.belongsTo(DeliveryDocumentBatch, { foreignKey: 'batch_id', as: 'batch' });

User.hasMany(DeliveryDocumentBook, { foreignKey: 'inventory_manager_id', as: 'managedBooks' });
DeliveryDocumentBook.belongsTo(User, { foreignKey: 'inventory_manager_id', as: 'inventoryManager' });

User.hasMany(DeliveryDocumentBook, { foreignKey: 'driver_id', as: 'assignedBooks' });
DeliveryDocumentBook.belongsTo(User, { foreignKey: 'driver_id', as: 'driver' });
DeliveryDocumentBook.belongsTo(User, { foreignKey: 'assigned_by', as: 'assignedBy' });

DeliveryDocumentBook.hasMany(DeliveryDocumentUsage, { foreignKey: 'book_id', as: 'usages' });
DeliveryDocumentUsage.belongsTo(DeliveryDocumentBook, { foreignKey: 'book_id', as: 'book' });

Order.hasMany(DeliveryDocumentUsage, { foreignKey: 'order_id', as: 'documentUsages' });
Order.hasOne(DeliveryDocumentUsage, { foreignKey: 'order_id', as: 'documentUsage' });
DeliveryDocumentUsage.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });

User.hasMany(DeliveryDocumentUsage, { foreignKey: 'driver_id', as: 'usedDocumentSlips' });
DeliveryDocumentUsage.belongsTo(User, { foreignKey: 'driver_id', as: 'driver' });

// --- علاقات مستندات إثبات التسليم ---
Order.hasMany(DeliveryDocument, { foreignKey: 'order_id', as: 'documents' });
DeliveryDocument.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });

User.hasMany(DeliveryDocument, { foreignKey: 'uploaded_by', as: 'uploadedDocuments' });
DeliveryDocument.belongsTo(User, { foreignKey: 'uploaded_by', as: 'uploader' });

// --- علاقات الطلب الأساسية ---
Client.hasMany(Order, { foreignKey: 'client_id' });
Order.belongsTo(Client, { foreignKey: 'client_id', as: 'client' });

User.hasMany(Order, { foreignKey: 'sales_rep_id' });
Order.belongsTo(User, { foreignKey: 'sales_rep_id', as: 'salesRep' });

Order.belongsTo(User, { foreignKey: 'sales_manager_id', as: 'salesManager' });
Order.belongsTo(User, { foreignKey: 'inventory_manager_id', as: 'inventoryManager' });
Order.belongsTo(User, { foreignKey: 'driver_id', as: 'driver' });

// --- علاقات الأقسام بالمواضوعات/المنتجات ---
Category.hasMany(Product, { foreignKey: 'category_id', as: 'products' });
Product.belongsTo(Category, { foreignKey: 'category_id', as: 'category' });

// --- علاقات الأصناف داخل الطلب ---
Order.hasMany(OrderItem, { foreignKey: 'order_id', as: 'items', onDelete: 'CASCADE' });
OrderItem.belongsTo(Order, { foreignKey: 'order_id' });

Product.hasMany(OrderItem, { foreignKey: 'product_id' });
OrderItem.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// --- علاقات الفواتير ---
Order.hasOne(Invoice, { foreignKey: 'order_id', as: 'invoice' });
Invoice.belongsTo(Order, { foreignKey: 'order_id' });

// --- علاقات مرتجعات المبيعات ---
Order.hasMany(SalesReturn, { foreignKey: 'order_id', as: 'returns' });
SalesReturn.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });

Client.hasMany(SalesReturn, { foreignKey: 'client_id' });
SalesReturn.belongsTo(Client, { foreignKey: 'client_id', as: 'client' });

User.hasMany(SalesReturn, { foreignKey: 'created_by' });
SalesReturn.belongsTo(User, { foreignKey: 'created_by', as: 'createdBy' });

SalesReturn.belongsTo(User, { foreignKey: 'driver_id', as: 'driver' });

SalesReturn.hasMany(SalesReturnItem, { foreignKey: 'sales_return_id', as: 'items', onDelete: 'CASCADE' });
SalesReturnItem.belongsTo(SalesReturn, { foreignKey: 'sales_return_id' });

Product.hasMany(SalesReturnItem, { foreignKey: 'product_id' });
SalesReturnItem.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

SalesReturn.hasOne(CreditNote, { foreignKey: 'sales_return_id', as: 'creditNote' });
CreditNote.belongsTo(SalesReturn, { foreignKey: 'sales_return_id', as: 'salesReturn' });

Client.hasMany(CreditNote, { foreignKey: 'client_id' });
CreditNote.belongsTo(Client, { foreignKey: 'client_id', as: 'client' });

// --- علاقات سجلات الحالات للتدقيق ---
Order.hasMany(OrderStatusLog, { foreignKey: 'order_id', as: 'statusLogs', onDelete: 'CASCADE' });
OrderStatusLog.belongsTo(Order, { foreignKey: 'order_id' });

User.hasMany(OrderStatusLog, { foreignKey: 'changed_by' });
OrderStatusLog.belongsTo(User, { foreignKey: 'changed_by', as: 'changedBy' });

// --- علاقات تتبع السائق ---
User.hasMany(DriverLocation, { foreignKey: 'driver_id' });
DriverLocation.belongsTo(User, { foreignKey: 'driver_id', as: 'trackedDriver' });

Order.hasMany(DriverLocation, { foreignKey: 'order_id' });
DriverLocation.belongsTo(Order, { foreignKey: 'order_id' });

module.exports = {
  sequelize,
  User,
  Client,
  Product,
  Order,
  OrderItem,
  Invoice,
  OrderStatusLog,
  DriverLocation,
  Category,
  SalesReturn,
  SalesReturnItem,
  CreditNote,
  DeliveryDocument,
  DeliveryDocumentBatch,
  DeliveryDocumentBook,
  DeliveryDocumentUsage,
  SystemSetting
};
