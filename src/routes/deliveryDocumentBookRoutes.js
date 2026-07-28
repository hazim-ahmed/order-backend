const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/auth');
const deliveryBookController = require('../controllers/deliveryDocumentBookController');

/**
 * مسارات إدارة دفاتر سندات التسليم (Delivery Document Book Routes)
 */

// 1. مسارات أوامر الصرف (Batches)
router.post(
  '/batches',
  authenticateToken,
  requireRole(['admin']),
  deliveryBookController.createBatch
);

router.get(
  '/batches',
  authenticateToken,
  requireRole(['admin', 'inventory_manager']),
  deliveryBookController.getBatches
);

// 2. مسارات الدفاتر السندات (Books)
router.get(
  '/books',
  authenticateToken,
  requireRole(['admin', 'inventory_manager', 'driver']),
  deliveryBookController.getBooks
);

router.get(
  '/books/driver-slips',
  authenticateToken,
  requireRole(['admin', 'inventory_manager', 'driver']),
  deliveryBookController.getDriverSlipsSummary
);

router.get(
  '/books/export/excel',
  authenticateToken,
  requireRole(['admin', 'inventory_manager']),
  deliveryBookController.exportDeliveryBooksExcel
);

router.post(
  '/books/:id/assign-driver',
  authenticateToken,
  requireRole(['admin', 'inventory_manager']),
  deliveryBookController.assignBookToDriver
);

module.exports = router;


