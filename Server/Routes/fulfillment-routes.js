// Server/Routes/fulfillment-routes.js
// Module 5: Fulfillment & Manifesting Routes

const express = require('express');
const router = express.Router();
const fulfillmentController = require('../Controllers/fulfillmentController');
const { requireAuth, requireRole } = require('../Middleware/auth');

// =====================================================
// Fulfillment Queue Routes
// =====================================================

/**
 * GET /api/v1/fulfillment/queue
 * Get fulfillment queue with filters and pagination
 */
router.get('/queue', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin', 'sales_admin', 'admin'), 
    fulfillmentController.getQueue.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/queue/claim
 * Claim an order for fulfillment
 */
router.post('/queue/claim', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.claimOrder.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/queue/release
 * Release order back to queue
 */
router.post('/queue/release', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.releaseOrder.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/admin/reassign
 * Admin reassign order to different worker
 */
router.post('/admin/reassign', requireAuth, requireRole('fulfillment_admin', 'admin'), 
    fulfillmentController.reassignOrder.bind(fulfillmentController));

// =====================================================
// Scanning Routes
// =====================================================

/**
 * POST /api/v1/fulfillment/scanning/start
 * Start scanning session
 */
router.post('/scanning/start', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.startScanningSession.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/scanning/scan
 * Scan a package
 */
router.post('/scanning/scan', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.scanPackage.bind(fulfillmentController));

/**
 * GET /api/v1/fulfillment/scanning/progress/:invoiceId
 * Get scanning progress
 */
router.get('/scanning/progress/:invoiceId', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.getScanningProgress.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/scanning/verify-rejected
 * Verify rejected package is OK to use
 */
router.post('/scanning/verify-rejected', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.verifyRejectedPackage.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/scanning/cancel/:sessionId
 * Cancel scanning session
 */
router.post('/scanning/cancel/:sessionId', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.cancelScanningSession.bind(fulfillmentController));

// =====================================================
// Transportation & Manifest Routes
// =====================================================

/**
 * GET /api/v1/fulfillment/transporters
 * Get available transporters
 */
router.get('/transporters', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.getTransporters.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/transportation
 * Enter transportation details
 */
router.post('/transportation', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.enterTransportationDetails.bind(fulfillmentController));

/**
 * GET /api/v1/fulfillment/manifest/preview/:invoiceId
 * Get manifest preview
 */
router.get('/manifest/preview/:invoiceId', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.getManifestPreview.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/manifest/create
 * Create manifest
 */
router.post('/manifest/create', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.createManifest.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/manifest/void
 * Void manifest
 */
router.post('/manifest/void', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.voidManifest.bind(fulfillmentController));

/**
 * PATCH /api/v1/fulfillment/manifest/update
 * Update manifest
 */
router.patch('/manifest/update', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.updateManifest.bind(fulfillmentController));

// =====================================================
// Issue Reporting Routes
// =====================================================

/**
 * POST /api/v1/fulfillment/issues/report
 * Report fulfillment issue
 */
router.post('/issues/report', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.reportIssue.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/issues/request-global
 * Sales requests global issue
 */
router.post('/issues/request-global', requireAuth, requireRole('sales_admin', 'admin'), 
    fulfillmentController.requestGlobalIssue.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/issues/acknowledge-global/:invoiceId
 * Fulfillment acknowledges global issue
 */
router.post('/issues/acknowledge-global/:invoiceId', requireAuth, requireRole('fulfillment_worker', 'fulfillment_admin'), 
    fulfillmentController.acknowledgeGlobalIssue.bind(fulfillmentController));

module.exports = router;

