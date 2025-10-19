/**
 * Inventory Monitor Service
 * 
 * Monitors inventory levels and triggers batch promotions
 * Runs as a background service to check for depleted sellable inventory
 */

const cron = require('node-cron');
const batchStatusService = require('./batchStatusService');
const auditLogger = require('./auditLogger');

class InventoryMonitorService {
    constructor() {
        this.isRunning = false;
        this.monitoringInterval = null;
        this.lastCheckTime = null;
        this.checkInterval = 5; // Check every 5 minutes
    }

    /**
     * Start the inventory monitoring service
     */
    start() {
        if (this.isRunning) {
            console.log('⚠️ Inventory monitoring is already running');
            return;
        }

        console.log('🚀 Starting inventory monitoring service...');
        
        // Schedule monitoring every 5 minutes during business hours (8 AM - 6 PM, weekdays)
        this.monitoringInterval = cron.schedule(`*/${this.checkInterval} 8-18 * * 1-5`, async () => {
            await this.checkInventoryLevels();
        }, {
            scheduled: false,
            timezone: "America/Chicago"
        });

        this.monitoringInterval.start();
        this.isRunning = true;
        
        console.log(`✅ Inventory monitoring started (every ${this.checkInterval} minutes during business hours)`);
        
        // Log service start
        auditLogger.logSystemAction(
            'inventory_monitor_started',
            'InventoryMonitor',
            'service',
            {
                check_interval_minutes: this.checkInterval,
                business_hours: '8 AM - 6 PM, weekdays'
            },
            'success'
        );
    }

    /**
     * Stop the inventory monitoring service
     */
    stop() {
        if (!this.isRunning) {
            console.log('⚠️ Inventory monitoring is not running');
            return;
        }

        if (this.monitoringInterval) {
            this.monitoringInterval.stop();
            this.monitoringInterval = null;
        }

        this.isRunning = false;
        console.log('🛑 Inventory monitoring stopped');
        
        // Log service stop
        auditLogger.logSystemAction(
            'inventory_monitor_stopped',
            'InventoryMonitor',
            'service',
            {
                last_check_time: this.lastCheckTime
            },
            'success'
        );
    }

    /**
     * Check inventory levels for all products
     */
    async checkInventoryLevels() {
        const startTime = new Date();
        this.lastCheckTime = startTime;
        
        console.log('🔍 Checking inventory levels...');
        
        try {
            const result = await batchStatusService.checkAndPromoteAllProducts();
            
            const duration = Date.now() - startTime.getTime();
            
            if (result.success) {
                console.log(`✅ Inventory check completed in ${duration}ms`);
                console.log(`📊 Processed ${result.totalProducts} products, promoted ${result.totalBatchesPromoted} batches`);
                
                // Log successful monitoring cycle
                auditLogger.logSystemAction(
                    'inventory_monitor_cycle_completed',
                    'InventoryMonitor',
                    'service',
                    {
                        duration_ms: duration,
                        total_products: result.totalProducts,
                        products_processed: result.productsProcessed,
                        total_batches_promoted: result.totalBatchesPromoted,
                        check_time: startTime.toISOString()
                    },
                    'success'
                );
            } else {
                console.error('❌ Inventory check failed:', result.error);
                
                // Log failed monitoring cycle
                auditLogger.logSystemAction(
                    'inventory_monitor_cycle_failed',
                    'InventoryMonitor',
                    'service',
                    {
                        duration_ms: duration,
                        error: result.error,
                        check_time: startTime.toISOString()
                    },
                    'failure'
                );
            }
            
        } catch (error) {
            const duration = Date.now() - startTime.getTime();
            console.error('❌ Error in inventory monitoring:', error.message);
            
            // Log error
            auditLogger.logSystemAction(
                'inventory_monitor_error',
                'InventoryMonitor',
                'service',
                {
                    duration_ms: duration,
                    error: error.message,
                    check_time: startTime.toISOString()
                },
                'failure'
            );
        }
    }

    /**
     * Get monitoring status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            lastCheckTime: this.lastCheckTime,
            checkInterval: this.checkInterval,
            nextCheckTime: this.isRunning ? this.getNextCheckTime() : null
        };
    }

    /**
     * Get next scheduled check time
     */
    getNextCheckTime() {
        if (!this.isRunning) return null;
        
        const now = new Date();
        const nextCheck = new Date(now.getTime() + (this.checkInterval * 60 * 1000));
        
        // If next check is outside business hours, move to next business day
        const hour = nextCheck.getHours();
        const day = nextCheck.getDay();
        
        if (hour < 8 || hour >= 18 || day === 0 || day === 6) {
            // Move to next business day at 8 AM
            const nextBusinessDay = new Date(nextCheck);
            nextBusinessDay.setHours(8, 0, 0, 0);
            
            // Skip weekends
            while (nextBusinessDay.getDay() === 0 || nextBusinessDay.getDay() === 6) {
                nextBusinessDay.setDate(nextBusinessDay.getDate() + 1);
            }
            
            return nextBusinessDay;
        }
        
        return nextCheck;
    }

    /**
     * Force an immediate inventory check (for manual triggers)
     */
    async forceCheck() {
        console.log('🔄 Force checking inventory levels...');
        await this.checkInventoryLevels();
    }

    /**
     * Update monitoring interval
     * @param {number} intervalMinutes - New interval in minutes
     */
    updateInterval(intervalMinutes) {
        if (intervalMinutes < 1 || intervalMinutes > 60) {
            throw new Error('Interval must be between 1 and 60 minutes');
        }
        
        const wasRunning = this.isRunning;
        
        if (wasRunning) {
            this.stop();
        }
        
        this.checkInterval = intervalMinutes;
        
        if (wasRunning) {
            this.start();
        }
        
        console.log(`⚙️ Monitoring interval updated to ${intervalMinutes} minutes`);
    }
}

module.exports = new InventoryMonitorService();
