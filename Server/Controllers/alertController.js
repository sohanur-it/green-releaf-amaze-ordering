/**
 * Alert Controller
 * Handles sync failure alerts for the audit log page
 */

const syncFailureTracker = require('../Services/syncFailureTracker');

class AlertController {
    /**
     * Get all active alerts for display on audit log page
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    async getAlerts(req, res) {
        try {
            const alerts = await syncFailureTracker.getAllAlerts();
            
            res.json({
                success: true,
                alerts: alerts,
                totalAlerts: alerts.length,
                criticalCount: alerts.filter(a => a.level === 'critical').length,
                warningCount: alerts.filter(a => a.level === 'warning').length
            });

        } catch (error) {
            console.error('❌ Error getting alerts:', error.message);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve alerts',
                error: error.message
            });
        }
    }

    /**
     * Get alert statistics for dashboard
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    async getAlertStats(req, res) {
        try {
            const stats = await syncFailureTracker.getFailureStats();
            
            res.json({
                success: true,
                stats: stats
            });

        } catch (error) {
            console.error('❌ Error getting alert stats:', error.message);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve alert statistics',
                error: error.message
            });
        }
    }

    /**
     * Get alert level for a specific script
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    async getScriptAlert(req, res) {
        try {
            const { scriptName, licenseNumber } = req.params;
            const alert = await syncFailureTracker.getAlertLevel(scriptName, licenseNumber);
            
            res.json({
                success: true,
                alert: alert
            });

        } catch (error) {
            console.error('❌ Error getting script alert:', error.message);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve script alert',
                error: error.message
            });
        }
    }

    /**
     * Manually reset failure count for a script (admin action)
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    async resetFailureCount(req, res) {
        try {
            const { scriptName, licenseNumber } = req.body;
            
            if (!scriptName) {
                return res.status(400).json({
                    success: false,
                    message: 'Script name is required'
                });
            }

            await syncFailureTracker.recordSuccess(scriptName, licenseNumber || 'CUL000063');
            
            res.json({
                success: true,
                message: `Failure count reset for ${scriptName}`
            });

        } catch (error) {
            console.error('❌ Error resetting failure count:', error.message);
            res.status(500).json({
                success: false,
                message: 'Failed to reset failure count',
                error: error.message
            });
        }
    }
}

module.exports = new AlertController();
