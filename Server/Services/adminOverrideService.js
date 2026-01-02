// Server/Services/adminOverrideService.js
// Module 11: Admin Tools & Overrides Service

const { pool } = require('../config/database');
const auditLogger = require('./auditLogger');

class AdminOverrideService {
    /**
     * Override invoice fields directly
     */
    async overrideInvoiceFields({ invoiceId, userId, fields, reason, approvalTicketNumber, sourceIp }) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Get current invoice state
            const currentInvoice = await client.query(`
                SELECT 
                    status,
                    metrc_manifest_numbers,
                    transportation_details,
                    fulfillment_accepted_at,
                    fulfillment_issue_reported_at,
                    manifest_created_at
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);

            if (currentInvoice.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Invoice not found' };
            }

            const current = currentInvoice.rows[0];
            const changes = {};
            const updates = [];
            const updateParams = [];
            let paramCount = 1;

            // Build update query dynamically
            if (fields.status !== undefined && fields.status !== current.status) {
                updates.push(`status = $${paramCount++}`);
                updateParams.push(fields.status);
                changes.status = { from: current.status, to: fields.status };
            }

            if (fields.metrc_manifest_numbers !== undefined) {
                const newValue = Array.isArray(fields.metrc_manifest_numbers) 
                    ? JSON.stringify(fields.metrc_manifest_numbers)
                    : fields.metrc_manifest_numbers;
                const currentValue = current.metrc_manifest_numbers 
                    ? JSON.stringify(current.metrc_manifest_numbers)
                    : null;
                
                if (newValue !== currentValue) {
                    updates.push(`metrc_manifest_numbers = $${paramCount++}`);
                    updateParams.push(newValue);
                    changes.metrc_manifest_numbers = { from: current.metrc_manifest_numbers, to: fields.metrc_manifest_numbers };
                }
            }

            if (fields.transportation_details !== undefined) {
                const newValue = typeof fields.transportation_details === 'object'
                    ? JSON.stringify(fields.transportation_details)
                    : fields.transportation_details;
                const currentValue = current.transportation_details
                    ? JSON.stringify(current.transportation_details)
                    : null;
                
                if (newValue !== currentValue) {
                    updates.push(`transportation_details = $${paramCount++}::jsonb`);
                    updateParams.push(newValue);
                    changes.transportation_details = { from: current.transportation_details, to: fields.transportation_details };
                }
            }

            if (fields.fulfillment_accepted_at !== undefined) {
                updates.push(`fulfillment_accepted_at = $${paramCount++}`);
                updateParams.push(fields.fulfillment_accepted_at || null);
                changes.fulfillment_accepted_at = { from: current.fulfillment_accepted_at, to: fields.fulfillment_accepted_at };
            }

            if (fields.fulfillment_issue_reported_at !== undefined) {
                updates.push(`fulfillment_issue_reported_at = $${paramCount++}`);
                updateParams.push(fields.fulfillment_issue_reported_at || null);
                changes.fulfillment_issue_reported_at = { from: current.fulfillment_issue_reported_at, to: fields.fulfillment_issue_reported_at };
            }

            if (fields.manifest_created_at !== undefined) {
                updates.push(`manifest_created_at = $${paramCount++}`);
                updateParams.push(fields.manifest_created_at || null);
                changes.manifest_created_at = { from: current.manifest_created_at, to: fields.manifest_created_at };
            }

            if (updates.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'No changes detected' };
            }

            // Add updated_at
            updates.push(`updated_at = NOW()`);
            updateParams.push(invoiceId);

            // Execute update
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET ${updates.join(', ')}
                WHERE id = $${paramCount}
            `, updateParams);

            // Log to invoice history
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    reason,
                    changed_by_user_id,
                    changed_by_system,
                    change_details
                ) VALUES ($1, 'admin_override', $2, $3, false, $4::jsonb)
            `, [
                invoiceId,
                reason,
                userId,
                JSON.stringify({
                    admin_override: true,
                    approval_ticket_number: approvalTicketNumber,
                    changes,
                    before: current,
                    after: fields
                })
            ]);

            // Audit log
            await auditLogger.logAction({
                userId,
                action: 'admin_override_invoice_fields',
                resourceType: 'Invoice',
                resourceId: invoiceId.toString(),
                details: {
                    admin_override: true,
                    approval_ticket_number: approvalTicketNumber,
                    reason,
                    changes,
                    before: current,
                    after: fields
                },
                status: 'success',
                sourceIp
            });

            await client.query('COMMIT');

            return {
                success: true,
                changes
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Override invoice fields error:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Manually add scanned package
     */
    async manuallyAddPackage({ invoiceId, lineItemId, packageLabel, userId, reason, sourceIp }) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Validate package exists in activepackages
            const packageCheck = await client.query(`
                SELECT 
                    p.package_label,
                    p.synclicense,
                    p.quantity,
                    p.item_strain_name,
                    b.id as batch_id,
                    b.fk_master_product_id
                FROM activepackages p
                LEFT JOIN "ORDERS-batches" b ON p.batch_id = b.batch_id
                WHERE p.package_label = $1
            `, [packageLabel]);

            if (packageCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Package not found in METRC active packages' };
            }

            const pkg = packageCheck.rows[0];

            // Get line item details
            const lineItem = await client.query(`
                SELECT 
                    li.id,
                    li.fk_batch_id,
                    li.assigned_package_labels,
                    b.synclicense as batch_license
                FROM "ORDERS-invoice-line-items" li
                JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
                WHERE li.id = $1 AND li.fk_invoice_id = $2
            `, [lineItemId, invoiceId]);

            if (lineItem.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Line item not found or does not belong to invoice' };
            }

            const item = lineItem.rows[0];

            // Validate license matches
            if (pkg.synclicense !== item.batch_license) {
                await client.query('ROLLBACK');
                return { 
                    success: false, 
                    error: `Package license ${pkg.synclicense} does not match batch license ${item.batch_license}` 
                };
            }

            // Validate batch matches
            if (pkg.batch_id && pkg.batch_id !== item.fk_batch_id) {
                await client.query('ROLLBACK');
                return { 
                    success: false, 
                    error: `Package belongs to different batch` 
                };
            }

            // Check if package already assigned to another invoice
            const existingAssignment = await client.query(`
                SELECT 
                    li.fk_invoice_id,
                    i.invoice_number
                FROM "ORDERS-invoice-line-items" li
                JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                WHERE li.assigned_package_labels::text LIKE $1
                    AND li.fk_invoice_id != $2
            `, [`%${packageLabel}%`, invoiceId]);

            if (existingAssignment.rows.length > 0) {
                await client.query('ROLLBACK');
                return { 
                    success: false, 
                    error: `Package already assigned to invoice ${existingAssignment.rows[0].invoice_number}` 
                };
            }

            // Add package to assigned_package_labels
            const currentLabels = item.assigned_package_labels || [];
            const updatedLabels = Array.isArray(currentLabels) 
                ? [...currentLabels, packageLabel]
                : [packageLabel];

            await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET assigned_package_labels = $1::jsonb,
                    updated_at = NOW()
                WHERE id = $2
            `, [JSON.stringify(updatedLabels), lineItemId]);

            // Log to invoice history
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    reason,
                    changed_by_user_id,
                    changed_by_system,
                    change_details
                ) VALUES ($1, 'admin_manual_package_add', $2, $3, false, $4::jsonb)
            `, [
                invoiceId,
                reason,
                userId,
                JSON.stringify({
                    admin_manual_add: true,
                    package_label: packageLabel,
                    line_item_id: lineItemId,
                    package_details: pkg
                })
            ]);

            // Audit log
            await auditLogger.logAction({
                userId,
                action: 'admin_manual_package_add',
                resourceType: 'Invoice',
                resourceId: invoiceId.toString(),
                details: {
                    admin_manual_add: true,
                    package_label: packageLabel,
                    line_item_id: lineItemId,
                    package_details: pkg,
                    reason
                },
                status: 'success',
                sourceIp
            });

            await client.query('COMMIT');

            return {
                success: true,
                package: {
                    label: packageLabel,
                    quantity: pkg.quantity,
                    strain: pkg.item_strain_name
                }
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Manually add package error:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Force release allocation
     */
    async forceReleaseAllocation({ invoiceId, lineItemId, batchId, userId, reason, sourceIp }) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Get current quantities
            const lineItem = await client.query(`
                SELECT 
                    quantity_allocated,
                    fk_batch_id
                FROM "ORDERS-invoice-line-items"
                WHERE id = $1 AND fk_invoice_id = $2
            `, [lineItemId, invoiceId]);

            if (lineItem.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Line item not found' };
            }

            const currentAllocated = parseInt(lineItem.rows[0].quantity_allocated || 0);
            const itemBatchId = lineItem.rows[0].fk_batch_id;

            if (itemBatchId !== batchId) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Batch ID mismatch' };
            }

            // Get batch current allocated quantity
            const batch = await client.query(`
                SELECT allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [batchId]);

            if (batch.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Batch not found' };
            }

            const batchAllocated = parseInt(batch.rows[0].allocated_quantity || 0);

            // Release allocation
            await client.query(`
                UPDATE "ORDERS-batches"
                SET allocated_quantity = allocated_quantity - $1
                WHERE id = $2
            `, [currentAllocated, batchId]);

            await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET quantity_allocated = 0,
                    updated_at = NOW()
                WHERE id = $1
            `, [lineItemId]);

            // Log to batch history
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id,
                    change_type,
                    field_name,
                    old_value,
                    new_value,
                    reason,
                    related_invoice_id,
                    changed_by_system
                ) VALUES ($1, 'admin_force_release', 'allocated_quantity', $2, $3, $4, $5, false)
            `, [
                batchId,
                batchAllocated.toString(),
                (batchAllocated - currentAllocated).toString(),
                reason,
                invoiceId
            ]);

            // Log to invoice history
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    reason,
                    changed_by_user_id,
                    changed_by_system,
                    change_details
                ) VALUES ($1, 'admin_force_release_allocation', $2, $3, false, $4::jsonb)
            `, [
                invoiceId,
                reason,
                userId,
                JSON.stringify({
                    admin_force_release: true,
                    line_item_id: lineItemId,
                    batch_id: batchId,
                    quantity_released: currentAllocated,
                    batch_allocated_before: batchAllocated,
                    batch_allocated_after: batchAllocated - currentAllocated
                })
            ]);

            // Audit log
            await auditLogger.logAction({
                userId,
                action: 'admin_force_release_allocation',
                resourceType: 'Invoice',
                resourceId: invoiceId.toString(),
                details: {
                    admin_force_release: true,
                    line_item_id: lineItemId,
                    batch_id: batchId,
                    quantity_released: currentAllocated,
                    reason
                },
                status: 'success',
                sourceIp
            });

            await client.query('COMMIT');

            return {
                success: true,
                details: {
                    quantity_released: currentAllocated,
                    batch_allocated_before: batchAllocated,
                    batch_allocated_after: batchAllocated - currentAllocated
                }
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Force release allocation error:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Get invoice for override preview
     */
    async getInvoiceForOverride(invoiceId) {
        const client = await pool.connect();
        
        try {
            const result = await client.query(`
                SELECT 
                    id,
                    invoice_number,
                    status,
                    metrc_manifest_numbers,
                    transportation_details,
                    fulfillment_accepted_at,
                    fulfillment_issue_reported_at,
                    manifest_created_at
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);

            if (result.rows.length === 0) {
                return null;
            }

            return result.rows[0];
        } catch (error) {
            console.error('Get invoice preview error:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Log security audit for failed attempts
     */
    async logSecurityAudit({ userId, action, resourceType, resourceId, status, reason, sourceIp }) {
        const client = await pool.connect();
        
        try {
            // Check if security_audit_log table exists, if not create it
            await client.query(`
                CREATE TABLE IF NOT EXISTS "ORDERS-security_audit_log" (
                    id BIGSERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    action VARCHAR(100) NOT NULL,
                    resource_type VARCHAR(50),
                    resource_id VARCHAR(255),
                    status VARCHAR(20) NOT NULL,
                    reason TEXT,
                    source_ip INET,
                    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);

            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_security_audit_user_id 
                ON "ORDERS-security_audit_log"(user_id);
            `);

            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_security_audit_timestamp 
                ON "ORDERS-security_audit_log"(timestamp);
            `);

            await client.query(`
                INSERT INTO "ORDERS-security_audit_log" (
                    user_id, action, resource_type, resource_id, status, reason, source_ip
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [userId, action, resourceType, resourceId, status, reason, sourceIp]);

            // Check for multiple failed attempts
            const failedAttempts = await client.query(`
                SELECT COUNT(*) as count
                FROM "ORDERS-security_audit_log"
                WHERE user_id = $1
                    AND status = 'failure'
                    AND timestamp >= NOW() - INTERVAL '1 hour'
            `, [userId]);

            const attemptCount = parseInt(failedAttempts.rows[0].count || 0);

            // Alert if >3 failed attempts
            if (attemptCount > 3) {
                // Log to main audit log for admin notification
                await auditLogger.logAction({
                    userId,
                    action: 'security_audit_multiple_failures',
                    resourceType: 'Security',
                    resourceId: userId.toString(),
                    details: {
                        failed_attempts: attemptCount,
                        action,
                        resource_type: resourceType,
                        resource_id: resourceId
                    },
                    status: 'failure',
                    sourceIp
                });
            }
        } catch (error) {
            console.error('Security audit log error:', error);
            // Don't throw - this is non-critical
        } finally {
            client.release();
        }
    }
}

module.exports = new AdminOverrideService();



