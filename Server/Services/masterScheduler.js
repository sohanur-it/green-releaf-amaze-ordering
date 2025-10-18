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
                schedule: '*/10 8-18 * * 1-5', // Every 10 minutes, 8 AM - 6 PM, weekdays
                script: 'sync:transferred:prod',
                enabled: true,
                lastRun: null,
                nextRun: null,
                status: 'idle'
            },
            {
                name: 'strains',
                description: 'Strains Sync (Incremental)',
                schedule: '0 8-18 * * 1-5', // Every hour, 8 AM - 6 PM, weekdays
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

        console.log('🚀 Starting Master Scheduler...');
        
        // Schedule all enabled jobs
        for (const job of this.syncJobs) {
            if (job.enabled) {
                await this.scheduleJob(job);
            }
        }

        this.isRunning = true;
        console.log('✅ Master Scheduler started successfully');
        
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
                timezone: 'America/Los_Angeles' // PST/PDT timezone
            });

            this.jobs.set(job.name, cronJob);
            cronJob.start();
            
            // Calculate next run time
            job.nextRun = this.getNextRunTime(job.schedule);
            job.status = 'scheduled';
            
            console.log(`📅 Scheduled job: ${job.name} - ${job.description}`);
            console.log(`   Schedule: ${job.schedule}`);
            console.log(`   Next run: ${job.nextRun}`);
            
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
        
        console.log(`🔄 Executing job: ${job.name} - ${job.description}`);
        
        try {
            // Execute the sync script
            const { stdout, stderr } = await execAsync(`npm run ${job.script}`, {
                timeout: 300000, // 5 minute timeout
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
            // This is a simplified calculation - in production you might want to use a library like 'cron-parser'
            const now = new Date();
            const nextRun = new Date(now.getTime() + 60000); // Add 1 minute as placeholder
            return nextRun.toISOString();
        } catch (error) {
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
