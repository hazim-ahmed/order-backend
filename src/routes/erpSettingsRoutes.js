const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/auth');
const { getERPSettings, saveERPSettings } = require('../controllers/erpSettingsController');

// إعدادات ERP تحتوي أسرارا، لذلك كل المسارات محصورة بالإدارة.
router.use(authenticateToken);
router.use(requireRole(['admin']));

router.get('/', getERPSettings);
router.put('/', saveERPSettings);

module.exports = router;