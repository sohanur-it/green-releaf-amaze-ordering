const express = require('express');
const router = express.Router();
const BatchController = require('../Controllers/batch-controller');
const ItemDetailsController = require('../Controllers/item-details-controller');
const AdminTableController = require('../Controllers/admin-table-controller');
const BatchManagementController = require('../Controllers/batch-management-controller');
const { uploadMultiple, handleUploadErrors } = require('../Middleware/upload-middleware');
const { PRODUCT_CATEGORIES, BRANDS, STRAIN_TYPES, UNIT_SIZE_MEASUREMENTS, BUYER_TYPES } = require('../config/constants');

//admin routes - for managing product details and batch workflow

//==============================================
// MAIN VIEWS
//==============================================

//render admin dashboard (main landing page)
router.get('/', async (req, res, next) => {
    try {
        res.render('admin/dashboard', {
            title: 'Admin Dashboard'
        });
    } catch (error) {
        next(error);
    }
});

//render product setup page (product management table)
router.get('/product-setup', async (req, res, next) => {
    try {
        res.render('admin/admin-table', {
            title: 'Product Setup'
        });
    } catch (error) {
        next(error);
    }
});

//render batch management page (batch workflow + view all batches)
router.get('/batch-management', async (req, res, next) => {
    try {
        res.render('admin/batch-management', {
            title: 'Batch Management'
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

//==============================================
// DASHBOARD API
//==============================================

//get dashboard statistics
router.get('/api/dashboard-stats', BatchManagementController.getDashboardStats);

//==============================================
// BATCH WORKFLOW API
//==============================================

//get next product for batch workflow
router.get('/api/batch-workflow/next', BatchManagementController.getNextProductForBatchWorkflow);

//get batches for specific product (workflow)
router.get('/api/batch-workflow/product/:itemName', BatchManagementController.getBatchesForProduct);

//submit batch decisions (Complete button)
router.post('/api/batch-workflow/submit', BatchManagementController.submitBatchDecisions);

//check for new batches (polling)
router.get('/api/batch-workflow/check-new', BatchManagementController.checkForNewBatches);

//==============================================
// BATCH MANAGEMENT API (View All Batches)
//==============================================

//get all marked batches with details
router.get('/api/batch-management/marked', BatchManagementController.getAllMarkedBatches);

//update batch status inline
router.put('/api/batch-management/batch/:batchName', BatchManagementController.updateBatchStatus);

//==============================================
// PRODUCT SETUP API
//==============================================

//get table data with completion tracking (product setup table)
router.get('/api/table-data', AdminTableController.getTableData);

//inline edit a single field
router.put('/api/inline-edit/:itemName', AdminTableController.inlineEdit);

//auto-save before photo upload
router.post('/api/auto-save', AdminTableController.autoSave);

//get batch details for expandable rows
router.get('/api/batch-details/:itemName', AdminTableController.getBatchDetails);

//get all batches with details status (legacy - still used by old form)
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