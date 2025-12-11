// Server/Services/scanningSessionService.js
// Module 5: Package Scanning System

const { query, pool } = require('../config/database');
const websocketService = require('./websocketService');

class ScanningSessionService {
    /**
     * Initialize scanning session for an invoice
     */
    async startScanningSession(invoiceId, userId, websocketConnectionId = null) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Check if user has admin privileges (Sales Admin or Administrator)
            const userRoles = await client.query(`
                SELECT r.name as role_name
                FROM user_roles ur
                JOIN roles r ON ur.role_id = r.id
                WHERE ur.user_id = $1
            `, [userId]);
            
            const roleNames = userRoles.rows.map(r => (r.role_name || '').toLowerCase().trim());
            const isAdmin = roleNames.some(r => 
                r === 'sales admin' || 
                r === 'administrator' || 
                r === 'fulfillment_admin'
            );

            // Verify invoice is in correct state
            const invoice = await client.query(`
                SELECT 
                    id, status, fulfillment_accepted_by,
                    invoice_number
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                await client.query('ROLLBACK');
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            // Allow scanning for Fulfillment_Accepted, Fulfillment_Issue, and Manifest_Voided (allows rescanning)
            const allowedStatuses = ['Fulfillment_Accepted', 'Fulfillment_Issue', 'Manifest_Voided'];
            if (!allowedStatuses.includes(inv.status)) {
                await client.query('ROLLBACK');
                throw new Error(`Cannot start scanning - invoice status is ${inv.status}. Allowed statuses: ${allowedStatuses.join(', ')}`);
            }
            
            // If status is Manifest_Voided, check if sales has acknowledged the void
            if (inv.status === 'Manifest_Voided') {
                const voidCheck = await client.query(`
                    SELECT sales_acknowledged_void, voided_at
                    FROM "ORDERS-invoices"
                    WHERE id = $1
                `, [invoiceId]);
                
                if (voidCheck.rows.length > 0 && voidCheck.rows[0].voided_at && !voidCheck.rows[0].sales_acknowledged_void) {
                    await client.query('ROLLBACK');
                    throw new Error('Cannot start scanning - sales team must acknowledge the voided manifest before rescanning can begin. Please contact sales.');
                }
            }

            // Allow admins to scan even if not assigned, but regular workers must be assigned
            if (!isAdmin && inv.fulfillment_accepted_by !== userId) {
                await client.query('ROLLBACK');
                throw new Error('You are not assigned to this order');
            }

            // Check for existing active session
            const existing = await client.query(`
                SELECT id, fk_user_id, started_at, last_activity
                FROM "ORDERS-scanning-sessions"
                WHERE fk_invoice_id = $1 AND session_status = 'active'
            `, [invoiceId]);

            if (existing.rows.length > 0) {
                const existingSession = existing.rows[0];
                
                // If it's the same user, return the existing session (resume)
                if (existingSession.fk_user_id === userId) {
                    await client.query('COMMIT');
                    return {
                        success: true,
                        session_id: existingSession.id,
                        started_at: existingSession.started_at,
                        resumed: true
                    };
                }
                
                // Admins can resume their own sessions even if not assigned
                // (This handles the case where admin started scanning but order was reassigned)
                
                // If it's a different user, check if session is stale (older than 30 minutes)
                const lastActivity = existingSession.last_activity || existingSession.started_at;
                const minutesSinceActivity = (new Date() - new Date(lastActivity)) / (1000 * 60);
                
                if (minutesSinceActivity > 30) {
                    // Auto-abandon stale session and create new one
                    await client.query(`
                        UPDATE "ORDERS-scanning-sessions"
                        SET session_status = 'abandoned', abandoned_at = NOW()
                        WHERE id = $1
                    `, [existingSession.id]);
                    
                    // Continue to create new session below
                } else {
                    // Active session by another user
                    // Admins can take over active sessions, but regular workers cannot
                    if (!isAdmin) {
                        let otherUserName = 'Another worker';
                        try {
                            const otherUser = await client.query(`
                                SELECT first_name, last_name FROM users WHERE id = $1
                            `, [existingSession.fk_user_id]);
                            
                            if (otherUser.rows.length > 0) {
                                otherUserName = `${otherUser.rows[0].first_name} ${otherUser.rows[0].last_name}`;
                            }
                        } catch (err) {
                            console.error('[Scanning] Error fetching other user name:', err);
                            // Continue with default name
                        }
                        
                        await client.query('ROLLBACK');
                        throw new Error(`An active scanning session exists for this order (started by ${otherUserName}). Please wait for them to finish or contact an admin.`);
                    } else {
                        // Admin can take over - abandon the existing session
                        await client.query(`
                            UPDATE "ORDERS-scanning-sessions"
                            SET session_status = 'abandoned', abandoned_at = NOW()
                            WHERE id = $1
                        `, [existingSession.id]);
                        // Continue to create new session below
                    }
                }
            }

            // Create session
            const session = await client.query(`
                INSERT INTO "ORDERS-scanning-sessions" (
                    fk_invoice_id,
                    fk_user_id,
                    session_status,
                    currently_locked_packages,
                    websocket_connection_id
                ) VALUES ($1, $2, 'active', '[]'::jsonb, $3)
                RETURNING id, started_at
            `, [invoiceId, userId, websocketConnectionId]);

            await client.query('COMMIT');

            return {
                success: true,
                session_id: session.rows[0].id,
                started_at: session.rows[0].started_at
            };

        } catch (error) {
            console.error('[Scanning] Error in startScanningSession:', error.message, error.stack);
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('[Scanning] Error during ROLLBACK:', rollbackError.message);
            }
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Cancel scanning session (user clicked Cancel button)
     * Rolls back ALL progress
     */
    async cancelScanningSession(sessionId, userId, reason = null) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get session and invoice details
            const session = await client.query(`
                SELECT 
                    ss.fk_invoice_id,
                    ss.fk_user_id,
                    ss.currently_locked_packages,
                    i.invoice_number
                FROM "ORDERS-scanning-sessions" ss
                JOIN "ORDERS-invoices" i ON ss.fk_invoice_id = i.id
                WHERE ss.id = $1 AND ss.session_status = 'active'
                FOR UPDATE
            `, [sessionId]);

            if (session.rows.length === 0) {
                throw new Error('Active session not found');
            }

            const sess = session.rows[0];

            if (sess.fk_user_id !== userId) {
                throw new Error('This session belongs to another user');
            }

            const invoiceId = sess.fk_invoice_id;
            const lockedPackages = sess.currently_locked_packages || [];

            // Rollback: Clear all assigned_package_labels
            await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET assigned_package_labels = NULL
                WHERE fk_invoice_id = $1
            `, [invoiceId]);

            // Rollback: Invoice back to 'Approved' status (unlocks for other workers)
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    status = 'Approved',
                    fulfillment_accepted_by = NULL,
                    fulfillment_accepted_at = NULL,
                    status_updated_at = NOW()
                WHERE id = $1
            `, [invoiceId]);

            // Mark session as cancelled
            await client.query(`
                UPDATE "ORDERS-scanning-sessions"
                SET 
                    session_status = 'cancelled',
                    cancelled_at = NOW()
                WHERE id = $1
            `, [sessionId]);

            // Log cancellation
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    reason,
                    changed_by_user_id
                ) VALUES ($1, 'scanning_cancelled', $2, $3)
            `, [invoiceId, reason || 'Fulfillment worker cancelled scanning', userId]);

            await client.query('COMMIT');

            // Broadcast package release to other workers
            if (lockedPackages.length > 0) {
                websocketService.broadcastPackageReleased(lockedPackages, invoiceId);
            }

            return {
                success: true,
                message: `Scanning cancelled for invoice ${sess.invoice_number}. Order returned to queue.`
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Auto-abandon sessions after 30 minutes of inactivity
     * Runs as scheduled job
     */
    async abandonInactiveSessions() {
        const client = await pool.connect();

        try {
            const abandoned = await client.query(`
                UPDATE "ORDERS-scanning-sessions"
                SET 
                    session_status = 'abandoned',
                    cancelled_at = NOW()
                WHERE session_status = 'active'
                    AND last_activity < NOW() - INTERVAL '30 minutes'
                RETURNING id, fk_invoice_id, fk_user_id, currently_locked_packages
            `);

            // Rollback each abandoned session
            for (const session of abandoned.rows) {
                const invoiceId = session.fk_invoice_id;
                const lockedPackages = session.currently_locked_packages || [];

                // Clear assigned packages
                await client.query(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET assigned_package_labels = NULL
                    WHERE fk_invoice_id = $1
                `, [invoiceId]);

                // Return invoice to Approved
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET 
                        status = 'Approved',
                        fulfillment_accepted_by = NULL,
                        fulfillment_accepted_at = NULL,
                        status_updated_at = NOW()
                    WHERE id = $1
                `, [invoiceId]);

                // Log abandonment
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id,
                        modification_type,
                        reason,
                        changed_by_system
                    ) VALUES ($1, 'scanning_cancelled', 'Auto-abandoned due to inactivity', true)
                `, [invoiceId]);

                // Broadcast package release
                if (lockedPackages.length > 0) {
                    websocketService.broadcastPackageReleased(lockedPackages, invoiceId);
                }
            }

            console.log(`[Auto-Abandon] Abandoned ${abandoned.rowCount} inactive scanning sessions`);
            return { abandoned: abandoned.rowCount };

        } catch (error) {
            console.error('[Auto-Abandon] Error:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get scanning progress for an invoice
     */
    async getScanningProgress(invoiceId) {
        const progress = await query(`
            SELECT 
                li.id as line_item_id,
                li.quantity_ordered,
                li.specific_package_labels,
                li.assigned_package_labels,
                p.name as product_name,
                b.batch_name,
                
                -- Calculate progress
                COALESCE(jsonb_array_length(li.assigned_package_labels), 0) as scanned_count,
                li.quantity_ordered - COALESCE(jsonb_array_length(li.assigned_package_labels), 0) as remaining_count,
                
                -- Status
                CASE 
                    WHEN COALESCE(jsonb_array_length(li.assigned_package_labels), 0) = 0 
                        THEN 'not_started'
                    WHEN COALESCE(jsonb_array_length(li.assigned_package_labels), 0) = li.quantity_ordered 
                        THEN 'complete'
                    ELSE 'in_progress'
                END as status
                
            FROM "ORDERS-invoice-line-items" li
            JOIN "ORDERS-products" p ON li.fk_master_product_id = p.entry_id
            JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
            WHERE li.fk_invoice_id = $1
            ORDER BY li.line_item_order
        `, [invoiceId]);

        const lineItems = progress.rows;
        const totalPackagesNeeded = lineItems.reduce((sum, li) => sum + parseInt(li.quantity_ordered), 0);
        const totalPackagesScanned = lineItems.reduce((sum, li) => sum + parseInt(li.scanned_count), 0);

        return {
            invoice_id: invoiceId,
            line_items: lineItems.map(li => ({
                line_item_id: li.line_item_id,
                product_name: li.product_name,
                batch_name: li.batch_name,
                quantity_ordered: parseInt(li.quantity_ordered),
                scanned_count: parseInt(li.scanned_count),
                remaining_count: parseInt(li.remaining_count),
                status: li.status,
                scanned_packages: li.assigned_package_labels || [],
                specific_package_labels: li.specific_package_labels
            })),
            overall_progress: {
                total_packages_needed: totalPackagesNeeded,
                total_packages_scanned: totalPackagesScanned,
                percentage: totalPackagesNeeded > 0 
                    ? Math.round((totalPackagesScanned / totalPackagesNeeded) * 100)
                    : 0,
                all_complete: totalPackagesScanned === totalPackagesNeeded
            }
        };
    }
}

module.exports = new ScanningSessionService();

