const express = require('express');
const { adminLimiter } = require('../middleware/rateLimiter');
const { showBookings } = require('../controllers/bookingsPage.controller');

const router = express.Router();

router.get('/', adminLimiter, showBookings);

module.exports = router;
