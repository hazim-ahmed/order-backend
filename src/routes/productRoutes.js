const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// القراءة: مسموح لجميع المستخدمين المصادق عليهم
router.get('/', authenticateToken, productController.getAll);
router.get('/:id', authenticateToken, productController.getById);

// الكتابة: محصورة بالإدارة فقط
router.post('/sync-erp', authenticateToken, requireRole(['admin']), productController.syncErp);
router.post('/', authenticateToken, requireRole(['admin']), productController.create);
router.put('/:id', authenticateToken, requireRole(['admin']), productController.update);
router.delete('/clear-all', authenticateToken, requireRole(['admin']), productController.removeAll);
router.delete('/:id', authenticateToken, requireRole(['admin']), productController.remove);

module.exports = router;
