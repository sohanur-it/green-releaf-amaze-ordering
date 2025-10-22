/**
 * Batch Controller
 * 
 * Handles batch status management and promotion operations
 * Provides API endpoints for batch status updates and monitoring
 */

const batchStatusService = require('../Services/batchStatusService');
const inventoryMonitorService = require('../Services/inventoryMonitorService');
const auditLogger = require('../Services/auditLogger');

class BatchController {
    /**
     * Get batch status summary for a product
     * GET /api/batches/product/:productId/summary
     */
    async getBatchSummary(req, res) {
        try {
            const { productId } = req.params;
            
            if (!productId || isNaN(productId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Valid product ID is required'
                });
            }
            
            const summary = await batchStatusService.getBatchStatusSummary(parseInt(productId));
            
            res.json({
                success: true,
                data: summary
            });
            
        } catch (error) {
            console.error('❌ Error getting batch summary:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to get batch summary'
            });
        }
    }

    /**
     * Check if product inventory is depleted
     * GET /api/batches/product/:productId/inventory-status
     */
    async checkInventoryStatus(req, res) {
        try {
            const { productId } = req.params;
            
            if (!productId || isNaN(productId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Valid product ID is required'
                });
            }
            
            const isDepleted = await batchStatusService.isInventoryDepleted(parseInt(productId));
            const onDeckBatches = await batchStatusService.getOnDeckBatches(parseInt(productId));
            
            res.json({
                success: true,
                data: {
                    productId: parseInt(productId),
                    isDepleted,
                    onDeckBatchesCount: onDeckBatches.length,
                    onDeckBatches: onDeckBatches
                }
            });
            
        } catch (error) {
            console.error('❌ Error checking inventory status:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to check inventory status'
            });
        }
    }

    /**
     * Promote On Deck batches to Sellable for a product
     * POST /api/batches/product/:productId/promote
     */
    async promoteBatches(req, res) {
        try {
            const { productId } = req.params;
            const userId = req.user?.id || req.session?.userId;
            
            if (!productId || isNaN(productId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Valid product ID is required'
                });
            }
            
            console.log(`🔄 Promoting batches for product ${productId} (triggered by user ${userId})`);
            
            const result = await batchStatusService.promoteBatchesToSellable(parseInt(productId));
            
            if (result.success) {
                res.json({
                    success: true,
                    message: result.message,
                    data: {
                        productId: parseInt(productId),
                        updatedBatches: result.updatedBatches,
                        batchCount: result.updatedBatches.length
                    }
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: result.error
                });
            }
            
        } catch (error) {
            console.error('❌ Error promoting batches:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to promote batches'
            });
        }
    }

    /**
     * Manually update batch status
     * PUT /api/batches/:batchId/status
     */
    async updateBatchStatus(req, res) {
        try {
            const { batchId } = req.params;
            const { status } = req.body;
            const userId = req.user?.id || req.session?.userId;
            
            if (!batchId || isNaN(batchId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Valid batch ID is required'
                });
            }
            
            if (!status || !['On Deck', 'Sellable', 'On Hold', 'Sold', 'Destroyed'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'Valid status is required (On Deck, Sellable, On Hold, Sold, Destroyed)'
                });
            }
            
            console.log(`🔄 Updating batch ${batchId} status to ${status} (triggered by user ${userId})`);
            
            const result = await batchStatusService.updateBatchStatus(parseInt(batchId), status, userId);
            
            if (result.success) {
                res.json({
                    success: true,
                    message: result.message,
                    data: result.batch
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: result.error
                });
            }
            
        } catch (error) {
            console.error('❌ Error updating batch status:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to update batch status'
            });
        }
    }

    /**
     * Force inventory check for all products
     * POST /api/batches/force-check
     */
    async forceInventoryCheck(req, res) {
        try {
            const userId = req.user?.id || req.session?.userId;
            
            console.log(`🔄 Force inventory check triggered by user ${userId}`);
            
            const result = await batchStatusService.checkAndPromoteAllProducts();
            
            res.json({
                success: true,
                message: 'Inventory check completed',
                data: {
                    totalProducts: result.totalProducts,
                    productsProcessed: result.productsProcessed,
                    totalBatchesPromoted: result.totalBatchesPromoted,
                    results: result.results
                }
            });
            
        } catch (error) {
            console.error('❌ Error in force inventory check:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to perform inventory check'
            });
        }
    }

    /**
     * Get inventory monitoring status
     * GET /api/batches/monitoring-status
     */
    async getMonitoringStatus(req, res) {
        try {
            const status = inventoryMonitorService.getStatus();
            
            res.json({
                success: true,
                data: status
            });
            
        } catch (error) {
            console.error('❌ Error getting monitoring status:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to get monitoring status'
            });
        }
    }

    /**
     * Start inventory monitoring
     * POST /api/batches/start-monitoring
     */
    async startMonitoring(req, res) {
        try {
            const userId = req.user?.id || req.session?.userId;
            
            console.log(`🔄 Starting inventory monitoring (triggered by user ${userId})`);
            
            inventoryMonitorService.start();
            
            // Log the action
            const userText = userId === 'SYSTEM' ? 'System' : `User ID ${userId}`;
            await auditLogger.logAction({
                userId: userId === 'SYSTEM' ? null : userId,
                action: 'inventory_monitoring_started',
                resourceType: 'InventoryMonitor',
                resourceId: 'service',
                details: {
                    message: `${userText} started the inventory monitoring service`,
                    triggered_by: 'manual',
                    user_id: userId
                },
                status: 'success',
                sourceIp: req.ip
            });
            
            res.json({
                success: true,
                message: 'Inventory monitoring started',
                data: inventoryMonitorService.getStatus()
            });
            
        } catch (error) {
            console.error('❌ Error starting monitoring:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to start monitoring'
            });
        }
    }

    /**
     * Stop inventory monitoring
     * POST /api/batches/stop-monitoring
     */
    async stopMonitoring(req, res) {
        try {
            const userId = req.user?.id || req.session?.userId;
            
            console.log(`🔄 Stopping inventory monitoring (triggered by user ${userId})`);
            
            inventoryMonitorService.stop();
            
            // Log the action
            const userText = userId === 'SYSTEM' ? 'System' : `User ID ${userId}`;
            await auditLogger.logAction({
                userId: userId === 'SYSTEM' ? null : userId,
                action: 'inventory_monitoring_stopped',
                resourceType: 'InventoryMonitor',
                resourceId: 'service',
                details: {
                    message: `${userText} stopped the inventory monitoring service`,
                    triggered_by: 'manual',
                    user_id: userId
                },
                status: 'success',
                sourceIp: req.ip
            });
            
            res.json({
                success: true,
                message: 'Inventory monitoring stopped',
                data: inventoryMonitorService.getStatus()
            });
            
        } catch (error) {
            console.error('❌ Error stopping monitoring:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to stop monitoring'
            });
        }
    }

    /**
     * Update monitoring interval
     * PUT /api/batches/monitoring-interval
     */
    async updateMonitoringInterval(req, res) {
        try {
            const { intervalMinutes } = req.body;
            const userId = req.user?.id || req.session?.userId;
            
            if (!intervalMinutes || isNaN(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 60) {
                return res.status(400).json({
                    success: false,
                    error: 'Valid interval (1-60 minutes) is required'
                });
            }
            
            console.log(`🔄 Updating monitoring interval to ${intervalMinutes} minutes (triggered by user ${userId})`);
            
            inventoryMonitorService.updateInterval(parseInt(intervalMinutes));
            
            // Log the action
            const userText = userId === 'SYSTEM' ? 'System' : `User ID ${userId}`;
            const oldInterval = inventoryMonitorService.checkInterval;
            await auditLogger.logAction({
                userId: userId === 'SYSTEM' ? null : userId,
                action: 'inventory_monitoring_interval_updated',
                resourceType: 'InventoryMonitor',
                resourceId: 'service',
                details: {
                    message: `${userText} updated inventory monitoring interval from ${oldInterval} to ${intervalMinutes} minutes`,
                    old_interval: oldInterval,
                    new_interval: intervalMinutes,
                    user_id: userId
                },
                status: 'success',
                sourceIp: req.ip
            });
            
            res.json({
                success: true,
                message: `Monitoring interval updated to ${intervalMinutes} minutes`,
                data: inventoryMonitorService.getStatus()
            });
            
        } catch (error) {
            console.error('❌ Error updating monitoring interval:', error.message);
            res.status(500).json({
                success: false,
                error: 'Failed to update monitoring interval'
            });
        }
    }
}

module.exports = new BatchController();
