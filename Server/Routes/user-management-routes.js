/**
 * User Management Routes
 * 
 * API routes for user approval, role assignment, and user management
 */

const express = require('express');
const router = express.Router();
const userManagementController = require('../Controllers/userManagementController');
const { requireAuth, requirePermission } = require('../Middleware/auth');

// Apply authentication to all user management routes
router.use(requireAuth);

/**
 * GET /api/v1/admin/users
 * Get all users with their roles
 * Requires: admin.user.read permission
 */
router.get('/', 
    requirePermission('admin.user.read'),
    userManagementController.getAllUsers
);

/**
 * GET /api/v1/admin/users/pending
 * Get pending users awaiting approval
 * Requires: admin.user.read permission
 */
router.get('/pending',
    requirePermission('admin.user.read'),
    userManagementController.getPendingUsers
);

/**
 * GET /api/v1/admin/roles
 * Get all available roles
 * Requires: admin.user.read permission
 */
router.get('/roles',
    requirePermission('admin.user.read'),
    userManagementController.getAllRoles
);

/**
 * GET /api/v1/admin/roles/:roleId/permissions
 * Get permissions for a specific role
 * Requires: admin.user.read permission
 * NOTE: Must come BEFORE /:userId/permissions to avoid route collision
 */
router.get('/roles/:roleId/permissions',
    requirePermission('admin.user.read'),
    userManagementController.getRolePermissions
);

/**
 * GET /api/v1/admin/users/:userId/permissions
 * Get permissions for a specific user
 * Requires: admin.user.read permission
 */
router.get('/:userId/permissions',
    requirePermission('admin.user.read'),
    userManagementController.getUserPermissions
);

/**
 * POST /api/v1/admin/users/:userId/approve
 * Approve a pending user
 * Requires: admin.user.approve permission
 */
router.post('/:userId/approve',
    requirePermission('admin.user.approve'),
    userManagementController.approveUser
);

/**
 * POST /api/v1/admin/users/:userId/revoke
 * Revoke user access
 * Requires: admin.user.revoke permission
 */
router.post('/:userId/revoke',
    requirePermission('admin.user.revoke'),
    userManagementController.revokeUser
);

/**
 * POST /api/v1/admin/users/:userId/roles
 * Assign roles to a user
 * Requires: admin.user.assign_roles permission
 */
router.post('/:userId/roles',
    requirePermission('admin.user.assign_roles'),
    userManagementController.assignRoles
);

/**
 * DELETE /api/v1/admin/users/:userId/roles
 * Remove roles from a user
 * Requires: admin.user.assign_roles permission
 */
router.delete('/:userId/roles',
    requirePermission('admin.user.assign_roles'),
    userManagementController.removeRoles
);

module.exports = router;
