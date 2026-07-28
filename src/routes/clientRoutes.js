const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// القراءة: مسموح لجميع المستخدمين المصادق عليهم (المندوبون يحتاجون قائمة العملاء)
router.get('/', authenticateToken, clientController.getAll);
router.get('/:id', authenticateToken, clientController.getById);

// الكتابة: الإدارة ومندوبو المبيعات لإضافة عملاء
router.post('/', authenticateToken, requireRole(['admin', 'sales_rep', 'sales_manager']), clientController.create);
router.put('/:id', authenticateToken, requireRole(['admin', 'sales_manager']), clientController.update);
router.delete('/:id', authenticateToken, requireRole(['admin']), clientController.remove);

module.exports = router;
