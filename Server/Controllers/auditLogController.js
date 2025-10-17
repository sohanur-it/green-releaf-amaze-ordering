/**
 * Audit Log Controller
 * 
 * Handles audit log viewing and filtering
 */

const auditLogger = require('../Services/auditLogger');

class AuditLogController {
    /**
     * Get audit logs with filtering
     * GET /api/v1/admin/audit-logs
     */
    async getAuditLogs(req, res) {
        try {
            const {
                page = 1,
                limit = 50,
                userId = null,
                action = null,
                resourceType = null,
                status = null,
                startDate = null,
                endDate = null
            } = req.query;

            const offset = (page - 1) * limit;
            
            const logs = await auditLogger.getLogs({
                userId: userId ? parseInt(userId) : null,
                action,
                resourceType,
                status,
                startDate,
                endDate,
                limit: parseInt(limit),
                offset
            });

            const totalCount = await auditLogger.getLogCount({
                userId: userId ? parseInt(userId) : null,
                action,
                resourceType,
                status,
                startDate,
                endDate
            });

            res.json({
                success: true,
                data: {
                    logs,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total: totalCount,
                        pages: Math.ceil(totalCount / limit)
                    }
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error getting audit logs:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get audit logs',
                message: error.message
            });
        }
    }

    /**
     * Get audit log statistics
     * GET /api/v1/admin/audit-logs/stats
     */
    async getAuditStats(req, res) {
        try {
            const stats = await auditLogger.getStats();
            
            res.json({
                success: true,
                data: stats,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error getting audit stats:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get audit statistics',
                message: error.message
            });
        }
    }

    /**
     * Get unique values for filters
     * GET /api/v1/admin/audit-logs/filters
     */
    async getFilterOptions(req, res) {
        try {
            const filters = await auditLogger.getFilterOptions();
            
            res.json({
                success: true,
                data: filters,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error getting filter options:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get filter options',
                message: error.message
            });
        }
    }
}

module.exports = new AuditLogController();
