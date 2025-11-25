// Server/Services/manifestStatusTrackingService.js
// Module 5: Post-Manifest Status Tracking
// Tracks manifest lifecycle: In Transit → Delivered → Rejected

const { query, pool } = require('../config/database');
const metrcAuth = require('./metrcAuth');
const websocketService = require('./websocketService');
const batchStatusService = require('./batchStatusService');

class ManifestStatusTrackingService {
    /**
     * Sync manifest statuses from METRC
     * Called by scheduled job every 15 minutes
     */
    async syncManifestStatuses() {
        const client = await pool.connect();
        let syncedCount = 0;
        let errorCount = 0;

        try {
            // Get all invoices with manifests that need status checking
            const invoices = await client.query(`
                SELECT 
                    id,
                    invoice_number,
                    status,
                    manifest_metrc_ids,
                    shipped_at,
                    delivered_at,
                    inventory_finalized
                FROM "ORDERS-invoices"
                WHERE status IN ('Manifested', 'Shipped', 'Partially_Manifested')
                    AND manifest_metrc_ids IS NOT NULL
                    AND jsonb_array_length(manifest_metrc_ids::jsonb) > 0
                ORDER BY manifest_created_at DESC
                LIMIT 100
            `);

            console.log(`[Status Sync] Checking ${invoices.rows.length} invoices...`);

            for (const invoice of invoices.rows) {
                try {
                    const manifestIds = Array.isArray(invoice.manifest_metrc_ids)
                        ? invoice.manifest_metrc_ids
                        : JSON.parse(invoice.manifest_metrc_ids || '[]');

                    // Check status for each manifest
                    const statusResults = [];
                    for (const manifest of manifestIds) {
                        const status = await this.checkManifestStatus(manifest.id, manifest.license);
                        statusResults.push({
                            manifest: manifest,
                            status: status
                        });
                    }

                    // Process status updates
                    await this.processStatusUpdates(invoice.id, invoice.status, statusResults, client);
                    syncedCount++;

                } catch (error) {
                    console.error(`[Status Sync] Error processing invoice ${invoice.invoice_number}:`, error.message);
                    errorCount++;
                }
            }

            console.log(`[Status Sync] Complete: ${syncedCount} synced, ${errorCount} errors`);

            return {
                success: true,
                synced: syncedCount,
                errors: errorCount
            };

        } catch (error) {
            console.error('[Status Sync] Fatal error:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Check manifest status from METRC
     */
    async checkManifestStatus(manifestMetrcId, license) {
        try {
            const response = await metrcAuth.makeAuthenticatedRequest({
                method: 'GET',
                url: `${metrcAuth.apiBaseUrl}/transfers/v2/external/incoming/${manifestMetrcId}`,
                params: {
                    licenseNumber: license
                },
                timeout: 15000
            });

            return {
                success: true,
                status: response.data.status || 'Unknown',
                actualDeliveryDate: response.data.actualDeliveryDate || null,
                departureDateTime: response.data.departureDateTime || null,
                estimatedArrivalDateTime: response.data.estimatedArrivalDateTime || null,
                packagesSent: response.data.packagesSent || 0,
                packagesReceived: response.data.packagesReceived || 0,
                data: response.data
            };
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return { success: false, error: 'Manifest not found in METRC' };
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * Process status updates for an invoice
     */
    async processStatusUpdates(invoiceId, currentStatus, statusResults, client) {
        await client.query('BEGIN');

        try {
            // Determine overall status
            const allStatuses = statusResults.map(r => r.status.status);
            const allDelivered = allStatuses.every(s => s === 'Delivered');
            const allInTransit = allStatuses.every(s => s === 'InTransit');
            const anyRejected = statusResults.some(r => {
                const status = r.status.status;
                const packagesSent = r.status.packagesSent || 0;
                const packagesReceived = r.status.packagesReceived || 0;
                return status === 'Delivered' && packagesSent > packagesReceived;
            });

            let newStatus = currentStatus;
            let updates = {};

            // Handle In Transit status
            if (allInTransit && currentStatus === 'Manifested') {
                newStatus = 'Shipped';
                const firstDeparture = statusResults
                    .map(r => r.status.departureDateTime)
                    .filter(d => d)
                    .sort()[0];
                if (firstDeparture) {
                    updates.shipped_at = firstDeparture;
                }
                const firstEstimatedArrival = statusResults
                    .map(r => r.status.estimatedArrivalDateTime)
                    .filter(d => d)
                    .sort()[0];
                if (firstEstimatedArrival) {
                    updates.estimated_delivery = firstEstimatedArrival;
                }
            }

            // Handle Delivered status
            if (allDelivered && ['Manifested', 'Shipped'].includes(currentStatus)) {
                newStatus = 'Delivered';
                const firstDelivery = statusResults
                    .map(r => r.status.actualDeliveryDate)
                    .filter(d => d)
                    .sort()[0];
                if (firstDelivery) {
                    updates.delivered_at = firstDelivery;
                }

                // Finalize inventory if not already done
                if (!updates.inventory_finalized) {
                    await this.finalizeInventoryDeductions(invoiceId, client);
                    updates.inventory_finalized = true;
                }
            }

            // Handle Rejection
            if (anyRejected) {
                await this.processRejections(invoiceId, statusResults, client);
                if (allDelivered) {
                    // Check if all packages rejected
                    const allRejected = statusResults.every(r => {
                        const sent = r.status.packagesSent || 0;
                        const received = r.status.packagesReceived || 0;
                        return sent > 0 && received === 0;
                    });
                    newStatus = allRejected ? 'Fully_Rejected' : 'Partially_Rejected';
                }
            }

            // Update invoice if status changed
            if (newStatus !== currentStatus || Object.keys(updates).length > 0) {
                const updateFields = [];
                const updateValues = [];
                let paramCount = 1;

                if (newStatus !== currentStatus) {
                    updateFields.push(`status = $${paramCount++}`);
                    updateValues.push(newStatus);
                }

                if (updates.shipped_at) {
                    updateFields.push(`shipped_at = $${paramCount++}`);
                    updateValues.push(updates.shipped_at);
                }

                if (updates.delivered_at) {
                    updateFields.push(`delivered_at = $${paramCount++}`);
                    updateValues.push(updates.delivered_at);
                }

                if (updates.estimated_delivery) {
                    updateFields.push(`estimated_delivery = $${paramCount++}`);
                    updateValues.push(updates.estimated_delivery);
                }

                if (updates.inventory_finalized) {
                    updateFields.push(`inventory_finalized = $${paramCount++}`);
                    updateValues.push(true);
                }

                updateFields.push(`status_updated_at = NOW()`);
                updateValues.push(invoiceId);

                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET ${updateFields.join(', ')}
                    WHERE id = $${paramCount}
                `, updateValues);

                // Log status change
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id,
                        modification_type,
                        field_name,
                        old_value,
                        new_value,
                        changed_by_system,
                        change_details
                    ) VALUES ($1, 'status_changed', 'status', $2, $3, true, $4)
                `, [
                    invoiceId,
                    currentStatus,
                    newStatus,
                    JSON.stringify({
                        status_results: statusResults.map(r => ({
                            manifest: r.manifest.number,
                            status: r.status.status
                        }))
                    })
                ]);
            }

            await client.query('COMMIT');

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    }

    /**
     * Finalize inventory deductions on delivery
     * CRITICAL: Check inventory_finalized flag to prevent double-deduction
     */
    async finalizeInventoryDeductions(invoiceId, client) {
        // Check if already finalized
        const invoice = await client.query(`
            SELECT inventory_finalized
            FROM "ORDERS-invoices"
            WHERE id = $1
        `, [invoiceId]);

        if (invoice.rows[0] && invoice.rows[0].inventory_finalized) {
            console.log(`[Inventory Finalization] Invoice ${invoiceId} already finalized, skipping`);
            return;
        }

        // Get all manifest packages
        const manifestPackages = await client.query(`
            SELECT 
                mp.id,
                mp.package_label,
                mp.batch_id,
                mp.line_item_id,
                mp.quantity,
                mp.package_status,
                li.quantity_ordered,
                li.assigned_package_labels
            FROM "ORDERS-manifest-packages" mp
            JOIN "ORDERS-invoice-line-items" li ON mp.line_item_id = li.id
            WHERE mp.fk_invoice_id = $1
                AND mp.package_status = 'manifested'
        `, [invoiceId]);

        // Group by batch for efficient updates
        const batchUpdates = {};

        for (const pkg of manifestPackages.rows) {
            const batchId = pkg.batch_id;
            if (!batchUpdates[batchId]) {
                batchUpdates[batchId] = {
                    quantity: 0,
                    allocated: 0
                };
            }

            // Check if this is a partial package
            const assignedLabels = Array.isArray(pkg.assigned_package_labels)
                ? pkg.assigned_package_labels
                : JSON.parse(pkg.assigned_package_labels || '[]');

            const isPartialPackage = assignedLabels.length > 0 && assignedLabels.includes(pkg.package_label);

            if (isPartialPackage) {
                // Partial package: only decrement allocated_quantity
                batchUpdates[batchId].allocated += parseFloat(pkg.quantity);
            } else {
                // Full package: decrement both quantity and allocated_quantity
                batchUpdates[batchId].quantity += parseFloat(pkg.quantity);
                batchUpdates[batchId].allocated += parseFloat(pkg.quantity);
            }

            // Update package status
            await client.query(`
                UPDATE "ORDERS-manifest-packages"
                SET package_status = 'delivered'
                WHERE id = $1
            `, [pkg.id]);
        }

        // Apply batch updates
        for (const [batchId, updates] of Object.entries(batchUpdates)) {
            await client.query(`
                UPDATE "ORDERS-batches"
                SET 
                    quantity = quantity - $1,
                    allocated_quantity = allocated_quantity - $2
                WHERE id = $3
            `, [updates.quantity, updates.allocated, batchId]);

            // Log to batch history
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id,
                    change_type,
                    field_name,
                    reason,
                    related_invoice_id,
                    changed_by_system,
                    change_details
                ) VALUES ($1, 'package_delivered', 'quantity', 
                         'Package delivered - inventory finalized', $2, true, $3)
            `, [
                batchId,
                invoiceId,
                JSON.stringify({
                    quantity_decremented: updates.quantity,
                    allocated_decremented: updates.allocated
                })
            ]);

            // Check if batch is now depleted and trigger auto-promotion
            const batch = await client.query(`
                SELECT quantity, allocated_quantity, status
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [batchId]);

            if (batch.rows.length > 0) {
                const b = batch.rows[0];
                const available = parseFloat(b.quantity) - parseFloat(b.allocated_quantity);
                
                if (available <= 0 && b.status === 'Sellable') {
                    // Trigger auto-promotion
                    try {
                        await batchStatusService.autoPromoteNextBatch(batchId);
                    } catch (promoError) {
                        console.error(`[Auto-Promotion] Error promoting batch after delivery:`, promoError.message);
                    }
                }

                // Broadcast batch update
                websocketService.broadcastBatchInventoryUpdate(
                    batchId,
                    available,
                    parseFloat(b.allocated_quantity)
                );
            }
        }

        // Mark invoice as finalized
        await client.query(`
            UPDATE "ORDERS-invoices"
            SET inventory_finalized = true
            WHERE id = $1
        `, [invoiceId]);

        console.log(`[Inventory Finalization] Finalized inventory for invoice ${invoiceId}`);
    }

    /**
     * Process package rejections
     */
    async processRejections(invoiceId, statusResults, client) {
        for (const result of statusResults) {
            const status = result.status;
            const packagesSent = status.packagesSent || 0;
            const packagesReceived = status.packagesReceived || 0;

            if (packagesSent > packagesReceived) {
                const rejectedCount = packagesSent - packagesReceived;

                // Get packages from this manifest
                const manifestPackages = await client.query(`
                    SELECT 
                        id,
                        package_label,
                        package_metrc_id,
                        batch_id,
                        line_item_id
                    FROM "ORDERS-manifest-packages"
                    WHERE fk_invoice_id = $1
                        AND manifest_number = $2
                        AND package_status = 'manifested'
                    ORDER BY id
                    LIMIT $3
                `, [invoiceId, result.manifest.number, rejectedCount]);

                // Mark packages as rejected
                for (const pkg of manifestPackages.rows) {
                    await client.query(`
                        UPDATE "ORDERS-manifest-packages"
                        SET package_status = 'rejected'
                        WHERE id = $1
                    `, [pkg.id]);

                    // Insert into rejected packages table
                    await client.query(`
                        INSERT INTO "ORDERS-rejected_packages" (
                            packagelabel,
                            package_metrc_id,
                            manifestnumber,
                            rejection_date,
                            rejection_reason,
                            synclicense,
                            detected_at
                        ) VALUES ($1, $2, $3, NOW(), $4, $5, NOW())
                        ON CONFLICT (synclicense, packagelabel, manifestnumber) DO NOTHING
                    `, [
                        pkg.package_label,
                        pkg.package_metrc_id,
                        result.manifest.number,
                        'Package rejected by receiving facility',
                        result.manifest.license
                    ]);
                }
            }
        }
    }
}

module.exports = new ManifestStatusTrackingService();

