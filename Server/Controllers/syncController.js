/**
 * Sync Controller
 * 
 * Handles on-demand sync operations via API endpoints
 * Provides admin interface for triggering sync services
 */

const scheduler = require('../../scripts/sync/master-scheduler');
const metrcAuth = require('../Services/metrcAuth');

class SyncController {
    /**
     * Get sync status and scheduler information
     */
    async getStatus(req, res) {
        try {
            const status = scheduler.getStatus();
            const authStatus = metrcAuth.getTokenStatus();
            
            res.json({
                success: true,
                data: {
                    scheduler: status,
                    authentication: authStatus,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error('❌ Error getting sync status:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to get sync status',
                message: error.message
            });
        }
    }

    /**
     * Trigger a specific sync service
     */
    async triggerSync(req, res) {
        try {
            const { serviceName } = req.params;
            
            // Validate service name
            const validServices = ['active', 'transferred', 'intransit', 'outgoing', 'items', 'strains'];
            if (!validServices.includes(serviceName)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid service name',
                    message: `Valid services: ${validServices.join(', ')}`
                });
            }

            console.log(`🔄 Admin triggered ${serviceName} sync`);
            
            // Run the sync service
            await scheduler.runSyncService(serviceName);
            
            res.json({
                success: true,
                message: `${serviceName} sync completed successfully`,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error(`❌ Error triggering ${req.params.serviceName} sync:`, error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to trigger sync',
                message: error.message
            });
        }
    }

    /**
     * Trigger all sync services
     */
    async triggerAllSyncs(req, res) {
        try {
            console.log('🔄 Admin triggered all syncs');
            
            // Run all sync services
            await scheduler.runAllSyncServices();
            
            res.json({
                success: true,
                message: 'All sync services completed successfully',
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Error triggering all syncs:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to trigger all syncs',
                message: error.message
            });
        }
    }

    /**
     * Start the scheduler
     */
    async startScheduler(req, res) {
        try {
            if (scheduler.isRunning) {
                return res.status(400).json({
                    success: false,
                    error: 'Scheduler is already running'
                });
            }

            scheduler.start();
            
            res.json({
                success: true,
                message: 'Scheduler started successfully',
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Error starting scheduler:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to start scheduler',
                message: error.message
            });
        }
    }

    /**
     * Stop the scheduler
     */
    async stopScheduler(req, res) {
        try {
            if (!scheduler.isRunning) {
                return res.status(400).json({
                    success: false,
                    error: 'Scheduler is not running'
                });
            }

            scheduler.stop();
            
            res.json({
                success: true,
                message: 'Scheduler stopped successfully',
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Error stopping scheduler:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to stop scheduler',
                message: error.message
            });
        }
    }

    /**
     * Refresh METRC authentication tokens
     */
    async refreshAuth(req, res) {
        try {
            console.log('🔄 Admin triggered auth refresh');
            
            // Clear existing tokens and re-authenticate
            await metrcAuth.clearTokens();
            await metrcAuth.authenticateWithCredentials();
            
            res.json({
                success: true,
                message: 'Authentication refreshed successfully',
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Error refreshing auth:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to refresh authentication',
                message: error.message
            });
        }
    }

    /**
     * Get sync history/logs
     */
    async getSyncHistory(req, res) {
        try {
            const status = scheduler.getStatus();
            
            // Format sync history
            const history = Object.entries(status.syncStatus).map(([service, data]) => ({
                service,
                lastRun: data.lastRun,
                lastSuccess: data.lastSuccess,
                status: data.status,
                duration: data.duration,
                error: data.error
            }));

            res.json({
                success: true,
                data: {
                    history,
                    totalServices: Object.keys(status.syncStatus).length,
                    timestamp: new Date().toISOString()
                }
            });
            
        } catch (error) {
            console.error('❌ Error getting sync history:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to get sync history',
                message: error.message
            });
        }
    }
}

module.exports = new SyncController();
