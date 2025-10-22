/**
 * Centralized Audit Logger Service
 * 
 * Provides immutable logging for all significant user and system actions
 * Ensures accountability, troubleshooting, security, and compliance
 */

const { Pool } = require('pg');

class AuditLogger {
    constructor() {
        this.pool = new Pool({
            user: process.env.DB_USER || 'postgres',
            host: process.env.DB_HOST || 'localhost',
            database: process.env.DB_DATABASE || 'green_releaf_dev',
            password: process.env.DB_PASSWORD || 'dev_password_123',
            port: parseInt(process.env.DB_PORT, 10) || 5432,
            connectionTimeoutMillis: 5000,  // 5 second connection timeout
            query_timeout: 3000,            // 3 second query timeout
            statement_timeout: 3000,        // 3 second statement timeout
            idle_in_transaction_session_timeout: 10000, // 10 second idle timeout
        });
    }

    /**
     * Log an action to the audit trail
     * 
     * @param {Object} params - Logging parameters
     * @param {number|null} params.userId - User ID (null for system actions)
     * @param {string} params.action - Action performed (e.g., 'order_created', 'batch_status_updated')
     * @param {string} params.resourceType - Type of resource (e.g., 'Order', 'Invoice', 'Batch')
     * @param {string} params.resourceId - ID of the affected resource
     * @param {Object} params.details - Contextual data (before/after values, etc.)
     * @param {string} params.status - 'success' or 'failure'
     * @param {string} params.sourceIp - IP address of the user
     * @returns {Promise<Object>} - Log entry result
     */
    async logAction({
        userId = null,
        action,
        resourceType = null,
        resourceId = null,
        details = null,
        status = 'success',
        sourceIp = null
    }) {
        const client = await this.pool.connect();
        
        try {
            const query = `
                INSERT INTO "ORDERS-audit_log" 
                (user_id, action, resource_type, resource_id, details, status, source_ip)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, timestamp
            `;
            
            const values = [
                userId,
                action,
                resourceType,
                resourceId,
                details ? JSON.stringify(details) : null,
                status,
                sourceIp
            ];
            
            const result = await client.query(query, values);
            
            console.log(`📝 Audit Log: ${action} by user ${userId || 'SYSTEM'} - ${status}`);
            
            return {
                success: true,
                logId: result.rows[0].id,
                timestamp: result.rows[0].timestamp
            };
            
        } catch (error) {
            console.error('❌ Failed to log audit action:', error.message);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Log a system action (automated processes)
     * Non-blocking version - fire and forget to prevent blocking cron jobs
     * 
     * @param {string} action - Action performed
     * @param {string} resourceType - Type of resource
     * @param {string} resourceId - ID of the affected resource
     * @param {Object} details - Contextual data
     * @param {string} status - 'success' or 'failure'
     * @param {boolean} blocking - If true, waits for log to complete (default: false for system actions)
     * @returns {Promise<Object>} - Log entry result
     */
    async logSystemAction(action, resourceType = null, resourceId = null, details = null, status = 'success', blocking = false) {
        const logPromise = this.logAction({
            userId: null, // System action
            action,
            resourceType,
            resourceId,
            details,
            status,
            sourceIp: null
        });

        // For non-blocking (default), fire-and-forget with error catching
        if (!blocking) {
            logPromise.catch(error => {
                console.error(`⚠️ Non-blocking audit log failed (${action}):`, error.message);
            });
            // Return immediately without waiting
            return { success: true, nonBlocking: true };
        }

        // For blocking, wait for completion
        return await logPromise;
    }

    /**
     * Log a user action
     * 
     * @param {number} userId - User ID
     * @param {string} action - Action performed
     * @param {string} resourceType - Type of resource
     * @param {string} resourceId - ID of the affected resource
     * @param {Object} details - Contextual data
     * @param {string} status - 'success' or 'failure'
     * @param {string} sourceIp - IP address of the user
     * @returns {Promise<Object>} - Log entry result
     */
    async logUserAction(userId, action, resourceType = null, resourceId = null, details = null, status = 'success', sourceIp = null) {
        return await this.logAction({
            userId,
            action,
            resourceType,
            resourceId,
            details,
            status,
            sourceIp
        });
    }

    /**
     * Log API request automatically (for middleware)
     * 
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {string} action - Action derived from endpoint
     * @param {Object} beforeData - Data before changes
     * @param {Object} afterData - Data after changes
     * @param {string} status - 'success' or 'failure'
     * @returns {Promise<Object>} - Log entry result
     */
    async logApiRequest(req, res, action, beforeData = null, afterData = null, status = 'success') {
        const userId = req.session?.userId || null;
        
        // Enhanced IP address extraction
        const sourceIp = req.ip || 
                        req.connection?.remoteAddress || 
                        req.socket?.remoteAddress ||
                        (req.connection?.socket ? req.connection.socket.remoteAddress : null) ||
                        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                        req.headers['x-real-ip'] ||
                        req.headers['x-client-ip'] ||
                        'unknown';
        
        // Extract resource info from request
        const resourceType = this.extractResourceType(req.path);
        const resourceId = this.extractResourceId(req.path, req.body, req.params);
        
        // Build details object
        const details = {
            method: req.method,
            path: req.path,
            userAgent: req.get('User-Agent'),
            beforeData,
            afterData,
            changes: this.calculateChanges(beforeData, afterData)
        };
        
        return await this.logUserAction(
            userId,
            action,
            resourceType,
            resourceId,
            details,
            status,
            sourceIp
        );
    }

    /**
     * Extract resource type from API path
     */
    extractResourceType(path) {
        const pathSegments = path.split('/').filter(segment => segment);
        
        if (pathSegments.includes('orders')) return 'Order';
        if (pathSegments.includes('invoices')) return 'Invoice';
        if (pathSegments.includes('batches')) return 'Batch';
        if (pathSegments.includes('manifests')) return 'Manifest';
        if (pathSegments.includes('users')) return 'User';
        if (pathSegments.includes('packages')) return 'Package';
        
        return null;
    }

    /**
     * Extract resource ID from request
     */
    extractResourceId(path, body, params) {
        // Try to get ID from URL parameters first
        if (params.id) return params.id;
        if (params.orderId) return params.orderId;
        if (params.batchId) return params.batchId;
        
        // Try to get ID from request body
        if (body.id) return body.id;
        if (body.orderId) return body.orderId;
        if (body.batchId) return body.batchId;
        
        // Extract from URL path
        const pathSegments = path.split('/').filter(segment => segment);
        const lastSegment = pathSegments[pathSegments.length - 1];
        
        // Check if last segment is a number (likely an ID)
        if (/^\d+$/.test(lastSegment)) {
            return lastSegment;
        }
        
        return null;
    }

    /**
     * Calculate changes between before and after data
     */
    calculateChanges(beforeData, afterData) {
        if (!beforeData || !afterData) return null;
        
        const changes = [];
        
        // Compare each field
        for (const key in afterData) {
            if (beforeData[key] !== afterData[key]) {
                changes.push({
                    field: key,
                    oldValue: beforeData[key],
                    newValue: afterData[key]
                });
            }
        }
        
        return changes.length > 0 ? changes : null;
    }

    /**
     * Get audit log entries with filtering
     * 
     * @param {Object} filters - Filtering options
     * @param {number} limit - Number of entries to return
     * @param {number} offset - Offset for pagination
     * @returns {Promise<Array>} - Audit log entries
     */
    async getAuditLog(filters = {}, limit = 100, offset = 0) {
        const client = await this.pool.connect();
        
        try {
            let query = `
                SELECT 
                    al.id,
                    al.user_id,
                    u.username,
                    u.first_name as firstname,
                    u.last_name as lastname,
                    al.action,
                    al.resource_type,
                    al.resource_id,
                    al.details,
                    al.status,
                    al.source_ip,
                    al.timestamp
                FROM "ORDERS-audit_log" al
                LEFT JOIN users u ON al.user_id = u.id
                WHERE 1=1
            `;
            
            const values = [];
            let paramCount = 0;
            
            // Add filters
            if (filters.userId) {
                paramCount++;
                query += ` AND al.user_id = $${paramCount}`;
                values.push(filters.userId);
            }
            
            if (filters.action) {
                paramCount++;
                query += ` AND al.action = $${paramCount}`;
                values.push(filters.action);
            }
            
            if (filters.resourceType) {
                paramCount++;
                query += ` AND al.resource_type = $${paramCount}`;
                values.push(filters.resourceType);
            }
            
            if (filters.resourceId) {
                paramCount++;
                query += ` AND al.resource_id = $${paramCount}`;
                values.push(filters.resourceId);
            }
            
            if (filters.status) {
                paramCount++;
                query += ` AND al.status = $${paramCount}`;
                values.push(filters.status);
            }
            
            if (filters.startDate) {
                paramCount++;
                query += ` AND al.timestamp >= $${paramCount}`;
                values.push(filters.startDate);
            }
            
            if (filters.endDate) {
                paramCount++;
                query += ` AND al.timestamp <= $${paramCount}`;
                values.push(filters.endDate);
            }
            
            // Add ordering and pagination
            query += ` ORDER BY al.timestamp DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
            values.push(limit, offset);
            
            const result = await client.query(query, values);
            
            return result.rows.map(row => ({
                ...row,
                details: row.details ? JSON.parse(row.details) : null
            }));
            
        } catch (error) {
            console.error('❌ Failed to get audit log:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Close database connection
     */
    async close() {
        await this.pool.end();
    }

    /**
     * Get audit logs with filtering and pagination
     */
    async getLogs(filters = {}) {
        const client = await this.pool.connect();
        
        try {
            let query = `
                SELECT 
                    al.id,
                    al.user_id,
                    u.username,
                    u.first_name as firstname,
                    u.last_name as lastname,
                    al.action,
                    al.resource_type,
                    al.resource_id,
                    al.details,
                    al.status,
                    al.source_ip,
                    al.timestamp
                FROM "ORDERS-audit_log" al
                LEFT JOIN users u ON al.user_id = u.id
                WHERE 1=1
            `;
            
            const values = [];
            let paramCount = 0;
            
            // Add filters
            if (filters.userId) {
                paramCount++;
                query += ` AND al.user_id = $${paramCount}`;
                values.push(filters.userId);
            }
            
            if (filters.action) {
                paramCount++;
                query += ` AND al.action = $${paramCount}`;
                values.push(filters.action);
            }
            
            if (filters.resourceType) {
                paramCount++;
                query += ` AND al.resource_type = $${paramCount}`;
                values.push(filters.resourceType);
            }
            
            if (filters.status) {
                paramCount++;
                query += ` AND al.status = $${paramCount}`;
                values.push(filters.status);
            }
            
            if (filters.startDate) {
                paramCount++;
                query += ` AND al.timestamp >= $${paramCount}`;
                values.push(filters.startDate);
            }
            
            if (filters.endDate) {
                paramCount++;
                query += ` AND al.timestamp <= $${paramCount}`;
                values.push(filters.endDate);
            }
            
            // Add ordering and pagination
            query += ` ORDER BY al.timestamp DESC`;
            
            if (filters.limit) {
                paramCount++;
                query += ` LIMIT $${paramCount}`;
                values.push(filters.limit);
            }
            
            if (filters.offset) {
                paramCount++;
                query += ` OFFSET $${paramCount}`;
                values.push(filters.offset);
            }
            
            const result = await client.query(query, values);
            
            return result.rows.map(row => ({
                id: row.id,
                userId: row.user_id,
                username: row.username,
                userFullName: row.firstname && row.lastname ? `${row.firstname} ${row.lastname}` : null,
                action: row.action,
                resourceType: row.resource_type,
                resourceId: row.resource_id,
                details: row.details ? (typeof row.details === 'string' ? JSON.parse(row.details) : row.details) : null,
                status: row.status,
                sourceIp: row.source_ip,
                timestamp: row.timestamp
            }));
            
        } catch (error) {
            console.error('❌ Failed to get audit logs:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get total count of audit logs with filters
     */
    async getLogCount(filters = {}) {
        const client = await this.pool.connect();
        
        try {
            let query = `SELECT COUNT(*) FROM "ORDERS-audit_log" WHERE 1=1`;
            const values = [];
            let paramCount = 0;
            
            // Add same filters as getLogs
            if (filters.userId) {
                paramCount++;
                query += ` AND user_id = $${paramCount}`;
                values.push(filters.userId);
            }
            
            if (filters.action) {
                paramCount++;
                query += ` AND action = $${paramCount}`;
                values.push(filters.action);
            }
            
            if (filters.resourceType) {
                paramCount++;
                query += ` AND resource_type = $${paramCount}`;
                values.push(filters.resourceType);
            }
            
            if (filters.status) {
                paramCount++;
                query += ` AND status = $${paramCount}`;
                values.push(filters.status);
            }
            
            if (filters.startDate) {
                paramCount++;
                query += ` AND timestamp >= $${paramCount}`;
                values.push(filters.startDate);
            }
            
            if (filters.endDate) {
                paramCount++;
                query += ` AND timestamp <= $${paramCount}`;
                values.push(filters.endDate);
            }
            
            const result = await client.query(query, values);
            return parseInt(result.rows[0].count);
            
        } catch (error) {
            console.error('❌ Failed to get audit log count:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get audit log statistics
     */
    async getStats() {
        const client = await this.pool.connect();
        
        try {
            // Total logs
            const totalResult = await client.query('SELECT COUNT(*) FROM "ORDERS-audit_log"');
            const totalLogs = parseInt(totalResult.rows[0].count);
            
            // Logs by status
            const statusResult = await client.query(`
                SELECT status, COUNT(*) as count 
                FROM "ORDERS-audit_log" 
                GROUP BY status
            `);
            
            // Logs by action (top 10)
            const actionResult = await client.query(`
                SELECT action, COUNT(*) as count 
                FROM "ORDERS-audit_log" 
                GROUP BY action 
                ORDER BY count DESC 
                LIMIT 10
            `);
            
            // Logs by user (top 10)
            const userResult = await client.query(`
                SELECT u.username, u.first_name as firstname, u.last_name as lastname, COUNT(*) as count 
                FROM "ORDERS-audit_log" al
                LEFT JOIN users u ON al.user_id = u.id
                GROUP BY u.username, u.first_name, u.last_name
                ORDER BY count DESC 
                LIMIT 10
            `);
            
            // Logs by day (last 30 days)
            const dailyResult = await client.query(`
                SELECT DATE(timestamp) as date, COUNT(*) as count 
                FROM "ORDERS-audit_log" 
                WHERE timestamp >= NOW() - INTERVAL '30 days'
                GROUP BY DATE(timestamp) 
                ORDER BY date DESC
            `);
            
            return {
                totalLogs,
                statusBreakdown: statusResult.rows,
                topActions: actionResult.rows,
                topUsers: userResult.rows,
                dailyActivity: dailyResult.rows
            };
            
        } catch (error) {
            console.error('❌ Failed to get audit stats:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get filter options for the UI
     */
    async getFilterOptions() {
        const client = await this.pool.connect();
        
        try {
            // Get unique actions
            const actionResult = await client.query(`
                SELECT DISTINCT action 
                FROM "ORDERS-audit_log" 
                ORDER BY action
            `);
            
            // Get unique resource types
            const resourceResult = await client.query(`
                SELECT DISTINCT resource_type 
                FROM "ORDERS-audit_log" 
                WHERE resource_type IS NOT NULL
                ORDER BY resource_type
            `);
            
            // Get unique statuses
            const statusResult = await client.query(`
                SELECT DISTINCT status 
                FROM "ORDERS-audit_log" 
                ORDER BY status
            `);
            
            // Get users who have performed actions
            const userResult = await client.query(`
                SELECT DISTINCT u.id, u.username, u.first_name as firstname, u.last_name as lastname
                FROM "ORDERS-audit_log" al
                JOIN users u ON al.user_id = u.id
                ORDER BY u.username
            `);
            
            return {
                actions: actionResult.rows.map(r => r.action),
                resourceTypes: resourceResult.rows.map(r => r.resource_type),
                statuses: statusResult.rows.map(r => r.status),
                users: userResult.rows.map(r => ({
                    id: r.id,
                    username: r.username,
                    fullName: r.firstname && r.lastname ? `${r.firstname} ${r.lastname}` : r.username
                }))
            };
            
        } catch (error) {
            console.error('❌ Failed to get filter options:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get individual audit log details by ID
     */
    async getLogById(logId) {
        const client = await this.pool.connect();
        
        try {
            const query = `
                SELECT 
                    al.id,
                    al.user_id,
                    u.username,
                    u.first_name as firstname,
                    u.last_name as lastname,
                    al.action,
                    al.resource_type,
                    al.resource_id,
                    al.details,
                    al.status,
                    al.source_ip,
                    al.timestamp
                FROM "ORDERS-audit_log" al
                LEFT JOIN users u ON al.user_id = u.id
                WHERE al.id = $1
            `;
            
            const result = await client.query(query, [logId]);
            
            if (result.rows.length === 0) {
                return null;
            }
            
            const row = result.rows[0];
            return {
                id: row.id,
                userId: row.user_id,
                username: row.username,
                userFullName: row.firstname && row.lastname ? `${row.firstname} ${row.lastname}` : null,
                action: row.action,
                resourceType: row.resource_type,
                resourceId: row.resource_id,
                details: row.details ? (typeof row.details === 'string' ? JSON.parse(row.details) : row.details) : null,
                status: row.status,
                sourceIp: row.source_ip,
                timestamp: row.timestamp
            };
            
        } catch (error) {
            console.error('❌ Failed to get audit log by ID:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

}

// Export singleton instance
module.exports = new AuditLogger();
