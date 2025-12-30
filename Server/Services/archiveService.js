// Server/Services/archiveService.js
// Module 20: Data Retention & Archival

const { query, pool } = require('../config/database');
const auditLogger = require('./auditLogger');

class ArchiveService {
    /**
     * Archive old scanning sessions (older than 30 days)
     * Scheduled: Daily at 2 AM
     */
    async archiveScanningSessions() {
        const client = await pool.connect();
        
        try {
            console.log('[Archive] Starting scanning sessions archive...');
            
            // Call PostgreSQL function
            const result = await client.query('SELECT * FROM archive_old_scanning_sessions()');
            
            const archivedCount = result.rows[0]?.archived_count || 0;
            const remainingCount = result.rows[0]?.remaining_count || 0;
            
            console.log(`[Archive] Scanning sessions: ${archivedCount} archived, ${remainingCount} remaining`);
            
            // Log to audit
            await auditLogger.logSystemAction(
                'archive_scanning_sessions',
                'Archive',
                'scanning_sessions',
                {
                    archived_count: archivedCount,
                    remaining_count: remainingCount
                },
                'success'
            );
            
            return {
                success: true,
                archived_count: archivedCount,
                remaining_count: remainingCount
            };
            
        } catch (error) {
            console.error('[Archive] Error archiving scanning sessions:', error);
            
            // Log error
            await auditLogger.logSystemAction(
                'archive_scanning_sessions',
                'Archive',
                'scanning_sessions',
                { error: error.message },
                'error'
            );
            
            // Send notification to admin (placeholder - implement email service)
            console.error('[Archive] ⚠️ Archive job failed - admin notification needed');
            
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Archive old manifest packages (older than 1 year for delivered invoices)
     * Scheduled: Monthly, 1st of month at 2 AM
     */
    async archiveManifestPackages() {
        const client = await pool.connect();
        
        try {
            console.log('[Archive] Starting manifest packages archive...');
            
            // Call PostgreSQL function
            const result = await client.query('SELECT * FROM archive_old_manifest_packages()');
            
            const archivedCount = result.rows[0]?.archived_count || 0;
            const remainingCount = result.rows[0]?.remaining_count || 0;
            
            console.log(`[Archive] Manifest packages: ${archivedCount} archived, ${remainingCount} remaining`);
            
            // Log to audit
            await auditLogger.logSystemAction(
                'archive_manifest_packages',
                'Archive',
                'manifest_packages',
                {
                    archived_count: archivedCount,
                    remaining_count: remainingCount
                },
                'success'
            );
            
            return {
                success: true,
                archived_count: archivedCount,
                remaining_count: remainingCount
            };
            
        } catch (error) {
            console.error('[Archive] Error archiving manifest packages:', error);
            
            // Log error
            await auditLogger.logSystemAction(
                'archive_manifest_packages',
                'Archive',
                'manifest_packages',
                { error: error.message },
                'error'
            );
            
            // Send notification to admin
            console.error('[Archive] ⚠️ Archive job failed - admin notification needed');
            
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Archive resolved cancelled shipment packages
     * Scheduled: Weekly, Sunday at 3 AM
     */
    async archiveCancelledShipments() {
        const client = await pool.connect();
        
        try {
            console.log('[Archive] Starting cancelled shipment packages archive...');
            
            // Call PostgreSQL function
            const result = await client.query('SELECT * FROM archive_resolved_cancelled_shipments()');
            
            const archivedCount = result.rows[0]?.archived_count || 0;
            const remainingCount = result.rows[0]?.remaining_count || 0;
            
            console.log(`[Archive] Cancelled shipments: ${archivedCount} archived, ${remainingCount} remaining`);
            
            // Log to audit
            await auditLogger.logSystemAction(
                'archive_cancelled_shipments',
                'Archive',
                'cancelled_shipment_packages',
                {
                    archived_count: archivedCount,
                    remaining_count: remainingCount
                },
                'success'
            );
            
            return {
                success: true,
                archived_count: archivedCount,
                remaining_count: remainingCount
            };
            
        } catch (error) {
            console.error('[Archive] Error archiving cancelled shipments:', error);
            
            // Log error
            await auditLogger.logSystemAction(
                'archive_cancelled_shipments',
                'Archive',
                'cancelled_shipment_packages',
                { error: error.message },
                'error'
            );
            
            // Send notification to admin
            console.error('[Archive] ⚠️ Archive job failed - admin notification needed');
            
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get archive statistics for admin dashboard
     */
    async getArchiveStats() {
        const client = await pool.connect();
        
        try {
            const stats = {};
            
            // Scanning sessions archive stats
            const sessionsResult = await client.query(`
                SELECT 
                    COUNT(*) as archived_count,
                    MAX(archived_at) as last_archived_at
                FROM "ORDERS-scanning-sessions-archive"
            `);
            stats.scanning_sessions = {
                archived_count: parseInt(sessionsResult.rows[0]?.archived_count || 0),
                last_archived_at: sessionsResult.rows[0]?.last_archived_at
            };
            
            // Manifest packages archive stats
            const manifestResult = await client.query(`
                SELECT 
                    COUNT(*) as archived_count,
                    MAX(archived_at) as last_archived_at
                FROM "ORDERS-manifest-packages-archive"
            `);
            stats.manifest_packages = {
                archived_count: parseInt(manifestResult.rows[0]?.archived_count || 0),
                last_archived_at: manifestResult.rows[0]?.last_archived_at
            };
            
            // Cancelled shipments archive stats
            const cancelledResult = await client.query(`
                SELECT 
                    COUNT(*) as archived_count,
                    MAX(archived_at) as last_archived_at
                FROM "ORDERS-cancelled-shipment-packages-archive"
            `);
            stats.cancelled_shipments = {
                archived_count: parseInt(cancelledResult.rows[0]?.archived_count || 0),
                last_archived_at: cancelledResult.rows[0]?.last_archived_at
            };
            
            return stats;
            
        } catch (error) {
            console.error('[Archive] Error getting archive stats:', error);
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new ArchiveService();



