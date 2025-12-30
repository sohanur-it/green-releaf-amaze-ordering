// Server/Routes/health-routes.js
// Module 19: Health Check Routes

const express = require('express');
const router = express.Router();
const healthController = require('../Controllers/healthController');

/**
 * GET /api/health
 * Overall health check
 */
router.get('/', healthController.checkOverall.bind(healthController));

/**
 * GET /api/health/db
 * Database health check
 */
router.get('/db', healthController.checkDatabase.bind(healthController));

/**
 * GET /api/health/metrc
 * METRC API health check
 */
router.get('/metrc', healthController.checkMetrc.bind(healthController));

/**
 * GET /api/health/websocket
 * WebSocket health check
 */
router.get('/websocket', healthController.checkWebSocket.bind(healthController));

module.exports = router;



