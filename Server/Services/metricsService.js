// Server/Services/metricsService.js
// Module 19: Monitoring & Alerts

const { pool } = require('../config/database');

class MetricsService {
    /**
     * Get critical metrics for dashboard
     */
    async getCriticalMetrics() {
        const client = await pool.connect();
        
        try {
            const [
                ordersInQueue,
                activeScanningSessions,
                manifestSuccessRate,
                manifestDuration,
                abandonedSessions,
                metrcApiFailures,
                packageScanErrors
            ] = await Promise.all([
                this.getOrdersInQueue(client),
                this.getActiveScanningSessions(client),
                this.getManifestSuccessRate(client),
                this.getManifestDuration(client),
                this.getAbandonedSessions(client),
                this.getMetrcApiFailures(client),
                this.getPackageScanErrors(client)
            ]);

            return {
                success: true,
                metrics: {
                    orders_in_queue: ordersInQueue,
                    active_scanning_sessions: activeScanningSessions,
                    manifest_success_rate: manifestSuccessRate,
                    manifest_duration: manifestDuration,
                    abandoned_sessions: abandonedSessions,
                    metrc_api_failures: metrcApiFailures,
                    package_scan_errors: packageScanErrors
                },
                alerts: this.generateAlerts({
                    ordersInQueue,
                    activeScanningSessions,
                    manifestSuccessRate,
                    manifestDuration,
                    abandonedSessions,
                    metrcApiFailures,
                    packageScanErrors
                })
            };
        } catch (error) {
            console.error('Metrics service error:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Get orders in queue count
     */
    async getOrdersInQueue(client) {
        const result = await client.query(`
            SELECT COUNT(*) as count
            FROM "ORDERS-invoices"
            WHERE status = 'Approved'
                AND created_at >= NOW() - INTERVAL '1 hour'
        `);
        return parseInt(result.rows[0].count || 0);
    }

    /**
     * Get active scanning sessions
     */
    async getActiveScanningSessions(client) {
        const result = await client.query(`
            SELECT COUNT(*) as count
            FROM "ORDERS-scanning-sessions"
            WHERE session_status = 'active'
                AND started_at >= NOW() - INTERVAL '2 hours'
        `);
        return parseInt(result.rows[0].count || 0);
    }

    /**
     * Get manifest success rate (last 24 hours)
     */
    async getManifestSuccessRate(client) {
        const result = await client.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status IN ('Manifested', 'Partially_Manifested')) as success_count,
                COUNT(*) FILTER (WHERE manifest_created_at IS NOT NULL) as total_attempts
            FROM "ORDERS-invoices"
            WHERE manifest_created_at >= NOW() - INTERVAL '24 hours'
        `);
        
        const successCount = parseInt(result.rows[0].success_count || 0);
        const totalAttempts = parseInt(result.rows[0].total_attempts || 0);
        
        return totalAttempts > 0 ? (successCount / totalAttempts) * 100 : 100;
    }

    /**
     * Get manifest creation duration (p95)
     */
    async getManifestDuration(client) {
        // This would require tracking manifest creation start/end times
        // Placeholder for now
        return {
            p50: 0,
            p95: 0,
            p99: 0,
            note: 'Requires manifest creation timing tracking'
        };
    }

    /**
     * Get abandoned sessions count (last 24 hours)
     */
    async getAbandonedSessions(client) {
        const result = await client.query(`
            SELECT COUNT(*) as count
            FROM "ORDERS-scanning-sessions"
            WHERE session_status = 'abandoned'
                AND abandoned_at >= NOW() - INTERVAL '24 hours'
        `);
        return parseInt(result.rows[0].count || 0);
    }

    /**
     * Get METRC API failures (last 24 hours)
     */
    async getMetrcApiFailures(client) {
        const result = await client.query(`
            SELECT COUNT(*) as count
            FROM "ORDERS-audit_log"
            WHERE action LIKE '%metrc%'
                AND status = 'failure'
                AND timestamp >= NOW() - INTERVAL '24 hours'
        `);
        return parseInt(result.rows[0].count || 0);
    }

    /**
     * Get package scan errors (last hour)
     */
    async getPackageScanErrors(client) {
        const result = await client.query(`
            SELECT COUNT(*) as count
            FROM "ORDERS-invoice-history"
            WHERE modification_type LIKE '%scan%error%'
                AND created_at >= NOW() - INTERVAL '1 hour'
        `);
        return parseInt(result.rows[0].count || 0);
    }

    /**
     * Generate alerts based on metrics
     */
    generateAlerts(metrics) {
        const alerts = [];

        // Orders in Queue > 50 for more than 1 hour
        if (metrics.ordersInQueue > 50) {
            alerts.push({
                level: 'warning',
                message: `${metrics.ordersInQueue} orders in queue (threshold: 50)`,
                metric: 'orders_in_queue'
            });
        }

        // Active scanning sessions > 2 hours
        if (metrics.activeScanningSessions > 0) {
            alerts.push({
                level: 'info',
                message: `${metrics.activeScanningSessions} active scanning session(s)`,
                metric: 'active_scanning_sessions'
            });
        }

        // Manifest success rate < 95%
        if (metrics.manifestSuccessRate < 95) {
            alerts.push({
                level: 'error',
                message: `Manifest success rate is ${metrics.manifestSuccessRate.toFixed(1)}% (threshold: 95%)`,
                metric: 'manifest_success_rate'
            });
        }

        // Abandoned sessions > 10 per day
        if (metrics.abandonedSessions > 10) {
            alerts.push({
                level: 'warning',
                message: `${metrics.abandonedSessions} abandoned sessions today (threshold: 10)`,
                metric: 'abandoned_sessions'
            });
        }

        // Package scan errors > 50 per hour
        if (metrics.packageScanErrors > 50) {
            alerts.push({
                level: 'error',
                message: `${metrics.packageScanErrors} package scan errors in the last hour (threshold: 50)`,
                metric: 'package_scan_errors'
            });
        }

        return alerts;
    }
}

module.exports = new MetricsService();



