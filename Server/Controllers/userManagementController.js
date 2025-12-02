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
                
                // Update superuser flags based on assigned roles
                try {
                    await UserModel.updateSuperuserFlags(userId);
                    console.log(`[ROLES] Updated superuser flags for user ${userId} after approval with roles`);
                } catch (flagError) {
                    console.error('[ROLES] Error updating superuser flags:', flagError);
                    // Don't fail the whole operation if flag update fails
                }
            }
            
            // Get role names if roles were assigned
            let roleNames = [];
            if (roles && roles.length > 0) {
                const allRoles = await UserModel.getAllRoles();
                roleNames = roles.map(roleId => {
                    const role = allRoles.find(r => r.id === parseInt(roleId));
                    return role ? role.name : 'Unknown';
                });
            }
            
            // Log the approval with clear message
            const roleText = roleNames.length > 0 ? ` with role(s): ${roleNames.join(', ')}` : '';
            await auditLogger.logUserAction(
                adminUserId,
                'user_approved',
                'User',
                userId,
                {
                    message: `User ${user.firstname} ${user.lastname} (${user.username}) approved successfully${roleText}`,
                    username: user.username,
                    email: user.email,
                    assignedRoles: roleNames.join(', ') || 'None'
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
     * Reject a pending user
     * POST /api/v1/admin/users/:userId/reject
     */
    async rejectUser(req, res) {
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
            
            if (user.status !== 'pending') {
                return res.status(400).json({
                    success: false,
                    error: 'Only pending users can be rejected'
                });
            }
            
            // Reject the user
            await UserModel.reject(userId);
            
            // Log the rejection with clear message
            await auditLogger.logUserAction(
                adminUserId,
                'user_rejected',
                'User',
                userId,
                {
                    message: `User ${user.firstname} ${user.lastname} (${user.username})'s registration has been rejected`,
                    username: user.username,
                    email: user.email,
                    previousStatus: user.status
                },
                'success'
            );
            
            res.json({
                success: true,
                message: 'User rejected successfully',
                data: {
                    userId,
                    username: user.username,
                    status: 'rejected'
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error rejecting user:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to reject user',
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
            
            if (user.status === 'revoked' || user.status === 'rejected') {
                return res.status(400).json({
                    success: false,
                    error: 'User is already revoked or rejected'
                });
            }
            
            // Revoke the user
            await UserModel.revoke(userId);
            
            // Log the revocation with clear message
            await auditLogger.logUserAction(
                adminUserId,
                'user_revoked',
                'User',
                userId,
                {
                    message: `User ${user.firstname} ${user.lastname} (${user.username})'s access has been revoked`,
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
            
            // Validate admin user ID
            if (!adminUserId) {
                console.error('❌ No admin user ID in session:', req.session);
                return res.status(401).json({
                    success: false,
                    error: 'Admin user not authenticated'
                });
            }
            
            console.log('🔍 Admin user ID for audit log:', adminUserId);
            
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
            
            // Remove all existing roles first
            for (const role of currentRoles) {
                await UserModel.removeRole(userId, role.id);
            }
            
            // Assign new roles
            const assignedRoleNames = [];
            for (const roleId of roles) {
                await UserModel.assignRole(userId, roleId, adminUserId);
                
                // Get the assigned role details
                const allRoles = await UserModel.getAllRoles();
                const assignedRoleDetails = allRoles.find(r => r.id === parseInt(roleId));
                if (assignedRoleDetails) {
                    assignedRoleNames.push(assignedRoleDetails.name);
                }
            }
            
            // Update superuser flags based on new roles
            try {
                await UserModel.updateSuperuserFlags(userId);
                console.log(`[ROLES] Updated superuser flags for user ${userId} based on new roles`);
            } catch (flagError) {
                console.error('[ROLES] Error updating superuser flags:', flagError);
                // Don't fail the whole operation if flag update fails
            }
            
            const roleNamesText = assignedRoleNames.join(', ');
            const roleText = assignedRoleNames.length === 1 ? 'role' : 'roles';
            
            // Log the role assignment with clear message
            await auditLogger.logUserAction(
                adminUserId,
                'user_roles_assigned',
                'User',
                userId,
                {
                    message: `User ${user.firstname} ${user.lastname}'s new ${roleText} "${roleNamesText}" assigned successfully!`,
                    username: user.username,
                    previousRoles: currentRoles.map(r => r.name).join(', ') || 'None',
                    newRoles: roleNamesText
                },
                'success'
            );
            
            // Invalidate all sessions for this user to force re-login with new roles
            // This ensures users don't retain old permissions after role changes
            try {
                const invalidatedCount = await UserModel.invalidateUserSessions(userId);
                console.log(`[ROLES] Invalidated ${invalidatedCount} session(s) for user ${userId} after role change`);
            } catch (sessionError) {
                console.error('[ROLES] Error invalidating sessions:', sessionError);
                // Don't fail the whole operation if session invalidation fails
            }
            
            res.json({
                success: true,
                message: `${roleText.charAt(0).toUpperCase() + roleText.slice(1)} assigned successfully (previous roles removed)`,
                data: {
                    userId,
                    username: user.username,
                    assignedRoles: assignedRoleNames,
                    previousRoles: currentRoles.map(r => r.name)
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
            
            // Update superuser flags based on remaining roles
            try {
                await UserModel.updateSuperuserFlags(userId);
                console.log(`[ROLES] Updated superuser flags for user ${userId} after role removal`);
            } catch (flagError) {
                console.error('[ROLES] Error updating superuser flags:', flagError);
                // Don't fail the whole operation if flag update fails
            }
            
            // Get removed role names
            const allRoles = await UserModel.getAllRoles();
            const removedRoleNames = roles.map(roleId => {
                const role = allRoles.find(r => r.id === parseInt(roleId));
                return role ? role.name : 'Unknown';
            });
            
            // Log the role removal with clear message
            await auditLogger.logUserAction(
                adminUserId,
                'user_roles_removed',
                'User',
                userId,
                {
                    message: `User ${user.firstname} ${user.lastname} (${user.username})'s role(s) removed: ${removedRoleNames.join(', ')}`,
                    username: user.username,
                    previousRoles: currentRoles.map(r => r.name).join(', ') || 'None',
                    removedRoles: removedRoleNames.join(', ')
                },
                'success'
            );
            
            // Invalidate all sessions for this user to force re-login with updated roles
            // This ensures users don't retain old permissions after role removal
            try {
                const invalidatedCount = await UserModel.invalidateUserSessions(userId);
                console.log(`[ROLES] Invalidated ${invalidatedCount} session(s) for user ${userId} after role removal`);
            } catch (sessionError) {
                console.error('[ROLES] Error invalidating sessions:', sessionError);
                // Don't fail the whole operation if session invalidation fails
            }
            
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
