// Server/Services/performanceMonitoringService.js
// Module 13: Performance & Monitoring

const { pool } = require('../config/database');

class PerformanceMonitoringService {
    /**
     * Monitor fulfillment queue performance
     * Should be <500ms
     */
    async monitorFulfillmentQueue() {
        const startTime = Date.now();
        const client = await pool.connect();
        
        try {
            await client.query(`
                SELECT COUNT(*) 
                FROM "ORDERS-invoices"
                WHERE status = 'Approved'
            `);
            
            const duration = Date.now() - startTime;
            
            return {
                metric: 'fulfillment_queue',
                duration_ms: duration,
                threshold_ms: 500,
                status: duration < 500 ? 'healthy' : 'degraded',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                metric: 'fulfillment_queue',
                duration_ms: Date.now() - startTime,
                threshold_ms: 500,
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        } finally {
            client.release();
        }
    }

    /**
     * Monitor scanning validation performance
     * Should be <200ms
     */
    async monitorScanningValidation() {
        const startTime = Date.now();
        const client = await pool.connect();
        
        try {
            // Simulate scanning validation query
            await client.query(`
                SELECT COUNT(*) 
                FROM activepackages
                WHERE isarchived = false
                LIMIT 1
            `);
            
            const duration = Date.now() - startTime;
            
            return {
                metric: 'scanning_validation',
                duration_ms: duration,
                threshold_ms: 200,
                status: duration < 200 ? 'healthy' : 'degraded',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                metric: 'scanning_validation',
                duration_ms: Date.now() - startTime,
                threshold_ms: 200,
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        } finally {
            client.release();
        }
    }

    /**
     * Monitor manifest creation performance
     * Should be <2 seconds
     */
    async monitorManifestCreation() {
        // This would be called during actual manifest creation
        // For now, return a placeholder
        return {
            metric: 'manifest_creation',
            duration_ms: 0,
            threshold_ms: 2000,
            status: 'not_measured',
            note: 'Measured during actual manifest creation',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get all performance metrics
     */
    async getAllMetrics() {
        const [queue, scanning] = await Promise.all([
            this.monitorFulfillmentQueue(),
            this.monitorScanningValidation()
        ]);

        return {
            success: true,
            metrics: {
                fulfillment_queue: queue,
                scanning_validation: scanning,
                manifest_creation: await this.monitorManifestCreation()
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Run EXPLAIN ANALYZE on a query
     */
    async explainAnalyze(query, params = []) {
        const client = await pool.connect();
        
        try {
            const result = await client.query(`EXPLAIN ANALYZE ${query}`, params);
            return {
                success: true,
                explain: result.rows.map(r => r['QUERY PLAN'] || r['query plan'] || r['QUERY PLAN']).join('\n')
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }
}

module.exports = new PerformanceMonitoringService();



