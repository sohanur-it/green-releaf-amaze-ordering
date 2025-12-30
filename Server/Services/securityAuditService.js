// Server/Services/securityAuditService.js
// Module 14.4: Security Audit Logging

const { pool } = require('../config/database');

class SecurityAuditService {
    /**
     * Log failed login attempt
     */
    async logFailedLogin(username, ipAddress, reason = 'invalid_credentials') {
        const client = await pool.connect();
        
        try {
            await client.query(`
                INSERT INTO "ORDERS-security_audit_log"
                (event_type, username, ip_address, details, severity)
                VALUES ($1, $2, $3, $4, $5)
            `, [
                'failed_login',
                username,
                ipAddress,
                JSON.stringify({ reason }),
                'medium'
            ]);
        } catch (error) {
            console.error('Error logging failed login:', error);
        } finally {
            client.release();
        }
    }

    /**
     * Log unauthorized access attempt
     */
    async logUnauthorizedAccess(userId, username, resource, ipAddress, details = {}) {
        const client = await pool.connect();
        
        try {
            await client.query(`
                INSERT INTO "ORDERS-security_audit_log"
                (event_type, user_id, username, resource, ip_address, details, severity)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                'unauthorized_access',
                userId,
                username,
                resource,
                ipAddress,
                JSON.stringify(details),
                'high'
            ]);
        } catch (error) {
            console.error('Error logging unauthorized access:', error);
        } finally {
            client.release();
        }
    }

    /**
     * Log permission change
     */
    async logPermissionChange(changedByUserId, targetUserId, changes, ipAddress) {
        const client = await pool.connect();
        
        try {
            await client.query(`
                INSERT INTO "ORDERS-security_audit_log"
                (event_type, user_id, username, resource, ip_address, details, severity)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                'permission_change',
                changedByUserId,
                null, // Will be populated from user lookup if needed
                `user_${targetUserId}`,
                ipAddress,
                JSON.stringify({ target_user_id: targetUserId, changes }),
                'high'
            ]);
        } catch (error) {
            console.error('Error logging permission change:', error);
        } finally {
            client.release();
        }
    }

    /**
     * Get recent security events
     */
    async getRecentSecurityEvents(limit = 100) {
        const client = await pool.connect();
        
        try {
            const result = await client.query(`
                SELECT *
                FROM "ORDERS-security_audit_log"
                ORDER BY created_at DESC
                LIMIT $1
            `, [limit]);
            
            return result.rows;
        } catch (error) {
            console.error('Error fetching security events:', error);
            return [];
        } finally {
            client.release();
        }
    }
}

module.exports = new SecurityAuditService();



