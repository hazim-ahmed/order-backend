const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/auth');
const {
  createSalesReturn,
  getSalesReturns,
  getSalesReturnById,
  approveSalesReturn,
  assignDriverForReturn,
  confirmDriverDelivery,
  inspectSalesReturn,
  issueCreditNote
} = require('../controllers/salesReturnController');

router.use(authenticateToken);

router.post('/', requireRole(['sales_rep', 'sales_manager', 'admin']), createSalesReturn);
router.get('/', getSalesReturns);
router.get('/:id', getSalesReturnById);
router.patch('/:id/approve', requireRole(['sales_manager', 'admin']), approveSalesReturn);
router.post('/:id/assign-driver', requireRole(['sales_manager', 'inventory_manager', 'admin']), assignDriverForReturn);
router.post('/:id/confirm-delivery', requireRole(['driver']), confirmDriverDelivery);
router.post('/:id/inspect', requireRole(['inventory_manager', 'admin']), inspectSalesReturn);
router.post('/:id/issue-credit-note', requireRole(['admin']), issueCreditNote);

module.exports = router;