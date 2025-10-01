const express = require('express');
const router = express.Router();
const BatchController = require('../Controllers/batch-controller');
const ItemDetailsController = require('../Controllers/item-details-controller');
const { uploadMultiple, handleUploadErrors } = require('../Middleware/upload-middleware');
const { PRODUCT_CATEGORIES, BRANDS, STRAIN_TYPES, UNIT_SIZE_MEASUREMENTS, BUYER_TYPES } = require('../config/constants');

//admin routes - for managing product details

//render admin list page
router.get('/', async (req, res, next) => {
    try {
        res.render('admin/item-details-list', {
            title: 'Manage Product Details'
        });
    } catch (error) {
        next(error);
    }
});

//render item details form page
router.get('/item/:itemName', async (req, res, next) => {
    try {
        res.render('admin/item-details-form', {
            title: 'Product Details Form',
            itemName: req.params.itemName,
            categories: PRODUCT_CATEGORIES,
            brands: BRANDS,
            strainTypes: STRAIN_TYPES,
            unitSizeMeasurements: UNIT_SIZE_MEASUREMENTS,
            buyerTypes: BUYER_TYPES
        });
    } catch (error) {
        next(error);
    }
});

//api endpoints
//get all batches with details status
router.get('/api/batches', BatchController.getBatchesWithDetailsStatus);

//get batches for specific item
router.get('/api/batches/:itemName', BatchController.getBatchesByItem);

//get default values from items table
router.get('/api/item-defaults/:itemName', ItemDetailsController.getDefaultValues);

//get product details
router.get('/api/details/:itemName', ItemDetailsController.getDetails);

//save product details (create or update)
router.post('/api/details/:itemName', ItemDetailsController.saveDetails);

//upload product images
router.post('/api/details/:itemName/images', uploadMultiple, handleUploadErrors, ItemDetailsController.uploadImages);

//update image sort order
router.put('/api/details/:itemName/images/order', ItemDetailsController.updateImageOrder);

//delete single image
router.delete('/api/images/:imageId', ItemDetailsController.deleteImage);

//delete product details
router.delete('/api/details/:itemName', ItemDetailsController.deleteDetails);

module.exports = router;