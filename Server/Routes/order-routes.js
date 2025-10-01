const express = require('express');
const router = express.Router();
const OrderController = require('../Controllers/order-controller');

//order page routes - for the e-commerce mockup

//render order page
router.get('/', async (req, res, next) => {
    try {
        res.render('order/order-page', {
            title: 'Order Products'
        });
    } catch (error) {
        next(error);
    }
});

//api endpoints
//get all products for order page
router.get('/api/products', OrderController.getOrderProducts);

//get filter options
router.get('/api/filters', OrderController.getFilters);

//get single product detail
router.get('/api/products/:itemName', OrderController.getProductDetail);

module.exports = router;