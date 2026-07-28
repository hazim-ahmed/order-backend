const express = require('express');
const rateLimit = require('express-rate-limit');
const setupController = require('../controllers/setupController');

const router = express.Router();

const setupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تم تجاوز عدد محاولات التهيئة المسموح بها. يرجى المحاولة لاحقاً.' }
});

router.get('/status', setupController.getSetupStatus);
router.post('/initialize', setupLimiter, setupController.initializeSystem);

module.exports = router;
