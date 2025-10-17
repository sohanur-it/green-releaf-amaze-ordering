/**
 * Manifest Routes
 * 
 * API routes for manifest creation and management
 */

const express = require('express');
const router = express.Router();
const manifestController = require('../Controllers/manifestController');
const { requireAuth, requirePermission } = require('../Middleware/auth');
const { manifestAuditMiddleware } = require('../Middleware/auditMiddleware');

// Apply authentication to all manifest routes
router.use(requireAuth);

/**
 * POST /api/v1/manifests
 * Create a new manifest
 * Requires: fulfillment.manifest_create permission
 */
router.post('/', 
    requirePermission('fulfillment.manifest_create'),
    manifestAuditMiddleware,
    manifestController.createManifest
);

/**
 * GET /api/v1/manifests/:manifestNumber/status
 * Get manifest status from METRC
 * Requires: fulfillment.manifest_read permission
 */
router.get('/:manifestNumber/status', 
    requirePermission('fulfillment.manifest_read'),
    manifestController.getManifestStatus
);

module.exports = router;
