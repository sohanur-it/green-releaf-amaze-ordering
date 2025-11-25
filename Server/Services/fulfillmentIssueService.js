// Server/Services/fulfillmentIssueService.js
// Module 5: Fulfillment Issue Reporting & Resolution

const { query, pool } = require('../config/database');
const websocketService = require('./websocketService');
const notificationStore = require('./notificationStoreService');

class FulfillmentIssueService {
    /**
     * Fulfillment worker reports issues with one or more line items
     */
    async reportIssue(invoiceId, userId, issues) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verify invoice is in fulfillment state
            const invoice = await client.query(`
                SELECT 
                    status,
                    fulfillment_accepted_by,
                    invoice_number,
                    assigned_sales_rep_id
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            if (!['Fulfillment_Accepted', 'Approved'].includes(inv.status)) {
                throw new Error(`Cannot report issue - invoice status is ${inv.status}`);
            }

            if (inv.fulfillment_accepted_by !== userId) {
                throw new Error('You are not assigned to this order');
            }

            // Format issue note
            const issueNote = this.formatIssueReport(issues);

            // Transition to Fulfillment_Issue state
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    status = 'Fulfillment_Issue',
                    fulfillment_issue_reported_at = NOW(),
                    fulfillment_issue_note = $1,
                    status_updated_at = NOW()
                WHERE id = $2
            `, [issueNote, invoiceId]);

            // Clear any scanning session
            await client.query(`
                UPDATE "ORDERS-scanning-sessions"
                SET 
                    session_status = 'cancelled',
                    cancelled_at = NOW()
                WHERE fk_invoice_id = $1 AND session_status = 'active'
            `, [invoiceId]);

            // Clear assigned packages (rollback scanning progress)
            await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET assigned_package_labels = NULL
                WHERE fk_invoice_id = $1
            `, [invoiceId]);

            // Log each specific issue
            for (const issue of issues) {
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id,
                        modification_type,
                        field_name,
                        change_details,
                        reason,
                        changed_by_user_id,
                        triggered_by_fulfillment_issue
                    ) VALUES ($1, 'fulfillment_issue_reported', $2, $3, $4, $5, TRUE)
                `, [
                    invoiceId,
                    issue.type,
                    JSON.stringify(issue),
                    issue.description,
                    userId
                ]);
            }

            await client.query('COMMIT');

            // Notify assigned sales rep
            if (inv.assigned_sales_rep_id) {
                await this.notifySalesRepOfIssue(invoiceId, inv.invoice_number, issueNote, inv.assigned_sales_rep_id);
            }

            return {
                success: true,
                message: `Issues reported for invoice ${inv.invoice_number}. Order returned to sales for resolution.`
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    formatIssueReport(issues) {
        return issues.map(issue => {
            let line = `[${issue.type}]`;
            if (issue.line_item_id) line += ` Line Item ${issue.line_item_id}`;
            if (issue.batch_name) line += ` Batch: ${issue.batch_name}`;
            line += ` - ${issue.description}`;
            return line;
        }).join('\n');
    }

    /**
     * Sales rep requests fulfillment to report a global issue
     * Used when sales needs order returned during 'Fulfillment_Accepted' state
     */
    async requestGlobalIssueReport(invoiceId, salesRepId, reason) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verify invoice is in correct state
            const invoice = await client.query(`
                SELECT 
                    status,
                    assigned_sales_rep_id,
                    fulfillment_accepted_by,
                    invoice_number
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            if (inv.status !== 'Fulfillment_Accepted') {
                throw new Error(`Cannot request return - invoice status is ${inv.status}`);
            }

            if (inv.assigned_sales_rep_id !== salesRepId) {
                throw new Error('You are not the assigned sales rep for this order');
            }

            // Mark request
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    global_issue_requested_by = $1,
                    global_issue_requested_at = NOW()
                WHERE id = $2
            `, [salesRepId, invoiceId]);

            // Log request
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    reason,
                    changed_by_user_id
                ) VALUES ($1, 'global_issue_requested', $2, $3)
            `, [invoiceId, reason, salesRepId]);

            await client.query('COMMIT');

            // Send persistent notification to fulfillment worker
            await this.notifyFulfillmentWorkerGlobalIssueRequest(
                inv.fulfillment_accepted_by,
                invoiceId,
                inv.invoice_number,
                reason
            );

            return {
                success: true,
                message: `Return request sent to fulfillment worker for invoice ${inv.invoice_number}`
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Fulfillment worker acknowledges and reports global issue
     */
    async acknowledgeGlobalIssueRequest(invoiceId, userId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verify request exists
            const invoice = await client.query(`
                SELECT 
                    global_issue_requested_by,
                    global_issue_requested_at,
                    fulfillment_accepted_by
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0 || invoice.rows[0].global_issue_requested_by === null) {
                throw new Error('No global issue request found for this invoice');
            }

            if (invoice.rows[0].fulfillment_accepted_by !== userId) {
                throw new Error('You are not assigned to this order');
            }

            // Report issue with special global flag
            await this.reportIssue(invoiceId, userId, [{
                type: 'global_issue',
                description: 'Sales requested return to modify order'
            }]);

            // Log acknowledgment
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    reason,
                    changed_by_user_id
                ) VALUES ($1, 'global_issue_acknowledged', 'Fulfillment worker acknowledged sales request', $2)
            `, [invoiceId, userId]);

            // Clear request
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    global_issue_requested_by = NULL,
                    global_issue_requested_at = NULL
                WHERE id = $1
            `, [invoiceId]);

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Global issue acknowledged. Order returned to sales.'
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Notify sales rep of issue
     */
    async notifySalesRepOfIssue(invoiceId, invoiceNumber, issueNote, salesRepId) {
        try {
            // Store notification
            await notificationStore.createNotification({
                userId: salesRepId,
                type: 'fulfillment_issue',
                title: `Fulfillment Issue: ${invoiceNumber}`,
                message: issueNote,
                payload: {
                    invoice_id: invoiceId,
                    invoice_number: invoiceNumber
                },
                priority: 'high',
                requiresAck: false
            });

            // Send via websocket
            await websocketService.sendPersistentNotification(salesRepId, {
                type: 'fulfillment_issue',
                title: `Fulfillment Issue: ${invoiceNumber}`,
                message: issueNote,
                payload: {
                    invoice_id: invoiceId,
                    invoice_number: invoiceNumber
                }
            });
        } catch (error) {
            console.error('Error notifying sales rep:', error);
        }
    }

    /**
     * Notify fulfillment worker of global issue request
     */
    async notifyFulfillmentWorkerGlobalIssueRequest(workerId, invoiceId, invoiceNumber, reason) {
        try {
            // Store persistent notification
            await notificationStore.createNotification({
                userId: workerId,
                type: 'global_issue_request',
                title: `Sales Requested Review: ${invoiceNumber}`,
                message: `Sales requested review for Invoice ${invoiceNumber} - ${reason}`,
                payload: {
                    invoice_id: invoiceId,
                    invoice_number: invoiceNumber,
                    reason
                },
                priority: 'high',
                requiresAck: true
            });

            // Send via websocket
            await websocketService.sendPersistentNotification(workerId, {
                type: 'global_issue_request',
                title: `Sales Requested Review: ${invoiceNumber}`,
                message: `Sales requested review for Invoice ${invoiceNumber} - ${reason}`,
                payload: {
                    invoice_id: invoiceId,
                    invoice_number: invoiceNumber,
                    reason
                },
                requiresAck: true
            });
        } catch (error) {
            console.error('Error notifying fulfillment worker:', error);
        }
    }

    /**
     * Update issue details
     * POST /api/v1/fulfillment/issues/update
     */
    async updateIssueDetails(invoiceId, userId, updates) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verify invoice is in Fulfillment_Issue status
            const invoice = await client.query(`
                SELECT 
                    status,
                    fulfillment_issue_note,
                    assigned_sales_rep_id
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            if (invoice.rows[0].status !== 'Fulfillment_Issue') {
                throw new Error('Cannot update issue - invoice is not in Fulfillment_Issue status');
            }

            const oldNote = invoice.rows[0].fulfillment_issue_note || '';
            
            // Parse existing note and update
            let updatedNote = oldNote;
            if (updates.issue_type || updates.description) {
                // For simplicity, append update to note
                // In production, you might want more sophisticated parsing
                const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
                updatedNote = `${oldNote}\n[${timestamp} - Updated]: Type: ${updates.issue_type || 'unchanged'}, Description: ${updates.description || 'unchanged'}`;
            }

            await client.query(`
                UPDATE "ORDERS-invoices"
                SET fulfillment_issue_note = $1
                WHERE id = $2
            `, [updatedNote, invoiceId]);

            // Log update
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    old_value,
                    new_value,
                    changed_by_user_id
                ) VALUES ($1, 'issue_updated', 'fulfillment_issue_note', $2, $3, $4)
            `, [invoiceId, oldNote, updatedNote, userId]);

            await client.query('COMMIT');

            // Notify sales rep
            if (invoice.rows[0].assigned_sales_rep_id) {
                await this.notifySalesRepOfIssue(
                    invoiceId,
                    invoice.rows[0].invoice_number || 'Unknown',
                    'Issue details updated',
                    invoice.rows[0].assigned_sales_rep_id
                );
            }

            return {
                success: true,
                message: 'Issue details updated successfully'
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Add note to existing issue
     * POST /api/v1/fulfillment/issues/add-note
     */
    async addNoteToIssue(invoiceId, userId, note) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const invoice = await client.query(`
                SELECT 
                    status,
                    fulfillment_issue_note,
                    invoice_number
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            if (invoice.rows[0].status !== 'Fulfillment_Issue') {
                throw new Error('Cannot add note - invoice is not in Fulfillment_Issue status');
            }

            // Get user name
            const user = await client.query(`
                SELECT first_name, last_name
                FROM users
                WHERE id = $1
            `, [userId]);

            const userName = user.rows.length > 0 
                ? `${user.rows[0].first_name} ${user.rows[0].last_name}`
                : 'Unknown User';

            const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
            const formattedNote = `[${timestamp} - ${userName}]: "${note}"`;
            
            const currentNote = invoice.rows[0].fulfillment_issue_note || '';
            const updatedNote = currentNote ? `${currentNote}\n${formattedNote}` : formattedNote;

            await client.query(`
                UPDATE "ORDERS-invoices"
                SET fulfillment_issue_note = $1
                WHERE id = $2
            `, [updatedNote, invoiceId]);

            // Log note addition
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    new_value,
                    changed_by_user_id
                ) VALUES ($1, 'issue_note_added', 'fulfillment_issue_note', $2, $3)
            `, [invoiceId, formattedNote, userId]);

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Note added successfully'
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Cancel/delete issue report
     * POST /api/v1/fulfillment/issues/cancel
     */
    async cancelIssueReport(invoiceId, userId, reason) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const invoice = await client.query(`
                SELECT 
                    status,
                    fulfillment_accepted_by,
                    invoice_number
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            if (invoice.rows[0].status !== 'Fulfillment_Issue') {
                throw new Error('Cannot cancel issue - invoice is not in Fulfillment_Issue status');
            }

            if (invoice.rows[0].fulfillment_accepted_by !== userId) {
                throw new Error('You are not assigned to this order');
            }

            // Return to Fulfillment_Accepted
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    status = 'Fulfillment_Accepted',
                    fulfillment_issue_note = NULL,
                    fulfillment_issue_reported_at = NULL,
                    status_updated_at = NOW()
                WHERE id = $1
            `, [invoiceId]);

            // Log cancellation
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    reason,
                    changed_by_user_id
                ) VALUES ($1, 'issue_cancelled', $2, $3)
            `, [invoiceId, reason || 'Issue cancelled by fulfillment worker', userId]);

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Issue cancelled. Order returned to Fulfillment_Accepted status.'
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get all issues for bulk management
     * GET /api/v1/admin/fulfillment/issues
     */
    async getAllIssues(filters = {}) {
        const { issue_type, date_from, date_to, sales_rep_id, status } = filters;
        const client = await pool.connect();

        try {
            let sql = `
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.status,
                    i.fulfillment_issue_reported_at,
                    i.fulfillment_issue_note,
                    i.assigned_sales_rep_id,
                    b.name as buyer_name,
                    u.first_name || ' ' || u.last_name as sales_rep_name
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                LEFT JOIN users u ON i.assigned_sales_rep_id = u.id
                WHERE i.status = 'Fulfillment_Issue'
            `;

            const params = [];
            let paramCount = 1;

            if (date_from) {
                sql += ` AND i.fulfillment_issue_reported_at >= $${paramCount++}`;
                params.push(date_from);
            }

            if (date_to) {
                sql += ` AND i.fulfillment_issue_reported_at <= $${paramCount++}`;
                params.push(date_to);
            }

            if (sales_rep_id) {
                sql += ` AND i.assigned_sales_rep_id = $${paramCount++}`;
                params.push(sales_rep_id);
            }

            if (issue_type && i.fulfillment_issue_note) {
                sql += ` AND i.fulfillment_issue_note LIKE $${paramCount++}`;
                params.push(`%[${issue_type}]%`);
            }

            sql += ` ORDER BY i.fulfillment_issue_reported_at DESC`;

            const issues = await client.query(sql, params);

            return {
                success: true,
                issues: issues.rows,
                total: issues.rows.length
            };

        } finally {
            client.release();
        }
    }

    /**
     * Bulk assign issues to sales rep
     * POST /api/v1/admin/fulfillment/issues/bulk-assign
     */
    async bulkAssignIssues(invoiceIds, salesRepId, adminUserId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const updated = await client.query(`
                UPDATE "ORDERS-invoices"
                SET assigned_sales_rep_id = $1
                WHERE id = ANY($2)
                    AND status = 'Fulfillment_Issue'
                RETURNING id, invoice_number
            `, [salesRepId, invoiceIds]);

            // Log bulk assignment
            for (const invoice of updated.rows) {
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id,
                        modification_type,
                        changed_by_user_id,
                        change_details
                    ) VALUES ($1, 'issue_bulk_assigned', $2, $3)
                `, [
                    invoice.id,
                    adminUserId,
                    JSON.stringify({
                        sales_rep_id: salesRepId,
                        bulk_operation: true
                    })
                ]);
            }

            await client.query('COMMIT');

            return {
                success: true,
                updated_count: updated.rows.length,
                invoices: updated.rows
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Track issue resolution
     * Called when sales clicks "Resolve Issue"
     * Note: Stores resolution data in history table (resolved_at/resolved_by columns can be added later if needed)
     */
    async trackIssueResolution(invoiceId, salesRepId, resolutionActions) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Try to update resolved_at/resolved_by if columns exist, otherwise just log to history
            try {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET 
                        resolved_at = NOW(),
                        resolved_by = $1,
                        resolution_actions = $2::jsonb
                    WHERE id = $3
                `, [salesRepId, JSON.stringify(resolutionActions), invoiceId]);
            } catch (columnError) {
                // Columns don't exist yet - that's OK, we'll just log to history
                console.log('[Issue Resolution] Resolution columns not found, storing in history only');
            }

            // Log resolution (always)
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    changed_by_user_id,
                    change_details
                ) VALUES ($1, 'issue_resolved', $2, $3)
            `, [
                invoiceId,
                salesRepId,
                JSON.stringify({
                    resolved_at: new Date().toISOString(),
                    resolved_by: salesRepId,
                    resolution_actions: resolutionActions
                })
            ]);

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Issue resolution tracked'
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new FulfillmentIssueService();

