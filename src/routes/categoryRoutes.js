const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// القراءة: مسموح لجميع المستخدمين المصادق عليهم
router.get('/', authenticateToken, categoryController.getAll);
router.get('/:id', authenticateToken, categoryController.getById);

// الكتابة: محصورة بالإدارة فقط
router.post('/', authenticateToken, requireRole(['admin']), categoryController.create);
router.put('/:id', authenticateToken, requireRole(['admin']), categoryController.update);
router.delete('/:id', authenticateToken, requireRole(['admin']), categoryController.remove);

module.exports = router;
