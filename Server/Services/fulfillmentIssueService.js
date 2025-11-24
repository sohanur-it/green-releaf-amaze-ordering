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
}

module.exports = new FulfillmentIssueService();

