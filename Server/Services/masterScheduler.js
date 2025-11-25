/**
 * Master Scheduler Service
 * 
 * Manages all METRC sync jobs using node-cron
 * Implements business hours scheduling (8 AM - 6 PM weekdays)
 */

const cron = require('node-cron');
const { exec } = require('child_process');
const { promisify } = require('util');
const auditLogger = require('./auditLogger');
const cartCleanupService = require('./cartCleanupService');
const dealFlowAutomationService = require('./dealFlowAutomationService');
const batchStatusService = require('./batchStatusService');
const scanningSessionService = require('./scanningSessionService');

const execAsync = promisify(exec);

class MasterScheduler {
    constructor() {
        this.jobs = new Map();
        this.isRunning = false;
        this.jobHistory = [];
        this.maxHistorySize = 100;
        
        // Define all sync jobs with their schedules
        this.syncJobs = [
            {
                name: 'activePackages',
                description: 'Active Packages Sync (Full Mirror)',
                schedule: '*/10 8-18 * * 1-5', // Every 10 minutes, 8 AM - 6 PM, weekdays
                script: 'sync:active:prod',
                enabled: true,
                lastRun: null,
                nextRun: null,
                status: 'idle'
            },
            {
                name: 'outgoingTransfers',
                description: 'Outgoing Transfers Sync (Incremental)',
                schedule: '*/5 8-18 * * 1-5', // Every 5 minutes, 8 AM - 6 PM, weekdays
                script: 'sync:outgoing:prod',
                enabled: true,
                lastRun: null,
                nextRun: null,
                status: 'idle'
            },
            {
                name: 'intransitPackages',
                description: 'In-Transit Packages Sync (Full Mirror)',
                schedule: '*/5 8-18 * * 1-5', // Every 5 minutes, 8 AM - 6 PM, weekdays
                script: 'sync:intransit:prod',
                enabled: true,
                lastRun: null,
                nextRun: null,
                status: 'idle'
            },
            {
                name: 'transferredPackages',
                description: 'Transferred Packages Sync (Incremental)',
                schedule: '0 8-18 * * 1-5', // Every hour at :00, 8 AM - 6 PM, weekdays
                script: 'sync:transferred:prod',
                enabled: true,
                lastRun: null,
                nextRun: null,
                status: 'idle'
            },
            {
                name: 'strains',
                description: 'Strains Sync (Incremental)',
                schedule: '30 8-18 * * 1-5', // Every hour at :30, 8 AM - 6 PM, weekdays
                script: 'sync:strains:prod',
                enabled: true,
                lastRun: null,
                nextRun: null,
                status: 'idle'
            },
            {
                name: 'items',
                description: 'Items Sync (Incremental)',
                schedule: '0 8-18 * * 1-5', // Every hour, 8 AM - 6 PM, weekdays
                script: 'sync:items:prod',
                enabled: true,
                lastRun: null,
                nextRun: null,
                status: 'idle'
            },
            {
                name: 'batches',
                description: 'Batch Sync (Module 3)',
                schedule: '*/15 8-18 * * 1-5', // Every 15 minutes, 8 AM - 6 PM, weekdays
                script: 'sync:batches:prod',
                enabled: true,
                lastRun: null,
                nextRun: null,
                status: 'idle'
            }
        ];
    }

    /**
     * Start the master scheduler
     */
    async start() {
        if (this.isRunning) {
            console.log('⚠️ Master scheduler is already running');
            return;
        }

        const timezone = process.env.SYNC_TIMEZONE || 'America/Chicago';
        const nowInTz = new Date().toLocaleString('en-US', { 
            timeZone: timezone,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'long'
        });
        console.log('🚀 Starting Master Scheduler...');
        console.log(`📅 Using timezone: ${timezone}`);
        console.log(`⏰ Current time in ${timezone}: ${nowInTz}`);
        console.log(`📋 Business hours: 8:00 AM - 6:00 PM (Monday-Friday) in ${timezone}`);
        
        // Schedule all enabled jobs
        let scheduledCount = 0;
        for (const job of this.syncJobs) {
            if (job.enabled) {
                await this.scheduleJob(job);
                scheduledCount++;
            }
        }

        // Schedule cart cleanup job (every 5 minutes, 24/7) - more frequent for immediate cleanup
        const cartCleanupJob = cron.schedule('*/5 * * * *', async () => {
            try {
                console.log('🧹 Running cart cleanup job...');
                const result = await cartCleanupService.cleanupExpiredCarts();
                if (result.success) {
                    console.log(`✅ Cart cleanup completed: ${result.cleaned} cleaned, ${result.failed} failed`);
                } else {
                    console.error('❌ Cart cleanup job failed:', result.error);
                }
            } catch (error) {
                console.error('❌ Cart cleanup job error:', error.message);
            }
        }, {
            scheduled: true,
            timezone: process.env.SYNC_TIMEZONE || 'America/Chicago'
        });

        this.jobs.set('cartCleanup', cartCleanupJob);
        scheduledCount++;
        console.log('📅 Scheduled cart cleanup job (every 10 minutes)');

        // Schedule deal flow automation job (daily at 2 AM)
        const dealFlowJob = cron.schedule('0 2 * * *', async () => {
            try {
                console.log('🔄 Running deal flow automation job...');
                const result = await dealFlowAutomationService.batchUpdateAllBuyers();
                if (result.success) {
                    console.log(`✅ Deal flow automation completed: ${result.updated} updated, ${result.unchanged} unchanged`);
                } else {
                    console.error('❌ Deal flow automation job failed:', result.error);
                }
            } catch (error) {
                console.error('❌ Deal flow automation job error:', error.message);
            }
        }, {
            scheduled: true,
            timezone: process.env.SYNC_TIMEZONE || 'America/Chicago'
        });

        this.jobs.set('dealFlowAutomation', dealFlowJob);
        scheduledCount++;
        console.log('📅 Scheduled deal flow automation job (daily at 2 AM)');

        // Schedule batch auto-promotion job (every 15 minutes during business hours)
        const batchPromotionJob = cron.schedule('*/15 8-18 * * 1-5', async () => {
            try {
                console.log('🔄 [SCHEDULER] Running scheduled batch auto-promotion job...');
                console.log('🔄 [SCHEDULER] Current time:', new Date().toISOString());
                const result = await batchStatusService.checkAndPromoteAllProducts();
                if (result.success) {
                    console.log(`✅ [SCHEDULER] Batch auto-promotion completed: ${result.totalBatchesPromoted} batches promoted across ${result.productsProcessed} products`);
                    console.log(`📊 [SCHEDULER] Promotion details:`, {
                        totalProducts: result.totalProducts,
                        productsProcessed: result.productsProcessed,
                        totalBatchesPromoted: result.totalBatchesPromoted
                    });
                } else {
                    console.error('❌ [SCHEDULER] Batch auto-promotion job failed:', result.error);
                }
            } catch (error) {
                console.error('❌ [SCHEDULER] Batch auto-promotion job error:', error.message);
                console.error('❌ [SCHEDULER] Error stack:', error.stack);
            }
        }, {
            scheduled: true,
            timezone: process.env.SYNC_TIMEZONE || 'America/Chicago'
        });

        this.jobs.set('batchAutoPromotion', batchPromotionJob);
        scheduledCount++;
        console.log('📅 Scheduled batch auto-promotion job (every 15 minutes during business hours)');

        // Schedule scanning session auto-abandon job (every 10 minutes, 24/7)
        const sessionAbandonJob = cron.schedule('*/10 * * * *', async () => {
            try {
                console.log('🧹 Running scanning session auto-abandon job...');
                const result = await scanningSessionService.abandonInactiveSessions();
                if (result.abandoned > 0) {
                    console.log(`✅ Session auto-abandon completed: ${result.abandoned} sessions abandoned`);
                }
            } catch (error) {
                console.error('❌ Session auto-abandon job error:', error.message);
            }
        }, {
            scheduled: true,
            timezone: process.env.SYNC_TIMEZONE || 'America/Chicago'
        });

        this.jobs.set('sessionAutoAbandon', sessionAbandonJob);
        scheduledCount++;
        console.log('📅 Scheduled scanning session auto-abandon job (every 10 minutes)');

        // Schedule manifest status tracking job (every 15 minutes, 24/7)
        const manifestStatusTrackingService = require('./manifestStatusTrackingService');
        const manifestStatusJob = cron.schedule('*/15 * * * *', async () => {
            try {
                console.log('📊 Running manifest status tracking job...');
                const result = await manifestStatusTrackingService.syncManifestStatuses();
                if (result.success) {
                    console.log(`✅ Manifest status sync completed: ${result.synced} synced, ${result.errors} errors`);
                } else {
                    console.error(`❌ Manifest status sync failed: ${result.error}`);
                }
            } catch (error) {
                console.error('❌ Manifest status tracking job error:', error.message);
            }
        }, {
            scheduled: true,
            timezone: process.env.SYNC_TIMEZONE || 'America/Chicago'
        });

        this.jobs.set('manifestStatusTracking', manifestStatusJob);
        scheduledCount++;
        console.log('📅 Scheduled manifest status tracking job (every 15 minutes)');

        // Run batch promotion immediately on startup
        try {
            console.log('🚀 [SCHEDULER] Running initial batch promotion check on startup...');
            console.log('🚀 [SCHEDULER] Startup time:', new Date().toISOString());
            const initialResult = await batchStatusService.checkAndPromoteAllProducts();
            if (initialResult.success) {
                if (initialResult.totalBatchesPromoted > 0) {
                    console.log(`✅ [SCHEDULER] Initial batch promotion completed: ${initialResult.totalBatchesPromoted} batches promoted across ${initialResult.productsProcessed} products`);
                    console.log(`📊 [SCHEDULER] Initial promotion details:`, {
                        totalProducts: initialResult.totalProducts,
                        productsProcessed: initialResult.productsProcessed,
                        totalBatchesPromoted: initialResult.totalBatchesPromoted
                    });
                } else {
                    console.log(`ℹ️ [SCHEDULER] Initial batch promotion: No batches needed promotion (${initialResult.totalProducts} products checked)`);
                }
            } else {
                console.log(`ℹ️ [SCHEDULER] Initial batch promotion: ${initialResult.error || 'No batches needed promotion'}`);
            }
        } catch (startupError) {
            console.error('⚠️ [SCHEDULER] Error during initial batch promotion on startup:', startupError.message);
            console.error('⚠️ [SCHEDULER] Error stack:', startupError.stack);
            // Don't fail startup if promotion fails
        }

        // Run all sync jobs immediately on startup (don't wait for cron schedules)
        console.log('🚀 [SCHEDULER] Running all sync jobs immediately on startup...');
        const startupSyncPromises = [];
        for (const job of this.syncJobs) {
            if (job.enabled) {
                console.log(`🚀 [SCHEDULER] Starting immediate sync: ${job.name} - ${job.description}`);
                // Run each sync job asynchronously (don't block startup)
                startupSyncPromises.push(
                    this.executeJob(job).catch(error => {
                        console.error(`❌ [SCHEDULER] Startup sync failed for ${job.name}:`, error.message);
                        // Don't fail startup if individual syncs fail
                    })
                );
            }
        }
        
        // Wait for all startup syncs to complete (but don't block if they take too long)
        Promise.allSettled(startupSyncPromises).then(results => {
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            console.log(`✅ [SCHEDULER] Startup syncs completed: ${successful} successful, ${failed} failed`);
        }).catch(error => {
            console.error('⚠️ [SCHEDULER] Error waiting for startup syncs:', error.message);
        });

        this.isRunning = true;
        console.log(`✅ Master Scheduler started successfully (${scheduledCount} jobs scheduled, ${this.syncJobs.filter(j => j.enabled).length} syncs triggered on startup)`);
        
        // Log system action
        await auditLogger.logSystemAction(
            'scheduler_started',
            'Scheduler',
            'master',
            { jobsScheduled: this.syncJobs.filter(j => j.enabled).length },
            'success'
        );
    }

    /**
     * Stop the master scheduler
     */
    async stop() {
        if (!this.isRunning) {
            console.log('⚠️ Master scheduler is not running');
            return;
        }

        console.log('🛑 Stopping Master Scheduler...');
        
        // Stop all scheduled jobs
        for (const [jobName, cronJob] of this.jobs) {
            cronJob.stop();
            console.log(`⏹️ Stopped job: ${jobName}`);
        }

        this.jobs.clear();
        this.isRunning = false;
        console.log('✅ Master Scheduler stopped successfully');
        
        // Log system action
        await auditLogger.logSystemAction(
            'scheduler_stopped',
            'Scheduler',
            'master',
            { jobsStopped: this.jobs.size },
            'success'
        );
    }

    /**
     * Schedule a specific job
     */
    async scheduleJob(job) {
        try {
            // Validate cron expression
            if (!cron.validate(job.schedule)) {
                throw new Error(`Invalid cron expression: ${job.schedule}`);
            }

            const cronJob = cron.schedule(job.schedule, async () => {
                await this.executeJob(job);
            }, {
                scheduled: false,
                timezone: process.env.SYNC_TIMEZONE || 'America/Chicago' // Configurable timezone (defaults to Central)
            });

            this.jobs.set(job.name, cronJob);
            cronJob.start();
            
            // Calculate next run time
            job.nextRun = this.getNextRunTime(job.schedule);
            job.status = 'scheduled';
            
            const timezone = process.env.SYNC_TIMEZONE || 'America/Chicago';
            const nowInTz = new Date().toLocaleString('en-US', { 
                timeZone: timezone,
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
            });
            console.log(`📅 Scheduled job: ${job.name} - ${job.description}`);
            console.log(`   Schedule: ${job.schedule} (${timezone} timezone)`);
            console.log(`   Current ${timezone} time: ${nowInTz}`);
            console.log(`   Next run: ${job.nextRun || 'Calculating...'}`);
            
        } catch (error) {
            console.error(`❌ Failed to schedule job ${job.name}:`, error.message);
            job.status = 'error';
        }
    }

    /**
     * Execute a specific job
     */
    async executeJob(job) {
        const startTime = new Date();
        job.status = 'running';
        job.lastRun = startTime;
        
        const timezone = process.env.SYNC_TIMEZONE || 'America/Chicago';
        const executeTime = new Date().toLocaleString('en-US', { 
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
        });
        console.log(`🔄 Executing job: ${job.name} - ${job.description}`);
        console.log(`   Execution time (${timezone}): ${executeTime}`);
        
        try {
            // Execute the sync script with appropriate timeout based on sync type
            // Active packages and transferred packages can process thousands of records
            const timeoutMap = {
                'sync:active:prod': 900000,      // 15 minutes for active packages (can be 5000+ records)
                'sync:transferred:prod': 1800000, // 30 minutes for transferred packages (can be very large)
                'sync:intransit:prod': 600000,   // 10 minutes for in-transit packages
                'sync:outgoing:prod': 600000,     // 10 minutes for outgoing transfers
                'sync:items:prod': 600000,        // 10 minutes for items
                'sync:strains:prod': 600000,     // 10 minutes for strains
                'sync:batches:prod': 900000       // 15 minutes for batches
            };
            
            const timeout = timeoutMap[job.script] || 600000; // Default 10 minutes
            
            const { stdout, stderr } = await execAsync(`npm run ${job.script}`, {
                timeout: timeout,
                cwd: process.cwd()
            });

            const endTime = new Date();
            const duration = endTime - startTime;
            
            // Parse output to get record count and detailed sync information
            const recordsProcessed = this.parseRecordCount(stdout);
            const syncDetails = this.parseSyncDetails(stdout);
            
            // Update job status
            job.status = 'completed';
            
            // Add to history
            this.addToHistory({
                jobName: job.name,
                startTime,
                endTime,
                duration,
                status: 'success',
                recordsProcessed,
                output: stdout,
                error: stderr
            });
            
            console.log(`✅ Job completed: ${job.name} (${duration}ms, ${recordsProcessed} records)`);
            
            // Log system action with detailed sync information
            await auditLogger.logSystemAction(
                'sync_job_completed',
                'SyncJob',
                job.name,
                {
                    duration,
                    recordsProcessed,
                    script: job.script,
                    syncDetails,
                    summary: this.generateSyncSummary(syncDetails)
                },
                'success'
            );
            
        } catch (error) {
            const endTime = new Date();
            const duration = endTime - startTime;
            
            // Update job status
            job.status = 'failed';
            
            // Add to history
            this.addToHistory({
                jobName: job.name,
                startTime,
                endTime,
                duration,
                status: 'failed',
                recordsProcessed: 0,
                output: '',
                error: error.message
            });
            
            console.error(`❌ Job failed: ${job.name} (${duration}ms)`, error.message);
            
            // Log system action
            await auditLogger.logSystemAction(
                'sync_job_failed',
                'SyncJob',
                job.name,
                {
                    duration,
                    error: error.message,
                    script: job.script
                },
                'failure'
            );
        }
        
        // Calculate next run time
        job.nextRun = this.getNextRunTime(job.schedule);
    }

    /**
     * Parse record count from script output
     */
    parseRecordCount(output) {
        try {
            // Look for patterns like "✅ Retrieved 100 strains" or "recordsProcessed": 100
            const recordMatch = output.match(/(?:Retrieved|Processed|recordsProcessed["\s]*:?\s*)(\d+)/i);
            return recordMatch ? parseInt(recordMatch[1]) : 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Parse detailed sync information from script output
     */
    parseSyncDetails(output) {
        const details = {
            inserted: 0,
            updated: 0,
            deleted: 0,
            processed: 0,
            chunks: 0,
            records: 0
        };

        try {
            const lines = output.split('\n');
            
            for (const line of lines) {
                // Parse "Enhanced sync completed: X inserted, Y updated, Z deleted"
                const syncMatch = line.match(/Enhanced sync completed:\s*(\d+)\s*inserted,\s*(\d+)\s*updated,\s*(\d+)\s*deleted/i);
                if (syncMatch) {
                    details.inserted = parseInt(syncMatch[1]);
                    details.updated = parseInt(syncMatch[2]);
                    details.deleted = parseInt(syncMatch[3]);
                }

                // Parse "X records processed"
                const processedMatch = line.match(/(\d+)\s*records?\s*processed/i);
                if (processedMatch) {
                    details.processed = parseInt(processedMatch[1]);
                }

                // Parse "Processing X records"
                const processingMatch = line.match(/Processing\s*(\d+)\s*records?/i);
                if (processingMatch) {
                    details.records = parseInt(processingMatch[1]);
                }

                // Parse chunk information
                const chunkMatch = line.match(/(\d+)\s*chunks?/i);
                if (chunkMatch) {
                    details.chunks = parseInt(chunkMatch[1]);
                }
            }
        } catch (error) {
            console.error('Error parsing sync details:', error.message);
        }

        return details;
    }

    /**
     * Generate a human-readable summary of sync details
     */
    generateSyncSummary(syncDetails) {
        const parts = [];
        
        if (syncDetails.inserted > 0) {
            parts.push(`${syncDetails.inserted} inserted`);
        }
        if (syncDetails.updated > 0) {
            parts.push(`${syncDetails.updated} updated`);
        }
        if (syncDetails.deleted > 0) {
            parts.push(`${syncDetails.deleted} deleted`);
        }
        if (syncDetails.processed > 0) {
            parts.push(`${syncDetails.processed} processed`);
        }
        if (syncDetails.records > 0) {
            parts.push(`${syncDetails.records} records`);
        }

        if (parts.length > 0) {
            return `Enhanced sync completed: ${parts.join(', ')}`;
        } else {
            return 'Sync completed successfully';
        }
    }

    /**
     * Get next run time for a cron expression
     */
    getNextRunTime(cronExpression) {
        try {
            // Use node-cron's built-in functionality to get next execution time
            // Create a temporary cron job to calculate next run
            const timezone = process.env.SYNC_TIMEZONE || 'America/Chicago';
            const tempCron = cron.schedule(cronExpression, () => {}, {
                scheduled: false,
                timezone: timezone
            });
            
            // Get the next execution time
            // Note: node-cron doesn't directly expose next execution time, so we'll use a calculation
            // For now, return the schedule info formatted for Chicago timezone
            const now = new Date();
            const chicagoTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
            return `Scheduled in ${timezone} timezone`;
        } catch (error) {
            console.error('Error calculating next run time:', error.message);
            return null;
        }
    }

    /**
     * Add job execution to history
     */
    addToHistory(execution) {
        this.jobHistory.unshift(execution);
        
        // Keep only the last maxHistorySize executions
        if (this.jobHistory.length > this.maxHistorySize) {
            this.jobHistory = this.jobHistory.slice(0, this.maxHistorySize);
        }
    }

    /**
     * Get scheduler status
     */
    getStatus() {
        const runningJobs = Array.from(this.jobs.values()).filter(job => job.running).length;
        const recentJobs = this.jobHistory.slice(0, 10);
        
        return {
            status: this.isRunning ? 'running' : 'stopped',
            runningJobs,
            totalJobs: this.syncJobs.length,
            enabledJobs: this.syncJobs.filter(j => j.enabled).length,
            schedules: this.syncJobs.map(job => ({
                name: job.name,
                description: job.description,
                schedule: job.schedule,
                script: job.script,
                enabled: job.enabled,
                lastRun: job.lastRun,
                nextRun: job.nextRun,
                status: job.status
            })),
            recentJobs,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Enable/disable a specific job
     */
    async toggleJob(jobName, enabled) {
        const job = this.syncJobs.find(j => j.name === jobName);
        if (!job) {
            throw new Error(`Job not found: ${jobName}`);
        }

        job.enabled = enabled;

        if (enabled && this.isRunning) {
            await this.scheduleJob(job);
        } else if (!enabled && this.jobs.has(jobName)) {
            this.jobs.get(jobName).stop();
            this.jobs.delete(jobName);
            job.status = 'disabled';
        }

        console.log(`${enabled ? '✅ Enabled' : '❌ Disabled'} job: ${jobName}`);
    }

    /**
     * Trigger a job manually
     */
    async triggerJob(jobName) {
        const job = this.syncJobs.find(j => j.name === jobName);
        if (!job) {
            throw new Error(`Job not found: ${jobName}`);
        }

        console.log(`🔧 Manually triggering job: ${jobName}`);
        await this.executeJob(job);
    }
}

// Create singleton instance
const masterScheduler = new MasterScheduler();

module.exports = masterScheduler;
