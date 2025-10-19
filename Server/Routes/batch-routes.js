/**
 * Batch Routes
 * 
 * API routes for batch status management and inventory monitoring
 */

const express = require('express');
const router = express.Router();
const batchController = require('../Controllers/batchController');
const swaggerAuth = require('../Middleware/swagger-auth');
const { auditMiddleware } = require('../Middleware/auditMiddleware');

// Apply authentication middleware to all routes
router.use(swaggerAuth);

/**
 * @swagger
 * components:
 *   schemas:
 *     BatchSummary:
 *       type: object
 *       properties:
 *         productId:
 *           type: integer
 *         statuses:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *               batch_count:
 *                 type: integer
 *               total_quantity:
 *                 type: number
 *         totalBatches:
 *           type: integer
 *         totalQuantity:
 *           type: number
 *     
 *     InventoryStatus:
 *       type: object
 *       properties:
 *         productId:
 *           type: integer
 *         isDepleted:
 *           type: boolean
 *         onDeckBatchesCount:
 *           type: integer
 *         onDeckBatches:
 *           type: array
 *           items:
 *             type: object
 *     
 *     BatchPromotionResult:
 *       type: object
 *       properties:
 *         productId:
 *           type: integer
 *         updatedBatches:
 *           type: array
 *         batchCount:
 *           type: integer
 *     
 *     MonitoringStatus:
 *       type: object
 *       properties:
 *         isRunning:
 *           type: boolean
 *         lastCheckTime:
 *           type: string
 *           format: date-time
 *         checkInterval:
 *           type: integer
 *         nextCheckTime:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/batches/product/{productId}/summary:
 *   get:
 *     summary: Get batch status summary for a product
 *     tags: [Batches]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Batch summary retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/BatchSummary'
 *       400:
 *         description: Invalid product ID
 *       500:
 *         description: Server error
 */
router.get('/product/:productId/summary', batchController.getBatchSummary);

/**
 * @swagger
 * /api/batches/product/{productId}/inventory-status:
 *   get:
 *     summary: Check if product inventory is depleted
 *     tags: [Batches]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Inventory status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/InventoryStatus'
 *       400:
 *         description: Invalid product ID
 *       500:
 *         description: Server error
 */
router.get('/product/:productId/inventory-status', batchController.checkInventoryStatus);

/**
 * @swagger
 * /api/batches/product/{productId}/promote:
 *   post:
 *     summary: Promote On Deck batches to Sellable for a product
 *     tags: [Batches]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Batches promoted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/BatchPromotionResult'
 *       400:
 *         description: Invalid product ID
 *       500:
 *         description: Server error
 */
router.post('/product/:productId/promote', batchController.promoteBatches);

/**
 * @swagger
 * /api/batches/{batchId}/status:
 *   put:
 *     summary: Manually update batch status
 *     tags: [Batches]
 *     parameters:
 *       - in: path
 *         name: batchId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Batch ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [On Deck, Sellable, On Hold, Sold, Destroyed]
 *                 description: New batch status
 *     responses:
 *       200:
 *         description: Batch status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid batch ID or status
 *       500:
 *         description: Server error
 */
router.put('/:batchId/status', auditMiddleware, batchController.updateBatchStatus);

/**
 * @swagger
 * /api/batches/force-check:
 *   post:
 *     summary: Force inventory check for all products
 *     tags: [Batches]
 *     responses:
 *       200:
 *         description: Inventory check completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalProducts:
 *                       type: integer
 *                     productsProcessed:
 *                       type: integer
 *                     totalBatchesPromoted:
 *                       type: integer
 *                     results:
 *                       type: array
 *       500:
 *         description: Server error
 */
router.post('/force-check', auditMiddleware, batchController.forceInventoryCheck);

/**
 * @swagger
 * /api/batches/monitoring-status:
 *   get:
 *     summary: Get inventory monitoring status
 *     tags: [Batches]
 *     responses:
 *       200:
 *         description: Monitoring status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/MonitoringStatus'
 *       500:
 *         description: Server error
 */
router.get('/monitoring-status', batchController.getMonitoringStatus);

/**
 * @swagger
 * /api/batches/start-monitoring:
 *   post:
 *     summary: Start inventory monitoring
 *     tags: [Batches]
 *     responses:
 *       200:
 *         description: Monitoring started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MonitoringStatus'
 *       500:
 *         description: Server error
 */
router.post('/start-monitoring', auditMiddleware, batchController.startMonitoring);

/**
 * @swagger
 * /api/batches/stop-monitoring:
 *   post:
 *     summary: Stop inventory monitoring
 *     tags: [Batches]
 *     responses:
 *       200:
 *         description: Monitoring stopped successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MonitoringStatus'
 *       500:
 *         description: Server error
 */
router.post('/stop-monitoring', auditMiddleware, batchController.stopMonitoring);

/**
 * @swagger
 * /api/batches/monitoring-interval:
 *   put:
 *     summary: Update monitoring interval
 *     tags: [Batches]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               intervalMinutes:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 60
 *                 description: Monitoring interval in minutes
 *     responses:
 *       200:
 *         description: Monitoring interval updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MonitoringStatus'
 *       400:
 *         description: Invalid interval
 *       500:
 *         description: Server error
 */
router.put('/monitoring-interval', auditMiddleware, batchController.updateMonitoringInterval);

module.exports = router;
