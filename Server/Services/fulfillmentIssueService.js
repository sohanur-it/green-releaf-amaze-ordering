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

            // Section 4.2: Allow both Fulfillment_Accepted AND Fulfillment_Issue status
            if (!['Fulfillment_Accepted', 'Fulfillment_Issue', 'Approved'].includes(inv.status)) {
                throw new Error(`Cannot report issue - invoice status is ${inv.status}`);
            }

            if (inv.fulfillment_accepted_by !== userId) {
                throw new Error('You are not assigned to this order');
            }

            // Format issue note
            const issueNote = this.formatIssueReport(issues);

            // Transition to Fulfillment_Issue state
            // Section 5.1.6: Add auto-clear: Clear transportation_details when invoice transitions to Fulfillment_Issue if manifest_created_at IS NULL
            const invoiceCheck = await client.query(`
                SELECT manifest_created_at
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);
            
            const shouldClearTransportation = !invoiceCheck.rows[0]?.manifest_created_at;
            
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    status = 'Fulfillment_Issue',
                    fulfillment_issue_reported_at = NOW(),
                    fulfillment_issue_note = $1,
                    status_updated_at = NOW${shouldClearTransportation ? ', transportation_details = NULL' : ''}
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

            // Section 4.1: Update line items with issue information
            // Log each specific issue and update line items
            for (const issue of issues) {
                // Update line item if line_item_id is provided
                if (issue.line_item_id) {
                    await client.query(`
                        UPDATE "ORDERS-invoice-line-items"
                        SET 
                            has_fulfillment_issue = true,
                            fulfillment_issue_type = $1,
                            issue_photo_urls = COALESCE($2::jsonb, '[]'::jsonb)
                        WHERE id = $3 AND fk_invoice_id = $4
                    `, [
                        issue.type,
                        issue.photo_urls ? JSON.stringify(issue.photo_urls) : '[]',
                        issue.line_item_id,
                        invoiceId
                    ]);
                }

                // Log to invoice history
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

            // Log status change to invoice history (kicked back to sales)
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    old_value,
                    new_value,
                    reason,
                    changed_by_user_id
                ) VALUES ($1, 'status_changed', 'status', $2, 'Fulfillment_Issue', $3, $4)
            `, [invoiceId, inv.status, `Invoice kicked back to sales team: ${issueNote}`, userId]);

            // Log to audit log
            const auditLogger = require('./auditLogger');
            await auditLogger.logUserAction(
                userId,
                'invoice_kicked_back_to_sales',
                'Invoice',
                invoiceId.toString(),
                {
                    invoice_number: inv.invoice_number,
                    old_status: inv.status,
                    new_status: 'Fulfillment_Issue',
                    issue_note: issueNote,
                    issues: issues
                },
                'success'
            );

            await client.query('COMMIT');

            // Notify assigned sales rep
            if (inv.assigned_sales_rep_id) {
                await this.notifySalesRepOfIssue(invoiceId, inv.invoice_number, issueNote, inv.assigned_sales_rep_id);
            }

            // Notify all Sales Admins and Administrators
            await this.notifyAdminsOfIssue(invoiceId, inv.invoice_number, issueNote);

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

            // Section 4.2: Allow both Fulfillment_Accepted AND Fulfillment_Issue status
            if (!['Fulfillment_Accepted', 'Fulfillment_Issue'].includes(inv.status)) {
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
     * Notify all Sales Admins and Administrators of fulfillment issue
     */
    async notifyAdminsOfIssue(invoiceId, invoiceNumber, issueNote) {
        try {
            // Get all users with Sales Admin or Administrator roles
            const adminUsers = await query(`
                SELECT DISTINCT u.id
                FROM users u
                JOIN user_roles ur ON u.id = ur.user_id
                JOIN roles r ON ur.role_id = r.id
                WHERE (LOWER(r.name) IN ('sales admin', 'administrator')
                   OR LOWER(r.role_name) IN ('sales admin', 'administrator'))
                   AND u.status = 'active'
            `);

            for (const user of adminUsers.rows) {
                await notificationStore.createNotification({
                    userId: user.id,
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

                await websocketService.sendPersistentNotification(user.id, {
                    type: 'fulfillment_issue',
                    title: `Fulfillment Issue: ${invoiceNumber}`,
                    message: issueNote,
                    payload: {
                        invoice_id: invoiceId,
                        invoice_number: invoiceNumber
                    }
                });
            }

            console.log(`✅ Notified ${adminUsers.rows.length} admin(s) of fulfillment issue for invoice ${invoiceNumber}`);
        } catch (error) {
            console.error('Error notifying admins of issue:', error);
        }
    }

    /**
     * Section 4.4.2: Notify sales rep when issue is cancelled
     */
    async notifySalesRepOfIssueCancellation(salesRepId, invoiceId, invoiceNumber, reason) {
        try {
            await notificationStore.createNotification({
                userId: salesRepId,
                type: 'issue_cancelled',
                title: `Issue Cancelled: ${invoiceNumber}`,
                message: `Fulfillment worker cancelled the issue report: ${reason}`,
                payload: {
                    invoice_id: invoiceId,
                    invoice_number: invoiceNumber,
                    reason: reason
                },
                priority: 'medium',
                requiresAck: false
            });

            await websocketService.sendPersistentNotification(salesRepId, {
                type: 'issue_cancelled',
                title: `Issue Cancelled: ${invoiceNumber}`,
                message: `Fulfillment worker cancelled the issue report: ${reason}`,
                payload: {
                    invoice_id: invoiceId,
                    invoice_number: invoiceNumber,
                    reason: reason
                }
            });
        } catch (error) {
            console.error('Error notifying sales rep of issue cancellation:', error);
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

            if (inv.status !== 'Fulfillment_Issue') {
                throw new Error('Cannot cancel issue - invoice is not in Fulfillment_Issue status');
            }

            if (inv.fulfillment_accepted_by !== userId) {
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

            // Section 4.4.2: Add sales rep notification when issue is cancelled
            if (inv.assigned_sales_rep_id) {
                await this.notifySalesRepOfIssueCancellation(
                    inv.assigned_sales_rep_id,
                    invoiceId,
                    inv.invoice_number,
                    reason || 'Issue cancelled by fulfillment worker'
                );
            }

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
     * Section 4.4: Enhanced with filtering, sorting, and pagination
     */
    async getAllIssues(filters = {}) {
        const { 
            issue_type, 
            date_from, 
            date_to, 
            sales_rep_id, 
            status,
            product_id,
            batch_id,
            sort_by = 'date',
            sort_order = 'DESC',
            page = 1,
            limit = 50
        } = filters;
        
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
            `;

            // Section 4.4.3: Add filter by product/batch
            if (product_id || batch_id) {
                sql += `
                    LEFT JOIN "ORDERS-invoice-line-items" li ON i.id = li.fk_invoice_id
                `;
            }

            sql += ` WHERE i.status = 'Fulfillment_Issue'`;

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

            if (issue_type) {
                sql += ` AND i.fulfillment_issue_note LIKE $${paramCount++}`;
                params.push(`%[${issue_type}]%`);
            }

            // Section 4.4.3: Filter by product/batch
            if (product_id) {
                sql += ` AND li.fk_master_product_id = $${paramCount++}`;
                params.push(product_id);
            }

            if (batch_id) {
                sql += ` AND li.fk_batch_id = $${paramCount++}`;
                params.push(batch_id);
            }

            // Section 4.4.4: Add sort options
            const sortColumnMap = {
                'date': 'i.fulfillment_issue_reported_at',
                'customer': 'b.name',
                'issue_type': 'i.fulfillment_issue_note',
                'invoice_number': 'i.invoice_number'
            };

            const sortColumn = sortColumnMap[sort_by] || sortColumnMap['date'];
            const sortDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            sql += ` ORDER BY ${sortColumn} ${sortDirection}`;

            // Section 4.4.5: Add pagination support
            const offset = (page - 1) * limit;
            sql += ` LIMIT $${paramCount++} OFFSET $${paramCount++}`;
            params.push(limit, offset);

            const issues = await client.query(sql, params);

            // Get total count for pagination
            let countSql = `
                SELECT COUNT(DISTINCT i.id) as total
                FROM "ORDERS-invoices" i
            `;
            
            if (product_id || batch_id) {
                countSql += `
                    LEFT JOIN "ORDERS-invoice-line-items" li ON i.id = li.fk_invoice_id
                `;
            }
            
            countSql += ` WHERE i.status = 'Fulfillment_Issue'`;
            
            const countParams = [];
            let countParamCount = 1;
            
            if (date_from) {
                countSql += ` AND i.fulfillment_issue_reported_at >= $${countParamCount++}`;
                countParams.push(date_from);
            }
            if (date_to) {
                countSql += ` AND i.fulfillment_issue_reported_at <= $${countParamCount++}`;
                countParams.push(date_to);
            }
            if (sales_rep_id) {
                countSql += ` AND i.assigned_sales_rep_id = $${countParamCount++}`;
                countParams.push(sales_rep_id);
            }
            if (issue_type) {
                countSql += ` AND i.fulfillment_issue_note LIKE $${countParamCount++}`;
                countParams.push(`%[${issue_type}]%`);
            }
            if (product_id) {
                countSql += ` AND li.fk_master_product_id = $${countParamCount++}`;
                countParams.push(product_id);
            }
            if (batch_id) {
                countSql += ` AND li.fk_batch_id = $${countParamCount++}`;
                countParams.push(batch_id);
            }

            const countResult = await client.query(countSql, countParams);
            const total = parseInt(countResult.rows[0]?.total || 0);

            return {
                success: true,
                issues: issues.rows,
                total: total,
                page: page,
                limit: limit,
                total_pages: Math.ceil(total / limit)
            };

        } finally {
            client.release();
        }
    }

    /**
     * Module 21.4: Bulk mark issues as resolved
     * Sales rep can mark multiple resolved issues at once
     */
    async bulkMarkIssuesResolved(invoiceIds, userId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Module 21.5: Enforce batch size limit
            if (invoiceIds.length > 100) {
                throw new Error('Cannot process more than 100 issues at once');
            }

            // Get all issues
            const invoices = await client.query(`
                SELECT 
                    id,
                    invoice_number,
                    status
                FROM "ORDERS-invoices"
                WHERE id = ANY($1)
                    AND status = 'Fulfillment_Issue'
            `, [invoiceIds]);

            if (invoices.rows.length === 0) {
                throw new Error('No issues found to resolve');
            }

            let resolvedCount = 0;

            // Resolve each issue
            for (const invoice of invoices.rows) {
                // Update status to Approved
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET 
                        status = 'Approved',
                        resolved_at = NOW(),
                        resolved_by = $1,
                        status_updated_at = NOW()
                    WHERE id = $2
                `, [userId, invoice.id]);

                // Log resolution
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id,
                        modification_type,
                        field_name,
                        old_value,
                        new_value,
                        reason,
                        changed_by_user_id
                    ) VALUES ($1, 'issue_resolved', 'status', 'Fulfillment_Issue', 'Approved', 'Issue resolved and order returned to queue', $2)
                `, [invoice.id, userId]);

                resolvedCount++;
            }

            // Log bulk operation
            await client.query(`
                INSERT INTO "ORDERS-audit_log" (
                    user_id,
                    action,
                    resource_type,
                    resource_id,
                    details,
                    status
                ) VALUES ($1, 'bulk_resolve_issues', 'Invoice', NULL, $2, 'success')
            `, [userId, JSON.stringify({
                bulk_operation: true,
                operation_type: 'bulk_resolve_issues',
                record_count: resolvedCount,
                affected_invoice_ids: invoiceIds
            })]);

            await client.query('COMMIT');

            // Notify fulfillment team
            const websocketService = require('./websocketService');
            await websocketService.broadcastToFulfillmentTeam({
                type: 'issues_resolved',
                count: resolvedCount,
                message: `${resolvedCount} issue(s) resolved and returned to fulfillment queue`
            });

            return {
                success: true,
                resolved_count: resolvedCount
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
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

    /**
     * Sales rep resolves the issue by modifying invoice
     * Can add, remove, or change line items
     * This is the unified method that combines all modifications and state transition
     */
    async resolveIssueAndModify(invoiceId, modifications, userId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verify invoice is in Fulfillment_Issue state
            const invoice = await client.query(`
                SELECT 
                    status,
                    assigned_sales_rep_id,
                    invoice_number,
                    manifest_created_at
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            // Section 4.3: Post-Manifest Modification Protection
            if (inv.manifest_created_at) {
                throw new Error('Cannot modify invoice after manifest created');
            }

            if (inv.status !== 'Fulfillment_Issue') {
                throw new Error('Invoice not in Fulfillment_Issue state');
            }

            // Verify user has permission (assigned sales rep or admin)
            // Note: Admin check would be done at route level, here we check sales rep
            if (inv.assigned_sales_rep_id && inv.assigned_sales_rep_id !== userId) {
                // Allow if user is admin (check would be done at route level)
                // For now, we'll allow if they got this far (route middleware handles auth)
            }

            // Apply modifications
            const resolutionActions = [];

            // Remove line items
            for (const mod of modifications.remove_items || []) {
                // Section 17.3.2: Remove generic default reasons
                if (!mod.reason || mod.reason.trim().length === 0) {
                    throw new Error('Reason is required when removing line items');
                }
                
                // Validate reason is not a generic default
                const genericReasons = ['removed', 'deleted', 'Removed to resolve fulfillment issue'];
                if (genericReasons.some(generic => mod.reason.toLowerCase().trim() === generic.toLowerCase())) {
                    throw new Error('Please provide a specific reason for removing this line item. Generic reasons are not allowed.');
                }
                
                await this.removeLineItemWithHistory(
                    invoiceId,
                    mod.line_item_id,
                    mod.reason.trim(),
                    userId,
                    client
                );
                resolutionActions.push({
                    action: 'remove',
                    line_item_id: mod.line_item_id,
                    reason: mod.reason
                });
            }

            // Add line items
            for (const mod of modifications.add_items || []) {
                const lineItemId = await this.addLineItemWithHistory(
                    invoiceId,
                    mod,
                    userId,
                    client
                );
                resolutionActions.push({
                    action: 'add',
                    line_item_id: lineItemId,
                    batch_id: mod.fk_batch_id,
                    quantity: mod.quantity
                });
            }

            // Modify line item quantities
            for (const mod of modifications.quantity_changes || []) {
                // Section 17.3.2: Remove generic default reasons, require explicit user-provided reasons
                if (!mod.reason || mod.reason.trim().length === 0) {
                    throw new Error('Modification reason is required for each line item modification');
                }
                
                // Validate reason is not a generic default
                const genericReasons = ['modified', 'changed', 'updated', 'adjusted', 'N/A', 'n/a', 'none', 'Quantity modified to resolve fulfillment issue'];
                if (genericReasons.some(generic => mod.reason.toLowerCase().trim() === generic.toLowerCase())) {
                    throw new Error('Please provide a specific reason for this modification. Generic reasons are not allowed.');
                }
                
                await this.modifyLineItemQuantity(
                    invoiceId,
                    mod.line_item_id,
                    mod.new_quantity,
                    mod.reason.trim(),
                    userId,
                    client
                );
                resolutionActions.push({
                    action: 'quantity_change',
                    line_item_id: mod.line_item_id,
                    new_quantity: mod.new_quantity,
                    reason: mod.reason
                });
            }

            // Recalculate totals
            const internalInvoiceService = require('./internalInvoiceService');
            await internalInvoiceService.recalculateTotals(invoiceId, client);

            // Track resolution (within transaction)
            // Note: trackIssueResolution creates its own transaction, so we'll do it manually
            try {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET 
                        resolved_at = NOW(),
                        resolved_by = $1,
                        resolution_actions = $2::jsonb
                    WHERE id = $3
                `, [userId, JSON.stringify(resolutionActions), invoiceId]);
            } catch (columnError) {
                // Columns don't exist yet - that's OK, we'll just log to history
                console.log('[Issue Resolution] Resolution columns not found, storing in history only');
            }

            // Log resolution
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    changed_by_user_id,
                    change_details
                ) VALUES ($1, 'issue_resolved', $2, $3)
            `, [
                invoiceId,
                userId,
                JSON.stringify({
                    resolved_at: new Date().toISOString(),
                    resolved_by: userId,
                    resolution_actions: resolutionActions
                })
            ]);

            // Transition back to Approved for fulfillment retry
            // Execute transition logic manually (within our transaction)
            const invoiceStateMachineService = require('./invoiceStateMachineService');
            const transitionResult = await invoiceStateMachineService.executeTransitionLogic(
                invoiceId,
                'Fulfillment_Issue',
                'Approved',
                userId,
                client
            );

            if (!transitionResult.success) {
                throw new Error(transitionResult.error || 'Failed to transition invoice to Approved');
            }

            // Update status manually (since we're in our own transaction)
            // Section 4.3: Clear fulfillment_accepted_by to NULL on issue resolve
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    status = 'Approved',
                    status_updated_at = NOW(),
                    updated_at = NOW(),
                    fulfillment_accepted_by = NULL,
                    fulfillment_accepted_at = NULL
                WHERE id = $1
            `, [invoiceId]);

            // Log status change
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    old_value,
                    new_value,
                    reason,
                    changed_by_user_id
                ) VALUES ($1, 'status_changed', 'status', 'Fulfillment_Issue', 'Approved', $2, $3)
            `, [invoiceId, 'Sales rep resolved fulfillment issues', userId]);

            await client.query('COMMIT');

            // Notify fulfillment team (after commit)
            await this.notifyFulfillmentOfResolution(invoiceId, inv.invoice_number);

            return {
                success: true,
                message: 'Issue resolved and invoice modified. Order returned to Approved status.',
                resolution_actions: resolutionActions
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Modify line item quantity with proper allocation handling
     */
    async modifyLineItemQuantity(invoiceId, lineItemId, newQuantity, reason, userId, client) {
        const lineItem = await client.query(`
            SELECT 
                id,
                quantity_ordered,
                quantity_allocated,
                fk_batch_id,
                original_quantity,
                unit_price,
                line_discount_amount
            FROM "ORDERS-invoice-line-items"
            WHERE id = $1 AND fk_invoice_id = $2
            FOR UPDATE
        `, [lineItemId, invoiceId]);

        if (lineItem.rows.length === 0) {
            throw new Error('Line item not found');
        }

        const item = lineItem.rows[0];
        const quantityDelta = newQuantity - item.quantity_ordered;

        // Store original if this is first modification
        const originalQty = item.original_quantity || item.quantity_ordered;

        const allocationService = require('./allocationService');

        if (quantityDelta > 0) {
            // Increasing, allocate more
            // Check batch availability
            const batch = await client.query(`
                SELECT quantity, allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
                FOR UPDATE
            `, [item.fk_batch_id]);

            if (batch.rows.length === 0) {
                throw new Error('Batch not found');
            }

            const available = batch.rows[0].quantity - batch.rows[0].allocated_quantity;
            
            if (available < quantityDelta) {
                throw new Error(`Insufficient inventory. Available: ${available}, Requested: ${quantityDelta}`);
            }

            // Allocate additional quantity
            await client.query(`
                UPDATE "ORDERS-batches"
                SET allocated_quantity = allocated_quantity + $1
                WHERE id = $2
            `, [quantityDelta, item.fk_batch_id]);

            // Log batch history
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id, change_type, field_name,
                    old_value, new_value, reason,
                    related_invoice_id, changed_by_system
                ) VALUES ($1, 'allocation_increased', 'allocated_quantity',
                          $2, $3, 'Line item quantity increased: ' || $4, $5, false)
            `, [
                item.fk_batch_id,
                batch.rows[0].allocated_quantity,
                batch.rows[0].allocated_quantity + quantityDelta,
                reason,
                invoiceId
            ]);
        } else if (quantityDelta < 0) {
            // Decreasing, release allocation
            const releaseQty = Math.abs(quantityDelta);
            
            // Get current allocated_quantity to prevent negative values
            const batchCheck = await client.query(`
                SELECT allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
                FOR UPDATE
            `, [item.fk_batch_id]);
            
            if (batchCheck.rows.length > 0) {
                const currentAllocated = parseInt(batchCheck.rows[0].allocated_quantity || 0);
                const actualReleaseQty = Math.min(releaseQty, currentAllocated);
                
                if (actualReleaseQty > 0) {
                    await client.query(`
                        UPDATE "ORDERS-batches"
                        SET allocated_quantity = GREATEST(0, allocated_quantity - $1)
                        WHERE id = $2
                    `, [actualReleaseQty, item.fk_batch_id]);

                    // Log batch history
                    await client.query(`
                        INSERT INTO "ORDERS-batch-history" (
                            batch_id, change_type, field_name,
                            old_value, new_value, reason,
                            related_invoice_id, changed_by_system
                        ) VALUES ($1, 'allocation_decreased', 'allocated_quantity',
                                  $2, $3, 'Line item quantity reduced: ' || $4, $5, false)
                    `, [
                        item.fk_batch_id,
                        currentAllocated.toString(),
                        Math.max(0, currentAllocated - actualReleaseQty).toString(),
                        reason,
                        invoiceId
                    ]);
                } else {
                    console.warn(`⚠️  Cannot release allocation for batch ${item.fk_batch_id}: current allocated is ${currentAllocated}, trying to release ${releaseQty}`);
                }
            }
        }

        // Calculate new line total
        const newLineTotal = (parseFloat(item.unit_price) * newQuantity) - parseFloat(item.line_discount_amount || 0);

        // Section 17.3: Traceability Requirements
        // Section 17.3.2: Remove generic default reasons, require explicit user-provided reasons
        if (!reason || reason.trim().length === 0) {
            throw new Error('Modification reason is required. Please provide a specific reason for this change.');
        }
        
        // Section 17.3.2: Validate reason is not a generic default
        const genericReasons = ['modified', 'changed', 'updated', 'adjusted', 'N/A', 'n/a', 'none'];
        if (genericReasons.some(generic => reason.toLowerCase().trim() === generic)) {
            throw new Error('Please provide a specific reason for this modification. Generic reasons like "modified" or "updated" are not allowed.');
        }
        
        // Update line item
        await client.query(`
            UPDATE "ORDERS-invoice-line-items"
            SET 
                quantity_ordered = $1,
                quantity_allocated = $1,
                was_modified = TRUE,
                original_quantity = $2,
                modification_reason = $3,
                modified_at = NOW(),
                modified_by = $4,
                line_total = $5,
                updated_at = NOW()
            WHERE id = $6
        `, [newQuantity, originalQty, reason.trim(), userId, newLineTotal, lineItemId]);

        // Log modification
        await client.query(`
            INSERT INTO "ORDERS-invoice-history" (
                fk_invoice_id,
                modification_type,
                field_name,
                old_value,
                new_value,
                reason,
                changed_by_user_id,
                triggered_by_fulfillment_issue
            ) VALUES ($1, 'line_item_quantity_changed', $2, $3, $4, $5, $6, TRUE)
        `, [
            invoiceId,
            `line_item_${lineItemId}`,
            item.quantity_ordered.toString(),
            newQuantity.toString(),
            reason,
            userId
        ]);
    }

    /**
     * Remove line item with history tracking
     */
    async removeLineItemWithHistory(invoiceId, lineItemId, reason, userId, client) {
        const lineItem = await client.query(`
            SELECT 
                fk_batch_id, 
                quantity_allocated, 
                quantity_ordered
            FROM "ORDERS-invoice-line-items"
            WHERE id = $1 AND fk_invoice_id = $2
            FOR UPDATE
        `, [lineItemId, invoiceId]);

        if (lineItem.rows.length === 0) {
            return; // Already removed or doesn't exist
        }

        const item = lineItem.rows[0];

        // Release allocation
        if (item.quantity_allocated > 0) {
            await client.query(`
                UPDATE "ORDERS-batches"
                SET allocated_quantity = allocated_quantity - $1
                WHERE id = $2
            `, [item.quantity_allocated, item.fk_batch_id]);

            // Log batch history
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id, change_type, field_name,
                    old_value, new_value, reason,
                    related_invoice_id, changed_by_system
                ) VALUES ($1, 'allocation_decreased', 'allocated_quantity',
                          $2, $3, 'Line item removed: ' || $4, $5, false)
            `, [
                item.fk_batch_id,
                item.quantity_allocated,
                0,
                reason,
                invoiceId
            ]);
        }

        // Log before deletion
        await client.query(`
            INSERT INTO "ORDERS-invoice-history" (
                fk_invoice_id,
                modification_type,
                field_name,
                old_value,
                reason,
                changed_by_user_id,
                triggered_by_fulfillment_issue
            ) VALUES ($1, 'line_item_removed', $2, $3, $4, $5, TRUE)
        `, [
            invoiceId,
            `line_item_${lineItemId}`,
            item.quantity_ordered.toString(),
            reason,
            userId
        ]);

        // Delete line item
        await client.query(`
            DELETE FROM "ORDERS-invoice-line-items"
            WHERE id = $1
        `, [lineItemId]);
    }

    /**
     * Add line item with history tracking
     */
    async addLineItemWithHistory(invoiceId, itemData, userId, client) {
        // Use standard addLineItem but mark as modification
        const internalInvoiceService = require('./internalInvoiceService');
        const lineItemId = await internalInvoiceService.addLineItem(
            invoiceId,
            itemData,
            userId,
            client
        );

        // Section 17.3.2: Remove generic default reasons, require explicit user-provided reasons
        if (!itemData.reason || itemData.reason.trim().length === 0) {
            throw new Error('Reason is required when adding line items after fulfillment issue. Please provide a specific reason.');
        }
        
        // Validate reason is not a generic default
        const genericReasons = ['added', 'modified', 'changed', 'updated', 'adjusted', 'N/A', 'n/a', 'none', 'Added after fulfillment issue'];
        if (genericReasons.some(generic => itemData.reason.toLowerCase().trim() === generic.toLowerCase())) {
            throw new Error('Please provide a specific reason for adding this line item. Generic reasons are not allowed.');
        }
        
        // Update modification flags
        await client.query(`
            UPDATE "ORDERS-invoice-line-items"
            SET 
                was_modified = TRUE,
                modification_reason = $1,
                modified_at = NOW(),
                modified_by = $2
            WHERE id = $3
        `, [
            itemData.reason.trim(),
            userId,
            lineItemId
        ]);

        // Log addition
        await client.query(`
            INSERT INTO "ORDERS-invoice-history" (
                fk_invoice_id,
                modification_type,
                field_name,
                new_value,
                reason,
                changed_by_user_id,
                triggered_by_fulfillment_issue
            ) VALUES ($1, 'line_item_added', $2, $3, $4, $5, TRUE)
        `, [
            invoiceId,
            `line_item_${lineItemId}`,
            itemData.quantity.toString(),
            // Section 17.3.2: Remove generic default reasons - validated above
            itemData.reason.trim(),
            userId
        ]);

        return lineItemId;
    }

    /**
     * Notify fulfillment team of issue resolution
     */
    async notifyFulfillmentOfResolution(invoiceId, invoiceNumber) {
        try {
            // Get invoice to find fulfillment worker
            const invoice = await query(`
                SELECT 
                    fulfillment_accepted_by,
                    assigned_sales_rep_id
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);

            if (invoice.rows.length === 0) return;

            const inv = invoice.rows[0];

            // Notify previous fulfillment worker if they exist
            if (inv.fulfillment_accepted_by) {
                await notificationStore.createNotification({
                    userId: inv.fulfillment_accepted_by,
                    type: 'issue_resolved',
                    title: `Issue Resolved: ${invoiceNumber}`,
                    message: `Sales rep has resolved the fulfillment issues. Order is ready for fulfillment again.`,
                    payload: {
                        invoice_id: invoiceId,
                        invoice_number: invoiceNumber
                    },
                    priority: 'normal',
                    requiresAck: false
                });

                await websocketService.sendPersistentNotification(inv.fulfillment_accepted_by, {
                    type: 'issue_resolved',
                    title: `Issue Resolved: ${invoiceNumber}`,
                    message: `Sales rep has resolved the fulfillment issues. Order is ready for fulfillment again.`,
                    payload: {
                        invoice_id: invoiceId,
                        invoice_number: invoiceNumber
                    }
                });
            }
        } catch (error) {
            console.error('Error notifying fulfillment of resolution:', error);
        }
    }
}

module.exports = new FulfillmentIssueService();

