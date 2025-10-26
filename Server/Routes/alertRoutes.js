/**
 * Alert Routes
 * API endpoints for sync failure alerts
 */

const express = require('express');
const router = express.Router();
const alertController = require('../Controllers/alertController');
const { requireAuth } = require('../Middleware/auth');

// Apply authentication middleware to all routes
router.use(requireAuth);

/**
 * @swagger
 * /api/alerts:
 *   get:
 *     summary: Get all active sync failure alerts
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active alerts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 alerts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       scriptName:
 *                         type: string
 *                       licenseNumber:
 *                         type: string
 *                       level:
 *                         type: string
 *                         enum: [warning, critical]
 *                       count:
 *                         type: integer
 *                       message:
 *                         type: string
 *                       lastFailure:
 *                         type: string
 *                         format: date-time
 *                       lastError:
 *                         type: string
 *                 totalAlerts:
 *                   type: integer
 *                 criticalCount:
 *                   type: integer
 *                 warningCount:
 *                   type: integer
 */
router.get('/', alertController.getAlerts);

/**
 * @swagger
 * /api/alerts/stats:
 *   get:
 *     summary: Get alert statistics
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Alert statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalScripts:
 *                       type: integer
 *                     warningCount:
 *                       type: integer
 *                     criticalCount:
 *                       type: integer
 *                     maxFailures:
 *                       type: integer
 */
router.get('/stats', alertController.getAlertStats);

/**
 * @swagger
 * /api/alerts/script/{scriptName}/{licenseNumber}:
 *   get:
 *     summary: Get alert level for a specific script
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: scriptName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the sync script
 *       - in: path
 *         name: licenseNumber
 *         required: true
 *         schema:
 *           type: string
 *         description: License number
 *     responses:
 *       200:
 *         description: Script alert information
 */
router.get('/script/:scriptName/:licenseNumber', alertController.getScriptAlert);

/**
 * @swagger
 * /api/alerts/reset:
 *   post:
 *     summary: Manually reset failure count for a script
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - scriptName
 *             properties:
 *               scriptName:
 *                 type: string
 *                 description: Name of the sync script
 *               licenseNumber:
 *                 type: string
 *                 description: License number (optional, defaults to CUL000063)
 *     responses:
 *       200:
 *         description: Failure count reset successfully
 *       400:
 *         description: Bad request - missing required fields
 *       500:
 *         description: Internal server error
 */
router.post('/reset', alertController.resetFailureCount);

module.exports = router;
