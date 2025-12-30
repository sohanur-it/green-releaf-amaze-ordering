// Server/Controllers/healthController.js
// Module 19: Health Checks

const { pool } = require('../config/database');
const metrcAuth = require('../Services/metrcAuth');

class HealthController {
    /**
     * Database health check
     * GET /api/health/db
     */
    static async checkDatabase(req, res) {
        try {
            const client = await pool.connect();
            await client.query('SELECT 1');
            client.release();
            
            res.json({
                status: 'healthy',
                service: 'database',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(503).json({
                status: 'unhealthy',
                service: 'database',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * METRC API health check
     * GET /api/health/metrc
     */
    static async checkMetrc(req, res) {
        try {
            // Try to get a valid access token (this will authenticate if needed)
            const token = await metrcAuth.getAccessToken();
            
            if (token) {
                res.json({
                    status: 'healthy',
                    service: 'metrc',
                    token_status: metrcAuth.getTokenStatus(),
                    timestamp: new Date().toISOString()
                });
            } else {
                res.status(503).json({
                    status: 'unhealthy',
                    service: 'metrc',
                    error: 'Failed to obtain METRC access token',
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            res.status(503).json({
                status: 'unhealthy',
                service: 'metrc',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * WebSocket health check
     * GET /api/health/websocket
     */
    static async checkWebSocket(req, res) {
        try {
            const websocketService = require('../Services/websocketService');
            // Get connection count from WebSocket server
            const connectionCount = websocketService.wss 
                ? websocketService.wss.clients.size 
                : 0;
            
            res.json({
                status: websocketService.wss ? 'healthy' : 'unhealthy',
                service: 'websocket',
                active_connections: connectionCount,
                is_running: websocketService.isRunning || false,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(503).json({
                status: 'unhealthy',
                service: 'websocket',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Overall health check
     * GET /api/health
     */
    static async checkOverall(req, res) {
        try {
            const [dbHealth, metrcHealth, wsHealth] = await Promise.allSettled([
                this.checkDatabaseInternal(),
                this.checkMetrcInternal(),
                this.checkWebSocketInternal()
            ]);

            const allHealthy = dbHealth.status === 'fulfilled' && 
                              metrcHealth.status === 'fulfilled' && 
                              wsHealth.status === 'fulfilled';

            res.status(allHealthy ? 200 : 503).json({
                status: allHealthy ? 'healthy' : 'degraded',
                services: {
                    database: dbHealth.status === 'fulfilled' ? 'healthy' : 'unhealthy',
                    metrc: metrcHealth.status === 'fulfilled' ? 'healthy' : 'unhealthy',
                    websocket: wsHealth.status === 'fulfilled' ? 'healthy' : 'unhealthy'
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(503).json({
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    async checkDatabaseInternal() {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        return true;
    }

    async checkMetrcInternal() {
        try {
            const token = await metrcAuth.getAccessToken();
            return !!token;
        } catch (error) {
            return false;
        }
    }

    async checkWebSocketInternal() {
        try {
            const websocketService = require('../Services/websocketService');
            return websocketService.wss !== null && websocketService.isRunning === true;
        } catch (error) {
            return false;
        }
    }
}

module.exports = HealthController;

