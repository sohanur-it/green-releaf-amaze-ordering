const { exec } = require('child_process');
const { promisify } = require('util');
const auditLogger = require('./auditLogger');
const logger = require('../../Utilities/logger');

const execAsync = promisify(exec);

class BackgroundSyncService {
  constructor() {
    this.runningJobs = new Map(); // Track running sync jobs
    this.jobQueue = []; // Queue for pending sync jobs
    this.maxConcurrentJobs = 2; // Maximum concurrent sync operations
  }

  /**
   * Queue a sync job for background processing
   * @param {string} serviceName - Name of the sync service (e.g., 'strains', 'items')
   * @param {Object} userInfo - User information for audit logging
   * @param {Object} req - Express request object
   * @returns {Promise<Object>} - Job information
   */
  async queueSyncJob(serviceName, userInfo, req) {
    const jobId = `sync_${serviceName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const job = {
      id: jobId,
      serviceName,
      userInfo,
      req,
      status: 'queued',
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null
    };

    this.jobQueue.push(job);
    
    // Log the job queued event
    await auditLogger.logAction({
      userId: userInfo.userId,
      action: `sync_${serviceName}_queued`,
      resourceType: 'SyncJob',
      resourceId: jobId,
      details: {
        serviceName,
        triggeredBy: userInfo.triggeredBy,
        userId: userInfo.userId,
        username: userInfo.username,
        queuePosition: this.jobQueue.length,
        estimatedWaitTime: this.estimateWaitTime()
      },
      status: 'success',
      sourceIp: req.ip
    });

    // Start processing if we have capacity
    this.processQueue();

    return {
      jobId,
      status: 'queued',
      message: `Sync job queued successfully. Job ID: ${jobId}`,
      estimatedWaitTime: this.estimateWaitTime()
    };
  }

  /**
   * Process the job queue
   */
  async processQueue() {
    if (this.runningJobs.size >= this.maxConcurrentJobs || this.jobQueue.length === 0) {
      return;
    }

    const job = this.jobQueue.shift();
    if (!job) return;

    this.runningJobs.set(job.id, job);
    job.status = 'running';
    job.startedAt = new Date();

    // Log job started
    await auditLogger.logAction({
      userId: job.userInfo.userId,
      action: `sync_${job.serviceName}_started`,
      resourceType: 'SyncJob',
      resourceId: job.id,
      details: {
        serviceName: job.serviceName,
        triggeredBy: job.userInfo.triggeredBy,
        userId: job.userInfo.userId,
        username: job.userInfo.username,
        queueWaitTime: Date.now() - job.createdAt.getTime()
      },
      status: 'success',
      sourceIp: job.req.ip
    });

    // Execute the sync job in background
    this.executeSyncJob(job).catch(error => {
      logger.error(`Background sync job ${job.id} failed:`, error);
    });
  }

  /**
   * Execute a sync job
   * @param {Object} job - The job to execute
   */
  async executeSyncJob(job) {
    try {
      const startTime = Date.now();
      
      // Map service names to npm scripts
      const scriptMap = {
        'strains': 'npm run sync:strains:prod',
        'items': 'npm run sync:items:prod',
        'active-packages': 'npm run sync:active:prod',
        'transferred-packages': 'npm run sync:transferred:prod',
        'intransit-packages': 'npm run sync:intransit:prod',
        'outgoing-transfers': 'npm run sync:outgoing:prod'
      };

      const script = scriptMap[job.serviceName];
      if (!script) {
        throw new Error(`Unknown sync service: ${job.serviceName}`);
      }

      logger.info(`🔄 Starting background sync: ${job.serviceName} (Job ID: ${job.id})`);

      // Set appropriate timeout based on service type
      const timeoutMap = {
        'sync:active:prod': 900000,      // 15 minutes for active packages
        'sync:transferred:prod': 1800000, // 30 minutes for transferred packages
        'sync:intransit:prod': 600000,   // 10 minutes for in-transit packages
        'sync:outgoing:prod': 600000,     // 10 minutes for outgoing transfers
        'sync:items:prod': 600000,        // 10 minutes for items
        'sync:strains:prod': 600000,      // 10 minutes for strains
        'sync:batches:prod': 900000       // 15 minutes for batches
      };
      
      // Extract script name from full command (e.g., "npm run sync:active:prod" -> "sync:active:prod")
      const scriptMatch = script.match(/sync:\w+:prod/);
      const scriptKey = scriptMatch ? scriptMatch[0] : null;
      const timeout = scriptKey && timeoutMap[scriptKey] ? timeoutMap[scriptKey] : 600000; // Default 10 minutes
      
      const { stdout, stderr } = await execAsync(script, { 
        timeout: timeout,
        env: { 
          ...process.env, 
          SYNC_USER_ID: job.userInfo.userIdString !== 'SYSTEM' ? job.userInfo.userIdString : undefined 
        }
      });

      const executionTime = Date.now() - startTime;
      
      // Parse sync results
      const lines = stdout.split('\n');
      const recordsProcessed = this.extractRecordsProcessed(lines);
      const details = this.extractSyncDetails(lines);

      job.result = {
        success: true,
        recordsProcessed,
        executionTime,
        details,
        output: stdout,
        error: stderr
      };

      job.status = 'completed';
      job.completedAt = new Date();

      // Log job completed
      await auditLogger.logAction({
        userId: job.userInfo.userId,
        action: `sync_${job.serviceName}_completed`,
        resourceType: 'SyncJob',
        resourceId: job.id,
        details: {
          recordsProcessed,
          executionTime,
          syncDetails: details,
          summary: `${job.serviceName} sync completed: ${recordsProcessed} records processed in ${executionTime}ms`,
          triggeredBy: job.userInfo.triggeredBy,
          userId: job.userInfo.userId,
          username: job.userInfo.username,
          totalJobTime: Date.now() - job.createdAt.getTime()
        },
        status: 'success',
        sourceIp: job.req.ip
      });

      logger.info(`✅ Background sync completed: ${job.serviceName} (Job ID: ${job.id}) - ${recordsProcessed} records in ${executionTime}ms`);

    } catch (error) {
      // Extract detailed error information
      let errorMessage = error.message;
      let errorDetails = {
        code: error.code,
        signal: error.signal,
        stdout: error.stdout || '',
        stderr: error.stderr || ''
      };

      // Try to extract meaningful error from stderr or stdout
      const errorOutput = error.stderr || error.stdout || '';
      const errorLines = errorOutput.split('\n').filter(line => 
        line.includes('❌') || 
        line.includes('Error') || 
        line.includes('Failed') ||
        line.includes('500') ||
        line.includes('HALTING')
      );

      if (errorLines.length > 0) {
        // Use the most relevant error line
        const relevantError = errorLines[errorLines.length - 1] || errorLines[0];
        errorMessage = `${error.message} | Script Error: ${relevantError}`;
      } else if (error.stderr) {
        // Fall back to last line of stderr
        const stderrLines = error.stderr.split('\n').filter(line => line.trim().length > 0);
        if (stderrLines.length > 0) {
          errorMessage = `${error.message} | Script Output: ${stderrLines[stderrLines.length - 1]}`;
        }
      } else if (error.stdout) {
        // Check stdout for error messages
        const stdoutLines = error.stdout.split('\n').filter(line => 
          line.includes('❌') || line.includes('Error') || line.includes('Failed')
        );
        if (stdoutLines.length > 0) {
          errorMessage = `${error.message} | Script Output: ${stdoutLines[stdoutLines.length - 1]}`;
        }
      }

      job.error = errorMessage;
      job.status = 'failed';
      job.completedAt = new Date();
      job.result = {
        success: false,
        error: errorMessage,
        errorDetails: errorDetails,
        output: error.stdout || '',
        stderr: error.stderr || ''
      };

      // Log job failed with detailed error information
      await auditLogger.logAction({
        userId: job.userInfo.userId,
        action: `sync_${job.serviceName}_failed`,
        resourceType: 'SyncJob',
        resourceId: job.id,
        details: {
          error: errorMessage,
          errorDetails: errorDetails,
          scriptOutput: error.stdout ? error.stdout.substring(0, 1000) : '', // Limit size
          scriptError: error.stderr ? error.stderr.substring(0, 1000) : '', // Limit size
          triggeredBy: job.userInfo.triggeredBy,
          userId: job.userInfo.userId,
          username: job.userInfo.username,
          totalJobTime: Date.now() - job.createdAt.getTime()
        },
        status: 'failure',
        sourceIp: job.req.ip
      });

      logger.error(`❌ Background sync failed: ${job.serviceName} (Job ID: ${job.id})`);
      logger.error(`   Error: ${errorMessage}`);
      if (error.stderr) {
        logger.error(`   Stderr: ${error.stderr.substring(0, 500)}`);
      }
      if (error.stdout) {
        const errorLines = error.stdout.split('\n').filter(line => 
          line.includes('❌') || line.includes('Error') || line.includes('Failed')
        );
        if (errorLines.length > 0) {
          logger.error(`   Script Errors: ${errorLines.join('; ')}`);
        }
      }
    } finally {
      // Remove from running jobs
      this.runningJobs.delete(job.id);
      
      // Process next job in queue
      setTimeout(() => this.processQueue(), 1000);
    }
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @returns {Object|null} - Job status or null if not found
   */
  getJobStatus(jobId) {
    // Check running jobs first
    if (this.runningJobs.has(jobId)) {
      return this.runningJobs.get(jobId);
    }

    // Check queued jobs
    const queuedJob = this.jobQueue.find(job => job.id === jobId);
    if (queuedJob) {
      return queuedJob;
    }

    return null;
  }

  /**
   * Get all job statuses
   * @returns {Object} - Status of all jobs
   */
  getAllJobStatuses() {
    return {
      running: Array.from(this.runningJobs.values()),
      queued: this.jobQueue,
      stats: {
        totalRunning: this.runningJobs.size,
        totalQueued: this.jobQueue.length,
        maxConcurrent: this.maxConcurrentJobs
      }
    };
  }

  /**
   * Estimate wait time for queued jobs
   * @returns {number} - Estimated wait time in milliseconds
   */
  estimateWaitTime() {
    const avgJobTime = 30000; // 30 seconds average
    const queuePosition = this.jobQueue.length;
    const runningJobs = this.runningJobs.size;
    
    if (runningJobs < this.maxConcurrentJobs) {
      return 0; // Can start immediately
    }
    
    return queuePosition * avgJobTime;
  }

  /**
   * Extract records processed from sync output
   * @param {Array} lines - Output lines
   * @returns {number} - Number of records processed
   */
  extractRecordsProcessed(lines) {
    for (const line of lines) {
      const match = line.match(/(\d+)\s+(inserted|updated|deleted|processed)/);
      if (match) {
        return parseInt(match[1]);
      }
    }
    return 0;
  }

  /**
   * Extract sync details from output
   * @param {Array} lines - Output lines
   * @returns {Object} - Sync details
   */
  extractSyncDetails(lines) {
    const details = {
      inserted: 0,
      updated: 0,
      deleted: 0,
      processed: 0
    };

    for (const line of lines) {
      const insertedMatch = line.match(/(\d+)\s+inserted/);
      const updatedMatch = line.match(/(\d+)\s+updated/);
      const deletedMatch = line.match(/(\d+)\s+deleted/);
      const processedMatch = line.match(/(\d+)\s+processed/);

      if (insertedMatch) details.inserted = parseInt(insertedMatch[1]);
      if (updatedMatch) details.updated = parseInt(updatedMatch[1]);
      if (deletedMatch) details.deleted = parseInt(deletedMatch[1]);
      if (processedMatch) details.processed = parseInt(processedMatch[1]);
    }

    return details;
  }
}

module.exports = new BackgroundSyncService();
