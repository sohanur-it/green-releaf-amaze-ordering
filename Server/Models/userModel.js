// Server/Models/userModel.js

const { query } = require('../config/database');
const bcrypt = require('bcrypt');

class UserModel {
    /**
     * Create a new user
     * @param {Object} userData - User data
     * @returns {Promise<Object>} Created user
     */
    static async create(userData) {
        const { username, firstname, lastname, email, password, status = 'pending', is_superuser = false } = userData;
        
        // Hash the password
        const password_hash = await bcrypt.hash(password, 10);
        
        const sql = `
            INSERT INTO users (username, firstname, lastname, email, password_hash, status, is_superuser)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, username, firstname, lastname, email, status, is_superuser, created_at
        `;
        
        const result = await query(sql, [username, firstname, lastname, email, password_hash, status, is_superuser]);
        return result.rows[0];
    }

    /**
     * Find user by ID
     * @param {number} id - User ID
     * @returns {Promise<Object|null>} User or null
     */
    static async findById(id) {
        const sql = 'SELECT * FROM users WHERE id = $1';
        const result = await query(sql, [id]);
        return result.rows[0] || null;
    }

    /**
     * Find user by username
     * @param {string} username - Username
     * @returns {Promise<Object|null>} User or null
     */
    static async findByUsername(username) {
        const sql = 'SELECT * FROM users WHERE username = $1';
        const result = await query(sql, [username]);
        return result.rows[0] || null;
    }

    /**
     * Find user by email
     * @param {string} email - Email
     * @returns {Promise<Object|null>} User or null
     */
    static async findByEmail(email) {
        const sql = 'SELECT * FROM users WHERE email = $1';
        const result = await query(sql, [email]);
        return result.rows[0] || null;
    }

    /**
     * Get all users
     * @param {string} status - Filter by status (optional)
     * @returns {Promise<Array>} Array of users
     */
    static async getAll(status = null) {
        let sql = 'SELECT id, username, firstname, lastname, email, status, is_superuser, created_at, last_login FROM users';
        const params = [];
        
        if (status) {
            sql += ' WHERE status = $1';
            params.push(status);
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
        return this.getAll('pending');
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
        const sql = `
            UPDATE users 
            SET status = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING id, username, firstname, lastname, email, status, is_superuser
        `;
        
        const result = await query(sql, [status, id]);
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
            SET firstname = $1, lastname = $2, email = $3, updated_at = NOW()
            WHERE id = $4
            RETURNING id, username, firstname, lastname, email, status, is_superuser
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
        const sql = 'SELECT is_superuser FROM users WHERE id = $1';
        const result = await query(sql, [userId]);
        return result.rows[0]?.is_superuser || false;
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
}

module.exports = UserModel;

