// Server/Services/manifestVoidingService.js
// Module 5: Manifest Voiding & Updates

const { query, pool } = require('../config/database');
const websocketService = require('./websocketService');
const metrcAuth = require('./metrcAuth');

// METRC API Configuration
const METRC_API_TIMEOUT = 30000;

class ManifestVoidingService {
    /**
     * Void a manifest that was created but not yet shipped
     * Supports multi-license manifests
     */
    async voidManifest(invoiceId, userId, reason, targetManifestOrLicense = null) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get invoice and manifest details
            const invoice = await client.query(`
                SELECT 
                    status,
                    metrc_manifest_numbers,
                    manifest_metrc_ids,
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

            // Verify status allows voiding
            if (!['Manifested', 'Shipped', 'Partially_Manifested'].includes(inv.status)) {
                throw new Error(`Cannot void manifest - invoice status is ${inv.status}`);
            }

            const manifestNumbers = Array.isArray(inv.metrc_manifest_numbers) 
                ? inv.metrc_manifest_numbers 
                : (inv.metrc_manifest_numbers ? JSON.parse(inv.metrc_manifest_numbers) : []);
            const manifestIds = Array.isArray(inv.manifest_metrc_ids)
                ? inv.manifest_metrc_ids
                : (inv.manifest_metrc_ids ? JSON.parse(inv.manifest_metrc_ids) : []);

            if (manifestNumbers.length === 0) {
                throw new Error('No manifests to void');
            }

            if (!reason || reason.trim().length < 20) {
                throw new Error('Void reason is required (minimum 20 characters)');
            }

            console.log(`[Void] Voiding manifest(s) for invoice ${inv.invoice_number}`);

            // Determine which manifests to void
            let manifestsToVoid = [];
            if (targetManifestOrLicense === null || targetManifestOrLicense === 'all') {
                // Void all manifests
                manifestsToVoid = manifestIds;
            } else {
                // Void specific manifest by number or license
                manifestsToVoid = manifestIds.filter(m => 
                    m.number === targetManifestOrLicense || m.license === targetManifestOrLicense
                );
                if (manifestsToVoid.length === 0) {
                    throw new Error(`Manifest not found: ${targetManifestOrLicense}`);
                }
            }

            const voidedManifests = [];
            const failedManifests = [];

            // Process each manifest to void
            for (const manifest of manifestsToVoid) {
                try {
                    if (!manifest.id) {
                        throw new Error(`Manifest METRC ID not found for ${manifest.number}`);
                    }

                    console.log(`[Void] Processing manifest ${manifest.number} (ID: ${manifest.id})`);

                    // PHASE 1: DRY RUN
                    console.log(`[Void] Dry run for manifest ${manifest.number}...`);
                    const dryRunResult = await this.voidManifestDryRun(manifest.id, manifest.license);
                    
                    if (!dryRunResult.success) {
                        throw new Error(`Dry run failed: ${dryRunResult.error}`);
                    }

                    console.log(`[Void] ✓ Dry run passed for ${manifest.number}`);

                    // PHASE 2: ACTUAL VOID
                    console.log(`[Void] Submitting void to METRC for ${manifest.number}...`);
                    const voidResult = await this.voidManifestInMetrc(manifest.id, manifest.license);
                    
                    if (!voidResult.success) {
                        throw new Error(`Void failed: ${voidResult.error}`);
                    }

                    console.log(`[Void] ✓ Manifest ${manifest.number} voided in METRC`);
                    voidedManifests.push(manifest);

                } catch (manifestError) {
                    console.error(`[Void] ❌ Failed to void manifest ${manifest.number}:`, manifestError.message);
                    failedManifests.push({
                        manifest: manifest,
                        error: manifestError.message
                    });
                }
            }

            if (voidedManifests.length === 0) {
                throw new Error('All manifest void attempts failed');
            }

            // Update invoice - remove voided manifests
            const remainingManifests = manifestIds.filter(m => 
                !voidedManifests.some(v => v.id === m.id)
            );
            const remainingNumbers = remainingManifests.map(m => m.number);
            const voidedNumbers = voidedManifests.map(m => m.number);

            let newStatus = inv.status;
            if (remainingManifests.length === 0) {
                // All manifests voided
                newStatus = 'Fulfillment_Issue';
            } else if (voidedManifests.length > 0 && remainingManifests.length > 0) {
                // Partial void
                newStatus = 'Partially_Voided';
            }

            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    status = $1,
                    metrc_manifest_numbers = $2::jsonb,
                    manifest_metrc_ids = $3::jsonb,
                    voided_manifest_number = CASE 
                        WHEN voided_manifest_number IS NULL THEN $4
                        ELSE voided_manifest_number || ', ' || $4
                    END,
                    voided_manifest_reason = $5,
                    voided_at = NOW(),
                    voided_by = $6,
                    fulfillment_issue_reported_at = CASE 
                        WHEN $7 = true THEN NOW()
                        ELSE fulfillment_issue_reported_at
                    END,
                    fulfillment_issue_note = CASE 
                        WHEN $7 = true THEN $8
                        ELSE fulfillment_issue_note
                    END,
                    status_updated_at = NOW()
                WHERE id = $9
            `, [
                newStatus,
                JSON.stringify(remainingNumbers),
                JSON.stringify(remainingManifests),
                voidedNumbers.join(', '),
                reason,
                userId,
                remainingManifests.length === 0, // All voided
                remainingManifests.length === 0 ? `All manifests voided: ${reason}` : `Partial void: ${voidedNumbers.join(', ')} - ${reason}`,
                invoiceId
            ]);

            // If all manifests voided, clear assigned packages and release allocations
            if (remainingManifests.length === 0) {
                // Clear assigned packages (allow re-scanning)
                await client.query(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET 
                        assigned_package_labels = NULL,
                        quantity_fulfilled = 0
                    WHERE fk_invoice_id = $1
                `, [invoiceId]);

                // Release allocations
                await this.releaseAllocationsForInvoice(invoiceId, client);
            }

            // Update manifest packages table - mark voided packages
            for (const voidedManifest of voidedManifests) {
                await client.query(`
                    UPDATE "ORDERS-manifest-packages"
                    SET 
                        package_status = 'voided',
                        voided_at = NOW(),
                        voided_by = $1
                    WHERE fk_invoice_id = $2 
                        AND manifest_number = $3
                `, [userId, invoiceId, voidedManifest.number]);
            }

            // Log void
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    old_value,
                    new_value,
                    reason,
                    changed_by_user_id,
                    triggered_by_fulfillment_issue,
                    change_details
                ) VALUES ($1, 'manifest_voided', 'metrc_manifest_numbers', 
                          $2, $3, $4, $5, $6, $7)
            `, [
                invoiceId,
                JSON.stringify(manifestNumbers),
                JSON.stringify(remainingNumbers),
                reason,
                userId,
                remainingManifests.length === 0,
                JSON.stringify({
                    voided_manifests: voidedManifests,
                    failed_manifests: failedManifests,
                    remaining_manifests: remainingManifests,
                    all_voided: remainingManifests.length === 0
                })
            ]);

            await client.query('COMMIT');

            // Alert admin if partial void
            if (failedManifests.length > 0 || (voidedManifests.length > 0 && remainingManifests.length > 0)) {
                console.warn(`[Void] ⚠️ PARTIAL VOID: ${voidedManifests.length} voided, ${remainingManifests.length} remaining, ${failedManifests.length} failed`);
            }

            return {
                success: true,
                voided_count: voidedManifests.length,
                voided_manifests: voidedNumbers,
                remaining_manifests: remainingNumbers,
                failed_manifests: failedManifests.map(f => f.manifest.number),
                all_voided: remainingManifests.length === 0,
                message: remainingManifests.length === 0
                    ? `All ${voidedManifests.length} manifest(s) voided. Order returned to Fulfillment Issue state.`
                    : `Partial void: ${voidedManifests.length} manifest(s) voided, ${remainingManifests.length} remaining.`
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Release all allocations for an invoice
     * Called when manifest is voided
     */
    async releaseAllocationsForInvoice(invoiceId, client) {
        // Get all line items
        const lineItems = await client.query(`
            SELECT 
                li.id,
                li.fk_batch_id,
                li.quantity_allocated
            FROM "ORDERS-invoice-line-items" li
            WHERE li.fk_invoice_id = $1
                AND li.quantity_allocated > 0
        `, [invoiceId]);

        // Release allocations for each line item
        for (const li of lineItems.rows) {
            // Decrement batch allocated_quantity
            await client.query(`
                UPDATE "ORDERS-batches"
                SET allocated_quantity = allocated_quantity - $1
                WHERE id = $2
            `, [li.quantity_allocated, li.fk_batch_id]);

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
                ) VALUES ($1, 'allocation_released', 'allocated_quantity',
                         'Manifest voided - Invoice returned to sales', $2, true, $3)
            `, [
                li.fk_batch_id,
                invoiceId,
                JSON.stringify({
                    quantity_released: li.quantity_allocated,
                    reason: 'Manifest voided'
                })
            ]);

            // Reset line item allocation
            await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET quantity_allocated = 0
                WHERE id = $1
            `, [li.id]);

            // Broadcast batch update
            const batch = await client.query(`
                SELECT quantity, allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [li.fk_batch_id]);

            if (batch.rows.length > 0) {
                const b = batch.rows[0];
                websocketService.broadcastBatchInventoryUpdate(
                    li.fk_batch_id,
                    b.quantity - b.allocated_quantity,
                    b.allocated_quantity
                );
            }
        }
    }

    /**
     * Update manifest transportation details
     * Can only update: driver, vehicle, estimated times
     */
    async updateManifest(invoiceId, userId, updates) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get current manifest
            const invoice = await client.query(`
                SELECT 
                    status,
                    manifest_metrc_ids,
                    transportation_details,
                    fulfillment_accepted_by
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            if (inv.status !== 'Manifested') {
                throw new Error(`Cannot update manifest - invoice status is ${inv.status}`);
            }

            if (!inv.manifest_metrc_ids || inv.manifest_metrc_ids.length === 0) {
                throw new Error('No manifest to update');
            }

            // Verify permission
            if (inv.fulfillment_accepted_by !== userId) {
                // TODO: Check admin permissions
                console.warn('User updating manifest they did not create');
            }

            // Merge updates with current transportation details
            const currentDetails = typeof inv.transportation_details === 'string'
                ? JSON.parse(inv.transportation_details)
                : inv.transportation_details;

            const updatedDetails = {
                ...currentDetails,
                ...updates,
                updatedAt: new Date().toISOString(),
                updatedBy: userId
            };

            // PHASE 1: DRY RUN - Validate update with METRC
            const firstManifest = inv.manifest_metrc_ids[0];
            if (!firstManifest || !firstManifest.id) {
                throw new Error('No manifest METRC ID found');
            }

            console.log(`[Manifest Update] Dry run for manifest ${firstManifest.number}...`);
            const dryRunResult = await this.updateManifestDryRun(firstManifest.id, firstManifest.license, updates);
            
            if (!dryRunResult.success) {
                throw new Error(`Dry run failed: ${dryRunResult.error}`);
            }

            console.log(`[Manifest Update] ✓ Dry run passed`);

            // PHASE 2: ACTUAL UPDATE
            console.log(`[Manifest Update] Submitting update to METRC...`);
            const updateResult = await this.updateManifestInMetrc(firstManifest.id, firstManifest.license, updates);
            
            if (!updateResult.success) {
                throw new Error(`Update failed: ${updateResult.error}`);
            }

            console.log(`[Manifest Update] ✓ Manifest updated in METRC`);

            // Update transportation details in our DB
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET transportation_details = $1, updated_at = NOW()
                WHERE id = $2
            `, [JSON.stringify(updatedDetails), invoiceId]);

            // Log update
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    change_details,
                    changed_by_user_id
                ) VALUES ($1, 'manifest_updated', $2, $3)
            `, [invoiceId, JSON.stringify(updates), userId]);

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Manifest updated successfully'
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Dry run void manifest in METRC (validation only)
     */
    async voidManifestDryRun(manifestMetrcId, license) {
        try {
            // METRC T3 API doesn't have a separate dry run endpoint for voiding
            // We'll check the transfer status first to validate it can be voided
            const response = await metrcAuth.makeAuthenticatedRequest({
                method: 'GET',
                url: `${metrcAuth.apiBaseUrl}/transfers/v2/external/incoming/${manifestMetrcId}`,
                params: {
                    licenseNumber: license
                },
                timeout: 15000
            });

            const transfer = response.data;
            
            // Check if transfer can be voided
            if (transfer.status === 'Delivered') {
                return { success: false, error: 'Cannot void manifest - already delivered' };
            }
            if (transfer.status === 'Voided') {
                return { success: false, error: 'Cannot void manifest - already voided' };
            }
            if (transfer.status === 'InTransit') {
                // May or may not be voidable depending on METRC rules
                return { success: true, warning: 'Manifest is in transit - void may not be allowed by METRC' };
            }

            return { success: true };
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return { success: false, error: 'Manifest not found in METRC' };
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * Actually void manifest in METRC
     */
    async voidManifestInMetrc(manifestMetrcId, license) {
        try {
            // METRC T3 API void endpoint
            // Note: Actual endpoint may vary - check METRC API documentation
            const response = await metrcAuth.makeAuthenticatedRequest({
                method: 'DELETE',
                url: `${metrcAuth.apiBaseUrl}/transfers/v2/external/incoming/${manifestMetrcId}`,
                params: {
                    licenseNumber: license
                },
                timeout: METRC_API_TIMEOUT
            });

            return { success: true, data: response.data };
        } catch (error) {
            if (error.response) {
                const status = error.response.status;
                const data = error.response.data;
                
                if (status === 400) {
                    return { success: false, error: `METRC validation error: ${data.message || JSON.stringify(data)}` };
                }
                if (status === 404) {
                    return { success: false, error: 'Manifest not found in METRC' };
                }
                if (status === 409) {
                    return { success: false, error: 'Cannot void manifest - may already be in transit or delivered' };
                }
                
                return { success: false, error: `METRC API error (${status}): ${data.message || JSON.stringify(data)}` };
            }
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Dry run manifest update in METRC (validation only)
     */
    async updateManifestDryRun(manifestMetrcId, license, updates) {
        try {
            // Build update payload
            const payload = this.buildManifestUpdatePayload(updates);
            
            // METRC T3 API doesn't have a separate dry run endpoint for updates
            // We'll validate the payload structure and check current status
            const response = await metrcAuth.makeAuthenticatedRequest({
                method: 'GET',
                url: `${metrcAuth.apiBaseUrl}/transfers/v2/external/incoming/${manifestMetrcId}`,
                params: {
                    licenseNumber: license
                },
                timeout: 15000
            });

            const transfer = response.data;
            
            // Check if transfer can be updated
            if (transfer.status === 'Delivered') {
                return { success: false, error: 'Cannot update manifest - already delivered' };
            }
            if (transfer.status === 'Voided') {
                return { success: false, error: 'Cannot update manifest - already voided' };
            }

            // Validate payload structure
            const allowedFields = ['driverName', 'driverLicense', 'vehicleMake', 'vehicleModel', 
                                 'vehiclePlate', 'estimatedDeparture', 'estimatedArrival'];
            const updateFields = Object.keys(updates);
            const disallowedFields = updateFields.filter(f => !allowedFields.includes(f));
            
            if (disallowedFields.length > 0) {
                return { success: false, error: `Cannot update fields: ${disallowedFields.join(', ')}` };
            }

            return { success: true };
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return { success: false, error: 'Manifest not found in METRC' };
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * Actually update manifest in METRC
     */
    async updateManifestInMetrc(manifestMetrcId, license, updates) {
        try {
            const payload = this.buildManifestUpdatePayload(updates);
            
            const response = await metrcAuth.makeAuthenticatedRequest({
                method: 'PUT',
                url: `${metrcAuth.apiBaseUrl}/transfers/v2/external/incoming/${manifestMetrcId}`,
                params: {
                    licenseNumber: license
                },
                data: payload,
                timeout: METRC_API_TIMEOUT
            });

            return { success: true, data: response.data };
        } catch (error) {
            if (error.response) {
                const status = error.response.status;
                const data = error.response.data;
                
                if (status === 400) {
                    return { success: false, error: `METRC validation error: ${data.message || JSON.stringify(data)}` };
                }
                if (status === 404) {
                    return { success: false, error: 'Manifest not found in METRC' };
                }
                if (status === 409) {
                    return { success: false, error: 'Cannot update manifest - may already be delivered' };
                }
                
                return { success: false, error: `METRC API error (${status}): ${data.message || JSON.stringify(data)}` };
            }
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Build manifest update payload for METRC API
     */
    buildManifestUpdatePayload(updates) {
        const payload = {};
        
        if (updates.driverName) payload.driverName = updates.driverName;
        if (updates.driverLicense) payload.driverLicense = updates.driverLicense;
        if (updates.vehicleMake) payload.vehicleMake = updates.vehicleMake;
        if (updates.vehicleModel) payload.vehicleModel = updates.vehicleModel;
        if (updates.vehiclePlate) payload.vehiclePlate = updates.vehiclePlate;
        if (updates.estimatedDeparture) payload.estimatedDeparture = updates.estimatedDeparture;
        if (updates.estimatedArrival) payload.estimatedArrival = updates.estimatedArrival;
        
        return payload;
    }
}

module.exports = new ManifestVoidingService();

