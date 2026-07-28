const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// جميع مسارات المستخدمين محمية
router.use(authenticateToken);

// السماح للمدير العام وأمين المخزن بقراءة المستخدمين (أمين المخزن يحتاج رؤية السائقين)
router.get('/', requireRole(['admin', 'inventory_manager']), userController.getAll);
router.get('/:id', requireRole(['admin']), userController.getById);

// السماح فقط للمدير بإنشاء وتعديل وحذف المستخدمين
router.use(requireRole(['admin']));
router.post('/', userController.create);
router.put('/:id', userController.update);
router.delete('/:id', userController.remove);

module.exports = router;
