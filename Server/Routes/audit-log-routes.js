/**
 * Audit Log Routes
 * 
 * API routes for viewing audit logs
 */

const express = require('express');
const router = express.Router();
const auditLogController = require('../Controllers/auditLogController');
const { requireAuth, requirePermission } = require('../Middleware/auth');

// Apply authentication to all audit log routes
router.use(requireAuth);

/**
 * GET /api/v1/admin/audit-logs
 * Get audit logs with filtering and pagination
 * Requires: admin.audit.read permission
 */
router.get('/', 
    requirePermission('admin.audit.read'),
    auditLogController.getAuditLogs
);

/**
 * GET /api/v1/admin/audit-logs/stats
 * Get audit log statistics
 * Requires: admin.audit.read permission
 */
router.get('/stats',
    requirePermission('admin.audit.read'),
    auditLogController.getAuditStats
);

/**
 * GET /api/v1/admin/audit-logs/filters
 * Get filter options for the UI
 * Requires: admin.audit.read permission
 */
router.get('/filters',
    requirePermission('admin.audit.read'),
    auditLogController.getFilterOptions
);

module.exports = router;
