/**
 * METRC Conflict Detection Service
 * 
 * Detects when packages allocated to invoices disappear from METRC
 * and flags affected invoices for immediate action
 */

const { query, pool } = require('../config/database');
const invoiceStateMachine = require('./invoiceStateMachineService');

class MetrcConflictDetectionService {
    /**
     * Investigate why a package was removed from METRC
     */
    async investigateRemovedPackage(packageLabel, batchId) {
        try {
            const investigation = {
                package_label: packageLabel,
                batch_id: batchId,
                reason: null,
                related_invoices: [],
                metrc_status: null,
                requires_immediate_action: false
            };
            
            // Check 1: Was this package allocated to ANY active orders?
            const allocations = await query(`
                SELECT i.id as invoice_id, i.invoice_number, i.status, i.assigned_sales_rep_id,
                       li.id as line_item_id
                FROM "ORDERS-invoice-line-items" li
                JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                WHERE li.fk_batch_id = $1
                  AND li.assigned_package_labels @> $2::jsonb
                  AND i.status NOT IN ('Cancelled', 'Paid', 'Fully_Rejected')
                ORDER BY i.created_at DESC
            `, [batchId, JSON.stringify([packageLabel])]);
            
            if (allocations.rows.length > 0) {
                investigation.reason = 'allocated_to_active_invoices';
                investigation.related_invoices = allocations.rows;
                investigation.requires_immediate_action = true;
                
                // CRITICAL: Flag all affected invoices immediately
                for (const allocation of allocations.rows) {
                    await this.flagInvoiceForMETRCConflict(
                        allocation.invoice_id, 
                        packageLabel, 
                        batchId, 
                        allocation
                    );
                }
                
                return investigation;
            }
            
            // Check 2: Did it get transferred out?
            const transferred = await query(`
                SELECT metrcid, destination_license, transferred_date
                FROM transferredpackages
                WHERE label = $1
                ORDER BY transferred_date DESC
                LIMIT 1
            `, [packageLabel]);
            
            if (transferred.rows.length > 0) {
                investigation.reason = 'transferred_out';
                investigation.metrc_status = 'transferred';
                investigation.details = transferred.rows[0];
                return investigation;
            }
            
            // Check 3: Was it made inactive?
            const inactive = await query(`
                SELECT metrcid, finisheddate, finishedreason
                FROM inactivepackages
                WHERE label = $1
                ORDER BY finisheddate DESC
                LIMIT 1
            `, [packageLabel]);
            
            if (inactive.rows.length > 0) {
                investigation.reason = 'made_inactive';
                investigation.metrc_status = 'finished';
                investigation.details = inactive.rows[0];
                return investigation;
            }
            
            // Unknown reason - CRITICAL ALERT
            investigation.reason = 'unknown_removal';
            investigation.requires_immediate_action = true;
            
            await this.alertAdminTeam({
                type: 'UNKNOWN_PACKAGE_DISAPPEARANCE',
                package_label: packageLabel,
                batch_id: batchId,
                message: 'Package disappeared from METRC with no clear reason'
            });
            
            return investigation;
        } catch (error) {
            console.error('Error investigating removed package:', error);
            return {
                package_label: packageLabel,
                batch_id: batchId,
                error: error.message
            };
        }
    }

    /**
     * Flag invoice for METRC conflict and transition to safe state
     */
    async flagInvoiceForMETRCConflict(invoiceId, packageLabel, batchId, allocation) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get current invoice status
            const invoice = await client.query(`
                SELECT status FROM "ORDERS-invoices" WHERE id = $1 FOR UPDATE
            `, [invoiceId]);
            
            if (invoice.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Invoice not found' };
            }
            
            const currentStatus = invoice.rows[0].status;
            
            // Only transition if not already in a terminal or issue state
            if (!['Fulfillment_Issue', 'Cancelled', 'Paid', 'Fully_Rejected'].includes(currentStatus)) {
                // Transition to Fulfillment_Issue
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET status = 'Fulfillment_Issue',
                        fulfillment_issue_reported_at = NOW(),
                        fulfillment_issue_note = $1,
                        status_updated_at = NOW()
                    WHERE id = $2
                `, [
                    `🚨 METRC SYNC ALERT: Package ${packageLabel} allocated to this order is no longer in active inventory. ` +
                    `This package may have been transferred, destroyed, or removed from METRC. ` +
                    `Sales must verify order and reallocate inventory.`,
                    invoiceId
                ]);
                
                // Log to invoice history
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id, modification_type, field_name,
                        old_value, new_value, reason, changed_by_system
                    ) VALUES ($1, 'fulfillment_issue_reported', 'status', 
                              $2, 'Fulfillment_Issue', 'METRC conflict detected', true)
                `, [invoiceId, currentStatus]);
                
                console.log(`🚨 Flagged invoice ${invoiceId} for METRC conflict`);
                
                await client.query('COMMIT');
                
                // TODO: Send notification to sales rep
                // await this.notifySalesRep(invoiceId, packageLabel);
                
                return { success: true };
            }
            
            await client.query('COMMIT');
            return { success: true, message: 'Invoice already in issue state' };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error flagging invoice for METRC conflict:', error);
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    }

    /**
     * Alert admin team about critical METRC conflicts
     */
    async alertAdminTeam(alert) {
        console.error(`🚨 METRC CRITICAL ALERT:`, alert);
        
        // TODO: Implement actual alerting (email, Slack, etc.)
        // For now, just log to console
        
        try {
            // Could log to audit table or send to notification system
            await query(`
                INSERT INTO "ORDERS-audit_log" (
                    action, resource_type, details, status
                ) VALUES ('metrc_conflict_detected', 'Invoice', $1, 'warning')
            `, [JSON.stringify(alert)]);
        } catch (error) {
            console.error('Error logging METRC alert:', error);
        }
    }

    /**
     * Detect changes in batch data during METRC sync
     * Returns list of removed packages that need investigation
     */
    async detectPackageChanges(freshBatches, existingBatches) {
        const changes = {
            new: [],
            updated: [],
            removed: [],
            packageChanges: []
        };
        
        // Create lookup maps
        const existingMap = new Map(
            existingBatches.map(b => [b.batch_name, b])
        );
        const freshMap = new Map(
            freshBatches.map(b => [b.batch_name, b])
        );
        
        // Detect new batches
        for (const [batchName, freshBatch] of freshMap) {
            if (!existingMap.has(batchName)) {
                changes.new.push(freshBatch);
            }
        }
        
        // Detect removed batches and package-level changes
        for (const [batchName, existingBatch] of existingMap) {
            const freshBatch = freshMap.get(batchName);
            
            if (!freshBatch) {
                // Batch no longer exists in METRC
                changes.removed.push(existingBatch);
                
                // Investigate ALL packages in this batch
                if (existingBatch.available_labels && existingBatch.available_labels.length > 0) {
                    for (const packageLabel of existingBatch.available_labels) {
                        await this.investigateRemovedPackage(packageLabel, existingBatch.id);
                    }
                }
                continue;
            }
            
            // Compare package labels
            const existingLabels = existingBatch.available_labels || [];
            const freshLabels = freshBatch.available_labels || [];
            
            const removedPackages = existingLabels.filter(label => !freshLabels.includes(label));
            const addedPackages = freshLabels.filter(label => !existingLabels.includes(label));
            
            if (removedPackages.length > 0) {
                changes.packageChanges.push({
                    batch_name: batchName,
                    batch_id: existingBatch.id,
                    removed_packages: removedPackages,
                    added_packages: addedPackages
                });
                
                // Investigate each removed package
                for (const packageLabel of removedPackages) {
                    await this.investigateRemovedPackage(packageLabel, existingBatch.id);
                }
            }
            
            // Compare other critical fields
            const updates = {};
            if (freshBatch.quantity !== existingBatch.quantity) {
                updates.quantity = { old: existingBatch.quantity, new: freshBatch.quantity };
            }
            
            if (freshBatch.package_count !== existingBatch.package_count) {
                updates.package_count = {
                    old: existingBatch.package_count,
                    new: freshBatch.package_count
                };
            }
            
            if (Object.keys(updates).length > 0) {
                changes.updated.push({
                    batch_name: batchName,
                    batch_id: existingBatch.id,
                    updates: updates,
                    full_fresh_data: freshBatch
                });
            }
        }
        
        return changes;
    }
}

module.exports = new MetrcConflictDetectionService();

