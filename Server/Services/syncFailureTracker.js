/**
 * Sync Failure Tracking Service
 * Tracks consecutive failures for sync scripts and provides alert levels
 */

const { Pool } = require('pg');
const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
}

// Create database pool
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }
});

class SyncFailureTracker {
    constructor() {
        this.WARNING_THRESHOLD = 3;
        this.CRITICAL_THRESHOLD = 5;
        this.STALENESS_THRESHOLD_HOURS = 1; // Alert if no success in >1 hour
    }

    /**
     * Record a sync failure
     * @param {string} scriptName - Name of the sync script (e.g., 'sync-outgoing-transfers')
     * @param {string} errorMessage - Error message from the failure
     * @param {string} licenseNumber - License number for the sync
     */
    async recordFailure(scriptName, errorMessage, licenseNumber = 'CUL000063') {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Get current failure count
            const currentResult = await client.query(`
                SELECT consecutive_failures, last_failure_time 
                FROM sync_failure_tracking 
                WHERE script_name = $1 AND license_number = $2
            `, [scriptName, licenseNumber]);

            let consecutiveFailures = 1;
            let lastFailureTime = new Date();

            if (currentResult.rows.length > 0) {
                const current = currentResult.rows[0];
                consecutiveFailures = current.consecutive_failures + 1;
                lastFailureTime = new Date();
            }

            // Upsert failure tracking record
            await client.query(`
                INSERT INTO sync_failure_tracking (
                    script_name, license_number, consecutive_failures, 
                    last_failure_time, last_error_message, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                ON CONFLICT (script_name, license_number)
                DO UPDATE SET
                    consecutive_failures = EXCLUDED.consecutive_failures,
                    last_failure_time = EXCLUDED.last_failure_time,
                    last_error_message = EXCLUDED.last_error_message,
                    updated_at = NOW()
            `, [scriptName, licenseNumber, consecutiveFailures, lastFailureTime, errorMessage]);

            await client.query('COMMIT');

            console.log(`📊 Recorded failure #${consecutiveFailures} for ${scriptName}`);
            return consecutiveFailures;

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error recording sync failure:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Reset failure count on successful sync
     * @param {string} scriptName - Name of the sync script
     * @param {string} licenseNumber - License number for the sync
     */
    async recordSuccess(scriptName, licenseNumber = 'CUL000063') {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Reset failure count to 0
            await client.query(`
                INSERT INTO sync_failure_tracking (
                    script_name, license_number, consecutive_failures, 
                    last_success_time, created_at, updated_at
                ) VALUES ($1, $2, 0, NOW(), NOW(), NOW())
                ON CONFLICT (script_name, license_number)
                DO UPDATE SET
                    consecutive_failures = 0,
                    last_success_time = NOW(),
                    updated_at = NOW()
            `, [scriptName, licenseNumber]);

            await client.query('COMMIT');

            console.log(`✅ Reset failure count for ${scriptName}`);

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error recording sync success:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get alert level for a script
     * @param {string} scriptName - Name of the sync script
     * @param {string} licenseNumber - License number for the sync
     * @returns {Object} Alert information
     */
    async getAlertLevel(scriptName, licenseNumber = 'CUL000063') {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT consecutive_failures, last_failure_time, last_error_message
                FROM sync_failure_tracking 
                WHERE script_name = $1 AND license_number = $2
            `, [scriptName, licenseNumber]);

            if (result.rows.length === 0) {
                return { level: 'none', count: 0, message: null };
            }

            const { consecutive_failures, last_failure_time, last_error_message } = result.rows[0];

            if (consecutive_failures >= this.CRITICAL_THRESHOLD) {
                return {
                    level: 'critical',
                    count: consecutive_failures,
                    message: `CRITICAL: ${scriptName} has failed ${consecutive_failures} times consecutively`,
                    lastFailure: last_failure_time,
                    lastError: last_error_message
                };
            } else if (consecutive_failures >= this.WARNING_THRESHOLD) {
                return {
                    level: 'warning',
                    count: consecutive_failures,
                    message: `WARNING: ${scriptName} has failed ${consecutive_failures} times consecutively`,
                    lastFailure: last_failure_time,
                    lastError: last_error_message
                };
            }

            return { level: 'none', count: consecutive_failures, message: null };

        } catch (error) {
            console.error('❌ Error getting alert level:', error.message);
            return { level: 'none', count: 0, message: null };
        } finally {
            client.release();
        }
    }

    /**
     * Get all active alerts across all scripts
     * @returns {Array} Array of alert objects
     */
    async getAllAlerts() {
        const client = await pool.connect();
        try {
            // Get alerts for consecutive failures
            const failureResult = await client.query(`
                SELECT script_name, license_number, consecutive_failures, 
                       last_failure_time, last_error_message
                FROM sync_failure_tracking 
                WHERE consecutive_failures >= $1
                ORDER BY consecutive_failures DESC, last_failure_time DESC
            `, [this.WARNING_THRESHOLD]);

            const failureAlerts = failureResult.rows.map(row => {
                const { script_name, license_number, consecutive_failures, last_failure_time, last_error_message } = row;
                
                let level = 'warning';
                if (consecutive_failures >= this.CRITICAL_THRESHOLD) {
                    level = 'critical';
                }

                return {
                    scriptName: script_name,
                    licenseNumber: license_number,
                    level,
                    count: consecutive_failures,
                    message: `${level.toUpperCase()}: ${script_name} has failed ${consecutive_failures} times consecutively`,
                    lastFailure: last_failure_time,
                    lastError: last_error_message,
                    alertType: 'consecutive_failures'
                };
            });

            // Get alerts for sync staleness (no success in >1 hour)
            const stalenessResult = await client.query(`
                SELECT script_name, license_number, last_success_time
                FROM sync_failure_tracking 
                WHERE last_success_time IS NULL 
                   OR last_success_time < NOW() - INTERVAL '1 hour'
                ORDER BY last_success_time DESC NULLS LAST
            `);

            const stalenessAlerts = stalenessResult.rows.map(row => {
                const { script_name, license_number, last_success_time } = row;
                
                // Calculate hours since last success
                const hoursSinceLastSuccess = last_success_time 
                    ? Math.floor((Date.now() - new Date(last_success_time).getTime()) / (1000 * 60 * 60))
                    : null;
                
                return {
                    scriptName: script_name,
                    licenseNumber: license_number,
                    level: 'warning',
                    count: hoursSinceLastSuccess,
                    message: `STALE: ${script_name} has not had a successful sync in ${hoursSinceLastSuccess || 'N/A'} hour(s)`,
                    lastSuccess: last_success_time,
                    lastError: null,
                    alertType: 'staleness'
                };
            });

            // Combine and deduplicate (if a sync has both failure and staleness alerts, keep the critical one)
            const allAlertsMap = new Map();
            
            // Add staleness alerts first
            stalenessAlerts.forEach(alert => {
                const key = `${alert.scriptName}_${alert.licenseNumber}`;
                allAlertsMap.set(key, alert);
            });
            
            // Add failure alerts (overwrite staleness if critical)
            failureAlerts.forEach(alert => {
                const key = `${alert.scriptName}_${alert.licenseNumber}`;
                const existing = allAlertsMap.get(key);
                if (!existing || alert.level === 'critical') {
                    allAlertsMap.set(key, alert);
                }
            });

            return Array.from(allAlertsMap.values());

        } catch (error) {
            console.error('❌ Error getting all alerts:', error.message);
            return [];
        } finally {
            client.release();
        }
    }

    /**
     * Get failure statistics for dashboard
     * @returns {Object} Statistics object
     */
    async getFailureStats() {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT 
                    COUNT(*) as total_scripts,
                    COUNT(CASE WHEN consecutive_failures >= $1 THEN 1 END) as warning_count,
                    COUNT(CASE WHEN consecutive_failures >= $2 THEN 1 END) as critical_count,
                    MAX(consecutive_failures) as max_failures
                FROM sync_failure_tracking
            `, [this.WARNING_THRESHOLD, this.CRITICAL_THRESHOLD]);

            const stats = result.rows[0];
            return {
                totalScripts: parseInt(stats.total_scripts),
                warningCount: parseInt(stats.warning_count),
                criticalCount: parseInt(stats.critical_count),
                maxFailures: parseInt(stats.max_failures)
            };

        } catch (error) {
            console.error('❌ Error getting failure stats:', error.message);
            return { totalScripts: 0, warningCount: 0, criticalCount: 0, maxFailures: 0 };
        } finally {
            client.release();
        }
    }
}

module.exports = new SyncFailureTracker();
