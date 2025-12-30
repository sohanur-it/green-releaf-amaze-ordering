// Server/Services/purgeArchiveService.js
// Module 20: Purge Archive Policy

const { query, pool } = require('../config/database');
const auditLogger = require('./auditLogger');

class PurgeArchiveService {
    /**
     * Purge scanning sessions from archive (after 1 year retention)
     * Requires super_admin role and approval
     */
    async purgeScanningSessions(sessionIds, userId, purgeReason, approvalReference, approvalDocumentPath) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Validate reason length
            if (!purgeReason || purgeReason.trim().length < 100) {
                throw new Error('Purge reason is required (minimum 100 characters)');
            }
            
            // Verify records are eligible for purge (older than 1 year)
            const eligibleSessions = await client.query(`
                SELECT id, archived_at
                FROM "ORDERS-scanning-sessions-archive"
                WHERE id = ANY($1)
                    AND archived_at < NOW() - INTERVAL '1 year'
            `, [sessionIds]);
            
            if (eligibleSessions.rows.length === 0) {
                throw new Error('No eligible records found for purge (must be archived for at least 1 year)');
            }
            
            if (eligibleSessions.rows.length !== sessionIds.length) {
                throw new Error('Some records are not eligible for purge (must be archived for at least 1 year)');
            }
            
            const eligibleIds = eligibleSessions.rows.map(r => r.id);
            
            // Delete from archive
            const deleteResult = await client.query(`
                DELETE FROM "ORDERS-scanning-sessions-archive"
                WHERE id = ANY($1)
            `, [eligibleIds]);
            
            const purgedCount = deleteResult.rowCount;
            
            // Log purge operation (immutable)
            await client.query(`
                INSERT INTO "ORDERS-purge-log" (
                    archive_type,
                    purged_record_ids,
                    purged_count,
                    approval_document_path,
                    approval_reference,
                    approval_date,
                    purge_reason,
                    purged_by,
                    additional_details
                ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)
            `, [
                'scanning_sessions',
                eligibleIds,
                purgedCount,
                approvalDocumentPath || null,
                approvalReference || null,
                purgeReason.trim(),
                userId,
                JSON.stringify({
                    retention_period: '1 year',
                    archived_dates: eligibleSessions.rows.map(r => r.archived_at)
                })
            ]);
            
            // Log to audit
            await auditLogger.logAction({
                userId: userId,
                action: 'purge_archive',
                resourceType: 'ScanningSession',
                details: {
                    archive_type: 'scanning_sessions',
                    purged_count: purgedCount,
                    session_ids: eligibleIds,
                    approval_reference: approvalReference
                },
                status: 'success'
            });
            
            await client.query('COMMIT');
            
            return {
                success: true,
                purged_count: purgedCount,
                session_ids: eligibleIds
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Purge cancelled shipment packages from archive (after 2 years retention)
     */
    async purgeCancelledShipments(packageIds, userId, purgeReason, approvalReference, approvalDocumentPath) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Validate reason length
            if (!purgeReason || purgeReason.trim().length < 100) {
                throw new Error('Purge reason is required (minimum 100 characters)');
            }
            
            // Verify records are eligible for purge (older than 2 years)
            const eligiblePackages = await client.query(`
                SELECT id, archived_at
                FROM "ORDERS-cancelled-shipment-packages-archive"
                WHERE id = ANY($1)
                    AND archived_at < NOW() - INTERVAL '2 years'
            `, [packageIds]);
            
            if (eligiblePackages.rows.length === 0) {
                throw new Error('No eligible records found for purge (must be archived for at least 2 years)');
            }
            
            if (eligiblePackages.rows.length !== packageIds.length) {
                throw new Error('Some records are not eligible for purge (must be archived for at least 2 years)');
            }
            
            const eligibleIds = eligiblePackages.rows.map(r => r.id);
            
            // Delete from archive
            const deleteResult = await client.query(`
                DELETE FROM "ORDERS-cancelled-shipment-packages-archive"
                WHERE id = ANY($1)
            `, [eligibleIds]);
            
            const purgedCount = deleteResult.rowCount;
            
            // Log purge operation
            await client.query(`
                INSERT INTO "ORDERS-purge-log" (
                    archive_type,
                    purged_record_ids,
                    purged_count,
                    approval_document_path,
                    approval_reference,
                    approval_date,
                    purge_reason,
                    purged_by,
                    additional_details
                ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)
            `, [
                'cancelled_shipment_packages',
                eligibleIds,
                purgedCount,
                approvalDocumentPath || null,
                approvalReference || null,
                purgeReason.trim(),
                userId,
                JSON.stringify({
                    retention_period: '2 years',
                    archived_dates: eligiblePackages.rows.map(r => r.archived_at)
                })
            ]);
            
            // Log to audit
            await auditLogger.logAction({
                userId: userId,
                action: 'purge_archive',
                resourceType: 'CancelledShipmentPackage',
                details: {
                    archive_type: 'cancelled_shipment_packages',
                    purged_count: purgedCount,
                    package_ids: eligibleIds,
                    approval_reference: approvalReference
                },
                status: 'success'
            });
            
            await client.query('COMMIT');
            
            return {
                success: true,
                purged_count: purgedCount,
                package_ids: eligibleIds
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get purge log history
     */
    async getPurgeLog(filters = {}) {
        const client = await pool.connect();
        
        try {
            let queryStr = `
                SELECT 
                    pl.*,
                    u.username as purged_by_username
                FROM "ORDERS-purge-log" pl
                LEFT JOIN users u ON pl.purged_by = u.id
                WHERE 1=1
            `;
            
            const params = [];
            let paramCount = 1;
            
            if (filters.archive_type) {
                queryStr += ` AND pl.archive_type = $${paramCount++}`;
                params.push(filters.archive_type);
            }
            
            if (filters.user_id) {
                queryStr += ` AND pl.purged_by = $${paramCount++}`;
                params.push(filters.user_id);
            }
            
            if (filters.date_from) {
                queryStr += ` AND pl.purged_at >= $${paramCount++}`;
                params.push(filters.date_from);
            }
            
            if (filters.date_to) {
                queryStr += ` AND pl.purged_at <= $${paramCount++}`;
                params.push(filters.date_to);
            }
            
            queryStr += ` ORDER BY pl.purged_at DESC LIMIT 100`;
            
            const result = await client.query(queryStr, params);
            
            return {
                success: true,
                count: result.rows.length,
                records: result.rows
            };
            
        } catch (error) {
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new PurgeArchiveService();



