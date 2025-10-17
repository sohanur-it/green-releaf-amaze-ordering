/**
 * Sync Routes
 * 
 * API routes for sync management and monitoring
 */

const express = require('express');
const router = express.Router();
const syncController = require('../Controllers/syncController');
const { requireAuth, requirePermission } = require('../Middleware/auth');

// Apply authentication to all sync routes
router.use(requireAuth);

/**
 * GET /api/v1/admin/sync/status
 * Get current sync status and scheduler information
 */
router.get('/status', requirePermission('admin.sync.view'), syncController.getStatus);

/**
 * GET /api/v1/admin/sync/history
 * Get sync history and logs
 */
router.get('/history', requirePermission('admin.sync.view'), syncController.getSyncHistory);

/**
 * POST /api/v1/admin/sync/:serviceName
 * Trigger a specific sync service
 * Valid serviceNames: active, transferred, intransit, outgoing, items, strains
 */
router.post('/:serviceName', requirePermission('admin.sync.trigger'), syncController.triggerSync);

/**
 * POST /api/v1/admin/sync/all
 * Trigger all sync services
 */
router.post('/all', requirePermission('admin.sync.trigger'), syncController.triggerAllSyncs);

/**
 * POST /api/v1/admin/sync/scheduler/start
 * Start the sync scheduler
 */
router.post('/scheduler/start', requirePermission('admin.sync.manage'), syncController.startScheduler);

/**
 * POST /api/v1/admin/sync/scheduler/stop
 * Stop the sync scheduler
 */
router.post('/scheduler/stop', requirePermission('admin.sync.manage'), syncController.stopScheduler);

/**
 * POST /api/v1/admin/sync/auth/refresh
 * Refresh METRC authentication tokens
 */
router.post('/auth/refresh', requirePermission('admin.sync.manage'), syncController.refreshAuth);

module.exports = router;
