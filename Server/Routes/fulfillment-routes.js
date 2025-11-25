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
router.get('/queue', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.getQueue.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/queue/claim
 * Claim an order for fulfillment
 */
router.post('/queue/claim', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.claimOrder.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/queue/release
 * Release order back to queue
 */
router.post('/queue/release', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.releaseOrder.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/admin/reassign
 * Admin reassign order to different worker
 */
router.post('/admin/reassign', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.reassignOrder.bind(fulfillmentController));

// =====================================================
// Scanning Routes
// =====================================================

/**
 * POST /api/v1/fulfillment/scanning/start
 * Start scanning session
 */
router.post('/scanning/start', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.startScanningSession.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/scanning/scan
 * Scan a package
 */
router.post('/scanning/scan', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.scanPackage.bind(fulfillmentController));

/**
 * GET /api/v1/fulfillment/scanning/progress/:invoiceId
 * Get scanning progress
 */
router.get('/scanning/progress/:invoiceId', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.getScanningProgress.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/scanning/verify-rejected
 * Verify rejected package is OK to use
 */
router.post('/scanning/verify-rejected', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.verifyRejectedPackage.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/scanning/acknowledge-removal
 * Acknowledge that a package not on order has been removed
 */
router.post('/scanning/acknowledge-removal', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.acknowledgePackageRemoval.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/scanning/cancel/:sessionId
 * Cancel scanning session
 */
router.post('/scanning/cancel/:sessionId', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.cancelScanningSession.bind(fulfillmentController));

// =====================================================
// Transportation & Manifest Routes
// =====================================================

/**
 * GET /api/v1/fulfillment/transporters
 * Get available transporters
 */
router.get('/transporters', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.getTransporters.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/transportation
 * Enter transportation details
 */
router.post('/transportation', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.enterTransportationDetails.bind(fulfillmentController));

/**
 * GET /api/v1/fulfillment/manifest/preview/:invoiceId
 * Get manifest preview
 */
router.get('/manifest/preview/:invoiceId', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.getManifestPreview.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/manifest/create
 * Create manifest
 */
router.post('/manifest/create', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.createManifest.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/manifest/void
 * Void manifest
 */
router.post('/manifest/void', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.voidManifest.bind(fulfillmentController));

/**
 * PATCH /api/v1/fulfillment/manifest/update
 * Update manifest
 */
router.patch('/manifest/update', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.updateManifest.bind(fulfillmentController));

// =====================================================
// Issue Reporting Routes
// =====================================================

/**
 * POST /api/v1/fulfillment/issues/report
 * Report fulfillment issue
 */
router.post('/issues/report', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.reportIssue.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/issues/request-global
 * Sales requests global issue
 */
router.post('/issues/request-global', requireAuth, requireRole('Sales Admin', 'Administrator'), 
    fulfillmentController.requestGlobalIssue.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/issues/acknowledge-global/:invoiceId
 * Fulfillment acknowledges global issue
 */
router.post('/issues/acknowledge-global/:invoiceId', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.acknowledgeGlobalIssue.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/issues/update
 * Update issue details
 */
router.post('/issues/update', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.updateIssueDetails.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/issues/add-note
 * Add note to existing issue
 */
router.post('/issues/add-note', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.addNoteToIssue.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/issues/cancel
 * Cancel issue report
 */
router.post('/issues/cancel', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'),
    fulfillmentController.cancelIssueReport.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/issues/resolve
 * Sales rep resolves issue by modifying invoice
 * Requires: sales_admin, sales_rep, or admin role
 */
router.post('/issues/resolve', requireAuth, requireRole('Sales Admin', 'Sales Representative', 'Administrator'),
    fulfillmentController.resolveIssueAndModify.bind(fulfillmentController));

// =====================================================
// Cancelled Shipment Routes
// =====================================================

/**
 * POST /api/v1/fulfillment/cancelled-shipments/cancel
 * Process cancellation after shipment
 */
router.post('/cancelled-shipments/cancel', requireAuth, requireRole('Sales Admin', 'Administrator'), 
    fulfillmentController.processCancellation.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/cancelled-shipments/confirm-return
 * Confirm packages returned to inventory
 */
router.post('/cancelled-shipments/confirm-return', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.confirmPackagesReturned.bind(fulfillmentController));

/**
 * POST /api/v1/fulfillment/cancelled-shipments/report-incident
 * Report driver incident
 */
router.post('/cancelled-shipments/report-incident', requireAuth, requireRole('Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.reportDriverIncident.bind(fulfillmentController));

// =====================================================
// Admin Routes
// =====================================================

/**
 * GET /api/v1/admin/fulfillment/sessions
 * Get all active scanning sessions (admin)
 */
router.get('/admin/sessions', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.getAllActiveSessions.bind(fulfillmentController));

/**
 * POST /api/v1/admin/fulfillment/sessions/:sessionId/force-complete
 * Force complete scanning session (admin)
 */
router.post('/admin/sessions/:sessionId/force-complete', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.forceCompleteSession.bind(fulfillmentController));

/**
 * POST /api/v1/admin/fulfillment/sessions/remove-package
 * Remove mistakenly scanned package (admin)
 */
router.post('/admin/sessions/remove-package', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.removeScannedPackage.bind(fulfillmentController));

/**
 * POST /api/v1/admin/fulfillment/sessions/edit-package
 * Edit scanned package label (admin)
 */
router.post('/admin/sessions/edit-package', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.editScannedPackage.bind(fulfillmentController));

/**
 * POST /api/v1/admin/fulfillment/sessions/:sessionId/adjust
 * Manually adjust session data (admin)
 */
router.post('/admin/sessions/:sessionId/adjust', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.manuallyAdjustSession.bind(fulfillmentController));

/**
 * GET /api/v1/admin/fulfillment/issues
 * Get all issues for bulk management (admin)
 */
router.get('/admin/issues', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.getAllIssues.bind(fulfillmentController));

/**
 * POST /api/v1/admin/fulfillment/issues/bulk-assign
 * Bulk assign issues to sales rep (admin)
 */
router.post('/admin/issues/bulk-assign', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.bulkAssignIssues.bind(fulfillmentController));

/**
 * GET /api/v1/admin/cancelled-shipments/unverified-packages
 * Get unverified packages for admin dashboard
 */
router.get('/admin/cancelled-shipments/unverified-packages', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'),
    fulfillmentController.getUnverifiedPackages.bind(fulfillmentController));

/**
 * POST /api/v1/admin/cancelled-shipments/verify-package/:packageId
 * Verify a single package
 */
router.post('/admin/cancelled-shipments/verify-package/:packageId', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'),
    fulfillmentController.verifyPackage.bind(fulfillmentController));

/**
 * POST /api/v1/admin/cancelled-shipments/mark-missing/:packageId
 * Mark a package as missing
 */
router.post('/admin/cancelled-shipments/mark-missing/:packageId', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'),
    fulfillmentController.markPackageMissing.bind(fulfillmentController));

/**
 * POST /api/v1/admin/cancelled-shipments/bulk-verify
 * Bulk verify packages
 */
router.post('/admin/cancelled-shipments/bulk-verify', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'),
    fulfillmentController.bulkVerifyPackages.bind(fulfillmentController));

/**
 * POST /api/v1/admin/cancelled-shipments/bulk-mark-missing
 * Bulk mark packages as missing
 */
router.post('/admin/cancelled-shipments/bulk-mark-missing', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'),
    fulfillmentController.bulkMarkPackagesMissing.bind(fulfillmentController));

/**
 * POST /api/v1/admin/cancelled-shipments/:invoiceId/finalize-destroyed
 * Finalize destroyed packages (admin)
 */
router.post('/admin/cancelled-shipments/:invoiceId/finalize-destroyed', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.finalizeDestroyedPackages.bind(fulfillmentController));

/**
 * GET /api/v1/admin/cancelled-shipments/:invoiceId/unaccounted-packages
 * Get unaccounted packages (admin)
 */
router.get('/admin/cancelled-shipments/:invoiceId/unaccounted-packages', requireAuth, requireRole('fulfillment_admin', 'Sales Admin', 'Administrator'), 
    fulfillmentController.getUnaccountedPackages.bind(fulfillmentController));

/**
 * POST /api/v1/admin/fulfillment/sync-statuses
 * Sync manifest statuses (scheduled job endpoint)
 */
router.post('/admin/sync-statuses', requireAuth, requireRole('Administrator'), 
    fulfillmentController.syncManifestStatuses.bind(fulfillmentController));

module.exports = router;

