// Server/Services/recoveryToolsService.js
// Module 15: Error Handling & Recovery - Recovery Tools

const { pool } = require('../config/database');

class RecoveryToolsService {
    /**
     * Recover stuck scanning sessions
     * Finds sessions that are older than 2 hours and still active
     */
    async recoverStuckScanningSessions() {
        const client = await pool.connect();
        
        try {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            
            const result = await client.query(`
                UPDATE "ORDERS-scanning-sessions"
                SET status = 'abandoned',
                    ended_at = NOW()
                WHERE status = 'active'
                AND created_at < $1
                RETURNING id, fk_invoice_id, fk_user_id
            `, [twoHoursAgo]);
            
            // Release locks for recovered sessions
            for (const session of result.rows) {
                try {
                    const websocketService = require('./websocketService');
                    await websocketService.releaseLocksForDisconnectedUser(session.fk_user_id);
                } catch (error) {
                    console.error(`Error releasing locks for session ${session.id}:`, error);
                }
            }
            
            return {
                success: true,
                recovered_sessions: result.rows.length,
                sessions: result.rows
            };
        } catch (error) {
            console.error('Error recovering stuck sessions:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Recover orphaned package locks
     * Finds packages locked by users who are no longer connected
     */
    async recoverOrphanedLocks() {
        const client = await pool.connect();
        
        try {
            // Find packages locked but user is not connected via WebSocket
            const websocketService = require('./websocketService');
            const connectedUserIds = new Set();
            
            if (websocketService.wss) {
                websocketService.wss.clients.forEach(client => {
                    if (client.userId) {
                        connectedUserIds.add(client.userId);
                    }
                });
            }
            
            // Get all locked packages
            const lockedPackages = await client.query(`
                SELECT DISTINCT 
                    currently_locked_packages->>0 as package_label,
                    id as invoice_id
                FROM "ORDERS-invoices"
                WHERE currently_locked_packages IS NOT NULL
                AND jsonb_array_length(currently_locked_packages) > 0
            `);
            
            const orphanedLocks = [];
            for (const row of lockedPackages.rows) {
                // Check if any user is connected
                // For now, we'll release all locks older than 30 minutes
                const invoice = await client.query(`
                    SELECT currently_locked_packages, updated_at
                    FROM "ORDERS-invoices"
                    WHERE id = $1
                `, [row.invoice_id]);
                
                if (invoice.rows[0]) {
                    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
                    if (invoice.rows[0].updated_at < thirtyMinutesAgo) {
                        orphanedLocks.push({
                            invoice_id: row.invoice_id,
                            package_label: row.package_label
                        });
                    }
                }
            }
            
            // Release orphaned locks
            for (const lock of orphanedLocks) {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET currently_locked_packages = '[]'::jsonb
                    WHERE id = $1
                `, [lock.invoice_id]);
            }
            
            return {
                success: true,
                recovered_locks: orphanedLocks.length,
                locks: orphanedLocks
            };
        } catch (error) {
            console.error('Error recovering orphaned locks:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Validate and fix data inconsistencies
     */
    async validateAndFixData() {
        const client = await pool.connect();
        
        try {
            const issues = [];
            
            // Check for invoices with invalid status transitions
            const invalidStatuses = await client.query(`
                SELECT id, invoice_number, status
                FROM "ORDERS-invoices"
                WHERE status NOT IN (
                    'Draft', 'Pending_Approval', 'Approved', 'Fulfillment_Accepted',
                    'Fulfillment_Issue', 'Manifested', 'Partially_Manifested',
                    'Shipped', 'Delivered', 'Cancelled', 'Voided'
                )
            `);
            
            if (invalidStatuses.rows.length > 0) {
                issues.push({
                    type: 'invalid_status',
                    count: invalidStatuses.rows.length,
                    items: invalidStatuses.rows
                });
            }
            
            // Check for line items with negative quantities
            const negativeQuantities = await client.query(`
                SELECT id, fk_invoice_id, quantity_ordered
                FROM "ORDERS-invoice-line-items"
                WHERE quantity_ordered < 0
            `);
            
            if (negativeQuantities.rows.length > 0) {
                issues.push({
                    type: 'negative_quantity',
                    count: negativeQuantities.rows.length,
                    items: negativeQuantities.rows
                });
            }
            
            return {
                success: true,
                issues_found: issues.length,
                issues: issues
            };
        } catch (error) {
            console.error('Error validating data:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }
}

module.exports = new RecoveryToolsService();



