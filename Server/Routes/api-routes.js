const express = require('express');
const router = express.Router();
const { PRODUCT_CATEGORIES, BRANDS, STRAIN_TYPES, UNIT_SIZE_MEASUREMENTS, BUYER_TYPES } = require('../config/constants');

//general api routes - constants and configuration

//get app constants for frontend
router.get('/constants', (req, res) => {
    res.json({
        success: true,
        data: {
            categories: PRODUCT_CATEGORIES,
            brands: BRANDS,
            strain_types: STRAIN_TYPES,
            unit_size_measurements: UNIT_SIZE_MEASUREMENTS,
            buyer_types: BUYER_TYPES
        }
    });
});

//health check endpoint
router.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;