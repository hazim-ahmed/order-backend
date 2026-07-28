const express = require('express');
const router = express.Router();
const { getClients, getProducts, getDrivers } = require('../controllers/coreController');
const { authenticateToken } = require('../middlewares/auth');

router.get('/clients', authenticateToken, getClients);
router.get('/products', authenticateToken, getProducts);
router.get('/drivers', authenticateToken, getDrivers);

module.exports = router;
