// Server/Services/manifestVoidingService.js
// Module 5: Manifest Voiding & Updates

const { query, pool } = require('../config/database');
const websocketService = require('./websocketService');
const metrcAuth = require('./metrcAuth');
const path = require('path');

// METRC API Configuration
const METRC_API_TIMEOUT = 60000; // 60 seconds - increased to match manifest creation timeout

// Load environment variables for METRC submit control
// Check if submit should be true (production) or false (testing/dry run)
const getMetrcSubmitValue = () => {
    // Load environment file based on NODE_ENV
    if (process.env.NODE_ENV === 'production') {
        require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
    } else {
        require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
    }
    
    // METRC_SUBMIT_TRANSFERS controls whether to actually submit (true) or dry run (false)
    // Default to true for production, false for development
    const submitValue = process.env.METRC_SUBMIT_TRANSFERS;
    if (submitValue === 'false' || submitValue === '0') {
        return false;
    }
    // Default to true if not explicitly set to false
    return true;
};

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
            
            // CRITICAL: Check if manifest is still in activeoutgoingtransfers (not shipped)
            // Only allow voiding if manifest is still active (hasn't shipped yet)
            const manifestStatusService = require('./manifestStatusService');

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

                    // CRITICAL: Check if manifest is still active (in activeoutgoingtransfers)
                    // Only allow voiding if manifest hasn't shipped yet
                    // If status check fails/times out, proceed anyway and let METRC API handle validation
                    const manifestStatusService = require('./manifestStatusService');
                    let statusCheck = null;
                    try {
                        // Set a timeout for status check to avoid blocking
                        const statusCheckPromise = manifestStatusService.checkManifestStatus(manifest.number, manifest.license);
                        const timeoutPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Status check timeout')), 10000) // 10 second timeout
                        );
                        statusCheck = await Promise.race([statusCheckPromise, timeoutPromise]);
                    } catch (statusError) {
                        console.warn(`[Void] ⚠️ Status check failed or timed out for ${manifest.number}: ${statusError.message}`);
                        console.warn(`[Void] ⚠️ Proceeding with void - METRC API will validate if manifest can be voided`);
                        statusCheck = null;
                    }
                    
                    // Handle case where statusCheck might be null or status is undefined
                    if (!statusCheck || !statusCheck.status) {
                        console.warn(`[Void] ⚠️ Could not determine manifest status for ${manifest.number}, proceeding with caution`);
                        // Don't block voiding if we can't determine status - let METRC API handle it
                    } else if (statusCheck.status === 'voided') {
                        throw new Error(`Cannot void manifest ${manifest.number}: Manifest is already voided.`);
                    } else if (statusCheck.status === 'active') {
                        console.log(`[Void] ✓ Manifest ${manifest.number} is active - can be voided`);
                    } else if (statusCheck.status === 'accepted') {
                        console.log(`[Void] ⚠️ Manifest ${manifest.number} is accepted - attempting to void (METRC will validate if allowed)`);
                    } else {
                        console.warn(`[Void] ⚠️ Manifest ${manifest.number} status is ${statusCheck.status} - attempting to void (METRC will validate if allowed)`);
                    }

                    // Check if we should submit (true) or dry run (false)
                    const shouldSubmit = getMetrcSubmitValue();
                    
                    if (!shouldSubmit) {
                        console.log(`[Void] ⚠️ DRY RUN MODE: METRC_SUBMIT_TRANSFERS=false, validating only...`);
                        // Just validate that manifest is not already voided
                        if (statusCheck && statusCheck.status === 'voided') {
                            throw new Error(`Cannot void manifest: Manifest is already voided.`);
                        }
                        console.log(`[Void] ✓ Dry run validation passed (manifest status: ${statusCheck?.status || 'unknown'})`);
                        // In dry run mode, don't actually void, just return success
                        voidedManifests.push({
                            manifestNumber: manifest.number,
                            license: manifest.license,
                            dryRun: true
                        });
                        continue;
                    }

                    // PHASE 2: ACTUAL VOID (submit=true)
                    console.log(`[Void] Submitting void to METRC for ${manifest.number} (submit=true)...`);
                    const voidResult = await this.voidManifestInMetrc(manifest.id, manifest.license, manifest.number);
                    
                    if (!voidResult.success) {
                        throw new Error(`Void failed: ${voidResult.error}`);
                    }

                    console.log(`[Void] ✓ Manifest ${manifest.number} voided in METRC`);
                    voidedManifests.push(manifest);

                } catch (manifestError) {
                    const errorMessage = manifestError.message || String(manifestError);
                    const errorStack = manifestError.stack ? `\nStack: ${manifestError.stack.substring(0, 500)}` : '';
                    
                    console.error(`[Void] ❌ Failed to void manifest ${manifest.number} (ID: ${manifest.id}):`, errorMessage);
                    if (manifestError.response) {
                        console.error(`[Void]   Response status: ${manifestError.response.status}`);
                        console.error(`[Void]   Response data:`, JSON.stringify(manifestError.response.data).substring(0, 500));
                    }
                    console.error(`[Void]   Full error:`, errorMessage + errorStack);
                    
                    failedManifests.push({
                        manifest: manifest,
                        error: errorMessage,
                        statusCode: manifestError.response?.status,
                        responseData: manifestError.response?.data
                    });
                }
            }

            if (voidedManifests.length === 0) {
                // Provide detailed error information
                const errorDetails = failedManifests.map(f => 
                    `Manifest ${f.manifest?.number || 'unknown'} (ID: ${f.manifest?.id || 'unknown'}): ${f.error}`
                ).join('; ');
                
                const errorMessage = `All manifest void attempts failed. ${failedManifests.length} manifest(s) failed to void. ` +
                    `Details: ${errorDetails}. ` +
                    `Please check server logs for more information. ` +
                    `Common causes: manifest already shipped, manifest not found in METRC, METRC API timeout, or validation errors.`;
                
                console.error(`[Void] ❌ ${errorMessage}`);
                throw new Error(errorMessage);
            }

            // Update invoice - remove voided manifests
            const remainingManifests = manifestIds.filter(m => 
                !voidedManifests.some(v => v.id === m.id)
            );
            const remainingNumbers = remainingManifests.map(m => m.number);
            const voidedNumbers = voidedManifests.map(m => m.number);

            let newStatus = inv.status;
            if (remainingManifests.length === 0) {
                // All manifests voided - set to Manifest_Voided so it can be rescanned
                newStatus = 'Manifest_Voided';
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
                    ? `All ${voidedManifests.length} manifest(s) voided. Order status set to Manifest_Voided - ready to rescan.`
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

            if (inv.status !== 'Manifested' && inv.status !== 'Partially_Manifested') {
                throw new Error(`Cannot update manifest - invoice status is ${inv.status}`);
            }

            if (!inv.manifest_metrc_ids || inv.manifest_metrc_ids.length === 0) {
                throw new Error('No manifest to update');
            }
            
            // CRITICAL: Check if manifest is still active (in activeoutgoingtransfers)
            // Only allow editing if manifest hasn't shipped yet
            const manifestIds = Array.isArray(inv.manifest_metrc_ids)
                ? inv.manifest_metrc_ids
                : (inv.manifest_metrc_ids ? JSON.parse(inv.manifest_metrc_ids) : []);
            
            if (manifestIds.length === 0) {
                throw new Error('No manifest METRC IDs found');
            }
            
            const firstManifest = manifestIds[0];
            const manifestStatusService = require('./manifestStatusService');
            
            // Check status with timeout to avoid blocking
            let statusCheck = null;
            try {
                const statusCheckPromise = manifestStatusService.checkManifestStatus(firstManifest.number, firstManifest.license);
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Status check timeout')), 10000) // 10 second timeout
                );
                statusCheck = await Promise.race([statusCheckPromise, timeoutPromise]);
            } catch (statusError) {
                console.warn(`[Manifest Update] ⚠️ Status check failed or timed out for ${firstManifest.number}: ${statusError.message}`);
                console.warn(`[Manifest Update] ⚠️ Proceeding with update - METRC API will validate if manifest can be updated`);
                statusCheck = null;
            }
            
            // Handle case where statusCheck might be null or status is undefined
            if (!statusCheck || !statusCheck.status) {
                console.warn(`[Manifest Update] ⚠️ Could not determine manifest status for ${firstManifest.number}, proceeding with caution`);
                // Don't block editing if we can't determine status - let METRC API handle it
            } else if (statusCheck.status !== 'active') {
                throw new Error(`Cannot edit manifest ${firstManifest.number}: Manifest is ${statusCheck.status || 'unknown'}. Only active manifests (not yet shipped) can be edited.`);
            } else {
                console.log(`[Manifest Update] ✓ Manifest ${firstManifest.number} is active - can be edited`);
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

            // Check if we should submit (true) or dry run (false)
            const shouldSubmit = getMetrcSubmitValue();
            
            if (!shouldSubmit) {
                console.log(`[Manifest Update] ⚠️ DRY RUN MODE: METRC_SUBMIT_TRANSFERS=false, validating only...`);
                // Just validate that manifest can be updated
                const statusCheck = await manifestStatusService.checkManifestStatus(firstManifest.number, firstManifest.license);
                if (statusCheck.status !== 'active') {
                    throw new Error(`Cannot update manifest: Manifest is ${statusCheck.status}. Only active manifests can be updated.`);
                }
                console.log(`[Manifest Update] ✓ Dry run validation passed (manifest is active)`);
                // In dry run mode, don't actually update, just return success
                await client.query('COMMIT');
                return {
                    success: true,
                    message: 'Manifest update validated (dry run mode)',
                    dryRun: true
                };
            }

            // PHASE 2: ACTUAL UPDATE (submit=true)
            console.log(`[Manifest Update] Submitting update to METRC (submit=true)...`);
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
     * Actually void manifest in METRC using T3 API
     * POST /transfers/void?licenseNumber=LIC-00001&submit=true
     * Payload: {"id":12345}
     * Includes retry logic for 504 Gateway Timeout errors
     * After timeout, verifies if void actually succeeded by checking manifest status
     */
    async voidManifestInMetrc(manifestMetrcId, license, manifestNumber = null) {
        const maxRetries = 3;
        const baseDelay = 3000; // 3 seconds base delay (increased from 2s)
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const shouldSubmit = getMetrcSubmitValue();
                
                console.log(`[Void] Voiding manifest ${manifestMetrcId}${manifestNumber ? ` (${manifestNumber})` : ''} in METRC (submit=${shouldSubmit}, attempt ${attempt}/${maxRetries})...`);
                
                const response = await metrcAuth.makeAuthenticatedRequest({
                    method: 'POST',
                    url: `${metrcAuth.apiBaseUrl}/transfers/void`,
                    params: {
                        licenseNumber: license,
                        submit: shouldSubmit
                    },
                    data: {
                        id: parseInt(manifestMetrcId, 10)
                    },
                    timeout: 90000  // 90 seconds - increased from 60s for slow METRC responses
                });

                console.log(`[Void] ✓ Successfully voided manifest in METRC`);
                return { success: true, data: response.data };
            } catch (error) {
                console.error(`[Void] ❌ Error voiding manifest (attempt ${attempt}/${maxRetries}):`, error.message);
                
                // Check if it's a 504 Gateway Timeout or timeout error
                const isTimeout = error.response?.status === 504 || 
                                 error.response?.status === 408 ||
                                 error.message?.includes('timeout') ||
                                 error.message?.includes('504') ||
                                 (error.response?.data && typeof error.response.data === 'string' && error.response.data.includes('504'));
                
                // If timeout and we have manifest number, verify if void actually succeeded
                if (isTimeout && manifestNumber) {
                    console.log(`[Void] ⚠️ Timeout occurred - verifying if void actually succeeded for manifest ${manifestNumber}...`);
                    try {
                        const manifestStatusService = require('./manifestStatusService');
                        // Wait a bit for METRC to process
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        const statusCheck = await manifestStatusService.checkManifestStatus(manifestNumber, license);
                        
                        if (statusCheck && statusCheck.status === 'voided') {
                            console.log(`[Void] ✓ Manifest ${manifestNumber} was successfully voided (verified after timeout)`);
                            return { success: true, data: { verified: true, message: 'Void succeeded but response timed out' } };
                        } else {
                            console.log(`[Void] ⚠️ Manifest ${manifestNumber} status: ${statusCheck?.status || 'unknown'} - void may not have succeeded`);
                        }
                    } catch (verifyError) {
                        console.warn(`[Void] ⚠️ Could not verify void status: ${verifyError.message}`);
                    }
                }
                
                if (isTimeout && attempt < maxRetries) {
                    // Calculate exponential backoff delay with jitter (longer delays)
                    const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 2000;
                    console.log(`[Void] ⚠️ Gateway timeout (504), retrying in ${Math.round(delay)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue; // Retry
                }
                
                // Handle other errors or final attempt failure
                if (error.response) {
                    const status = error.response.status;
                    const data = error.response.data;
                    
                    console.error(`[Void] Response status: ${status}`);
                    
                    // Check if response is HTML (Cloudflare error page)
                    const isHtmlError = typeof data === 'string' && data.includes('<!DOCTYPE html>');
                    
                    if (status === 504 || status === 408) {
                        // If we have manifest number, suggest checking status manually
                        const suggestion = manifestNumber 
                            ? ` Note: The void request may have succeeded despite the timeout. Check manifest ${manifestNumber} status manually.`
                            : '';
                        return { 
                            success: false, 
                            error: `METRC API gateway timeout (${status}). The server took too long to respond. Please try again in a few moments.${suggestion}` 
                        };
                    }
                    if (status === 400) {
                        const errorMsg = isHtmlError 
                            ? 'METRC validation error (received HTML response - API may be experiencing issues)'
                            : (data.message || JSON.stringify(data));
                        return { success: false, error: `METRC validation error: ${errorMsg}` };
                    }
                    if (status === 404) {
                        return { success: false, error: 'Manifest not found in METRC' };
                    }
                    if (status === 409) {
                        return { success: false, error: 'Cannot void manifest - may already be in transit or delivered' };
                    }
                    
                    const errorMsg = isHtmlError 
                        ? `METRC API error (${status}) - Received HTML error page. The API may be experiencing issues.`
                        : (data.message || JSON.stringify(data));
                    return { success: false, error: `METRC API error (${status}): ${errorMsg}` };
                }
                
                return { success: false, error: error.message };
            }
        }
        
        // Should never reach here, but just in case
        return { success: false, error: 'Failed to void manifest after maximum retries' };
    }

    /**
     * Dry run manifest update in METRC (validation only)
     * Uses submit=false to validate without actually updating
     */
    async updateManifestDryRun(manifestMetrcId, license, updates) {
        try {
            // Get current manifest data
            const currentManifest = await this.getCurrentManifestData(manifestMetrcId, license);
            
            if (!currentManifest) {
                return { success: false, error: 'Could not retrieve current manifest data from METRC' };
            }
            
            // Check if transfer can be updated based on status
            if (currentManifest.isVoided === true) {
                return { success: false, error: 'Cannot update manifest - already voided' };
            }
            
            // Build update payload with full structure
            const payload = await this.buildManifestUpdatePayload(manifestMetrcId, license, currentManifest, updates);
            
            // Validate payload structure
            const allowedFields = ['driverName', 'driverLicense', 'driverOccupationalLicense', 
                                 'vehicleMake', 'vehicleModel', 'vehiclePlate', 
                                 'estimatedDeparture', 'estimatedArrival'];
            const updateFields = Object.keys(updates);
            const disallowedFields = updateFields.filter(f => !allowedFields.includes(f));
            
            if (disallowedFields.length > 0) {
                return { success: false, error: `Cannot update fields: ${disallowedFields.join(', ')}` };
            }

            // Validate payload structure only (no API call needed)
            // The actual validation will happen when submit=true is used
            return { success: true };
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return { success: false, error: 'Manifest not found in METRC' };
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * Actually update manifest in METRC using T3 API
     * POST /transfers/update?licenseNumber=LIC-00001&submit=true
     * Includes retry logic for 504 Gateway Timeout errors
     */
    async updateManifestInMetrc(manifestMetrcId, license, updates) {
        const maxRetries = 3;
        const baseDelay = 2000; // 2 seconds base delay
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // First, try to get current manifest data from METRC to build full payload
                // If this fails or times out, we'll build payload from database data instead
                let currentManifest = null;
                try {
                    console.log(`[Manifest Update] Attempting to fetch current manifest data from METRC...`);
                    const fetchStart = Date.now();
                    currentManifest = await this.getCurrentManifestData(manifestMetrcId, license);
                    const fetchTime = Date.now() - fetchStart;
                    if (currentManifest) {
                        console.log(`[Manifest Update] ✓ Fetched current manifest data in ${fetchTime}ms`);
                    } else {
                        console.log(`[Manifest Update] ⚠️ Could not fetch current manifest data (took ${fetchTime}ms), will build from database`);
                    }
                } catch (fetchError) {
                    console.warn(`[Manifest Update] ⚠️ Failed to fetch current manifest data: ${fetchError.message}`);
                    console.warn(`[Manifest Update] ⚠️ Will build payload from database data instead`);
                    // Continue without currentManifest - buildManifestUpdatePayload can handle null
                }
                
                // Build update payload with full structure
                // buildManifestUpdatePayload can work with null currentManifest (uses database data)
                const payload = await this.buildManifestUpdatePayload(manifestMetrcId, license, currentManifest, updates);
                
                console.log(`[Manifest Update] Updating manifest ${manifestMetrcId} in METRC (attempt ${attempt}/${maxRetries})...`);
                
                const shouldSubmit = getMetrcSubmitValue();
                
                const response = await metrcAuth.makeAuthenticatedRequest({
                    method: 'POST',
                    url: `${metrcAuth.apiBaseUrl}/transfers/update`,
                    params: {
                        licenseNumber: license,
                        submit: shouldSubmit
                    },
                    data: payload,
                    timeout: 60000  // 60 seconds - same as manifest creation
                });

                console.log(`[Manifest Update] ✓ Successfully updated manifest in METRC`);
                return { success: true, data: response.data };
            } catch (error) {
                console.error(`[Manifest Update] ❌ Error updating manifest (attempt ${attempt}/${maxRetries}):`, error.message);
                
                // Check if it's a 504 Gateway Timeout or timeout error
                const isTimeout = error.response?.status === 504 || 
                                 error.response?.status === 408 ||
                                 error.message?.includes('timeout') ||
                                 error.message?.includes('504') ||
                                 (error.response?.data && typeof error.response.data === 'string' && error.response.data.includes('504'));
                
                if (isTimeout && attempt < maxRetries) {
                    // Calculate exponential backoff delay with jitter
                    const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
                    console.log(`[Manifest Update] ⚠️ Gateway timeout (504), retrying in ${Math.round(delay)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue; // Retry
                }
                
                // Handle other errors or final attempt failure
                if (error.response) {
                    const status = error.response.status;
                    const data = error.response.data;
                    
                    console.error(`[Manifest Update] Response status: ${status}`);
                    
                    // Check if response is HTML (Cloudflare error page)
                    const isHtmlError = typeof data === 'string' && data.includes('<!DOCTYPE html>');
                    
                    if (status === 504 || status === 408) {
                        return { 
                            success: false, 
                            error: `METRC API gateway timeout (${status}). The server took too long to respond. Please try again in a few moments.` 
                        };
                    }
                    if (status === 400) {
                        const errorMsg = isHtmlError 
                            ? 'METRC validation error (received HTML response - API may be experiencing issues)'
                            : (data.message || JSON.stringify(data));
                        return { success: false, error: `METRC validation error: ${errorMsg}` };
                    }
                    if (status === 404) {
                        return { success: false, error: 'Manifest not found in METRC' };
                    }
                    if (status === 409) {
                        return { success: false, error: 'Cannot update manifest - may already be delivered' };
                    }
                    
                    const errorMsg = isHtmlError 
                        ? `METRC API error (${status}) - Received HTML error page. The API may be experiencing issues.`
                        : (data.message || JSON.stringify(data));
                    return { success: false, error: `METRC API error (${status}): ${errorMsg}` };
                }
                
                return { success: false, error: error.message };
            }
        }
        
        // Should never reach here, but just in case
        return { success: false, error: 'Failed to update manifest after maximum retries' };
    }

    /**
     * Get current manifest data from METRC API
     */
    async getCurrentManifestData(manifestMetrcId, license) {
        try {
            // Try to get from active outgoing transfers first
            // Use shorter timeout and pagination to avoid long waits
            const activeResponse = await metrcAuth.makeAuthenticatedRequest({
                method: 'GET',
                url: `${metrcAuth.apiBaseUrl}/transfers/outgoing/active`,
                params: {
                    licenseNumber: license,
                    pageSize: 50,
                    page: 1
                },
                timeout: 15000  // 15 seconds - shorter timeout to fail fast
            });

            const activeTransfers = activeResponse.data?.data || activeResponse.data || [];
            const found = activeTransfers.find(t => t.id === manifestMetrcId || t.id === parseInt(manifestMetrcId));
            
            if (found) {
                console.log(`[Manifest Update] ✓ Found manifest in active transfers`);
                return found;
            }

            // If not found in active, try inactive (but with shorter timeout)
            const inactiveResponse = await metrcAuth.makeAuthenticatedRequest({
                method: 'GET',
                url: `${metrcAuth.apiBaseUrl}/transfers/outgoing/inactive`,
                params: {
                    licenseNumber: license,
                    pageSize: 50,
                    page: 1
                },
                timeout: 15000  // 15 seconds - shorter timeout to fail fast
            });

            const inactiveTransfers = inactiveResponse.data?.data || inactiveResponse.data || [];
            const foundInactive = inactiveTransfers.find(t => t.id === manifestMetrcId || t.id === parseInt(manifestMetrcId));
            
            if (foundInactive) {
                console.log(`[Manifest Update] ✓ Found manifest in inactive transfers`);
            }
            
            return foundInactive || null;
        } catch (error) {
            // Don't throw - just log and return null so update can proceed with database data
            console.warn(`[Manifest Update] ⚠️ Could not fetch current manifest data from METRC: ${error.message}`);
            console.warn(`[Manifest Update] ⚠️ Will build payload from database data instead`);
            return null;
        }
    }

    /**
     * Get manifest data for editing (extracts transport details from current manifest)
     * GET /api/v1/fulfillment/manifest/edit/:invoiceId
     */
    async getManifestDataForEdit(invoiceId, userId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get invoice and manifest details
            const invoice = await client.query(`
                SELECT 
                    id,
                    invoice_number,
                    status,
                    manifest_metrc_ids,
                    transportation_details
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            if (!inv.manifest_metrc_ids || inv.manifest_metrc_ids.length === 0) {
                throw new Error('No manifest found for this invoice');
            }

            const manifestIds = Array.isArray(inv.manifest_metrc_ids)
                ? inv.manifest_metrc_ids
                : (inv.manifest_metrc_ids ? JSON.parse(inv.manifest_metrc_ids) : []);

            if (manifestIds.length === 0) {
                throw new Error('No manifest METRC IDs found');
            }

            // Get the first manifest (for single-license manifests)
            const firstManifest = manifestIds[0];
            const manifestMetrcId = firstManifest.id;
            const license = firstManifest.license;

            // Try to get current manifest data from METRC
            let currentManifest = null;
            try {
                currentManifest = await this.getCurrentManifestData(manifestMetrcId, license);
            } catch (error) {
                console.warn(`[Manifest Edit] ⚠️ Could not fetch manifest data from METRC: ${error.message}`);
            }

            // Extract transport details from current manifest or fall back to transportation_details
            const transportationDetails = inv.transportation_details 
                ? (typeof inv.transportation_details === 'string' 
                    ? JSON.parse(inv.transportation_details) 
                    : inv.transportation_details)
                : {};

            // Get destination from current manifest
            const currentDestination = currentManifest?.destinations?.[0] || currentManifest?.destination || null;
            const currentTransporter = currentDestination?.transporters?.[0] || null;
            const currentTransporterDetails = currentTransporter?.transporterDetails?.[0] || null;

            // Build response with current manifest data
            const manifestData = {
                driverName: currentTransporterDetails?.driverName || transportationDetails.driverName || '',
                driverLicense: currentTransporterDetails?.driverLicenseNumber || transportationDetails.driverLicense || '',
                driverOccupationalLicense: currentTransporterDetails?.driverOccupationalLicenseNumber || transportationDetails.driverOccupationalLicense || '',
                vehicleMake: currentTransporterDetails?.vehicleMake || transportationDetails.vehicleMake || '',
                vehicleModel: currentTransporterDetails?.vehicleModel || transportationDetails.vehicleModel || '',
                vehiclePlate: currentTransporterDetails?.vehicleLicensePlateNumber || transportationDetails.vehiclePlate || '',
                estimatedDeparture: currentDestination?.estimatedDepartureDateTime || currentManifest?.estimatedDepartureDateTime || transportationDetails.estimatedDeparture || null,
                estimatedArrival: currentDestination?.estimatedArrivalDateTime || currentManifest?.estimatedArrivalDateTime || transportationDetails.estimatedArrival || null,
                recipientId: currentDestination?.recipientId || currentManifest?.recipientFacilityId || transportationDetails.recipientId || null,
                transporterId: currentTransporter?.transporterId || currentManifest?.transporterFacilityId || transportationDetails.transporterId || null,
                manifestNumber: firstManifest.number,
                manifestMetrcId: manifestMetrcId,
                license: license
            };

            await client.query('COMMIT');

            return {
                success: true,
                data: manifestData
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[Manifest Edit] Error getting manifest data:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Build manifest update payload for METRC T3 API
     * Format: [{id: 12345, destinations: [{...}]}]
     */
    async buildManifestUpdatePayload(manifestMetrcId, license, currentManifest, updates) {
        // Get invoice data to build full payload
        const client = await pool.connect();
        
        try {
            // Find invoice by manifest METRC ID
            const invoiceQuery = await client.query(`
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.transportation_details,
                    i.manifest_metrc_ids
                FROM "ORDERS-invoices" i
                WHERE i.manifest_metrc_ids::text LIKE $1
            `, [`%${manifestMetrcId}%`]);

            if (invoiceQuery.rows.length === 0) {
                throw new Error('Invoice not found for manifest');
            }

            const invoice = invoiceQuery.rows[0];
            const transportationDetails = invoice.transportation_details 
                ? (typeof invoice.transportation_details === 'string' 
                    ? JSON.parse(invoice.transportation_details) 
                    : invoice.transportation_details)
                : {};
            
            // Get destination license from transportation details
            const destinationLicense = transportationDetails.destinationLicense || null;

            // Get manifest packages from invoice line items
            // Use assigned_package_labels to get the actual packages that were scanned/assigned
            // Also check ORDERS-manifest-packages table as fallback (packages stored after manifest creation)
            const packages = [];
            const seenPackageIds = new Set(); // Avoid duplicates
            
            const packagesQuery = await client.query(`
                SELECT 
                    li.quantity_ordered,
                    li.quantity_fulfilled,
                    li.unit_price,
                    li.assigned_package_labels,
                    b.first_sourcepackage_label,
                    p.name as product_name
                FROM "ORDERS-invoice-line-items" li
                INNER JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
                INNER JOIN "ORDERS-products" p ON li.fk_master_product_id = p.entry_id
                WHERE li.fk_invoice_id = $1
                ORDER BY li.line_item_order
            `, [invoice.id]);
            
            console.log(`[Manifest Update] Found ${packagesQuery.rows.length} total line items for invoice ${invoice.id}`);
            
            // Log which line items have assigned_package_labels
            for (const li of packagesQuery.rows) {
                const hasLabels = li.assigned_package_labels !== null && li.assigned_package_labels !== undefined;
                const labelCount = hasLabels 
                    ? (Array.isArray(li.assigned_package_labels) 
                        ? li.assigned_package_labels.length 
                        : (typeof li.assigned_package_labels === 'string' 
                            ? JSON.parse(li.assigned_package_labels || '[]').length 
                            : 0))
                    : 0;
                console.log(`[Manifest Update] Line item ${li.quantity_ordered}x ${li.product_name}: has assigned_package_labels=${hasLabels}, count=${labelCount}`);
            }
            
            // Build packages array from assigned_package_labels
            // These are the actual packages that were scanned and assigned during fulfillment
            for (const lineItem of packagesQuery.rows) {
                // Get assigned package labels (array of package labels)
                const assignedLabels = lineItem.assigned_package_labels 
                    ? (Array.isArray(lineItem.assigned_package_labels)
                        ? lineItem.assigned_package_labels
                        : JSON.parse(lineItem.assigned_package_labels || '[]'))
                    : [];

                // Get package details for each assigned label
                for (const label of assignedLabels) {
                    // Get package details from activepackages (using correct column names)
                    const packageDetails = await client.query(`
                        SELECT 
                            metrcid,
                            label,
                            quantity,
                            item_productcategoryname,
                            item_name
                        FROM activepackages
                        WHERE label = $1 AND sync_license = $2
                        LIMIT 1
                    `, [label, license]);

                    if (packageDetails.rows.length > 0) {
                        const pkgData = packageDetails.rows[0];
                        
                        // Skip if we've already added this package
                        if (seenPackageIds.has(pkgData.metrcid)) {
                            continue;
                        }
                        seenPackageIds.add(pkgData.metrcid);
                        
                        // Calculate gross weight using the same method as manifest creation
                        const grossWeight = await this.calculateGrossWeight(
                            pkgData.item_productcategoryname,
                            pkgData.quantity,
                            pkgData.item_name
                        );
                        
                        // Calculate price per package (distribute line item price across packages)
                        const pricePerPackage = parseFloat(lineItem.unit_price) || 0;
                        
                        packages.push({
                            id: parseInt(pkgData.metrcid, 10),
                            wholesalePrice: parseFloat(pricePerPackage.toFixed(2)),
                            grossWeight: parseFloat(grossWeight.toFixed(2)),
                            grossUnitOfWeightId: 1 // Default unit ID (grams) - same as manifest creation
                        });
                    } else {
                        // Package not found in activepackages - log for fallback
                        console.log(`[Manifest Update] Package ${label} not found in activepackages, will try manifest-packages table as fallback`);
                    }
                }
            }
            
            // If no packages found from assigned_package_labels, OR if packages were assigned but not found in activepackages,
            // try to get from manifest-packages table as fallback
            // This handles cases where packages were transferred/archived after manifest creation
            const manifestNumber = currentManifest?.manifestNumber || currentManifest?.manifest_number || 
                                  (invoice.manifest_metrc_ids && Array.isArray(invoice.manifest_metrc_ids) && invoice.manifest_metrc_ids[0]?.number) ||
                                  (invoice.manifest_metrc_ids && typeof invoice.manifest_metrc_ids === 'string' && JSON.parse(invoice.manifest_metrc_ids || '[]')[0]?.number);
            
            if (packages.length === 0 || (packagesQuery.rows.some(li => {
                const labels = li.assigned_package_labels 
                    ? (Array.isArray(li.assigned_package_labels) ? li.assigned_package_labels : JSON.parse(li.assigned_package_labels || '[]'))
                    : [];
                return labels.length > 0;
            }) && packages.length === 0)) {
                console.log(`[Manifest Update] ${packages.length === 0 ? 'No packages' : 'Some packages missing'} from activepackages, checking ORDERS-manifest-packages table for manifest ${manifestNumber}...`);
                
                if (!manifestNumber) {
                    console.error(`[Manifest Update] Cannot use manifest-packages fallback: manifest number not found`);
                } else {
                    const manifestPackagesQuery = await client.query(`
                        SELECT 
                            mp.package_label,
                            mp.package_metrc_id,
                            mp.quantity,
                            mp.wholesale_price,
                            mp.gross_weight,
                            mp.synclicense
                        FROM "ORDERS-manifest-packages" mp
                        WHERE mp.fk_invoice_id = $1
                            AND mp.manifest_number = $2
                            AND mp.package_status != 'voided'
                        ORDER BY mp.id
                    `, [invoice.id, manifestNumber]);
                    
                    console.log(`[Manifest Update] Found ${manifestPackagesQuery.rows.length} packages in manifest-packages table`);
                    
                    if (manifestPackagesQuery.rows.length > 0) {
                        // Clear existing packages if we're using fallback (to avoid mixing sources)
                        if (packages.length === 0) {
                            packages.length = 0;
                            seenPackageIds.clear();
                        }
                        
                        // Use packages from manifest-packages table
                        for (const mp of manifestPackagesQuery.rows) {
                            if (!seenPackageIds.has(mp.package_metrc_id)) {
                                packages.push({
                                    id: parseInt(mp.package_metrc_id, 10),
                                    wholesalePrice: parseFloat(mp.wholesale_price) || 0,
                                    grossWeight: parseFloat(mp.gross_weight) || 0,
                                    grossUnitOfWeightId: 1
                                });
                                seenPackageIds.add(mp.package_metrc_id);
                            }
                        }
                    }
                }
            }
            
            // If still no packages found, try to get from current manifest data
            if (packages.length === 0 && currentManifest.packages) {
                console.warn(`[Manifest Update] No packages found from assigned_package_labels, using current manifest packages`);
                // Use packages from current manifest if available
                const manifestPackages = Array.isArray(currentManifest.packages) 
                    ? currentManifest.packages 
                    : (currentManifest.packages ? [currentManifest.packages] : []);
                
                for (const pkg of manifestPackages) {
                    if (pkg.id && !seenPackageIds.has(pkg.id)) {
                        packages.push({
                            id: pkg.id,
                            wholesalePrice: pkg.wholesalePrice || 0,
                            grossWeight: pkg.grossWeight || 0,
                            grossUnitOfWeightId: pkg.grossUnitOfWeightId || 1
                        });
                        seenPackageIds.add(pkg.id);
                    }
                }
            }
            
            if (packages.length === 0) {
                // Provide detailed diagnostic information
                console.error(`[Manifest Update] ❌ No packages found for invoice ${invoice.id}`);
                console.error(`[Manifest Update] Diagnostic info:`);
                console.error(`   - Total line items: ${packagesQuery.rows.length}`);
                console.error(`   - Line items with assigned_package_labels: ${packagesQuery.rows.filter(li => li.assigned_package_labels).length}`);
                console.error(`   - Missing packages: ${missingPackages.length > 0 ? missingPackages.slice(0, 5).join(', ') : 'N/A'}`);
                console.error(`   - Manifest number: ${firstManifest.number || 'N/A'}`);
                console.error(`\n💡 Run diagnostic script: NODE_ENV=production node scripts/diagnose-invoice-packages.js ${invoice.id}`);
                
                throw new Error(
                    `No packages found for manifest update. ` +
                    `Invoice ${invoice.id} (${invoice.invoice_number}) has ${packagesQuery.rows.length} line item(s) with assigned_package_labels, ` +
                    `but ${missingPackages.length} package(s) were not found in activepackages. ` +
                    `Packages may have been transferred, archived, or are under a different license. ` +
                    `Run: NODE_ENV=production node scripts/diagnose-invoice-packages.js ${invoice.id} for detailed diagnostics.`
                );
            }
            
            // Calculate total gross weight
            const totalGrossWeight = packages.reduce((sum, pkg) => sum + (pkg.grossWeight || 0), 0);

            // Build destination object
            // IMPORTANT: Only update fields provided in `updates` (from modal)
            // Preserve all other fields from currentManifest (if available) or transportationDetails
            // This ensures we don't accidentally change fields that weren't meant to be updated
            
            // Get current destination from currentManifest (if available)
            const currentDestination = currentManifest?.destinations?.[0] || currentManifest?.destination || null;
            const currentTransporter = currentDestination?.transporters?.[0] || null;
            const currentTransporterDetails = currentTransporter?.transporterDetails?.[0] || null;
            
            // Build destination object - prioritize currentManifest values, only override with updates
            const destination = {
                // Recipient and route - preserve from current manifest
                recipientId: currentDestination?.recipientId || currentManifest?.recipientFacilityId || transportationDetails.recipientId || null,
                plannedRoute: currentDestination?.plannedRoute || currentManifest?.plannedRoute || transportationDetails.plannedRoute || `Delivery to ${destinationLicense || 'destination'}`,
                transferTypeId: currentDestination?.transferTypeId || currentManifest?.transferTypeId || 1,
                invoiceNumber: currentDestination?.invoiceNumber || currentManifest?.invoiceNumber || invoice.invoice_number,
                
                // Dates - only update if provided in updates, otherwise preserve from current manifest
                estimatedDepartureDateTime: updates.estimatedDeparture 
                    ? new Date(updates.estimatedDeparture).toISOString()
                    : (currentDestination?.estimatedDepartureDateTime || currentManifest?.estimatedDepartureDateTime || transportationDetails.estimatedDeparture || new Date().toISOString()),
                estimatedArrivalDateTime: updates.estimatedArrival
                    ? new Date(updates.estimatedArrival).toISOString()
                    : (currentDestination?.estimatedArrivalDateTime || currentManifest?.estimatedArrivalDateTime || transportationDetails.estimatedArrival || new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()),
                
                // Weight - preserve from current manifest, use calculated only if not available
                grossWeight: currentDestination?.grossWeight || currentManifest?.grossWeight || totalGrossWeight || 0,
                grossUnitOfWeightId: currentDestination?.grossUnitOfWeightId || currentManifest?.grossUnitOfWeightId || 1,
                
                // Transporters - preserve transporterId and phone, only update details if provided
                transporters: [{
                    transporterId: currentTransporter?.transporterId || currentManifest?.transporterFacilityId || transportationDetails.transporterId || null,
                    phoneNumberForQuestions: currentTransporter?.phoneNumberForQuestions || currentManifest?.phoneNumberForQuestions || transportationDetails.phoneNumber || '0000000000',
                    transporterDetails: [{
                        // Only update driver/vehicle fields if provided in updates, otherwise preserve from current manifest
                        driverName: updates.driverName || currentTransporterDetails?.driverName || transportationDetails.driverName || '',
                        driverOccupationalLicenseNumber: updates.driverOccupationalLicense || currentTransporterDetails?.driverOccupationalLicenseNumber || transportationDetails.driverOccupationalLicense || '',
                        driverLicenseNumber: updates.driverLicense || currentTransporterDetails?.driverLicenseNumber || transportationDetails.driverLicense || '',
                        driverLayoverLeg: currentTransporterDetails?.driverLayoverLeg || '',
                        vehicleMake: updates.vehicleMake || currentTransporterDetails?.vehicleMake || transportationDetails.vehicleMake || '',
                        vehicleModel: updates.vehicleModel || currentTransporterDetails?.vehicleModel || transportationDetails.vehicleModel || '',
                        vehicleLicensePlateNumber: updates.vehiclePlate || currentTransporterDetails?.vehicleLicensePlateNumber || transportationDetails.vehiclePlate || ''
                    }]
                }],
                
                // Packages - always use current packages from database
                packages: packages
            };
            
            // Validate required fields are present
            if (!destination.recipientId) {
                throw new Error('recipientId is required but not found. Please ensure transportation details include recipientId.');
            }
            if (!destination.transporters[0].transporterId) {
                throw new Error('transporterId is required but not found. Please ensure transportation details include transporterId.');
            }

            // Build full payload array
            const payload = [{
                id: parseInt(manifestMetrcId),
                destinations: [destination]
            }];

            return payload;
        } finally {
            client.release();
        }
    }

    /**
     * Calculate gross weight for a package
     * Same logic as manifest creation service
     */
    async calculateGrossWeight(productCategory, quantity, itemName) {
        // Weight-based items: quantity × unit_weight_grams
        // For now, use quantity as grams (flower products)
        // Unit-based items: Use default weights
        
        const defaultWeights = {
            'Edible': 50,
            'Vape': 30,
            'Concentrate': 10
        };

        // If it's a weight-based product (flower), use quantity directly
        if (productCategory && !defaultWeights[productCategory]) {
            return parseFloat(quantity) || 0;
        }

        // For unit-based products, use default weight
        return defaultWeights[productCategory] || 10;
    }
}

module.exports = new ManifestVoidingService();

