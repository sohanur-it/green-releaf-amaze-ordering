/**
 * User Management Controller
 * 
 * Handles user approval, role assignment, and user management
 */

const UserModel = require('../Models/userModel');
const auditLogger = require('../Services/auditLogger');

class UserManagementController {
    /**
     * Get all users with their roles
     * GET /api/v1/admin/users
     */
    async getAllUsers(req, res) {
        try {
            const users = await UserModel.getAll();
            
            // Get roles and permissions for each user
            const usersWithRolesAndPermissions = await Promise.all(
                users.map(async (user) => {
                    const roles = await UserModel.getUserRoles(user.id);
                    const permissions = await UserModel.getUserPermissions(user.id);
                    return {
                        ...user,
                        roles: roles,
                        permissions: permissions
                    };
                })
            );
            
            res.json({
                success: true,
                data: usersWithRolesAndPermissions,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error getting users:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get users',
                message: error.message
            });
        }
    }

    /**
     * Get pending users awaiting approval
     * GET /api/v1/admin/users/pending
     */
    async getPendingUsers(req, res) {
        try {
            const pendingUsers = await UserModel.getPending();
            
            res.json({
                success: true,
                data: pendingUsers,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error getting pending users:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get pending users',
                message: error.message
            });
        }
    }

    /**
     * Approve a pending user
     * POST /api/v1/admin/users/:userId/approve
     */
    async approveUser(req, res) {
        try {
            const { userId } = req.params;
            const { roles } = req.body;
            const adminUserId = req.session.userId;
            
            // Get user details
            const user = await UserModel.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            
            if (user.status !== 'pending') {
                return res.status(400).json({
                    success: false,
                    error: 'User is not pending approval'
                });
            }
            
            // Approve the user
            await UserModel.approve(userId);
            
            // Assign roles if provided
            if (roles && roles.length > 0) {
                for (const roleId of roles) {
                    await UserModel.assignRole(userId, roleId, adminUserId);
                }
            }
            
            // Log the approval
            await auditLogger.logUserAction(
                adminUserId,
                'user_approved',
                'User',
                userId,
                {
                    username: user.username,
                    email: user.email,
                    assignedRoles: roles || []
                },
                'success'
            );
            
            res.json({
                success: true,
                message: 'User approved successfully',
                data: {
                    userId,
                    username: user.username,
                    assignedRoles: roles || []
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error approving user:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to approve user',
                message: error.message
            });
        }
    }

    /**
     * Revoke user access
     * POST /api/v1/admin/users/:userId/revoke
     */
    async revokeUser(req, res) {
        try {
            const { userId } = req.params;
            const adminUserId = req.session.userId;
            
            // Get user details
            const user = await UserModel.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            
            if (user.status === 'revoked') {
                return res.status(400).json({
                    success: false,
                    error: 'User is already revoked'
                });
            }
            
            // Revoke the user
            await UserModel.revoke(userId);
            
            // Log the revocation
            await auditLogger.logUserAction(
                adminUserId,
                'user_revoked',
                'User',
                userId,
                {
                    username: user.username,
                    email: user.email,
                    previousStatus: user.status
                },
                'success'
            );
            
            res.json({
                success: true,
                message: 'User access revoked successfully',
                data: {
                    userId,
                    username: user.username
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error revoking user:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to revoke user',
                message: error.message
            });
        }
    }

    /**
     * Assign roles to a user
     * POST /api/v1/admin/users/:userId/roles
     */
    async assignRoles(req, res) {
        try {
            const { userId } = req.params;
            const { roles } = req.body;
            const adminUserId = req.session.userId;
            
            if (!roles || !Array.isArray(roles)) {
                return res.status(400).json({
                    success: false,
                    error: 'Roles array is required'
                });
            }
            
            // Get user details
            const user = await UserModel.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            
            // Get current roles
            const currentRoles = await UserModel.getUserRoles(userId);
            
            // Assign new roles
            for (const roleId of roles) {
                await UserModel.assignRole(userId, roleId, adminUserId);
            }
            
            // Log the role assignment
            await auditLogger.logUserAction(
                adminUserId,
                'user_roles_assigned',
                'User',
                userId,
                {
                    username: user.username,
                    previousRoles: currentRoles.map(r => r.name),
                    newRoles: roles
                },
                'success'
            );
            
            res.json({
                success: true,
                message: 'Roles assigned successfully',
                data: {
                    userId,
                    username: user.username,
                    assignedRoles: roles
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error assigning roles:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to assign roles',
                message: error.message
            });
        }
    }

    /**
     * Remove roles from a user
     * DELETE /api/v1/admin/users/:userId/roles
     */
    async removeRoles(req, res) {
        try {
            const { userId } = req.params;
            const { roles } = req.body;
            const adminUserId = req.session.userId;
            
            if (!roles || !Array.isArray(roles)) {
                return res.status(400).json({
                    success: false,
                    error: 'Roles array is required'
                });
            }
            
            // Get user details
            const user = await UserModel.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            
            // Get current roles
            const currentRoles = await UserModel.getUserRoles(userId);
            
            // Remove specified roles
            for (const roleId of roles) {
                await UserModel.removeRole(userId, roleId);
            }
            
            // Log the role removal
            await auditLogger.logUserAction(
                adminUserId,
                'user_roles_removed',
                'User',
                userId,
                {
                    username: user.username,
                    previousRoles: currentRoles.map(r => r.name),
                    removedRoles: roles
                },
                'success'
            );
            
            res.json({
                success: true,
                message: 'Roles removed successfully',
                data: {
                    userId,
                    username: user.username,
                    removedRoles: roles
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error removing roles:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to remove roles',
                message: error.message
            });
        }
    }

    /**
     * Get all available roles
     * GET /api/v1/admin/roles
     */
    async getAllRoles(req, res) {
        try {
            const roles = await UserModel.getAllRoles();
            
            res.json({
                success: true,
                data: roles,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error getting roles:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get roles',
                message: error.message
            });
        }
    }

    /**
     * Get permissions for a specific user
     * GET /api/v1/admin/users/:userId/permissions
     */
    async getUserPermissions(req, res) {
        try {
            const { userId } = req.params;
            const permissions = await UserModel.getUserPermissions(userId);
            
            res.json({
                success: true,
                data: permissions,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error getting user permissions:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get user permissions',
                message: error.message
            });
        }
    }

    /**
     * Get permissions for a specific role
     * GET /api/v1/admin/users/roles/:roleId/permissions
     */
    async getRolePermissions(req, res) {
        try {
            const { roleId } = req.params;
            const permissions = await UserModel.getRolePermissions(roleId);
            
            res.json({
                success: true,
                data: permissions,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error getting role permissions:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get role permissions',
                message: error.message
            });
        }
    }
}

module.exports = new UserManagementController();
