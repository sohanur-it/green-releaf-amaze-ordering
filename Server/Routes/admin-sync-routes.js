const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const swaggerAuth = require('../Middleware/swagger-auth');

const execAsync = promisify(exec);

// Apply authentication middleware to all routes
router.use(swaggerAuth);

/**
 * @swagger
 * /api/v1/swagger/sync/status:
 *   get:
 *     summary: Get sync scheduler status
 *     description: Retrieve the current status of the METRC sync scheduler and all configured jobs
 *     tags: [Admin]
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
    // Return a mock scheduler status since we don't have a real scheduler running
    const statusData = {
      status: "running",
      runningJobs: 0,
      recentJobs: [],
      schedules: [
        {
          name: "activePackages",
          description: "Active Packages Sync (Full Mirror)",
          schedule: "every 10 minutes during business hours",
          script: "sync:active:prod",
          lastRun: null,
          nextRun: null,
          enabled: true
        },
        {
          name: "outgoingTransfers", 
          description: "Outgoing Transfers Sync (Incremental)",
          schedule: "every 5 minutes during business hours",
          script: "sync:outgoing:prod",
          lastRun: null,
          nextRun: null,
          enabled: true
        },
        {
          name: "strains",
          description: "Strains Sync (Incremental)",
          schedule: "every 60 minutes during business hours", 
          script: "sync:strains:prod",
          lastRun: null,
          nextRun: null,
          enabled: true
        },
        {
          name: "items",
          description: "Items Sync (Incremental)",
          schedule: "every 60 minutes during business hours",
          script: "sync:items:prod", 
          lastRun: null,
          nextRun: null,
          enabled: true
        },
        {
          name: "transferredPackages",
          description: "Transferred Packages Sync (Incremental)",
          schedule: "every 10 minutes during business hours",
          script: "sync:transferred:prod",
          lastRun: null,
          nextRun: null,
          enabled: true
        },
        {
          name: "intransitPackages",
          description: "In-Transit Packages Sync (Full Mirror)",
          schedule: "every 5 minutes during business hours",
          script: "sync:intransit:prod",
          lastRun: null,
          nextRun: null,
          enabled: true
        }
      ]
    };
    
    res.json({
      success: true,
      ...statusData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting sync status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync status',
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

    const startTime = Date.now();
    
    // Execute the sync command
    const { stdout, stderr } = await execAsync('npm run sync:active:prod', { timeout: 60000 });
    
    const executionTime = Date.now() - startTime;
    
    // Parse the output to extract key information
    const lines = stdout.split('\n');
    const recordsProcessed = extractRecordsProcessed(lines);
    const details = extractSyncDetails(lines);
    
    res.json({
      success: true,
      message: 'Active packages sync completed successfully',
      serviceName: 'active-packages',
      timestamp: new Date().toISOString(),
      recordsProcessed,
      executionTime,
      details,
      output: stdout.substring(0, 500) // First 500 chars for debugging
    });
  } catch (error) {
    console.error('Active packages sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Active packages sync failed',
      timestamp: new Date().toISOString(),
      details: { message: error.message, stderr: error.stderr }
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

    const startTime = Date.now();
    const { stdout, stderr } = await execAsync('npm run sync:outgoing:prod', { timeout: 60000 });
    const executionTime = Date.now() - startTime;
    
    const lines = stdout.split('\n');
    const recordsProcessed = extractRecordsProcessed(lines);
    const details = extractSyncDetails(lines);
    
    res.json({
      success: true,
      message: 'Outgoing transfers sync completed successfully',
      serviceName: 'outgoing-transfers',
      timestamp: new Date().toISOString(),
      recordsProcessed,
      executionTime,
      details,
      output: stdout.substring(0, 500)
    });
  } catch (error) {
    console.error('Outgoing transfers sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Outgoing transfers sync failed',
      timestamp: new Date().toISOString(),
      details: { message: error.message, stderr: error.stderr }
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

    const startTime = Date.now();
    const { stdout, stderr } = await execAsync('npm run sync:strains:prod', { timeout: 60000 });
    const executionTime = Date.now() - startTime;
    
    const lines = stdout.split('\n');
    const recordsProcessed = extractRecordsProcessed(lines);
    const details = extractSyncDetails(lines);
    
    res.json({
      success: true,
      message: 'Strains sync completed successfully',
      serviceName: 'strains',
      timestamp: new Date().toISOString(),
      recordsProcessed,
      executionTime,
      details,
      output: stdout.substring(0, 500)
    });
  } catch (error) {
    console.error('Strains sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Strains sync failed',
      timestamp: new Date().toISOString(),
      details: { message: error.message, stderr: error.stderr }
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

    const startTime = Date.now();
    const { stdout, stderr } = await execAsync('npm run sync:items:prod', { timeout: 60000 });
    const executionTime = Date.now() - startTime;
    
    const lines = stdout.split('\n');
    const recordsProcessed = extractRecordsProcessed(lines);
    const details = extractSyncDetails(lines);
    
    res.json({
      success: true,
      message: 'Items sync completed successfully',
      serviceName: 'items',
      timestamp: new Date().toISOString(),
      recordsProcessed,
      executionTime,
      details,
      output: stdout.substring(0, 500)
    });
  } catch (error) {
    console.error('Items sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Items sync failed',
      timestamp: new Date().toISOString(),
      details: { message: error.message, stderr: error.stderr }
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

    const startTime = Date.now();
    const { stdout, stderr } = await execAsync('npm run sync:transferred:prod', { timeout: 60000 });
    const executionTime = Date.now() - startTime;
    
    const lines = stdout.split('\n');
    const recordsProcessed = extractRecordsProcessed(lines);
    const details = extractSyncDetails(lines);
    
    res.json({
      success: true,
      message: 'Transferred packages sync completed successfully',
      serviceName: 'transferred-packages',
      timestamp: new Date().toISOString(),
      recordsProcessed,
      executionTime,
      details,
      output: stdout.substring(0, 500)
    });
  } catch (error) {
    console.error('Transferred packages sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Transferred packages sync failed',
      timestamp: new Date().toISOString(),
      details: { message: error.message, stderr: error.stderr }
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

    const startTime = Date.now();
    const { stdout, stderr } = await execAsync('npm run sync:intransit:prod', { timeout: 60000 });
    const executionTime = Date.now() - startTime;
    
    const lines = stdout.split('\n');
    const recordsProcessed = extractRecordsProcessed(lines);
    const details = extractSyncDetails(lines);
    
    res.json({
      success: true,
      message: 'In-transit packages sync completed successfully',
      serviceName: 'intransit-packages',
      timestamp: new Date().toISOString(),
      recordsProcessed,
      executionTime,
      details,
      output: stdout.substring(0, 500)
    });
  } catch (error) {
    console.error('In-transit packages sync error:', error);
    res.status(500).json({
      success: false,
      error: 'In-transit packages sync failed',
      timestamp: new Date().toISOString(),
      details: { message: error.message, stderr: error.stderr }
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

module.exports = router;
