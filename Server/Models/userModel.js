// Server/Models/userModel.js

const { query, pool } = require('../config/database');
const bcrypt = require('bcrypt');

// Cache for column existence check
let isRejectedColumnExists = null;

class UserModel {
    /**
     * Check if is_rejected column exists in users table
     * @returns {Promise<boolean>}
     */
    static async checkIsRejectedColumnExists() {
        if (isRejectedColumnExists !== null) {
            return isRejectedColumnExists;
        }
        
        try {
            const result = await query(`
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'users'
                  AND column_name = 'is_rejected'
            `);
            isRejectedColumnExists = result.rows.length > 0;
            return isRejectedColumnExists;
        } catch (error) {
            console.error('Error checking is_rejected column:', error);
            isRejectedColumnExists = false;
            return false;
        }
    }
    
    /**
     * Ensure is_rejected column exists
     */
    static async ensureIsRejectedColumn() {
        const exists = await this.checkIsRejectedColumnExists();
        if (exists) {
            return;
        }
        
        try {
            await query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS is_rejected BOOLEAN DEFAULT false
            `);
            isRejectedColumnExists = true;
        } catch (error) {
            console.error('Error creating is_rejected column:', error);
            // Don't throw, just mark as not existing
            isRejectedColumnExists = false;
        }
    }
    /**
     * Create a new user
     * @param {Object} userData - User data
     * @returns {Promise<Object>} Created user
     */
    static async create(userData) {
        const { username, firstname, lastname, email, password, status = 'pending', is_superuser = false } = userData;
        
        // Hash the password
        const password_hash = await bcrypt.hash(password, 10);
        
        // Hash the email for the email_hash field
        const email_hash = await bcrypt.hash(email, 10);
        
        // Convert status to is_active boolean
        const is_active = status === 'active';
        const is_superadmin = Boolean(is_superuser);
        
        const sql = `
            INSERT INTO users (
                username, first_name, last_name, email, email_hash, password_hash,
                is_active, is_admin, is_superadmin, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            RETURNING id, username, first_name as firstname, last_name as lastname, email, 
                     CASE WHEN is_active = true THEN 'active' ELSE 'inactive' END as status, 
                     COALESCE(is_superadmin, is_admin, false) as is_superuser, created_at
        `;
        
        const result = await query(sql, [
            username,
            firstname,
            lastname,
            email,
            email_hash,
            password_hash,
            is_active,
            is_superadmin,
            is_superadmin
        ]);
        return result.rows[0];
    }

    /**
     * Find user by ID
     * @param {number} id - User ID
     * @returns {Promise<Object|null>} User or null
     */
    static async findById(id) {
        const columnExists = await this.checkIsRejectedColumnExists();
        
        let sql;
        if (columnExists) {
            sql = `
                SELECT id, username, first_name as firstname, last_name as lastname, 
                       email, password_hash, 
                       CASE 
                           WHEN is_active = true THEN 'active'
                           WHEN is_rejected = true THEN 'rejected'
                           WHEN is_active = false THEN 'pending'
                           ELSE 'inactive'
                       END as status,
                       COALESCE(is_superadmin, is_admin, false) as is_superuser, 
                       created_at, last_login, updated_at
                FROM users WHERE id = $1
            `;
        } else {
            sql = `
                SELECT id, username, first_name as firstname, last_name as lastname, 
                       email, password_hash, 
                       CASE 
                           WHEN is_active = true THEN 'active'
                           WHEN is_active = false THEN 'pending'
                           ELSE 'inactive'
                       END as status,
                       COALESCE(is_superadmin, is_admin, false) as is_superuser, 
                       created_at, last_login, updated_at
                FROM users WHERE id = $1
            `;
        }
        
        const result = await query(sql, [id]);
        return result.rows[0] || null;
    }

    /**
     * Find user by username
     * @param {string} username - Username
     * @returns {Promise<Object|null>} User or null
     */
    static async findByUsername(username) {
        const columnExists = await this.checkIsRejectedColumnExists();
        
        let sql;
        if (columnExists) {
            sql = `
                SELECT id, username, first_name as firstname, last_name as lastname, 
                       email, password_hash, 
                       CASE 
                           WHEN is_active = true THEN 'active'
                           WHEN is_rejected = true THEN 'rejected'
                           WHEN is_active = false THEN 'pending'
                           ELSE 'inactive'
                       END as status,
                       COALESCE(is_superadmin, is_admin, false) as is_superuser, 
                       created_at, last_login, updated_at
                FROM users WHERE username = $1
            `;
        } else {
            sql = `
                SELECT id, username, first_name as firstname, last_name as lastname, 
                       email, password_hash, 
                       CASE 
                           WHEN is_active = true THEN 'active'
                           WHEN is_active = false THEN 'pending'
                           ELSE 'inactive'
                       END as status,
                       COALESCE(is_superadmin, is_admin, false) as is_superuser, 
                       created_at, last_login, updated_at
                FROM users WHERE username = $1
            `;
        }
        
        const result = await query(sql, [username]);
        return result.rows[0] || null;
    }

    /**
     * Find user by email
     * @param {string} email - Email
     * @returns {Promise<Object|null>} User or null
     */
    static async findByEmail(email) {
        const columnExists = await this.checkIsRejectedColumnExists();
        
        let sql;
        if (columnExists) {
            sql = `
                SELECT id, username, first_name as firstname, last_name as lastname, 
                       email, password_hash, 
                       CASE 
                           WHEN is_active = true THEN 'active'
                           WHEN is_rejected = true THEN 'rejected'
                           WHEN is_active = false THEN 'pending'
                           ELSE 'inactive'
                       END as status,
                       COALESCE(is_superadmin, is_admin, false) as is_superuser, 
                       created_at, last_login, updated_at
                FROM users WHERE email = $1
            `;
        } else {
            sql = `
                SELECT id, username, first_name as firstname, last_name as lastname, 
                       email, password_hash, 
                       CASE 
                           WHEN is_active = true THEN 'active'
                           WHEN is_active = false THEN 'pending'
                           ELSE 'inactive'
                       END as status,
                       COALESCE(is_superadmin, is_admin, false) as is_superuser, 
                       created_at, last_login, updated_at
                FROM users WHERE email = $1
            `;
        }
        
        const result = await query(sql, [email]);
        return result.rows[0] || null;
    }

    /**
     * Get all users
     * @param {string} status - Filter by status (optional)
     * @returns {Promise<Array>} Array of users
     */
    static async getAll(status = null) {
        const columnExists = await this.checkIsRejectedColumnExists();
        
        let sql;
        if (columnExists) {
            sql = `
                SELECT 
                    id, 
                    username, 
                    first_name as firstname, 
                    last_name as lastname, 
                    email, 
                    CASE 
                        WHEN is_active = true THEN 'active'
                        WHEN is_rejected = true THEN 'rejected'
                        WHEN is_active = false THEN 'pending'
                        ELSE 'inactive'
                    END as status,
                    COALESCE(is_superadmin, is_admin, false) as is_superuser, 
                    created_at, 
                    last_login 
                FROM users
            `;
        } else {
            sql = `
                SELECT 
                    id, 
                    username, 
                    first_name as firstname, 
                    last_name as lastname, 
                    email, 
                    CASE 
                        WHEN is_active = true THEN 'active'
                        WHEN is_active = false THEN 'pending'
                        ELSE 'inactive'
                    END as status,
                    COALESCE(is_superadmin, is_admin, false) as is_superuser, 
                    created_at, 
                    last_login 
                FROM users
            `;
        }
        
        const params = [];
        
        if (status) {
            if (status === 'active') {
                sql += ' WHERE is_active = true';
            } else if (status === 'pending') {
                if (columnExists) {
                    sql += ' WHERE is_active = false AND is_rejected = false';
                } else {
                    sql += ' WHERE is_active = false';
                }
            } else if (status === 'rejected') {
                if (columnExists) {
                    sql += ' WHERE is_rejected = true';
                } else {
                    // If column doesn't exist, no rejected users yet
                    sql += ' WHERE 1 = 0';
                }
            } else if (status === 'inactive') {
                sql += ' WHERE is_active = false';
            }
        }
        
        sql += ' ORDER BY created_at DESC';
        
        const result = await query(sql, params);
        return result.rows;
    }

    /**
     * Get pending users
     * @returns {Promise<Array>} Array of pending users
     */
    static async getPending() {
        const columnExists = await this.checkIsRejectedColumnExists();
        
        let sql;
        if (columnExists) {
            sql = `
                SELECT 
                    id, 
                    username, 
                    first_name as firstname, 
                    last_name as lastname, 
                    email, 
                    CASE 
                        WHEN is_active = true THEN 'active'
                        WHEN is_rejected = true THEN 'rejected'
                        WHEN is_active = false THEN 'pending'
                        ELSE 'inactive'
                    END as status,
                    COALESCE(is_superadmin, is_admin, false) as is_superuser, 
                    created_at, 
                    last_login 
                FROM users 
                WHERE is_active = false AND is_rejected = false
                ORDER BY created_at DESC
            `;
        } else {
            sql = `
                SELECT 
                    id, 
                    username, 
                    first_name as firstname, 
                    last_name as lastname, 
                    email, 
                    CASE 
                        WHEN is_active = true THEN 'active'
                        WHEN is_active = false THEN 'pending'
                        ELSE 'inactive'
                    END as status,
                    COALESCE(is_superadmin, is_admin, false) as is_superuser, 
                    created_at, 
                    last_login 
                FROM users 
                WHERE is_active = false
                ORDER BY created_at DESC
            `;
        }
        
        const result = await query(sql);
        return result.rows;
    }

    /**
     * Get active users
     * @returns {Promise<Array>} Array of active users
     */
    static async getActive() {
        return this.getAll('active');
    }

    /**
     * Update user status
     * @param {number} id - User ID
     * @param {string} status - New status
     * @returns {Promise<Object>} Updated user
     */
    static async updateStatus(id, status) {
        // Convert status string to is_active boolean
        const is_active = status === 'active';
        
        const sql = `
            UPDATE users 
            SET is_active = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING id, username, first_name as firstname, last_name as lastname, email, 
                     CASE WHEN is_active = true THEN 'active' ELSE 'inactive' END as status, 
                     COALESCE(is_superadmin, is_admin, false) as is_superuser
        `;
        
        const result = await query(sql, [is_active, id]);
        return result.rows[0];
    }

    /**
     * Approve user (change status to active)
     * @param {number} id - User ID
     * @returns {Promise<Object>} Updated user
     */
    static async approve(id) {
        return this.updateStatus(id, 'active');
    }

    /**
     * Revoke user (change status to revoked)
     * @param {number} id - User ID
     * @returns {Promise<Object>} Updated user
     */
    static async revoke(id) {
        return this.updateStatus(id, 'revoked');
    }

    /**
     * Update user information
     * @param {number} id - User ID
     * @param {Object} userData - Updated user data
     * @returns {Promise<Object>} Updated user
     */
    static async update(id, userData) {
        const { firstname, lastname, email } = userData;
        
        const sql = `
            UPDATE users 
            SET first_name = $1, last_name = $2, email = $3, updated_at = NOW()
            WHERE id = $4
            RETURNING id, username, first_name as firstname, last_name as lastname, email, 
                     CASE WHEN is_active = true THEN 'active' ELSE 'inactive' END as status, 
                     COALESCE(is_superadmin, is_admin, false) as is_superuser
        `;
        
        const result = await query(sql, [firstname, lastname, email, id]);
        return result.rows[0];
    }

    /**
     * Update user password
     * @param {number} id - User ID
     * @param {string} newPassword - New password
     * @returns {Promise<Object>} Updated user
     */
    static async updatePassword(id, newPassword) {
        const password_hash = await bcrypt.hash(newPassword, 10);
        
        const sql = `
            UPDATE users 
            SET password_hash = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING id, username, email
        `;
        
        const result = await query(sql, [password_hash, id]);
        return result.rows[0];
    }

    /**
     * Update last login timestamp
     * @param {number} id - User ID
     * @returns {Promise<void>}
     */
    static async updateLastLogin(id) {
        const sql = 'UPDATE users SET last_login = NOW() WHERE id = $1';
        await query(sql, [id]);
    }

    /**
     * Verify password
     * @param {string} plainPassword - Plain text password
     * @param {string} hashedPassword - Hashed password
     * @returns {Promise<boolean>} True if password matches
     */
    static async verifyPassword(plainPassword, hashedPassword) {
        return await bcrypt.compare(plainPassword, hashedPassword);
    }

    /**
     * Assign role to user
     * @param {number} userId - User ID
     * @param {number} roleId - Role ID
     * @param {number} assignedBy - User ID who assigned the role
     * @returns {Promise<void>}
     */
    static async assignRole(userId, roleId, assignedBy) {
        const sql = `
            INSERT INTO user_roles (user_id, role_id, assigned_by)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, role_id) DO NOTHING
        `;
        
        await query(sql, [userId, roleId, assignedBy]);
    }

    /**
     * Remove role from user
     * @param {number} userId - User ID
     * @param {number} roleId - Role ID
     * @returns {Promise<void>}
     */
    static async removeRole(userId, roleId) {
        const sql = 'DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2';
        await query(sql, [userId, roleId]);
    }

    /**
     * Get user roles
     * @param {number} userId - User ID
     * @returns {Promise<Array>} Array of roles
     */
    static async getUserRoles(userId) {
        const sql = `
            SELECT r.id, r.name, r.description
            FROM roles r
            JOIN user_roles ur ON r.id = ur.role_id
            WHERE ur.user_id = $1
        `;
        
        const result = await query(sql, [userId]);
        return result.rows;
    }

    /**
     * Get permissions for a specific role
     * @param {number} roleId - Role ID
     * @returns {Promise<Array>} Array of permissions
     */
    static async getRolePermissions(roleId) {
        const sql = `
            SELECT DISTINCT p.action, p.resource, CONCAT(p.action, ':', p.resource) AS permission
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            WHERE rp.role_id = $1
            ORDER BY p.resource, p.action
        `;
        
        const result = await query(sql, [roleId]);
        return result.rows;
    }

    /**
     * Get user permissions
     * @param {number} userId - User ID
     * @returns {Promise<Array>} Array of permissions
     */
    static async getUserPermissions(userId) {
        const sql = `
            SELECT DISTINCT p.action, p.resource, CONCAT(p.action, ':', p.resource) AS permission
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            JOIN roles r ON rp.role_id = r.id
            JOIN user_roles ur ON r.id = ur.role_id
            WHERE ur.user_id = $1
        `;
        
        const result = await query(sql, [userId]);
        return result.rows;
    }

    /**
     * Check if user has permission
     * @param {number} userId - User ID
     * @param {string} action - Action
     * @param {string} resource - Resource
     * @returns {Promise<boolean>} True if user has permission
     */
    static async hasPermission(userId, action, resource) {
        const sql = `
            SELECT COUNT(*) as count
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            JOIN roles r ON rp.role_id = r.id
            JOIN user_roles ur ON r.id = ur.role_id
            WHERE ur.user_id = $1 AND p.action = $2 AND p.resource = $3
        `;
        
        const result = await query(sql, [userId, action, resource]);
        return parseInt(result.rows[0].count) > 0;
    }

    /**
     * Check if user is superuser
     * @param {number} userId - User ID
     * @returns {Promise<boolean>} True if user is superuser
     */
    static async isSuperuser(userId) {
        // Check if user has Administrator role (more reliable than database flag)
        const userRoles = await this.getUserRoles(userId);
        const hasAdminRole = userRoles.some(role => {
            const roleName = (role.name || role.role_name || '').toLowerCase().trim();
            return roleName === 'administrator';
        });
        
        if (hasAdminRole) {
            return true;
        }
        
        // Fallback to database flag check
        const sql = `
            SELECT COALESCE(is_superadmin, is_admin, false) as super_flag
            FROM users
            WHERE id = $1
        `;
        const result = await query(sql, [userId]);
        return result.rows[0]?.super_flag || false;
    }
    
    /**
     * Update superuser flags in database based on user roles
     * Sets is_superadmin and is_admin to true only if user has Administrator role
     * @param {number} userId - User ID
     * @returns {Promise<void>}
     */
    static async updateSuperuserFlags(userId) {
        try {
            // Get user roles
            const userRoles = await this.getUserRoles(userId);
            
            // Check if user has Administrator role
            const hasAdminRole = userRoles.some(role => {
                const roleName = (role.name || role.role_name || '').toLowerCase().trim();
                return roleName === 'administrator';
            });
            
            // Update database flags based on Administrator role
            const sql = `
                UPDATE users
                SET is_superadmin = $1, is_admin = $1, updated_at = NOW()
                WHERE id = $2
            `;
            
            await query(sql, [hasAdminRole, userId]);
            
            console.log(`[USER] Updated superuser flags for user ${userId}: is_superadmin=${hasAdminRole}, is_admin=${hasAdminRole}`);
        } catch (error) {
            console.error(`[USER] Error updating superuser flags for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Delete user (soft delete by setting status to revoked)
     * @param {number} id - User ID
     * @returns {Promise<Object>} Updated user
     */
    static async delete(id) {
        return this.revoke(id);
    }

    /**
     * Get user with roles and permissions
     * @param {number} id - User ID
     * @returns {Promise<Object>} User with roles and permissions
     */
    static async getUserWithPermissions(id) {
        const user = await this.findById(id);
        if (!user) return null;

        const roles = await this.getUserRoles(id);
        const permissions = await this.getUserPermissions(id);

        return {
            ...user,
            roles,
            permissions: permissions.map(p => p.permission)
        };
    }

    /**
     * Get all roles
     */
    static async getAllRoles() {
        const sql = `
            SELECT id, name, description
            FROM roles
            ORDER BY name
        `;
        
        try {
            const result = await query(sql);
            const roles = result.rows;
            
            // Get permissions for each role
            for (let role of roles) {
                const permissions = await this.getRolePermissions(role.id);
                role.permissions = permissions.map(p => p.permission);
            }
            
            return roles;
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        }
    }

    /**
     * Assign role to user
     */
    static async assignRole(userId, roleId, assignedBy = null) {
        const query = `
            INSERT INTO user_roles (user_id, role_id, assigned_by)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, role_id) DO NOTHING
            RETURNING *
        `;
        
        try {
            const result = await pool.query(query, [userId, roleId, assignedBy]);
            return result.rows[0];
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        }
    }

    /**
     * Remove role from user
     */
    static async removeRole(userId, roleId) {
        const query = `
            DELETE FROM user_roles
            WHERE user_id = $1 AND role_id = $2
            RETURNING *
        `;
        
        try {
            const result = await pool.query(query, [userId, roleId]);
            return result.rows[0];
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        }
    }

    /**
     * Get user roles
     */
    static async getUserRoles(userId) {
        const query = `
            SELECT r.id, r.name, ur.assigned_at
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1
            ORDER BY r.name
        `;
        
        try {
            const result = await pool.query(query, [userId]);
            return result.rows;
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        }
    }

    /**
     * Get all users with a specific role
     * @param {string} roleName - Role name (e.g., 'Sales Representative', 'Sales Admin')
     * @returns {Promise<Array>} Array of users with that role
     */
    static async getUsersByRole(roleName) {
        const sql = `
            SELECT DISTINCT
                u.id,
                u.username,
                u.first_name as firstname,
                u.last_name as lastname,
                u.email,
                u.is_active,
                CASE 
                    WHEN u.is_active = true THEN 'active'
                    WHEN u.is_active = false THEN 'pending'
                    ELSE 'inactive'
                END as status
            FROM users u
            INNER JOIN user_roles ur ON u.id = ur.user_id
            INNER JOIN roles r ON ur.role_id = r.id
            WHERE LOWER(r.name) = LOWER($1)
            AND u.is_active = true
            ORDER BY u.first_name, u.last_name
        `;
        
        try {
            const result = await query(sql, [roleName]);
            return result.rows;
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        }
    }

    /**
     * Approve user
     */
    static async approve(userId) {
        const sql = `
            UPDATE users
            SET is_active = true, updated_at = NOW()
            WHERE id = $1 AND is_active = false
            RETURNING id, username, first_name as firstname, last_name as lastname, email, 
                     CASE WHEN is_active = true THEN 'active' ELSE 'pending' END as status, 
                     COALESCE(is_superadmin, is_admin, false) as is_superuser, created_at
        `;
        
        try {
            const result = await query(sql, [userId]);
            return result.rows[0];
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        }
    }

    /**
     * Revoke user (for active users)
     */
    static async revoke(userId) {
        const sql = `
            UPDATE users
            SET is_active = false, updated_at = NOW()
            WHERE id = $1 AND is_active = true
            RETURNING id, username, first_name as firstname, last_name as lastname, email, 
                     CASE WHEN is_active = true THEN 'active' ELSE 'pending' END as status, 
                     COALESCE(is_superadmin, is_admin, false) as is_superuser, created_at
        `;
        
        try {
            const result = await query(sql, [userId]);
            return result.rows[0];
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        }
    }

    /**
     * Reject user (for pending users - sets status to rejected)
     */
    static async reject(userId) {
        // Ensure is_rejected column exists
        await this.ensureIsRejectedColumn();
        
        // Update user to set is_rejected = true and is_active = false
        const sql = `
            UPDATE users
            SET is_active = false, is_rejected = true, updated_at = NOW()
            WHERE id = $1 AND is_active = false
            RETURNING id, username, first_name as firstname, last_name as lastname, email, 
                     'rejected' as status, 
                     COALESCE(is_superadmin, is_admin, false) as is_superuser, created_at
        `;
        
        const result = await query(sql, [userId]);
        if (result.rows.length > 0) {
            result.rows[0].status = 'rejected';
        }
        return result.rows[0];
    }

    /**
     * Invalidate all sessions for a user (force re-login)
     * This deletes all sessions from the user_sessions table for the specified user
     * @param {number} userId - User ID
     * @returns {Promise<void>}
     */
    static async invalidateUserSessions(userId) {
        try {
            // Delete all sessions for this user from user_sessions table
            // The sess column contains JSON with userId, so we need to check it
            // connect-pg-simple stores session data as JSON in the 'sess' column
            const sql = `
                DELETE FROM user_sessions
                WHERE sess::text LIKE $1
            `;
            
            // Search for sessions containing this userId in the session data
            // The session JSON structure from connect-pg-simple includes userId
            const userIdPattern = `%"userId":${userId}%`;
            const result = await query(sql, [userIdPattern]);
            
            console.log(`[SESSION] Invalidated all sessions for user ${userId}`);
            return result.rowCount || 0;
        } catch (error) {
            console.error(`[SESSION] Error invalidating sessions for user ${userId}:`, error);
            // Don't throw - session invalidation failure shouldn't break role assignment
            return 0;
        }
    }
}

module.exports = UserModel;

