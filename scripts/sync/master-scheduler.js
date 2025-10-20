#!/usr/bin/env node

/**
 * Master Scheduler for METRC Sync Operations
 * 
 * Automatically triggers METRC sync operations at specified intervals
 * during business hours (8 AM - 6 PM, Monday-Friday)
 * 
 * Usage: node scripts/sync/master-scheduler.js
 */

const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');

// Load environment variables
require('dotenv').config();

// Scheduler configuration
const SCHEDULE_CONFIG = {
    // Active Packages - Full Mirror Sync (every 10 minutes)
    activePackages: {
        schedule: '*/10 8-18 * * 1-5', // Every 10 minutes, 8 AM - 6 PM, Mon-Fri
        script: 'sync:active:prod',
        description: 'Active Packages Sync (Full Mirror)'
    },
    
    // In-Transit Packages - Full Mirror Sync (every 5 minutes)
    intransitPackages: {
        schedule: '*/5 8-18 * * 1-5', // Every 5 minutes, 8 AM - 6 PM, Mon-Fri
        script: 'sync:intransit:prod',
        description: 'In-Transit Packages Sync (Full Mirror)'
    },
    
    // Outgoing Transfers - Incremental Sync (every 5 minutes)
    outgoingTransfers: {
        schedule: '*/5 8-18 * * 1-5', // Every 5 minutes, 8 AM - 6 PM, Mon-Fri
        script: 'sync:outgoing:prod',
        description: 'Outgoing Transfers Sync (Incremental)'
    },
    
    // Transferred Packages - Incremental Sync (every 10 minutes)
    transferredPackages: {
        schedule: '*/10 8-18 * * 1-5', // Every 10 minutes, 8 AM - 6 PM, Mon-Fri
        script: 'sync:transferred:prod',
        description: 'Transferred Packages Sync (Incremental)'
    },
    
    // Items - Incremental Sync (every 60 minutes)
    items: {
        schedule: '0 8-18 * * 1-5', // Every hour, 8 AM - 6 PM, Mon-Fri
        script: 'sync:items:prod',
        description: 'Items Sync (Incremental)'
    },
    
    // Strains - Incremental Sync (every 60 minutes)
    strains: {
        schedule: '30 8-18 * * 1-5', // Every hour at :30, 8 AM - 6 PM, Mon-Fri
        script: 'sync:strains:prod',
        description: 'Strains Sync (Incremental)'
    }
};

// Track running jobs
const runningJobs = new Map();
const jobHistory = [];

// Logging function
function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const logTypes = {
        'SCHEDULER': '⏰',
        'START': '🚀',
        'SUCCESS': '✅',
        'ERROR': '❌',
        'INFO': '📊',
        'WARN': '⚠️'
    };
    
    const emoji = logTypes[type] || '📝';
    console.log(`[${timestamp}] ${type}: ${emoji} ${message}`);
}

// Execute sync script
function executeSyncScript(scriptName, description) {
    return new Promise((resolve, reject) => {
        log(`Starting ${description}...`, 'START');
        
        const startTime = Date.now();
        const jobId = `${scriptName}-${startTime}`;
        
        // Track running job
        runningJobs.set(jobId, {
            script: scriptName,
            description,
            startTime,
            status: 'running'
        });
        
        // Execute npm script
        const npmProcess = spawn('npm', ['run', scriptName], {
            cwd: process.cwd(),
            stdio: 'pipe'
        });
        
        let output = '';
        let errorOutput = '';
        
        npmProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        npmProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        npmProcess.on('close', (code) => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            // Update job status
            const job = runningJobs.get(jobId);
            if (job) {
                job.endTime = endTime;
                job.duration = duration;
                job.status = code === 0 ? 'success' : 'error';
                job.exitCode = code;
                job.output = output;
                job.error = errorOutput;
                
                // Move to history (keep last 100 jobs)
                jobHistory.push(job);
                if (jobHistory.length > 100) {
                    jobHistory.shift();
                }
                
                runningJobs.delete(jobId);
            }
            
            if (code === 0) {
                log(`${description} completed successfully (${duration}ms)`, 'SUCCESS');
                resolve({ success: true, duration, output });
            } else {
                log(`${description} failed with exit code ${code} (${duration}ms)`, 'ERROR');
                reject({ success: false, duration, output, error: errorOutput, exitCode: code });
            }
        });
        
        npmProcess.on('error', (error) => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            log(`${description} failed to start: ${error.message}`, 'ERROR');
            reject({ success: false, duration, error: error.message });
        });
    });
}

// Setup cron jobs
function setupScheduler() {
    log('Setting up METRC Sync Scheduler...', 'SCHEDULER');
    
    Object.entries(SCHEDULE_CONFIG).forEach(([key, config]) => {
        log(`Scheduling ${config.description} - ${config.schedule}`, 'SCHEDULER');
        
        cron.schedule(config.schedule, async () => {
            try {
                await executeSyncScript(config.script, config.description);
            } catch (error) {
                log(`Scheduled job failed: ${error.error || error.message}`, 'ERROR');
            }
        }, {
            scheduled: true,
            timezone: 'America/Los_Angeles' // PST/PDT timezone for US West Coast business hours
        });
    });
    
    log('All sync jobs scheduled successfully!', 'SCHEDULER');
    log('Scheduler is running. Press Ctrl+C to stop.', 'INFO');
}

// Get scheduler status
function getStatus() {
    const now = new Date();
    const runningJobsArray = Array.from(runningJobs.values());
    const recentJobs = jobHistory.slice(-10);
    
    return {
        status: 'running',
        timestamp: now.toISOString(),
        runningJobs: runningJobsArray.length,
        recentJobs: recentJobs.map(job => ({
            script: job.script,
            description: job.description,
            status: job.status,
            duration: job.duration,
            startTime: new Date(job.startTime).toISOString()
        })),
        schedules: Object.entries(SCHEDULE_CONFIG).map(([key, config]) => ({
            name: key,
            description: config.description,
            schedule: config.schedule,
            script: config.script
        }))
    };
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    log('Received SIGINT. Shutting down scheduler gracefully...', 'WARN');
    
    // Wait for running jobs to complete (max 30 seconds)
    const maxWaitTime = 30000;
    const startWait = Date.now();
    
    const waitForJobs = () => {
        if (runningJobs.size === 0 || (Date.now() - startWait) > maxWaitTime) {
            log('Scheduler stopped.', 'INFO');
            process.exit(0);
        } else {
            log(`Waiting for ${runningJobs.size} running jobs to complete...`, 'INFO');
            setTimeout(waitForJobs, 1000);
        }
    };
    
    waitForJobs();
});

// Start scheduler
if (require.main === module) {
    log('=== METRC Sync Master Scheduler ===', 'SCHEDULER');
    log(`Environment: ${process.env.NODE_ENV || 'development'}`, 'INFO');
    log(`Timezone: America/New_York`, 'INFO');
    
    setupScheduler();
    
    // Keep the process running
    process.stdin.resume();
}

module.exports = {
    setupScheduler,
    getStatus,
    executeSyncScript,
    SCHEDULE_CONFIG
};
