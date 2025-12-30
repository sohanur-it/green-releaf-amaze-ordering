// Server/Services/restoreArchiveService.js
// Module 20: Restore from Archive

const { query, pool } = require('../config/database');
const auditLogger = require('./auditLogger');

class RestoreArchiveService {
    /**
     * Restore scanning sessions from archive
     */
    async restoreScanningSessions(sessionIds, userId) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get archived sessions
            const archivedSessions = await client.query(`
                SELECT *
                FROM "ORDERS-scanning-sessions-archive"
                WHERE id = ANY($1)
            `, [sessionIds]);
            
            if (archivedSessions.rows.length === 0) {
                throw new Error('No archived sessions found');
            }
            
            const restoredSessions = [];
            
            // Restore each session
            for (const session of archivedSessions.rows) {
                // Insert back into active table
                await client.query(`
                    INSERT INTO "ORDERS-scanning-sessions" (
                        id, fk_invoice_id, fk_user_id, session_status,
                        currently_locked_packages, last_activity, started_at,
                        completed_at, cancelled_at, abandoned_at, websocket_connection_id
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    session.id,
                    session.fk_invoice_id,
                    session.fk_user_id,
                    session.session_status,
                    session.currently_locked_packages,
                    session.last_activity,
                    session.started_at,
                    session.completed_at,
                    session.cancelled_at,
                    session.abandoned_at,
                    session.websocket_connection_id
                ]);
                
                restoredSessions.push({
                    session_id: session.id,
                    invoice_id: session.fk_invoice_id
                });
            }
            
            // Log restore operation
            await auditLogger.logAction({
                userId: userId,
                action: 'restore_from_archive',
                resourceType: 'ScanningSession',
                details: {
                    archive_type: 'scanning_sessions',
                    restored_count: restoredSessions.length,
                    session_ids: sessionIds
                },
                status: 'success'
            });
            
            await client.query('COMMIT');
            
            return {
                success: true,
                restored_count: restoredSessions.length,
                sessions: restoredSessions
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Restore manifest packages from archive
     */
    async restoreManifestPackages(packageIds, userId) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get archived packages
            const archivedPackages = await client.query(`
                SELECT *
                FROM "ORDERS-manifest-packages-archive"
                WHERE id = ANY($1)
            `, [packageIds]);
            
            if (archivedPackages.rows.length === 0) {
                throw new Error('No archived packages found');
            }
            
            const restoredPackages = [];
            
            // Restore each package
            for (const pkg of archivedPackages.rows) {
                // Insert back into active table
                await client.query(`
                    INSERT INTO "ORDERS-manifest-packages" (
                        id, fk_invoice_id, manifest_number, package_label, package_metrc_id,
                        batch_id, line_item_id, quantity, wholesale_price, gross_weight,
                        package_status, voided_at, voided_by, synclicense, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    pkg.id,
                    pkg.fk_invoice_id,
                    pkg.manifest_number,
                    pkg.package_label,
                    pkg.package_metrc_id,
                    pkg.batch_id,
                    pkg.line_item_id,
                    pkg.quantity,
                    pkg.wholesale_price,
                    pkg.gross_weight,
                    pkg.package_status,
                    pkg.voided_at,
                    pkg.voided_by,
                    pkg.synclicense,
                    pkg.created_at
                ]);
                
                restoredPackages.push({
                    package_id: pkg.id,
                    invoice_id: pkg.fk_invoice_id,
                    package_label: pkg.package_label
                });
            }
            
            // Log restore operation
            await auditLogger.logAction({
                userId: userId,
                action: 'restore_from_archive',
                resourceType: 'ManifestPackage',
                details: {
                    archive_type: 'manifest_packages',
                    restored_count: restoredPackages.length,
                    package_ids: packageIds
                },
                status: 'success'
            });
            
            await client.query('COMMIT');
            
            return {
                success: true,
                restored_count: restoredPackages.length,
                packages: restoredPackages
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Restore cancelled shipment packages from archive
     */
    async restoreCancelledShipments(packageIds, userId) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get archived packages
            const archivedPackages = await client.query(`
                SELECT *
                FROM "ORDERS-cancelled-shipment-packages-archive"
                WHERE id = ANY($1)
            `, [packageIds]);
            
            if (archivedPackages.rows.length === 0) {
                throw new Error('No archived packages found');
            }
            
            const restoredPackages = [];
            
            // Restore each package
            for (const pkg of archivedPackages.rows) {
                // Insert back into active table
                await client.query(`
                    INSERT INTO "ORDERS-cancelled-shipment-packages" (
                        id, fk_invoice_id, package_label, package_metrc_id, batch_id,
                        was_on_manifest, returned_to_inventory, verified_in_metrc,
                        cancellation_reason, incident_type, verified_by, verified_at,
                        admin_notes, allocation_released, allocation_released_at,
                        allocation_released_by, synclicense, created_at, updated_at,
                        deleted_at, deleted_by, cancellation_cleanup_completed
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    pkg.id,
                    pkg.fk_invoice_id,
                    pkg.package_label,
                    pkg.package_metrc_id,
                    pkg.batch_id,
                    pkg.was_on_manifest,
                    pkg.returned_to_inventory,
                    pkg.verified_in_metrc,
                    pkg.cancellation_reason,
                    pkg.incident_type,
                    pkg.verified_by,
                    pkg.verified_at,
                    pkg.admin_notes,
                    pkg.allocation_released,
                    pkg.allocation_released_at,
                    pkg.allocation_released_by,
                    pkg.synclicense,
                    pkg.created_at,
                    pkg.updated_at,
                    pkg.deleted_at,
                    pkg.deleted_by,
                    pkg.cancellation_cleanup_completed
                ]);
                
                restoredPackages.push({
                    package_id: pkg.id,
                    invoice_id: pkg.fk_invoice_id,
                    package_label: pkg.package_label
                });
            }
            
            // Log restore operation
            await auditLogger.logAction({
                userId: userId,
                action: 'restore_from_archive',
                resourceType: 'CancelledShipmentPackage',
                details: {
                    archive_type: 'cancelled_shipment_packages',
                    restored_count: restoredPackages.length,
                    package_ids: packageIds
                },
                status: 'success'
            });
            
            await client.query('COMMIT');
            
            return {
                success: true,
                restored_count: restoredPackages.length,
                packages: restoredPackages
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Search archived records
     */
    async searchArchive(archiveType, filters) {
        const client = await pool.connect();
        
        try {
            let queryStr = '';
            let params = [];
            let paramCount = 1;
            
            switch (archiveType) {
                case 'scanning_sessions':
                    queryStr = `
                        SELECT 
                            ss.*,
                            i.invoice_number
                        FROM "ORDERS-scanning-sessions-archive" ss
                        JOIN "ORDERS-invoices" i ON ss.fk_invoice_id = i.id
                        WHERE 1=1
                    `;
                    
                    if (filters.invoice_id) {
                        queryStr += ` AND ss.fk_invoice_id = $${paramCount++}`;
                        params.push(filters.invoice_id);
                    }
                    
                    if (filters.date_from) {
                        queryStr += ` AND ss.archived_at >= $${paramCount++}`;
                        params.push(filters.date_from);
                    }
                    
                    if (filters.date_to) {
                        queryStr += ` AND ss.archived_at <= $${paramCount++}`;
                        params.push(filters.date_to);
                    }
                    
                    queryStr += ` ORDER BY ss.archived_at DESC LIMIT 100`;
                    break;
                    
                case 'manifest_packages':
                    queryStr = `
                        SELECT 
                            mp.*,
                            i.invoice_number
                        FROM "ORDERS-manifest-packages-archive" mp
                        JOIN "ORDERS-invoices" i ON mp.fk_invoice_id = i.id
                        WHERE 1=1
                    `;
                    
                    if (filters.invoice_id) {
                        queryStr += ` AND mp.fk_invoice_id = $${paramCount++}`;
                        params.push(filters.invoice_id);
                    }
                    
                    if (filters.package_label) {
                        queryStr += ` AND mp.package_label = $${paramCount++}`;
                        params.push(filters.package_label);
                    }
                    
                    if (filters.date_from) {
                        queryStr += ` AND mp.archived_at >= $${paramCount++}`;
                        params.push(filters.date_from);
                    }
                    
                    if (filters.date_to) {
                        queryStr += ` AND mp.archived_at <= $${paramCount++}`;
                        params.push(filters.date_to);
                    }
                    
                    queryStr += ` ORDER BY mp.archived_at DESC LIMIT 100`;
                    break;
                    
                case 'cancelled_shipments':
                    queryStr = `
                        SELECT 
                            csp.*,
                            i.invoice_number
                        FROM "ORDERS-cancelled-shipment-packages-archive" csp
                        JOIN "ORDERS-invoices" i ON csp.fk_invoice_id = i.id
                        WHERE 1=1
                    `;
                    
                    if (filters.invoice_id) {
                        queryStr += ` AND csp.fk_invoice_id = $${paramCount++}`;
                        params.push(filters.invoice_id);
                    }
                    
                    if (filters.package_label) {
                        queryStr += ` AND csp.package_label = $${paramCount++}`;
                        params.push(filters.package_label);
                    }
                    
                    if (filters.date_from) {
                        queryStr += ` AND csp.archived_at >= $${paramCount++}`;
                        params.push(filters.date_from);
                    }
                    
                    if (filters.date_to) {
                        queryStr += ` AND csp.archived_at <= $${paramCount++}`;
                        params.push(filters.date_to);
                    }
                    
                    queryStr += ` ORDER BY csp.archived_at DESC LIMIT 100`;
                    break;
                    
                default:
                    throw new Error(`Unknown archive type: ${archiveType}`);
            }
            
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

module.exports = new RestoreArchiveService();



