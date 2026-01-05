// Server/Services/cancelledShipmentService.js
// Module 5: Cancelled Shipments & Returns

const { query, pool } = require('../config/database');
const websocketService = require('./websocketService');

class CancelledShipmentService {
    /**
     * Process cancellation after shipment
     * POST /api/v1/fulfillment/cancelled-shipments/cancel
     */
    async processCancellation(invoiceId, userId, cancellationReason, incidentType = 'other') {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get invoice details
            const invoice = await client.query(`
                SELECT 
                    id,
                    invoice_number,
                    status,
                    manifest_metrc_ids
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            // Section 9.1: Add explicit check: Cannot transition from Delivered status
            // Verify status allows cancellation
            if (inv.status === 'Delivered') {
                throw new Error(`Cannot cancel shipment - invoice status is Delivered. Cannot cancel after delivery.`);
            }
            
            if (inv.status !== 'Shipped' && inv.status !== 'Manifested') {
                throw new Error(`Cannot cancel shipment - invoice status is ${inv.status}. Only Shipped or Manifested invoices can be cancelled.`);
            }

            // Get all packages from manifest
            const manifestPackages = await client.query(`
                SELECT 
                    mp.id,
                    mp.package_label,
                    mp.package_metrc_id,
                    mp.batch_id,
                    mp.synclicense
                FROM "ORDERS-manifest-packages" mp
                WHERE mp.fk_invoice_id = $1
                    AND mp.package_status IN ('manifested', 'delivered')
            `, [invoiceId]);

            if (manifestPackages.rows.length === 0) {
                throw new Error('No packages found on manifest');
            }

            // Create cancelled shipment package records
            const packageLabels = [];
            for (const pkg of manifestPackages.rows) {
                await client.query(`
                    INSERT INTO "ORDERS-cancelled-shipment-packages" (
                        fk_invoice_id,
                        package_label,
                        package_metrc_id,
                        batch_id,
                        was_on_manifest,
                        returned_to_inventory,
                        verified_in_metrc,
                        cancellation_reason,
                        incident_type,
                        synclicense
                    ) VALUES ($1, $2, $3, $4, true, false, false, $5, $6, $7)
                    ON CONFLICT (fk_invoice_id, package_label) DO NOTHING
                `, [
                    invoiceId,
                    pkg.package_label,
                    pkg.package_metrc_id,
                    pkg.batch_id,
                    cancellationReason,
                    incidentType,
                    pkg.synclicense
                ]);

                packageLabels.push(pkg.package_label);
            }

            // Update invoice status
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    status = 'Cancelled_After_Ship',
                    packages_returned_count = 0,
                    packages_missing_count = 0,
                    status_updated_at = NOW()
                WHERE id = $1
            `, [invoiceId]);

            // Log cancellation
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    reason,
                    changed_by_user_id,
                    change_details
                ) VALUES ($1, 'cancelled_after_ship', $2, $3, $4)
            `, [
                invoiceId,
                cancellationReason,
                userId,
                JSON.stringify({
                    incident_type: incidentType,
                    package_count: manifestPackages.rows.length,
                    packages: packageLabels
                })
            ]);

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Order cancelled. Awaiting package return confirmation.',
                packages_to_verify: manifestPackages.rows.length,
                invoice_number: inv.invoice_number
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Verify packages returned to inventory
     * POST /api/v1/fulfillment/cancelled-shipments/confirm-return
     */
    async confirmPackagesReturned(invoiceId, userId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get all unverified packages
            const packages = await client.query(`
                SELECT 
                    csp.id,
                    csp.package_label,
                    csp.batch_id,
                    csp.synclicense
                FROM "ORDERS-cancelled-shipment-packages" csp
                WHERE csp.fk_invoice_id = $1
                    AND csp.verified_in_metrc = false
                    AND csp.deleted_at IS NULL
            `, [invoiceId]);

            if (packages.rows.length === 0) {
                throw new Error('No unverified packages found');
            }

            // Verify each package in METRC activepackages
            const verifiedPackages = [];
            const notFoundPackages = [];

            for (const pkg of packages.rows) {
                // Check if package exists in activepackages
                const licenseColumn = await this.getActivePackagesLicenseColumn(client);
                const activePackage = await client.query(`
                    SELECT id, label, isarchived, isfinished
                    FROM activepackages
                    WHERE label = $1
                        AND ${licenseColumn} = $2
                        AND isarchived = false
                        AND isfinished = false
                `, [pkg.package_label, pkg.synclicense]);

                if (activePackage.rows.length > 0) {
                    // Package found - mark as verified
                    await client.query(`
                        UPDATE "ORDERS-cancelled-shipment-packages"
                        SET 
                            verified_in_metrc = true,
                            returned_to_inventory = true,
                            verified_at = NOW(),
                            verified_by = $1
                        WHERE id = $2
                    `, [userId, pkg.id]);

                    verifiedPackages.push(pkg);

                    // Restore inventory
                    await this.restorePackageToInventory(pkg.batch_id, pkg.id, invoiceId, client);
                } else {
                    notFoundPackages.push(pkg);
                }
            }

            // Update invoice counts
            const verifiedCount = verifiedPackages.length;
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET packages_returned_count = packages_returned_count + $1
                WHERE id = $2
            `, [verifiedCount, invoiceId]);

            // Log verification
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    changed_by_user_id,
                    change_details
                ) VALUES ($1, 'packages_returned_confirmed', $2, $3)
            `, [
                invoiceId,
                userId,
                JSON.stringify({
                    verified_count: verifiedCount,
                    verified_packages: verifiedPackages.map(p => p.package_label),
                    not_found_count: notFoundPackages.length,
                    not_found_packages: notFoundPackages.map(p => p.package_label)
                })
            ]);

            // Check if all packages are accounted for and release allocations
            const allPackages = await client.query(`
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN returned_to_inventory = true THEN 1 ELSE 0 END) as returned,
                       SUM(CASE WHEN allocation_released = true THEN 1 ELSE 0 END) as released
                FROM "ORDERS-cancelled-shipment-packages"
                WHERE fk_invoice_id = $1
                    AND deleted_at IS NULL
            `, [invoiceId]);

            const totalPackages = parseInt(allPackages.rows[0].total);
            const returnedPackages = parseInt(allPackages.rows[0].returned);
            const releasedPackages = parseInt(allPackages.rows[0].released);

            // If all packages are accounted for (returned or destroyed), release allocations
            if (totalPackages > 0 && (returnedPackages + releasedPackages) === totalPackages && releasedPackages < totalPackages) {
                await this.releaseAllAllocationsForCancelledShipment(invoiceId, userId, client);
            }

            await client.query('COMMIT');

            return {
                success: true,
                verified_count: verifiedCount,
                not_found_count: notFoundPackages.length,
                all_verified: notFoundPackages.length === 0,
                allocations_released: (returnedPackages + releasedPackages) === totalPackages && releasedPackages < totalPackages,
                message: `${verifiedCount} package(s) verified and returned to inventory. ${notFoundPackages.length > 0 ? `${notFoundPackages.length} package(s) not yet found in METRC.` : 'All packages accounted for.'}`
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Restore package to inventory
     */
    async restorePackageToInventory(batchId, cancelledPackageId, invoiceId, client) {
        // Get package details
        const pkg = await client.query(`
            SELECT package_label, batch_id
            FROM "ORDERS-cancelled-shipment-packages"
            WHERE id = $1
        `, [cancelledPackageId]);

        if (pkg.rows.length === 0) return;

        // Get line item to determine quantity
        const lineItem = await client.query(`
            SELECT li.quantity_ordered, li.assigned_package_labels
            FROM "ORDERS-invoice-line-items" li
            JOIN "ORDERS-manifest-packages" mp ON li.id = mp.line_item_id
            JOIN "ORDERS-cancelled-shipment-packages" csp ON mp.package_label = csp.package_label
            WHERE csp.id = $1
            LIMIT 1
        `, [cancelledPackageId]);

        if (lineItem.rows.length === 0) return;

        const quantity = parseFloat(lineItem.rows[0].quantity_ordered) || 1;

        // Increment batch quantity
        await client.query(`
            UPDATE "ORDERS-batches"
            SET quantity = quantity + $1
            WHERE id = $2
        `, [quantity, batchId]);

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
            ) VALUES ($1, 'package_returned_cancelled_shipment', 'quantity',
                     'Package returned from cancelled shipment', $2, true, $3)
        `, [
            batchId,
            invoiceId,
            JSON.stringify({
                package_label: pkg.rows[0].package_label,
                quantity_restored: quantity
            })
        ]);

        // Broadcast batch update
        const batch = await client.query(`
            SELECT quantity, allocated_quantity
            FROM "ORDERS-batches"
            WHERE id = $1
        `, [batchId]);

        if (batch.rows.length > 0) {
            const b = batch.rows[0];
            websocketService.broadcastBatchInventoryUpdate(
                batchId,
                parseFloat(b.quantity) - parseFloat(b.allocated_quantity),
                parseFloat(b.allocated_quantity)
            );
        }
    }

    /**
     * Report driver incident
     * POST /api/v1/fulfillment/cancelled-shipments/report-incident
     */
    async reportDriverIncident(invoiceId, userId, incidentDetails) {
        return await this.processCancellation(
            invoiceId,
            userId,
            incidentDetails.description || 'Driver incident reported',
            'driver_accident'
        );
    }

    /**
     * Finalize destroyed packages
     * POST /api/v1/admin/cancelled-shipments/:invoiceId/finalize-destroyed
     */
    async finalizeDestroyedPackages(invoiceId, destroyedPackages, adminUserId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get invoice details
            const invoice = await client.query(`
                SELECT 
                    id,
                    invoice_number,
                    status,
                    inventory_finalized
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            if (inv.status !== 'Cancelled_After_Ship') {
                throw new Error(`Cannot finalize destroyed packages - invoice status is ${inv.status}`);
            }

            const inventoryWasFinalized = inv.inventory_finalized;
            const packageLabels = destroyedPackages.map(p => p.package_label);

            // Get cancelled packages
            const cancelledPackages = await client.query(`
                SELECT 
                    id,
                    package_label,
                    batch_id,
                    allocation_released
                FROM "ORDERS-cancelled-shipment-packages"
                WHERE fk_invoice_id = $1
                    AND package_label = ANY($2)
                    AND deleted_at IS NULL
            `, [invoiceId, packageLabels]);

            if (cancelledPackages.rows.length !== destroyedPackages.length) {
                throw new Error('Some packages not found in cancelled shipment records');
            }

            // Group by batch for efficient updates
            const batchUpdates = {};

            for (const pkg of cancelledPackages.rows) {
                const batchId = pkg.batch_id;
                if (!batchUpdates[batchId]) {
                    batchUpdates[batchId] = {
                        quantity: 0,
                        allocated: 0,
                        packages: []
                    };
                }

                // Get quantity from line item
                const lineItem = await client.query(`
                    SELECT li.quantity_ordered
                    FROM "ORDERS-invoice-line-items" li
                    JOIN "ORDERS-manifest-packages" mp ON li.id = mp.line_item_id
                    WHERE mp.package_label = $1
                    LIMIT 1
                `, [pkg.package_label]);

                const quantity = lineItem.rows.length > 0 
                    ? parseFloat(lineItem.rows[0].quantity_ordered) || 1
                    : 1;

                if (!inventoryWasFinalized) {
                    // Inventory not finalized - decrement both quantity and allocated
                    batchUpdates[batchId].quantity += quantity;
                    batchUpdates[batchId].allocated += quantity;
                } else {
                    // Inventory already finalized - only log for audit
                    batchUpdates[batchId].quantity += 0;
                    batchUpdates[batchId].allocated += 0;
                }

                batchUpdates[batchId].packages.push({
                    package: pkg,
                    quantity: quantity,
                    reason: destroyedPackages.find(d => d.package_label === pkg.package_label)?.destruction_reason || 'Destroyed'
                });

                // Mark package as destroyed
                await client.query(`
                    UPDATE "ORDERS-cancelled-shipment-packages"
                    SET 
                        returned_to_inventory = false,
                        verified_in_metrc = false,
                        admin_notes = $1,
                        allocation_released = true,
                        allocation_released_at = NOW(),
                        allocation_released_by = $2
                    WHERE id = $3
                `, [
                    `Destroyed: ${destroyedPackages.find(d => d.package_label === pkg.package_label)?.destruction_reason || 'N/A'}`,
                    adminUserId,
                    pkg.id
                ]);
            }

            // Apply batch updates
            for (const [batchId, updates] of Object.entries(batchUpdates)) {
                if (!inventoryWasFinalized && (updates.quantity > 0 || updates.allocated > 0)) {
                    // Get current batch state to validate before decrementing
                    const batch = await client.query(`
                        SELECT quantity, allocated_quantity
                        FROM "ORDERS-batches"
                        WHERE id = $1
                        FOR UPDATE
                    `, [batchId]);
                    
                    if (batch.rows.length === 0) {
                        console.error(`⚠️ Batch ${batchId} not found when processing cancelled shipment for invoice ${invoiceId}`);
                        continue;
                    }
                    
                    const currentQuantity = parseFloat(batch.rows[0].quantity || 0);
                    const currentAllocated = parseFloat(batch.rows[0].allocated_quantity || 0);
                    const quantityToDeduct = parseFloat(updates.quantity || 0);
                    const allocatedToDeduct = parseFloat(updates.allocated || 0);
                    
                    // Validate: ensure we don't go negative
                    if (currentQuantity < quantityToDeduct || currentAllocated < allocatedToDeduct) {
                        console.error(`❌ CRITICAL: Attempting to deduct quantity=${quantityToDeduct}, allocated=${allocatedToDeduct} from batch ${batchId} which has quantity=${currentQuantity}, allocated=${currentAllocated}. Invoice: ${invoiceId}`);
                        // Use safe values that won't go negative
                        const safeQuantity = Math.min(quantityToDeduct, currentQuantity);
                        const safeAllocated = Math.min(allocatedToDeduct, currentAllocated);
                        
                        await client.query(`
                            UPDATE "ORDERS-batches"
                            SET 
                                quantity = GREATEST(0, quantity - $1),
                                allocated_quantity = GREATEST(0, allocated_quantity - $2)
                            WHERE id = $3
                        `, [safeQuantity, safeAllocated, batchId]);
                        
                        console.error(`⚠️ Applied safe deduction: quantity=${safeQuantity}, allocated=${safeAllocated} for batch ${batchId}`);
                    } else {
                        // Safe to decrement normally
                        await client.query(`
                            UPDATE "ORDERS-batches"
                            SET 
                                quantity = GREATEST(0, quantity - $1),
                                allocated_quantity = GREATEST(0, allocated_quantity - $2)
                            WHERE id = $3
                        `, [quantityToDeduct, allocatedToDeduct, batchId]);
                    }

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
                        ) VALUES ($1, 'package_destroyed', 'quantity',
                                 'Package destroyed - cancelled shipment', $2, false, $3)
                    `, [
                        batchId,
                        invoiceId,
                        JSON.stringify({
                            packages: updates.packages.map(p => ({
                                label: p.package.package_label,
                                quantity: p.quantity,
                                reason: p.reason
                            })),
                            inventory_was_finalized: inventoryWasFinalized
                        })
                    ]);
                    
                    // Section 9.3: Add accounting team notification when packages are destroyed
                    const invoice = await client.query(`
                        SELECT invoice_number
                        FROM "ORDERS-invoices"
                        WHERE id = $1
                    `, [invoiceId]);
                    
                    if (invoice.rows.length > 0) {
                        const notificationStore = require('./notificationStoreService');
                        const accountingUsers = await client.query(`
                            SELECT DISTINCT u.id
                            FROM users u
                            JOIN user_roles ur ON u.id = ur.user_id
                            JOIN roles r ON ur.role_id = r.id
                            WHERE (LOWER(r.name) IN ('accounting', 'administrator', 'accounting_admin')
                               OR LOWER(r.role_name) IN ('accounting', 'administrator', 'accounting_admin'))
                               AND u.status = 'active'
                        `);
                        
                        for (const accountingUser of accountingUsers.rows) {
                            await notificationStore.createNotification({
                                userId: accountingUser.id,
                                type: 'package_destroyed',
                                title: `Packages Destroyed: ${invoice.rows[0].invoice_number}`,
                                message: `${updates.packages.length} package(s) destroyed for invoice ${invoice.rows[0].invoice_number}. Batch ${batchId} quantity reduced by ${updates.quantity}.`,
                                payload: {
                                    invoice_id: invoiceId,
                                    invoice_number: invoice.rows[0].invoice_number,
                                    batch_id: batchId,
                                    packages_destroyed: updates.packages.map(p => ({
                                        label: p.package.package_label,
                                        quantity: p.quantity,
                                        reason: p.reason
                                    })),
                                    quantity_reduced: updates.quantity
                                },
                                priority: 'medium',
                                requiresAck: false
                            });
                        }
                        
                        console.log(`[Cancelled Shipment] ✓ Notified ${accountingUsers.rows.length} accounting user(s) of package destruction for invoice ${invoice.rows[0].invoice_number}`);
                    }
                }

                // Release allocations
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET allocated_quantity = allocated_quantity - $1
                    WHERE id = $2
                `, [updates.allocated, batchId]);

                // Broadcast batch update
                const batch = await client.query(`
                    SELECT quantity, allocated_quantity
                    FROM "ORDERS-batches"
                    WHERE id = $1
                `, [batchId]);

                if (batch.rows.length > 0) {
                    const b = batch.rows[0];
                    websocketService.broadcastBatchInventoryUpdate(
                        batchId,
                        parseFloat(b.quantity) - parseFloat(b.allocated_quantity),
                        parseFloat(b.allocated_quantity)
                    );
                }
            }

            // Update invoice
            const totalDestroyed = destroyedPackages.length;
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET packages_missing_count = packages_missing_count + $1
                WHERE id = $2
            `, [totalDestroyed, invoiceId]);

            // Check if all packages accounted for
            const remaining = await client.query(`
                SELECT COUNT(*) as count
                FROM "ORDERS-cancelled-shipment-packages"
                WHERE fk_invoice_id = $1
                    AND allocation_released = false
                    AND deleted_at IS NULL
            `, [invoiceId]);

            const allAccountedFor = remaining.rows[0].count === 0;

            if (allAccountedFor) {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET status = 'Cancelled'
                    WHERE id = $1
                `, [invoiceId]);
            }

            // Log finalization
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    changed_by_user_id,
                    change_details
                ) VALUES ($1, 'destroyed_packages_finalized', $2, $3)
            `, [
                invoiceId,
                adminUserId,
                JSON.stringify({
                    packages_finalized: totalDestroyed,
                    packages: destroyedPackages,
                    inventory_was_already_finalized: inventoryWasFinalized,
                    all_packages_accounted_for: allAccountedFor
                })
            ]);

            await client.query('COMMIT');

            return {
                success: true,
                packages_finalized: totalDestroyed,
                total_quantity_destroyed: Object.values(batchUpdates).reduce((sum, u) => sum + u.quantity, 0),
                all_packages_accounted_for: allAccountedFor,
                invoice_finalized: allAccountedFor,
                inventory_was_already_finalized: inventoryWasFinalized
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get unaccounted packages
     * GET /api/v1/admin/cancelled-shipments/:invoiceId/unaccounted-packages
     */
    async getUnaccountedPackages(invoiceId) {
        const client = await pool.connect();

        try {
            const invoice = await client.query(`
                SELECT 
                    id,
                    invoice_number,
                    status,
                    packages_returned_count,
                    packages_missing_count
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const packages = await client.query(`
                SELECT 
                    csp.id,
                    csp.package_label,
                    csp.package_metrc_id,
                    csp.batch_id,
                    csp.was_on_manifest,
                    csp.returned_to_inventory,
                    csp.verified_in_metrc,
                    csp.admin_notes,
                    csp.allocation_released,
                    csp.created_at
                FROM "ORDERS-cancelled-shipment-packages" csp
                WHERE csp.fk_invoice_id = $1
                    AND csp.deleted_at IS NULL
                ORDER BY csp.created_at
            `, [invoiceId]);

            const returned = packages.rows.filter(p => p.returned_to_inventory).length;
            const destroyed = packages.rows.filter(p => p.allocation_released && !p.returned_to_inventory).length;
            const unaccounted = packages.rows.filter(p => !p.returned_to_inventory && !p.allocation_released).length;

            return {
                invoice_id: invoiceId,
                invoice_number: invoice.rows[0].invoice_number,
                status: invoice.rows[0].status,
                total: packages.rows.length,
                returned: returned,
                destroyed: destroyed,
                unaccounted: unaccounted,
                packages: packages.rows.map(p => ({
                    package_label: p.package_label,
                    batch_id: p.batch_id,
                    was_on_manifest: p.was_on_manifest,
                    returned_to_inventory: p.returned_to_inventory,
                    verified_in_metrc: p.verified_in_metrc,
                    admin_notes: p.admin_notes,
                    allocation_released: p.allocation_released
                }))
            };

        } finally {
            client.release();
        }
    }

    /**
     * Release all allocations for cancelled shipment
     * Only called when ALL packages are accounted for (returned or destroyed)
     */
    async releaseAllAllocationsForCancelledShipment(invoiceId, userId, client) {
        // Get all packages that haven't had allocations released
        const packages = await client.query(`
            SELECT 
                id,
                package_label,
                batch_id,
                allocation_released
            FROM "ORDERS-cancelled-shipment-packages"
            WHERE fk_invoice_id = $1
                AND allocation_released = false
                AND deleted_at IS NULL
        `, [invoiceId]);

        // Group by batch for efficient updates
        const batchUpdates = {};

        for (const pkg of packages.rows) {
            const batchId = pkg.batch_id;
            if (!batchUpdates[batchId]) {
                batchUpdates[batchId] = {
                    allocated: 0,
                    packages: []
                };
            }

            // Get quantity from line item
            const lineItem = await client.query(`
                SELECT li.quantity_allocated
                FROM "ORDERS-invoice-line-items" li
                JOIN "ORDERS-manifest-packages" mp ON li.id = mp.line_item_id
                WHERE mp.package_label = $1
                LIMIT 1
            `, [pkg.package_label]);

            const quantity = lineItem.rows.length > 0 
                ? parseFloat(lineItem.rows[0].quantity_allocated) || 1
                : 1;

            batchUpdates[batchId].allocated += quantity;
            batchUpdates[batchId].packages.push(pkg);

            // Mark package allocation as released
            await client.query(`
                UPDATE "ORDERS-cancelled-shipment-packages"
                SET 
                    allocation_released = true,
                    allocation_released_at = NOW(),
                    allocation_released_by = $1
                WHERE id = $2
            `, [userId, pkg.id]);
        }

        // Apply batch updates
        for (const [batchId, updates] of Object.entries(batchUpdates)) {
            // Get current allocated_quantity to prevent negative values
            const batchCheck = await client.query(`
                SELECT allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
                FOR UPDATE
            `, [batchId]);
            
            if (batchCheck.rows.length > 0) {
                const currentAllocated = parseInt(batchCheck.rows[0].allocated_quantity || 0);
                const actualReleaseQty = Math.min(updates.allocated, currentAllocated);
                
                if (actualReleaseQty > 0) {
                    // Decrement allocated_quantity (with safeguard to prevent negative)
                    await client.query(`
                        UPDATE "ORDERS-batches"
                        SET allocated_quantity = GREATEST(0, allocated_quantity - $1)
                        WHERE id = $2
                    `, [actualReleaseQty, batchId]);

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
                            changed_by_system,
                            change_details
                        ) VALUES ($1, 'allocation_released_cancelled_shipment', 'allocated_quantity',
                                 $2, $3, 'Allocations released - cancelled shipment packages accounted for', $4, false, $5)
                    `, [
                        batchId,
                        currentAllocated.toString(),
                        Math.max(0, currentAllocated - actualReleaseQty).toString(),
                        invoiceId,
                        JSON.stringify({
                            packages: updates.packages.map(p => p.package_label),
                            quantity_released: actualReleaseQty
                        })
                    ]);
                } else {
                    console.warn(`⚠️  Cannot release allocation for batch ${batchId}: current allocated is ${currentAllocated}, trying to release ${updates.allocated}`);
                }
            }

            // Broadcast batch update
            const batch = await client.query(`
                SELECT quantity, allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [batchId]);

            if (batch.rows.length > 0) {
                const b = batch.rows[0];
                websocketService.broadcastBatchInventoryUpdate(
                    batchId,
                    parseFloat(b.quantity) - parseFloat(b.allocated_quantity),
                    parseFloat(b.allocated_quantity)
                );
            }
        }

        // Check if invoice can be finalized
        const remaining = await client.query(`
            SELECT COUNT(*) as count
            FROM "ORDERS-cancelled-shipment-packages"
            WHERE fk_invoice_id = $1
                AND allocation_released = false
                AND deleted_at IS NULL
        `, [invoiceId]);

        if (remaining.rows[0].count === 0) {
            // All packages accounted for and allocations released
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET status = 'Cancelled'
                WHERE id = $1
            `, [invoiceId]);
        }

        console.log(`[Cancelled Shipment] Released allocations for ${packages.rows.length} packages`);
    }

    /**
     * Get unverified packages for admin dashboard
     * GET /api/v1/admin/cancelled-shipments/unverified-packages
     */
    async getUnverifiedPackages(filters) {
        const client = await pool.connect();

        try {
            let query = `
                SELECT 
                    csp.id,
                    csp.package_label,
                    csp.batch_id,
                    csp.incident_type,
                    csp.returned_to_inventory,
                    csp.allocation_released,
                    csp.created_at,
                    i.invoice_number
                FROM "ORDERS-cancelled-shipment-packages" csp
                JOIN "ORDERS-invoices" i ON csp.fk_invoice_id = i.id
                WHERE csp.deleted_at IS NULL
            `;

            const params = [];
            let paramCount = 1;

            if (filters.invoice) {
                query += ` AND i.invoice_number ILIKE $${paramCount}`;
                params.push(`%${filters.invoice}%`);
                paramCount++;
            }

            if (filters.incident_type) {
                query += ` AND csp.incident_type = $${paramCount}`;
                params.push(filters.incident_type);
                paramCount++;
            }

            if (filters.status === 'unverified') {
                query += ` AND csp.returned_to_inventory = false AND csp.allocation_released = false`;
            } else if (filters.status === 'verified') {
                query += ` AND csp.returned_to_inventory = true`;
            } else if (filters.status === 'missing') {
                query += ` AND csp.allocation_released = true AND csp.returned_to_inventory = false`;
            }

            if (filters.days) {
                query += ` AND csp.created_at >= NOW() - INTERVAL '${filters.days} days'`;
            }

            query += ` ORDER BY csp.created_at DESC`;

            // Get total count
            const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM');
            const countResult = await client.query(countQuery, params);
            const total = parseInt(countResult.rows[0].total);

            // Add pagination
            const offset = (filters.page - 1) * filters.limit;
            query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
            params.push(filters.limit, offset);

            const result = await client.query(query, params);

            return {
                packages: result.rows,
                pagination: {
                    page: filters.page,
                    limit: filters.limit,
                    total: total,
                    totalPages: Math.ceil(total / filters.limit)
                }
            };

        } finally {
            client.release();
        }
    }

    /**
     * Verify a single package
     */
    async verifyPackage(packageId, userId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get package details
            const pkg = await client.query(`
                SELECT 
                    id,
                    package_label,
                    batch_id,
                    fk_invoice_id,
                    synclicense
                FROM "ORDERS-cancelled-shipment-packages"
                WHERE id = $1
            `, [packageId]);

            if (pkg.rows.length === 0) {
                throw new Error('Package not found');
            }

            const packageData = pkg.rows[0];

            // Check if package exists in activepackages
            const licenseColumn = await this.getActivePackagesLicenseColumn(client);
            const activePackage = await client.query(`
                SELECT id, label
                FROM activepackages
                WHERE label = $1
                    AND ${licenseColumn} = $2
                    AND isarchived = false
                    AND isfinished = false
            `, [packageData.package_label, packageData.synclicense]);

            if (activePackage.rows.length === 0) {
                throw new Error('Package not found in METRC activepackages - cannot verify');
            }

            // Mark as verified and restore inventory
            await client.query(`
                UPDATE "ORDERS-cancelled-shipment-packages"
                SET 
                    verified_in_metrc = true,
                    returned_to_inventory = true,
                    verified_at = NOW(),
                    verified_by = $1
                WHERE id = $2
            `, [userId, packageId]);

            // Restore inventory
            await this.restorePackageToInventory(packageData.batch_id, packageId, packageData.fk_invoice_id, client);

            // Update invoice count
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET packages_returned_count = packages_returned_count + 1
                WHERE id = $1
            `, [packageData.fk_invoice_id]);

            await client.query('COMMIT');

            return { success: true, message: 'Package verified and returned to inventory' };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Mark a package as missing
     */
    async markPackageMissing(packageId, userId, reason) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get package details
            const pkg = await client.query(`
                SELECT 
                    id,
                    fk_invoice_id,
                    package_label
                FROM "ORDERS-cancelled-shipment-packages"
                WHERE id = $1
            `, [packageId]);

            if (pkg.rows.length === 0) {
                throw new Error('Package not found');
            }

            // Mark as missing (will be finalized later)
            await client.query(`
                UPDATE "ORDERS-cancelled-shipment-packages"
                SET 
                    returned_to_inventory = false,
                    verified_in_metrc = false,
                    admin_notes = $1
                WHERE id = $2
            `, [reason, packageId]);

            // Update invoice count
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET packages_missing_count = packages_missing_count + 1
                WHERE id = $1
            `, [pkg.rows[0].fk_invoice_id]);

            await client.query('COMMIT');

            return { success: true, message: 'Package marked as missing' };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Bulk verify packages
     */
    async bulkVerifyPackages(packageIds, userId) {
        const client = await pool.connect();
        let verifiedCount = 0;

        try {
            await client.query('BEGIN');

            for (const packageId of packageIds) {
                try {
                    await this.verifyPackage(packageId, userId);
                    verifiedCount++;
                } catch (error) {
                    console.error(`Error verifying package ${packageId}:`, error.message);
                    // Continue with other packages
                }
            }

            await client.query('COMMIT');

            return { success: true, verified_count: verifiedCount };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Bulk mark packages as missing
     */
    async bulkMarkPackagesMissing(packageIds, userId, reason) {
        const client = await pool.connect();
        let markedCount = 0;

        try {
            await client.query('BEGIN');

            // Module 21.5: Enforce batch size limit
            if (packageIds.length > 100) {
                throw new Error('Cannot process more than 100 packages at once');
            }

            // Module 21.5: Validate all packages before processing
            const packages = await client.query(`
                SELECT id, package_label, fk_invoice_id
                FROM "ORDERS-cancelled-shipment-packages"
                WHERE id = ANY($1)
            `, [packageIds]);

            if (packages.rows.length !== packageIds.length) {
                throw new Error('Some packages not found');
            }

            // Process all packages
            for (const packageId of packageIds) {
                try {
                    await this.markPackageMissing(packageId, userId, reason);
                    markedCount++;
                } catch (error) {
                    console.error(`Error marking package ${packageId} as missing:`, error.message);
                    // Module 21.5: If ANY fails validation, rollback all
                    await client.query('ROLLBACK');
                    throw new Error(`Package marking failed: ${error.message}`);
                }
            }

            // Module 21.5: Log bulk operation
            await client.query(`
                INSERT INTO "ORDERS-audit_log" (
                    user_id,
                    action,
                    resource_type,
                    resource_id,
                    details,
                    status
                ) VALUES ($1, 'bulk_mark_missing', 'CancelledShipment', NULL, $2, 'success')
            `, [userId, JSON.stringify({
                bulk_operation: true,
                operation_type: 'bulk_mark_missing',
                record_count: markedCount,
                affected_package_ids: packageIds,
                reason: reason
            })]);

            await client.query('COMMIT');

            return { success: true, marked_count: markedCount };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Module 21.1: Bulk mark packages as destroyed
     * Requires destruction reason and detailed description
     */
    async bulkMarkPackagesDestroyed(packageIds, userId, destructionReason, detailedDescription) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Module 21.5: Enforce batch size limit
            if (packageIds.length > 100) {
                throw new Error('Cannot process more than 100 packages at once. Please select fewer packages.');
            }

            // Get all package details
            const packages = await client.query(`
                SELECT 
                    csp.id,
                    csp.package_label,
                    csp.fk_invoice_id,
                    csp.batch_id,
                    i.invoice_number,
                    b.quantity as batch_quantity,
                    b.allocated_quantity as batch_allocated,
                    p.wholesale_price
                FROM "ORDERS-cancelled-shipment-packages" csp
                JOIN "ORDERS-invoices" i ON csp.fk_invoice_id = i.id
                LEFT JOIN "ORDERS-batches" b ON csp.batch_id = b.batch_id
                LEFT JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
                WHERE csp.id = ANY($1)
            `, [packageIds]);

            if (packages.rows.length !== packageIds.length) {
                throw new Error('Some packages not found');
            }

            let destroyedCount = 0;
            let totalValueLost = 0;
            const batchUpdates = new Map(); // batch_id -> { count, value }

            // Process each package
            for (const pkg of packages.rows) {
                // Mark as destroyed
                await client.query(`
                    UPDATE "ORDERS-cancelled-shipment-packages"
                    SET 
                        verified_in_metrc = true,
                        returned_to_inventory = false,
                        verified_at = NOW(),
                        verified_by = $1,
                        admin_notes = $2
                    WHERE id = $3
                `, [userId, `Destroyed: ${destructionReason}. ${detailedDescription}`, pkg.id]);

                // Decrease batch quantity if batch exists
                if (pkg.batch_id) {
                    const current = batchUpdates.get(pkg.batch_id) || { count: 0, value: 0 };
                    current.count += 1;
                    current.value += parseFloat(pkg.wholesale_price || 0);
                    batchUpdates.set(pkg.batch_id, current);

                    await client.query(`
                        UPDATE "ORDERS-batches"
                        SET quantity = GREATEST(0, quantity - 1)
                        WHERE batch_id = $1
                    `, [pkg.batch_id]);

                    // Log batch history
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
                        ) VALUES ($1, 'quantity_decreased', 'quantity', $2, $3, $4, $5, false)
                    `, [
                        pkg.batch_id,
                        pkg.batch_quantity,
                        pkg.batch_quantity - 1,
                        `Package ${pkg.package_label} destroyed: ${destructionReason}`,
                        pkg.fk_invoice_id
                    ]);
                }

                destroyedCount++;
                totalValueLost += parseFloat(pkg.wholesale_price || 0);
            }

            // Log bulk operation to audit log
            await client.query(`
                INSERT INTO "ORDERS-audit_log" (
                    user_id,
                    action,
                    resource_type,
                    resource_id,
                    details,
                    status
                ) VALUES ($1, 'bulk_destroy_packages', 'CancelledShipment', NULL, $2, 'success')
            `, [userId, JSON.stringify({
                bulk_operation: true,
                operation_type: 'bulk_destroy_packages',
                record_count: destroyedCount,
                affected_package_ids: packageIds,
                destruction_reason: destructionReason,
                total_value_lost: totalValueLost,
                batches_affected: Array.from(batchUpdates.entries()).map(([batchId, data]) => ({
                    batch_id: batchId,
                    packages_destroyed: data.count,
                    value_lost: data.value
                }))
            })]);

            await client.query('COMMIT');

            // Module 21.1: Notify accounting team (placeholder - implement email service)
            console.log(`[Bulk Destroy] Accounting notification: ${destroyedCount} packages destroyed, $${totalValueLost.toFixed(2)} value lost`);

            return {
                success: true,
                destroyed_count: destroyedCount,
                total_value_lost: totalValueLost,
                batches_affected: batchUpdates.size
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Module 21.1: Bulk export packages to CSV
     */
    async bulkExportPackages(packageIds) {
        const client = await pool.connect();

        try {
            const packages = await client.query(`
                SELECT 
                    csp.package_label,
                    i.invoice_number,
                    b.batch_name,
                    CASE 
                        WHEN csp.verified_in_metrc THEN 'Verified'
                        WHEN csp.returned_to_inventory THEN 'Returned'
                        ELSE 'Unverified'
                    END as verification_status,
                    CASE WHEN csp.returned_to_inventory THEN 'Y' ELSE 'N' END as returned_to_inventory,
                    csp.verified_at::text as verified_date,
                    csp.admin_notes
                FROM "ORDERS-cancelled-shipment-packages" csp
                JOIN "ORDERS-invoices" i ON csp.fk_invoice_id = i.id
                LEFT JOIN "ORDERS-batches" b ON csp.batch_id = b.batch_id
                WHERE csp.id = ANY($1)
                ORDER BY csp.package_label
            `, [packageIds]);

            // Generate CSV
            const csvRows = [];
            csvRows.push('Package Label,Invoice Number,Batch Name,Verification Status,Returned to Inventory,Verified Date,Admin Notes');

            packages.rows.forEach(row => {
                csvRows.push([
                    row.package_label,
                    row.invoice_number || 'N/A',
                    row.batch_name || 'N/A',
                    row.verification_status,
                    row.returned_to_inventory,
                    row.verified_date || 'N/A',
                    (row.admin_notes || '').replace(/"/g, '""')
                ].map(v => `"${String(v)}"`).join(','));
            });

            return csvRows.join('\n');

        } catch (error) {
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get active packages license column name
     */
    async getActivePackagesLicenseColumn(client) {
        const checkColumn = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'activepackages' 
            AND column_name IN ('sync_license', 'synclicense')
            LIMIT 1
        `);
        
        return checkColumn.rows.length > 0 ? checkColumn.rows[0].column_name : 'synclicense';
    }
}

module.exports = new CancelledShipmentService();

