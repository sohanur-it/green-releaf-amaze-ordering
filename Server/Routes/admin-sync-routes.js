const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const swaggerAuth = require('../Middleware/swagger-auth');
const masterScheduler = require('../Services/masterScheduler');
const auditLogger = require('../Services/auditLogger');
const backgroundSyncService = require('../Services/backgroundSyncService');

const execAsync = promisify(exec);

// Helper function to get user info for audit logging
function getUserInfoForAudit(req) {
  // Priority: JWT token user > session user > SYSTEM
  let userId = 'SYSTEM';
  let triggeredBy = 'swagger_api';
  
  // Check if user is authenticated via JWT token
  if (req.user && req.user.id && req.user.id !== 'SYSTEM') {
    userId = req.user.id;
    triggeredBy = 'jwt_api';
  }
  // Check if user is authenticated via session
  else if (req.session?.userId && typeof req.session.userId === 'number') {
    userId = req.session.userId;
    triggeredBy = 'session_api';
  }
  
  return {
    userId: userId === 'SYSTEM' ? null : userId, // Use null for SYSTEM operations
    triggeredBy: triggeredBy,
    userIdString: userId,
    username: req.user?.username || req.session?.username || 'system'
  };
}

// Apply authentication middleware to all routes
router.use(swaggerAuth);

/**
 * @swagger
 * /api/v1/swagger/sync/status:
 *   get:
 *     summary: Get sync scheduler status
 *     description: Retrieve the current status of the METRC sync scheduler and all configured jobs
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Scheduler status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncStatus'
 *             example:
 *               status: "running"
 *               timestamp: "2025-10-17T09:40:34.777Z"
 *               runningJobs: 0
 *               recentJobs: []
 *               schedules:
 *                 - name: "activePackages"
 *                   description: "Active Packages Sync (Full Mirror)"
 *                   schedule: "every 10 minutes during business hours"
 *                   script: "sync:active:prod"
 *       401:
 *         description: Unauthorized - Login required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/status', async (req, res) => {
  try {
    // Get real scheduler status
    const statusData = masterScheduler.getStatus();
    
    res.json({
      success: true,
      ...statusData
    });
  } catch (error) {
    console.error('Error getting sync status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync status',
      username: userInfo.username,
        timestamp: new Date().toISOString(),
      details: { message: error.message }
    });
  }
});

/**
 * @swagger
 * /api/v1/swagger/sync/active-packages:
 *   post:
 *     summary: Trigger active packages sync
 *     description: Manually trigger the active packages synchronization from METRC API
 *     tags: [Sync Services]
 *     responses:
 *       200:
 *         description: Active packages sync completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncResponse'
 *             example:
 *               success: true
 *               message: "Active packages sync completed successfully"
 *               serviceName: "active-packages"
 *               timestamp: "2025-10-17T09:40:34.777Z"
 *               recordsProcessed: 100
 *               executionTime: 2500
 *               details:
 *                 inserted: 0
 *                 updated: 4
 *                 deleted: 0
 *       401:
 *         description: Unauthorized - Login required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Sync operation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/active-packages', async (req, res) => {
  try {
    const userInfo = getUserInfoForAudit(req);
    
    // Queue the sync job for background processing
    const jobResult = await backgroundSyncService.queueSyncJob('active-packages', userInfo, req);
    
    res.status(202).json({
      success: true,
      message: 'Active packages sync queued for background processing',
      data: jobResult
    });
    
  } catch (error) {
    console.error('Active packages sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to queue active packages sync',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/swagger/sync/outgoing-transfers:
 *   post:
 *     summary: Trigger outgoing transfers sync
 *     description: Manually trigger the outgoing transfers synchronization from METRC API
 *     tags: [Sync Services]
 *     responses:
 *       200:
 *         description: Outgoing transfers sync completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncResponse'
 *             example:
 *               success: true
 *               message: "Outgoing transfers sync completed successfully"
 *               serviceName: "outgoing-transfers"
 *               timestamp: "2025-10-17T09:40:34.777Z"
 *               recordsProcessed: 8
 *               executionTime: 1800
 *               details:
 *                 processed: 8
 *                 strategy: "incremental"
 *       401:
 *         description: Unauthorized - Login required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Sync operation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/outgoing-transfers', async (req, res) => {
  try {
    const userInfo = getUserInfoForAudit(req);
    
    // Queue the sync job for background processing
    const jobResult = await backgroundSyncService.queueSyncJob('outgoing-transfers', userInfo, req);
    
    res.status(202).json({
      success: true,
      message: 'Outgoing transfers sync queued for background processing',
      data: jobResult
    });
    
  } catch (error) {
    console.error('Outgoing transfers sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to queue outgoing transfers sync',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/swagger/sync/strains:
 *   post:
 *     summary: Trigger strains sync
 *     description: Manually trigger the strains synchronization from METRC API
 *     tags: [Sync Services]
 *     responses:
 *       200:
 *         description: Strains sync completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncResponse'
 *             example:
 *               success: true
 *               message: "Strains sync completed successfully"
 *               serviceName: "strains"
 *               timestamp: "2025-10-17T09:40:34.777Z"
 *               recordsProcessed: 100
 *               executionTime: 3200
 *               details:
 *                 processed: 100
 *                 chunks: 2
 *       401:
 *         description: Unauthorized - Login required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Sync operation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/strains', async (req, res) => {
  try {
    const userInfo = getUserInfoForAudit(req);
    
    // Queue the sync job for background processing
    const jobResult = await backgroundSyncService.queueSyncJob('strains', userInfo, req);
    
    res.status(202).json({
      success: true,
      message: 'Strains sync queued for background processing',
      data: jobResult
    });
    
  } catch (error) {
    console.error('Strains sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to queue strains sync',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/swagger/sync/status/{jobId}:
 *   get:
 *     summary: Get sync job status
 *     description: Check the status of a background sync job
 *     tags: [Sync Services]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: The job ID returned when queuing a sync
 *     responses:
 *       200:
 *         description: Job status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 jobId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [queued, running, completed, failed]
 *                 result:
 *                   type: object
 *                 error:
 *                   type: string
 *       404:
 *         description: Job not found
 */
router.get('/status/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const jobStatus = backgroundSyncService.getJobStatus(jobId);
    
    if (!jobStatus) {
      return res.status(404).json({
        success: false,
        message: 'Job not found',
        jobId
      });
    }
    
    res.json({
      success: true,
      jobId,
      status: jobStatus.status,
      createdAt: jobStatus.createdAt,
      startedAt: jobStatus.startedAt,
      completedAt: jobStatus.completedAt,
      result: jobStatus.result,
      error: jobStatus.error
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get job status',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/swagger/sync/status:
 *   get:
 *     summary: Get all sync job statuses
 *     description: Get status of all running and queued sync jobs
 *     tags: [Sync Services]
 *     responses:
 *       200:
 *         description: All job statuses retrieved successfully
 */
router.get('/status', (req, res) => {
  try {
    const allStatuses = backgroundSyncService.getAllJobStatuses();
    res.json({
      success: true,
      data: allStatuses
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get job statuses',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/swagger/sync/items:
 *   post:
 *     summary: Trigger items sync
 *     description: Manually trigger the items synchronization from METRC API
 *     tags: [Sync Services]
 *     responses:
 *       200:
 *         description: Items sync completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncResponse'
 *       401:
 *         description: Unauthorized - Login required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Sync operation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/items', async (req, res) => {
  try {
    const userInfo = getUserInfoForAudit(req);
    
    // Queue the sync job for background processing
    const jobResult = await backgroundSyncService.queueSyncJob('items', userInfo, req);
    
    res.status(202).json({
      success: true,
      message: 'Items sync queued for background processing',
      data: jobResult
    });
    
  } catch (error) {
    console.error('Items sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to queue items sync',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/swagger/sync/transferred-packages:
 *   post:
 *     summary: Trigger transferred packages sync
 *     description: Manually trigger the transferred packages synchronization from METRC API
 *     tags: [Sync Services]
 *     responses:
 *       200:
 *         description: Transferred packages sync completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncResponse'
 *       401:
 *         description: Unauthorized - Login required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Sync operation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/transferred-packages', async (req, res) => {
  try {
    const userInfo = getUserInfoForAudit(req);
    
    // Queue the sync job for background processing
    const jobResult = await backgroundSyncService.queueSyncJob('transferred-packages', userInfo, req);
    
    res.status(202).json({
      success: true,
      message: 'Transferred packages sync queued for background processing',
      data: jobResult
    });
    
  } catch (error) {
    console.error('Transferred packages sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to queue transferred packages sync',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/swagger/sync/intransit-packages:
 *   post:
 *     summary: Trigger in-transit packages sync
 *     description: Manually trigger the in-transit packages synchronization from METRC API
 *     tags: [Sync Services]
 *     responses:
 *       200:
 *         description: In-transit packages sync completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncResponse'
 *       401:
 *         description: Unauthorized - Login required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Sync operation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/intransit-packages', async (req, res) => {
  try {
    const userInfo = getUserInfoForAudit(req);
    
    // Queue the sync job for background processing
    const jobResult = await backgroundSyncService.queueSyncJob('intransit-packages', userInfo, req);
    
    res.status(202).json({
      success: true,
      message: 'In-transit packages sync queued for background processing',
      data: jobResult
    });
    
  } catch (error) {
    console.error('In-transit packages sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to queue in-transit packages sync',
      error: error.message
    });
  }
});

// Helper functions to parse sync output
function extractRecordsProcessed(lines) {
  for (const line of lines) {
    if (line.includes('records processed') || line.includes('packages retrieved') || line.includes('transfers retrieved')) {
      const match = line.match(/(\d+)/);
      return match ? parseInt(match[1]) : 0;
    }
  }
  return 0;
}

function extractSyncDetails(lines) {
  const details = {};
  
  for (const line of lines) {
    if (line.includes('inserted:')) {
      const match = line.match(/inserted:\s*(\d+)/);
      if (match) details.inserted = parseInt(match[1]);
    }
    if (line.includes('updated:')) {
      const match = line.match(/updated:\s*(\d+)/);
      if (match) details.updated = parseInt(match[1]);
    }
    if (line.includes('deleted:')) {
      const match = line.match(/deleted:\s*(\d+)/);
      if (match) details.deleted = parseInt(match[1]);
    }
    if (line.includes('processed:')) {
      const match = line.match(/processed:\s*(\d+)/);
      if (match) details.processed = parseInt(match[1]);
    }
    if (line.includes('chunks:')) {
      const match = line.match(/chunks:\s*(\d+)/);
      if (match) details.chunks = parseInt(match[1]);
    }
  }
  
  return details;
}

/**
 * @swagger
 * /api/v1/swagger/sync/scheduler/start:
 *   post:
 *     summary: Start the master scheduler
 *     description: Start the master scheduler to begin automatic sync operations
 *     tags: [Scheduler Control]
 *     responses:
 *       200:
 *         description: Scheduler started successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncResponse'
 *       500:
 *         description: Failed to start scheduler
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/scheduler/start', async (req, res) => {
  try {
    await masterScheduler.start();
    
    res.json({
      success: true,
      message: 'Master scheduler started successfully',
      username: userInfo.username,
        timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error starting scheduler:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start scheduler',
      username: userInfo.username,
        timestamp: new Date().toISOString(),
      details: { message: error.message }
    });
  }
});

/**
 * @swagger
 * /api/v1/swagger/sync/scheduler/stop:
 *   post:
 *     summary: Stop the master scheduler
 *     description: Stop the master scheduler to halt automatic sync operations
 *     tags: [Scheduler Control]
 *     responses:
 *       200:
 *         description: Scheduler stopped successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncResponse'
 *       500:
 *         description: Failed to stop scheduler
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/scheduler/stop', async (req, res) => {
  try {
    await masterScheduler.stop();
    
    res.json({
      success: true,
      message: 'Master scheduler stopped successfully',
      username: userInfo.username,
        timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error stopping scheduler:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop scheduler',
      username: userInfo.username,
        timestamp: new Date().toISOString(),
      details: { message: error.message }
    });
  }
});

/**
 * @swagger
 * /api/v1/swagger/sync/scheduler/trigger/{jobName}:
 *   post:
 *     summary: Trigger a specific sync job manually
 *     description: Manually trigger a specific sync job to run immediately
 *     tags: [Scheduler Control]
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the job to trigger
 *     responses:
 *       200:
 *         description: Job triggered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncResponse'
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Failed to trigger job
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/scheduler/trigger/:jobName', async (req, res) => {
  try {
    const { jobName } = req.params;
    await masterScheduler.triggerJob(jobName);
    
    res.json({
      success: true,
      message: `Job ${jobName} triggered successfully`,
      username: userInfo.username,
        timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error triggering job:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger job',
      message: error.message
    });
  }
});

module.exports = router;
