// Server/Services/adminSessionService.js
// Module 5: Admin Tools for Scanning Session Management

const { query, pool } = require('../config/database');
const websocketService = require('./websocketService');

class AdminSessionService {
    /**
     * Get all active scanning sessions
     * GET /api/v1/admin/fulfillment/sessions
     */
    async getAllActiveSessions(filters = {}) {
        const { worker_id, duration_min, sortBy = 'last_activity', sortOrder = 'desc' } = filters;
        const client = await pool.connect();

        try {
            // 3.4.3: Get count of abandoned sessions for dashboard
            const abandonedCount = await client.query(`
                SELECT COUNT(*) as count
                FROM "ORDERS-scanning-sessions"
                WHERE session_status = 'abandoned'
                    AND abandoned_at >= NOW() - INTERVAL '7 days'
            `);
            
            let sql = `
                SELECT 
                    ss.id,
                    ss.fk_invoice_id,
                    ss.fk_user_id,
                    ss.session_status,
                    ss.currently_locked_packages,
                    ss.last_activity,
                    ss.started_at,
                    ss.completed_at,
                    ss.cancelled_at,
                    ss.abandoned_at,
                    ss.websocket_connection_id,
                    i.invoice_number,
                    i.status as invoice_status,
                    u.first_name || ' ' || u.last_name as worker_name,
                    EXTRACT(EPOCH FROM (NOW() - ss.started_at)) / 60 as session_duration_minutes,
                    EXTRACT(EPOCH FROM (NOW() - ss.last_activity)) / 60 as inactivity_minutes
                FROM "ORDERS-scanning-sessions" ss
                JOIN "ORDERS-invoices" i ON ss.fk_invoice_id = i.id
                JOIN users u ON ss.fk_user_id = u.id
                WHERE ss.session_status = 'active'
            `;

            const params = [];
            let paramCount = 1;

            if (worker_id) {
                sql += ` AND ss.fk_user_id = $${paramCount++}`;
                params.push(worker_id);
            }

            if (duration_min) {
                sql += ` AND EXTRACT(EPOCH FROM (NOW() - ss.started_at)) / 60 >= $${paramCount++}`;
                params.push(duration_min);
            }

            // 3.6.3: Add sort options
            const sortColumnMap = {
                'last_activity': 'ss.last_activity',
                'duration': 'session_duration_minutes',
                'invoice_number': 'i.invoice_number',
                'worker': 'worker_name'
            };
            
            const sortColumn = sortColumnMap[sortBy] || 'ss.last_activity';
            const sortDirection = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
            sql += ` ORDER BY ${sortColumn} ${sortDirection}`;

            const sessions = await client.query(sql, params);

            // Get scanning progress for each session
            const sessionsWithProgress = await Promise.all(
                sessions.rows.map(async (session) => {
                    const progress = await this.getSessionProgress(session.fk_invoice_id, client);
                    return {
                        id: session.id,
                        session_id: session.id, // Alias for compatibility
                        invoice_id: session.fk_invoice_id,
                        invoice_number: session.invoice_number,
                        worker_name: session.worker_name,
                        session_duration_minutes: session.session_duration_minutes,
                        duration_minutes: session.session_duration_minutes, // Alias
                        last_activity: session.last_activity,
                        total_packages_scanned: progress.total_packages_scanned,
                        total_packages_needed: progress.total_packages_needed,
                        currently_locked_packages: session.currently_locked_packages,
                        session_status: session.session_status
                    };
                })
            );

            return {
                success: true,
                sessions: sessionsWithProgress,
                total: sessionsWithProgress.length,
                abandoned_sessions_count: parseInt(abandonedCount.rows[0]?.count || 0) // 3.4.3
            };

        } finally {
            client.release();
        }
    }

    /**
     * Get scanning progress for an invoice
     */
    async getSessionProgress(invoiceId, client) {
        const lineItems = await client.query(`
            SELECT 
                li.id,
                li.quantity_ordered,
                li.assigned_package_labels,
                li.specific_package_labels
            FROM "ORDERS-invoice-line-items" li
            WHERE li.fk_invoice_id = $1
        `, [invoiceId]);

        let totalNeeded = 0;
        let totalScanned = 0;

        for (const li of lineItems.rows) {
            const isPartial = li.specific_package_labels !== null && li.specific_package_labels !== '';
            
            if (isPartial) {
                // For partial packages, count the number of specific labels
                try {
                    const specificLabels = Array.isArray(li.specific_package_labels)
                        ? li.specific_package_labels
                        : JSON.parse(li.specific_package_labels || '[]');
                    const assignedLabels = li.assigned_package_labels
                        ? (Array.isArray(li.assigned_package_labels)
                            ? li.assigned_package_labels
                            : JSON.parse(li.assigned_package_labels || '[]'))
                        : [];
                    
                    // Normalize labels for comparison (uppercase) to handle case differences
                    const normalizedSpecificLabels = specificLabels.map(label => String(label).toUpperCase());
                    const normalizedAssignedLabels = assignedLabels.map(label => String(label).toUpperCase());
                    
                    totalNeeded += specificLabels.length;
                    // Count how many specific labels have been scanned (case-insensitive comparison)
                    totalScanned += normalizedSpecificLabels.filter(label => normalizedAssignedLabels.includes(label)).length;
                } catch (error) {
                    console.warn(`[AdminSession] Error parsing partial package labels:`, error);
                }
            } else {
                // For full packages, count quantity_ordered and scanned labels
                const labels = Array.isArray(li.assigned_package_labels)
                    ? li.assigned_package_labels
                    : (li.assigned_package_labels ? JSON.parse(li.assigned_package_labels) : []);
                
                totalNeeded += parseFloat(li.quantity_ordered) || 0;
                totalScanned += labels.length;
            }
        }

        return {
            total_packages_needed: totalNeeded,
            total_packages_scanned: totalScanned,
            percentage: totalNeeded > 0 ? Math.round((totalScanned / totalNeeded) * 100) : 0
        };
    }

    /**
     * Force complete a scanning session
     * POST /api/v1/admin/fulfillment/sessions/:sessionId/force-complete
     */
    async forceCompleteSession(sessionId, adminUserId, reason) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get session details
            const session = await client.query(`
                SELECT 
                    ss.id,
                    ss.fk_invoice_id,
                    ss.fk_user_id,
                    ss.currently_locked_packages,
                    i.invoice_number
                FROM "ORDERS-scanning-sessions" ss
                JOIN "ORDERS-invoices" i ON ss.fk_invoice_id = i.id
                WHERE ss.id = $1
                    AND ss.session_status = 'active'
            `, [sessionId]);

            if (session.rows.length === 0) {
                throw new Error('Active session not found');
            }

            const sess = session.rows[0];

            // Release all locked packages
            const lockedPackages = Array.isArray(sess.currently_locked_packages)
                ? sess.currently_locked_packages
                : (sess.currently_locked_packages ? JSON.parse(sess.currently_locked_packages) : []);

            for (const packageLabel of lockedPackages) {
                await websocketService.broadcastPackageReleased([packageLabel], sess.fk_invoice_id);
            }

            // Clear assigned packages
            await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET assigned_package_labels = NULL
                WHERE fk_invoice_id = $1
            `, [sess.fk_invoice_id]);

            // Mark session as completed
            await client.query(`
                UPDATE "ORDERS-scanning-sessions"
                SET 
                    session_status = 'completed',
                    completed_at = NOW()
                WHERE id = $1
            `, [sessionId]);

            // Return invoice to Approved status
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    status = 'Approved',
                    fulfillment_accepted_by = NULL,
                    fulfillment_accepted_at = NULL,
                    status_updated_at = NOW()
                WHERE id = $1
            `, [sess.fk_invoice_id]);

            // Log force completion
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    reason,
                    changed_by_user_id,
                    change_details
                ) VALUES ($1, 'scanning_cancelled', $2, $3, $4)
            `, [
                sess.fk_invoice_id,
                `Admin force-completed session: ${reason}`,
                adminUserId,
                JSON.stringify({
                    session_id: sessionId,
                    reason: reason,
                    locked_packages_released: lockedPackages.length
                })
            ]);

            await client.query('COMMIT');

            return {
                success: true,
                message: `Session force-completed. ${lockedPackages.length} package(s) released.`,
                invoice_number: sess.invoice_number
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Remove mistakenly scanned package
     * POST /api/v1/admin/fulfillment/sessions/remove-package
     */
    async removeScannedPackage(invoiceId, lineItemId, packageLabel, userId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verify invoice not yet manifested
            const invoice = await client.query(`
                SELECT status, manifest_created_at
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            if (invoice.rows[0].manifest_created_at) {
                throw new Error('Cannot remove package - manifest already created');
            }

            // Get current assigned packages
            const lineItem = await client.query(`
                SELECT assigned_package_labels
                FROM "ORDERS-invoice-line-items"
                WHERE id = $1 AND fk_invoice_id = $2
            `, [lineItemId, invoiceId]);

            if (lineItem.rows.length === 0) {
                throw new Error('Line item not found');
            }

            const labels = Array.isArray(lineItem.rows[0].assigned_package_labels)
                ? lineItem.rows[0].assigned_package_labels
                : (lineItem.rows[0].assigned_package_labels ? JSON.parse(lineItem.rows[0].assigned_package_labels) : []);

            if (!labels.includes(packageLabel)) {
                throw new Error('Package not found in line item');
            }

            // Remove package
            const updatedLabels = labels.filter(l => l !== packageLabel);

            await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET assigned_package_labels = $1
                WHERE id = $2
            `, [JSON.stringify(updatedLabels), lineItemId]);

            // Remove from session's locked packages
            await client.query(`
                UPDATE "ORDERS-scanning-sessions"
                SET currently_locked_packages = (
                    SELECT jsonb_agg(value)
                    FROM jsonb_array_elements(currently_locked_packages) AS value
                    WHERE value::text != $1
                )
                WHERE fk_invoice_id = $2
                    AND session_status = 'active'
            `, [JSON.stringify(packageLabel), invoiceId]);

            // Broadcast package release
            await websocketService.broadcastPackageReleased([packageLabel], invoiceId);

            // Log removal
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    old_value,
                    new_value,
                    changed_by_user_id
                ) VALUES ($1, 'package_removed', 'line_item_' || $2, $3, $4, $5)
            `, [
                invoiceId,
                lineItemId,
                packageLabel,
                JSON.stringify(updatedLabels),
                userId
            ]);

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Package removed successfully',
                remaining_count: updatedLabels.length
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Edit scanned package label
     * POST /api/v1/admin/fulfillment/sessions/edit-package
     */
    async editScannedPackage(invoiceId, lineItemId, oldPackageLabel, newPackageLabel, userId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verify invoice not yet manifested
            const invoice = await client.query(`
                SELECT status, manifest_created_at
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            if (invoice.rows[0].manifest_created_at) {
                throw new Error('Cannot edit package - manifest already created');
            }

            // Get current assigned packages
            const lineItem = await client.query(`
                SELECT assigned_package_labels
                FROM "ORDERS-invoice-line-items"
                WHERE id = $1 AND fk_invoice_id = $2
            `, [lineItemId, invoiceId]);

            if (lineItem.rows.length === 0) {
                throw new Error('Line item not found');
            }

            const labels = Array.isArray(lineItem.rows[0].assigned_package_labels)
                ? lineItem.rows[0].assigned_package_labels
                : (lineItem.rows[0].assigned_package_labels ? JSON.parse(lineItem.rows[0].assigned_package_labels) : []);

            if (!labels.includes(oldPackageLabel)) {
                throw new Error('Old package label not found in line item');
            }

            // Replace old label with new label
            const updatedLabels = labels.map(l => l === oldPackageLabel ? newPackageLabel : l);

            await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET assigned_package_labels = $1
                WHERE id = $2
            `, [JSON.stringify(updatedLabels), lineItemId]);

            // Update session's locked packages
            await client.query(`
                UPDATE "ORDERS-scanning-sessions"
                SET currently_locked_packages = (
                    SELECT jsonb_agg(
                        CASE 
                            WHEN value::text = $1 THEN $2::jsonb
                            ELSE value
                        END
                    )
                    FROM jsonb_array_elements(currently_locked_packages) AS value
                )
                WHERE fk_invoice_id = $3
                    AND session_status = 'active'
            `, [JSON.stringify(oldPackageLabel), JSON.stringify(newPackageLabel), invoiceId]);

            // Release old package, lock new package
            await websocketService.broadcastPackageReleased([oldPackageLabel], invoiceId);
            // Note: New package will be validated when scanned, so we don't need to lock it here

            // Log edit
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    old_value,
                    new_value,
                    changed_by_user_id
                ) VALUES ($1, 'package_label_edited', 'line_item_' || $2, $3, $4, $5)
            `, [
                invoiceId,
                lineItemId,
                oldPackageLabel,
                newPackageLabel,
                userId
            ]);

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Package label updated successfully',
                old_label: oldPackageLabel,
                new_label: newPackageLabel
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Manually adjust session data (admin override)
     * POST /api/v1/admin/fulfillment/sessions/:sessionId/adjust
     */
    async manuallyAdjustSession(sessionId, adminUserId, adjustments, reason) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get session
            const session = await client.query(`
                SELECT id, fk_invoice_id, currently_locked_packages
                FROM "ORDERS-scanning-sessions"
                WHERE id = $1
            `, [sessionId]);

            if (session.rows.length === 0) {
                throw new Error('Session not found');
            }

            // Validate adjustments
            if (adjustments.currently_locked_packages) {
                if (!Array.isArray(adjustments.currently_locked_packages)) {
                    throw new Error('currently_locked_packages must be an array');
                }
            }

            // Apply adjustments
            const updateFields = [];
            const updateValues = [];
            let paramCount = 1;

            if (adjustments.currently_locked_packages !== undefined) {
                updateFields.push(`currently_locked_packages = $${paramCount++}`);
                updateValues.push(JSON.stringify(adjustments.currently_locked_packages));
            }

            if (updateFields.length === 0) {
                throw new Error('No valid adjustments provided');
            }

            updateValues.push(sessionId);

            await client.query(`
                UPDATE "ORDERS-scanning-sessions"
                SET ${updateFields.join(', ')}
                WHERE id = $${paramCount}
            `, updateValues);

            // Log adjustment
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    reason,
                    changed_by_user_id,
                    change_details
                ) VALUES ($1, 'session_manually_adjusted', $2, $3, $4)
            `, [
                session.rows[0].fk_invoice_id,
                reason,
                adminUserId,
                JSON.stringify({
                    session_id: sessionId,
                    adjustments: adjustments,
                    old_data: {
                        currently_locked_packages: session.rows[0].currently_locked_packages
                    }
                })
            ]);

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Session data adjusted successfully'
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new AdminSessionService();

