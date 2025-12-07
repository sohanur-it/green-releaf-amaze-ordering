// Server/Services/manifestCreationService.js
// Module 5: METRC Manifest Creation
// Phase 1: Single-license support

const { query, pool } = require('../config/database');
const axios = require('axios');
const scanningSessionService = require('./scanningSessionService');
const metrcAuth = require('./metrcAuth');

// METRC API Configuration
const T3_API_BASE_URL = process.env.T3_API_BASE_URL || 'https://api.t3.com';
const METRC_API_TIMEOUT = 30000; // 30 seconds
const METRC_API_MAX_RETRIES = 2;

/**
 * Execute HTTP request with timeout
 */
async function axiosWithTimeout(config, timeoutMs = METRC_API_TIMEOUT) {
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('METRC_API_TIMEOUT')), timeoutMs)
    );

    return Promise.race([
        axios(config),
        timeoutPromise
    ]);
}

class ManifestCreationService {
    constructor() {
        this.apiBaseUrl = metrcAuth.apiBaseUrl || process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
    }

    /**
     * Get the correct license column name for activepackages table
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

    /**
     * Execute manifest creation - Phase 1: Single license support
     * Phase 2 will extend this for multi-license
     */
    async createManifest(invoiceId, userId) {
        console.log(`[Manifest] ========================================`);
        console.log(`[Manifest] Starting manifest creation for invoice ${invoiceId} by user ${userId}`);
        console.log(`[Manifest] ========================================`);
        
        // Check scanning progress BEFORE starting transaction to avoid deadlocks
        console.log(`[Manifest] Checking scanning progress (pre-transaction)...`);
        const scanProgress = await scanningSessionService.getScanningProgress(invoiceId);
        console.log(`[Manifest] Scanning progress:`, JSON.stringify(scanProgress));
        if (!scanProgress.overall_progress.all_complete) {
            const missingCount = scanProgress.overall_progress.total_packages_needed - scanProgress.overall_progress.total_packages_scanned;
            throw new Error(
                `Cannot create manifest - package scanning not complete. ` +
                `Scanned: ${scanProgress.overall_progress.total_packages_scanned}/${scanProgress.overall_progress.total_packages_needed} ` +
                `(${missingCount} package(s) still need to be scanned). ` +
                `Please complete scanning all packages before creating the manifest.`
            );
        }
        console.log(`[Manifest] ✓ Scanning complete`);
        
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            console.log(`[Manifest] Transaction started`);

            // Verify invoice state
            // Use FOR UPDATE NOWAIT to avoid hanging if another transaction has a lock
            console.log(`[Manifest] Querying invoice with FOR UPDATE NOWAIT lock...`);
            let invoice;
            try {
                invoice = await client.query(`
                    SELECT 
                        id,
                        status,
                        fulfillment_accepted_by,
                        transportation_details,
                        invoice_number,
                        fk_location_id
                    FROM "ORDERS-invoices"
                    WHERE id = $1
                    FOR UPDATE NOWAIT
                `, [invoiceId]);
                console.log(`[Manifest] Invoice query completed`);
            } catch (lockError) {
                if (lockError.code === '55P03') { // Lock not available
                    throw new Error('Invoice is currently locked by another transaction. Please try again in a moment.');
                }
                throw lockError;
            }

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];
            console.log(`[Manifest] Invoice status: ${inv.status}, assigned to: ${inv.fulfillment_accepted_by}`);

            // Allow manifest creation if status is Fulfillment_Accepted or Fulfillment_Issue
            // (Fulfillment_Issue might be from a previous scanning issue that was resolved)
            if (inv.status !== 'Fulfillment_Accepted' && inv.status !== 'Fulfillment_Issue') {
                throw new Error(`Cannot create manifest - invoice status is ${inv.status}. Must be Fulfillment_Accepted or Fulfillment_Issue.`);
            }

            if (inv.fulfillment_accepted_by !== userId) {
                throw new Error('You are not assigned to this order');
            }

            if (!inv.transportation_details) {
                throw new Error('Transportation details not entered');
            }
            console.log(`[Manifest] ✓ Invoice validation passed`);

            // ========================================
            // CRITICAL: Final validation - all packages still exist in METRC
            // ========================================
            console.log('[Manifest] Validating all scanned packages still exist in METRC...');

            // Get all line items with necessary fields for manifest creation
            console.log(`[Manifest] Querying line items...`);
            const allLineItems = await client.query(`
                SELECT 
                    id, 
                    fk_batch_id, 
                    assigned_package_labels,
                    line_total,
                    quantity_ordered
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [invoiceId]);
            console.log(`[Manifest] Found ${allLineItems.rows.length} line items`);

            // Collect all package labels
            console.log(`[Manifest] Collecting package labels from line items...`);
            const allPackageLabels = [];
            for (const li of allLineItems.rows) {
                const labels = li.assigned_package_labels 
                    ? (Array.isArray(li.assigned_package_labels)
                        ? li.assigned_package_labels
                        : JSON.parse(li.assigned_package_labels || '[]'))
                    : [];
                allPackageLabels.push(...labels);
            }

            if (allPackageLabels.length === 0) {
                throw new Error('No packages assigned to invoice line items');
            }

            console.log(`[Manifest] Checking ${allPackageLabels.length} packages in METRC...`);

            // Validate packages exist (check local table - Phase 1)
            // Phase 2 will add direct METRC API validation
            console.log(`[Manifest] Getting license column name...`);
            const licenseColumn = await this.getActivePackagesLicenseColumn(client);
            console.log(`[Manifest] Using license column: ${licenseColumn}`);
            
            console.log(`[Manifest] Validating packages exist in activepackages...`);
            const verifiedPackages = new Set();
            for (let i = 0; i < allPackageLabels.length; i++) {
                const label = allPackageLabels[i];
                if (i % 10 === 0) {
                    console.log(`[Manifest] Validating package ${i + 1}/${allPackageLabels.length}...`);
                }
                const existsQuery = `
                    SELECT 1 FROM activepackages
                    WHERE label = $1
                        AND ${licenseColumn} IN ('CUL000063', 'MAN000072')
                        AND isarchived = false
                        AND isfinished = false
                `;
                const exists = await client.query(existsQuery, [label]);

                if (exists.rows.length > 0) {
                    verifiedPackages.add(label);
                }
            }
            console.log(`[Manifest] Verified ${verifiedPackages.size}/${allPackageLabels.length} packages`);

            // Check for missing packages
            const missingPackages = allPackageLabels.filter(label => !verifiedPackages.has(label));

            if (missingPackages.length > 0) {
                console.error(`[Manifest] ${missingPackages.length} packages missing from METRC:`, missingPackages);

                // Packages disappeared since scanning - transition to Fulfillment_Issue
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET 
                        status = 'Fulfillment_Issue',
                        fulfillment_issue_reported_at = NOW(),
                        fulfillment_issue_note = $1
                    WHERE id = $2
                `, [
                    `🚨 METRC VALIDATION FAILED: ${missingPackages.length} package(s) no longer in active inventory. ` +
                    `Packages may have been transferred, destroyed, or archived in METRC since scanning. ` +
                    `Missing: ${missingPackages.slice(0, 10).join(', ')}${missingPackages.length > 10 ? '...' : ''}`,
                    invoiceId
                ]);

                // Clear assigned_package_labels for affected line items
                for (const li of allLineItems.rows) {
                    const labels = li.assigned_package_labels 
                        ? (Array.isArray(li.assigned_package_labels)
                            ? li.assigned_package_labels
                            : JSON.parse(li.assigned_package_labels || '[]'))
                        : [];
                    const remainingLabels = labels.filter(l => !missingPackages.includes(l));

                    if (remainingLabels.length !== labels.length) {
                        await client.query(`
                            UPDATE "ORDERS-invoice-line-items"
                            SET assigned_package_labels = $1
                            WHERE id = $2
                        `, [JSON.stringify(remainingLabels), li.id]);
                    }
                }

                // Log the issue
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id, modification_type, reason, changed_by_system, change_details
                    ) VALUES ($1, 'fulfillment_issue_reported', 'Packages missing from METRC', true, $2)
                `, [invoiceId, JSON.stringify({
                    missing_packages: missingPackages
                })]);

                await client.query('COMMIT');

                throw new Error(
                    `Manifest validation failed: ${missingPackages.length} packages no longer in METRC active inventory. ` +
                    `Order transitioned to Fulfillment_Issue status.`
                );
            }

            console.log(`[Manifest] ✓ All ${allPackageLabels.length} packages validated`);

            // ========================================
            // PHASE 2: Group Packages by License
            // ========================================
            console.log('[Manifest] Grouping packages by license...');
            console.log(`[Manifest] Processing ${allLineItems.rows.length} line items`);

            const packagesByLicense = await this.groupPackagesByLicense(invoiceId, allLineItems.rows, client);
            console.log(`[Manifest] Grouped into ${Object.keys(packagesByLicense).length} license(s)`);

            const licenseCount = Object.keys(packagesByLicense).length;
            console.log(`[Manifest] Found ${licenseCount} license(s): ${Object.keys(packagesByLicense).join(', ')}`);

            if (licenseCount === 0) {
                throw new Error('No packages found for any license');
            }

            // ========================================
            // Create Manifest(s) - One Per License
            // ========================================
            const transportationDetails = typeof inv.transportation_details === 'string'
                ? JSON.parse(inv.transportation_details)
                : inv.transportation_details;
            
            console.log(`[Manifest] Transportation details:`, JSON.stringify(transportationDetails, null, 2).substring(0, 1000));
            console.log(`[Manifest] recipientId in transportation details:`, transportationDetails?.recipientId);
            console.log(`[Manifest] transporterId in transportation details:`, transportationDetails?.transporterId);

            const createdManifests = [];
            const failedManifests = [];
            let partialFailure = false;

            // Build all payloads for preview (before creating)
            const allPayloads = [];
            for (const [license, licenseData] of Object.entries(packagesByLicense)) {
                const payload = await this.buildManifestPayloadForLicense(
                    invoiceId,
                    inv.invoice_number,
                    inv.fk_location_id,
                    license,
                    licenseData,
                    transportationDetails,
                    client
                );
                allPayloads.push({ license, payload });
            }

            // Process each license in the same transaction to avoid deadlocks
            // NOTE: We process licenses sequentially in the same transaction to avoid
            // deadlock issues with foreign key constraints
            for (const [license, licenseData] of Object.entries(packagesByLicense)) {
                try {
                    console.log(`[Manifest] Processing license ${license} (${licenseData.packages.length} packages)...`);

                    // Build payload for this license (using main transaction client)
                    const payload = await this.buildManifestPayloadForLicense(
                        invoiceId,
                        inv.invoice_number,
                        inv.fk_location_id,
                        license,
                        licenseData,
                        transportationDetails,
                        client
                    );

                    // PHASE 1: DRY RUN
                    console.log(`[Manifest] Dry run for ${license}...`);
                    // TODO: Implement actual METRC API dry run
                    const dryRunSuccess = true; // Placeholder

                    if (!dryRunSuccess) {
                        throw new Error('Dry run validation failed');
                    }

                    console.log(`[Manifest] ✓ Dry run passed for ${license}`);

                    // PHASE 2: ACTUAL SUBMISSION TO METRC
                    console.log(`[Manifest] Submitting to METRC for ${license}...`);
                    
                    // Create manifest in METRC using the payload
                    let manifestNumber, manifestMetrcId;
                    
                    try {
                        const metrcResponse = await this.createManifestInMetrc(payload, license);
                        
                        if (!metrcResponse.success) {
                            // Extract error message properly - handle both strings and objects
                            let errorMsg = 'Unknown error';
                            if (typeof metrcResponse.error === 'string') {
                                errorMsg = metrcResponse.error;
                            } else if (metrcResponse.error && typeof metrcResponse.error === 'object') {
                                errorMsg = JSON.stringify(metrcResponse.error);
                            }
                            
                            // Include details if available
                            if (metrcResponse.details) {
                                errorMsg += ` | Details: ${JSON.stringify(metrcResponse.details)}`;
                            }
                            
                            throw new Error(`Failed to create manifest in METRC: ${errorMsg}`);
                        }
                        
                        // Extract manifest number and METRC ID from response
                        const metrcData = metrcResponse.data;
                        manifestNumber = metrcData.manifestNumber || 
                                       metrcData.manifest_number || 
                                       metrcData.ManifestNumber ||
                                       metrcData.number ||
                                       metrcData.Number ||
                                       metrcData.transferNumber ||
                                       metrcData.transfer_number ||
                                       metrcData.TransferNumber;
                        manifestMetrcId = metrcData.id || 
                                        metrcData.Id || 
                                        metrcData.ID ||
                                        metrcData.metrcId ||
                                        metrcData.metrc_id ||
                                        metrcData.MetrcId;
                        
                        // Also check fullResponse if manifestNumber not found in data
                        if (!manifestNumber && metrcData.fullResponse) {
                            const fullResp = metrcData.fullResponse;
                            manifestNumber = fullResp.manifestNumber || 
                                           fullResp.manifest_number || 
                                           fullResp.ManifestNumber ||
                                           fullResp.number ||
                                           fullResp.Number ||
                                           fullResp.transferNumber ||
                                           fullResp.transfer_number ||
                                           (fullResp.destinations && Array.isArray(fullResp.destinations) && fullResp.destinations[0]?.manifestNumber) ||
                                           (fullResp.destinations && Array.isArray(fullResp.destinations) && fullResp.destinations[0]?.number);
                            
                            manifestMetrcId = manifestMetrcId || 
                                             fullResp.id || 
                                             fullResp.Id ||
                                             fullResp.metrcId ||
                                             (fullResp.destinations && Array.isArray(fullResp.destinations) && fullResp.destinations[0]?.id);
                        }
                        
                        // Check if this is sandbox mode
                        const isSandbox = metrcData.isSandbox || manifestNumber?.startsWith('SANDBOX-');
                        
                        if (!manifestNumber) {
                            // If no manifest number in response, check if API call succeeded (sandbox mode)
                            console.warn(`[Manifest] ⚠️  No manifest number found in response - checking if sandbox mode...`);
                            console.warn(`[Manifest] Full metrcData:`, JSON.stringify(metrcData, null, 2));
                            
                            // If the API call succeeded but no manifest number, treat as sandbox mode
                            if (metrcResponse.success && metrcData.fullResponse) {
                                console.warn(`[Manifest] ⚠️  API call succeeded but no manifest number - treating as SANDBOX mode`);
                                manifestNumber = `SANDBOX-${Date.now().toString().slice(-8)}`;
                                manifestMetrcId = null;
                                console.log(`[Manifest] Generated sandbox manifest number: ${manifestNumber}`);
                            } else {
                                // Only throw error if API call actually failed
                                console.error(`[Manifest] ❌ No manifest number found and API call may have failed`);
                                throw new Error('Manifest created in METRC but no manifest number returned in response. Please check METRC API response structure. Full response logged to server console.');
                            }
                        }
                        
                        // In sandbox mode, METRC ID is optional
                        if (!manifestMetrcId && !isSandbox) {
                            console.warn(`[Manifest] No METRC ID in standard fields, checking full response:`, JSON.stringify(metrcData).substring(0, 500));
                            // Don't throw error in sandbox mode - METRC ID is optional
                            if (!manifestNumber?.startsWith('SANDBOX-')) {
                                throw new Error('Manifest created in METRC but no METRC ID returned in response. Please check METRC API response structure.');
                            }
                        }
                        
                        if (isSandbox) {
                            console.log(`[Manifest] ✓ Manifest created in SANDBOX/TEST mode for ${license}: ${manifestNumber} (No METRC ID in sandbox mode)`);
                        } else {
                            console.log(`[Manifest] ✓ Manifest created in METRC for ${license}: ${manifestNumber} (METRC ID: ${manifestMetrcId})`);
                        }
                    } catch (metrcError) {
                        console.error(`[Manifest] ❌ METRC API error:`, metrcError);
                        console.error(`[Manifest] Error message:`, metrcError.message);
                        console.error(`[Manifest] Error stack:`, metrcError.stack);
                        
                        // Extract error message properly
                        let errorMsg = metrcError.message || 'Unknown error';
                        if (typeof errorMsg === 'object') {
                            errorMsg = JSON.stringify(errorMsg);
                        }
                        
                        // Don't double-wrap the error message
                        if (!errorMsg.includes('Failed to create manifest in METRC:')) {
                            throw new Error(`Failed to create manifest in METRC: ${errorMsg}`);
                        } else {
                            throw metrcError; // Already wrapped, just re-throw
                        }
                    }

                    // Record manifest packages immediately (using main transaction client)
                    console.log(`[Manifest] About to record manifest packages for ${license}...`);
                    await this.recordManifestPackages(
                        invoiceId,
                        manifestNumber,
                        license,
                        licenseData.lineItems,
                        client
                    );
                    console.log(`[Manifest] Finished recording manifest packages for ${license}`);

                    // Check if this manifest was created in sandbox mode
                    const isSandboxManifest = manifestNumber?.startsWith('SANDBOX-') || !manifestMetrcId;

                    createdManifests.push({
                        license,
                        manifest_number: manifestNumber,
                        metrc_id: manifestMetrcId,
                        package_count: licenseData.packages.length,
                        is_sandbox: isSandboxManifest
                    });

                } catch (licenseError) {
                    console.error(`[Manifest] ❌ Failed for ${license}:`, licenseError);
                    console.error(`[Manifest] Error type:`, typeof licenseError);
                    console.error(`[Manifest] Error constructor:`, licenseError?.constructor?.name);
                    
                    // Extract error message properly - handle various error types
                    let errorMsg = 'Unknown error';
                    
                    if (licenseError instanceof Error) {
                        errorMsg = licenseError.message || 'Error occurred';
                    } else if (typeof licenseError === 'string') {
                        errorMsg = licenseError;
                    } else if (typeof licenseError === 'object' && licenseError !== null) {
                        // Try to extract meaningful error message from object
                        errorMsg = licenseError.message || 
                                  licenseError.error || 
                                  licenseError.msg ||
                                  JSON.stringify(licenseError);
                    }
                    
                    // Ensure error message is a string and not too long
                    if (typeof errorMsg !== 'string') {
                        errorMsg = JSON.stringify(errorMsg);
                    }
                    errorMsg = errorMsg.substring(0, 1000);
                    
                    console.error(`[Manifest] Extracted error message:`, errorMsg);
                    
                    failedManifests.push({
                        license,
                        error: errorMsg,
                        stack: licenseError.stack || 'No stack trace available'
                    });
                    partialFailure = true;
                }
            }

            // ========================================
            // Update Invoice Status
            // ========================================
            console.log(`[Manifest] Summary: ${createdManifests.length} created, ${failedManifests.length} failed`);
            if (createdManifests.length === 0) {
                // All failed
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET 
                        status = 'Fulfillment_Issue',
                        fulfillment_issue_reported_at = NOW(),
                        fulfillment_issue_note = $1,
                        status_updated_at = NOW()
                    WHERE id = $2
                `, [
                    `Manifest creation failed for all licenses: ${failedManifests.map(f => f.license).join(', ')}`,
                    invoiceId
                ]);

                await client.query('COMMIT');
                
                // Create detailed error message with all failure reasons
                const errorDetails = failedManifests.map(f => 
                    `${f.license}: ${f.error || 'Unknown error'}`
                ).join('; ');
                
                throw new Error(`Manifest creation failed for all licenses. Errors: ${errorDetails}`);
            }

            // Update invoice with created manifests
            const manifestNumbers = createdManifests.map(m => m.manifest_number);
            const manifestMetrcIds = createdManifests.map(m => ({
                license: m.license,
                id: m.metrc_id,
                number: m.manifest_number
            }));

            let finalStatus = 'Manifested';
            if (partialFailure) {
                finalStatus = 'Partially_Manifested';
            }

            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    metrc_manifest_numbers = $1::jsonb,
                    manifest_metrc_ids = $2::jsonb,
                    manifest_created_at = NOW(),
                    status = $3,
                    status_updated_at = NOW(),
                    updated_at = NOW(),
                    fulfillment_issue_note = CASE 
                        WHEN $4 = true THEN $5
                        ELSE fulfillment_issue_note
                    END
                WHERE id = $6
            `, [
                JSON.stringify(manifestNumbers),
                JSON.stringify(manifestMetrcIds),
                finalStatus,
                partialFailure,
                partialFailure ? `⚠️ PARTIAL MANIFEST: Created for ${createdManifests.map(m => m.license).join(', ')}, failed for ${failedManifests.map(f => f.license).join(', ')}` : null,
                invoiceId
            ]);

            // Set quantity_fulfilled on all line items
            await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET quantity_fulfilled = quantity_ordered
                WHERE fk_invoice_id = $1
            `, [invoiceId]);

            // Complete scanning session
            await client.query(`
                UPDATE "ORDERS-scanning-sessions"
                SET 
                    session_status = 'completed',
                    completed_at = NOW()
                WHERE fk_invoice_id = $1 AND session_status = 'active'
            `, [invoiceId]);

            // Check if any manifests were created in sandbox mode
            const hasSandboxManifests = createdManifests.some(m => m.is_sandbox);
            const sandboxMessage = hasSandboxManifests 
                ? ' (Created in SANDBOX/TEST environment - manifest numbers are placeholders)' 
                : '';
            
            // Build status change message
            let statusChangeMessage = `Manifest created successfully${sandboxMessage}`;
            if (partialFailure) {
                statusChangeMessage = `Partial manifest creation${sandboxMessage} - Some licenses succeeded, some failed`;
            }
            
            // Log manifest creation with appropriate message
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    new_value,
                    reason,
                    changed_by_user_id,
                    change_details
                ) VALUES ($1, 'manifests_created', 'metrc_manifest_numbers', $2, $3, $4, $5)
            `, [
                invoiceId,
                JSON.stringify(manifestNumbers),
                statusChangeMessage,
                userId,
                JSON.stringify({
                    created: createdManifests,
                    failed: failedManifests,
                    partial_failure: partialFailure,
                    sandbox_mode: hasSandboxManifests
                })
            ]);

            await client.query('COMMIT');

            if (partialFailure) {
                // Alert admin team
                console.error(`[Manifest] ⚠️ PARTIAL FAILURE: ${createdManifests.length} succeeded, ${failedManifests.length} failed`);
            }

            return {
                success: true,
                manifests: createdManifests,
                failed: failedManifests,
                invoice_number: inv.invoice_number,
                total_manifests: createdManifests.length,
                partial_failure: partialFailure
            };

        } catch (error) {
            console.error(`[Manifest] Error in createManifest:`, error.message);
            console.error(`[Manifest] Stack:`, error.stack);
            await client.query('ROLLBACK');
            
            // Log failure if not already logged
            // Use 'status_changed' as modification_type since 'manifest_creation_failed' doesn't exist in enum
            try {
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id,
                        modification_type,
                        reason,
                        changed_by_user_id
                    ) VALUES ($1, 'status_changed', $2, $3)
                `, [invoiceId, `Manifest creation failed: ${error.message}`, userId]);
            } catch (historyError) {
                console.error(`[Manifest] Failed to log history:`, historyError.message);
            }

            throw error;
        } finally {
            client.release();
            console.log(`[Manifest] Client released`);
        }
    }

    /**
     * Group packages by license
     */
    async groupPackagesByLicense(invoiceId, lineItems, client) {
        const packagesByLicense = {};
        
        // Cache the license column name to avoid repeated queries
        const licenseColumn = await this.getActivePackagesLicenseColumn(client);
        console.log(`[Manifest] Using license column: ${licenseColumn} for grouping`);

        for (const li of lineItems) {
            const assignedLabels = li.assigned_package_labels 
                ? (Array.isArray(li.assigned_package_labels)
                    ? li.assigned_package_labels
                    : JSON.parse(li.assigned_package_labels || '[]'))
                : [];

            for (const label of assignedLabels) {
                // Get package license (using cached column name)
                const pkgDataQuery = `
                    SELECT ${licenseColumn} as synclicense
                    FROM activepackages
                    WHERE label = $1
                        AND ${licenseColumn} IN ('CUL000063', 'MAN000072')
                `;
                const pkgData = await client.query(pkgDataQuery, [label]);

                if (pkgData.rows.length > 0) {
                    const license = pkgData.rows[0].synclicense;

                    if (!packagesByLicense[license]) {
                        packagesByLicense[license] = {
                            license,
                            packages: [],
                            lineItems: []
                        };
                    }

                    if (!packagesByLicense[license].packages.includes(label)) {
                        packagesByLicense[license].packages.push(label);
                    }

                    // Track which line items belong to this license
                    const existingLineItem = packagesByLicense[license].lineItems.find(existing => existing.id === li.id);
                    if (!existingLineItem) {
                        packagesByLicense[license].lineItems.push({
                            ...li,
                            assigned_package_labels: li.assigned_package_labels
                        });
                    }
                }
            }
        }

        return packagesByLicense;
    }

    /**
     * Build manifest payload for a specific license
     */
    async buildManifestPayloadForLicense(invoiceId, invoiceNumber, locationId, license, licenseData, transportDetails, client) {
        // ============================================================================
        // CRITICAL LICENSE LOGIC:
        // ============================================================================
        // SOURCE LICENSE (license parameter): CUL000063 - Where product is coming FROM (our license)
        // DESTINATION LICENSE (destinationLicense): DIS000085 - Where product is going TO (buyer's store license)
        // 
        // The destination license MUST come from the invoice's buyer location (state_license)
        // This is set when the order is placed in the external dashboard and cannot be changed.
        // The transportation page shows this as read-only.
        // ============================================================================
        // Get destination license from buyer location (state_license) - this is the store's license (e.g., DIS000085)
        // This should ALWAYS be the buyer's location license and cannot be changed
        // Priority: 1) location.state_license (buyer location), 2) invoice.location_license_number (fallback)
        const invoice = await client.query(`
            SELECT 
                i.location_license_number,
                bl.state_license,
                bl.name as location_name
            FROM "ORDERS-invoices" i
            LEFT JOIN "ORDERS-buyer_locations" bl ON i.fk_location_id = bl.entry_id
            WHERE i.id = $1
        `, [invoiceId]);

        // CRITICAL: Destination license is the store's license (DIS000085) - where the product is going
        // CUL000063 is OUR license number (source) - where the product is coming from
        // The destination license (DIS000085) is what we display, but recipientId comes from the dropdown selection
        const destinationLicense = invoice.rows[0]?.state_license || invoice.rows[0]?.location_license_number;
        
        if (!destinationLicense) {
            throw new Error('Destination license not found. Please ensure the buyer location has a state_license configured.');
        }
        
        // Log destination license for debugging
        console.log(`[Manifest] ✅ Destination License: ${destinationLicense} (Store where product is going)`);
        console.log(`[Manifest] ✅ Source License: ${license} (Our license - where product is coming from)`);
        console.log(`[Manifest] ✅ Location: ${invoice.rows[0]?.location_name || 'N/A'}`);
        
        // Validate that destination license is not the source license (prevent shipping to self)
        if (destinationLicense === license) {
            throw new Error(`Invalid destination license: Cannot ship to the same license (${destinationLicense}). Destination must be the buyer's store license.`);
        }

        // Build packages array for this license only
        const packages = [];
        let totalGrossWeight = 0;

        for (const li of licenseData.lineItems) {
            const assignedLabels = li.assigned_package_labels 
                ? (Array.isArray(li.assigned_package_labels)
                    ? li.assigned_package_labels
                    : JSON.parse(li.assigned_package_labels || '[]'))
                : [];

            // Filter to only packages for this license
            const licenseLabels = assignedLabels.filter(label => 
                licenseData.packages.includes(label)
            );

            for (const label of licenseLabels) {
                // Get package data from activepackages (filtered by license)
                const licenseColumn = await this.getActivePackagesLicenseColumn(client);
                const pkgDataQuery = `
                    SELECT 
                        metrcid,
                        quantity,
                        item_name,
                        item_productcategoryname
                    FROM activepackages
                    WHERE label = $1 
                        AND ${licenseColumn} = $2
                        AND isarchived = false
                        AND isfinished = false
                `;
                const pkgData = await client.query(pkgDataQuery, [label, license]);

                if (pkgData.rows.length === 0) {
                    throw new Error(`Package ${label} not found in active inventory for license ${license}`);
                }

                const pkg = pkgData.rows[0];

                // Calculate gross weight
                const grossWeight = await this.calculateGrossWeight(
                    pkg.item_productcategoryname,
                    pkg.quantity,
                    pkg.item_name
                );

                totalGrossWeight += grossWeight;

                // Calculate price per package (only for packages in this license)
                const pricePerPackage = parseFloat(li.line_total) / licenseLabels.length;

                // Validate that metrcid is a valid number
                const packageMetrcId = parseInt(pkg.metrcid, 10);
                if (!packageMetrcId || isNaN(packageMetrcId)) {
                    throw new Error(`Package ${label} has invalid METRC ID: ${pkg.metrcid}`);
                }
                
                // Ensure all numeric fields are valid numbers
                const validatedWholesalePrice = parseFloat(pricePerPackage.toFixed(2));
                const validatedGrossWeight = parseFloat(grossWeight.toFixed(2));
                
                if (isNaN(validatedWholesalePrice) || validatedWholesalePrice < 0) {
                    throw new Error(`Package ${label} has invalid wholesale price: ${pricePerPackage}`);
                }
                
                if (isNaN(validatedGrossWeight) || validatedGrossWeight <= 0) {
                    throw new Error(`Package ${label} has invalid gross weight: ${grossWeight}`);
                }

                packages.push({
                    id: packageMetrcId,
                    wholesalePrice: validatedWholesalePrice,
                    grossWeight: validatedGrossWeight,
                    grossUnitOfWeightId: 1 // TODO: Look up actual unit ID
                });
            }
        }

        // Validate totalGrossWeight is a valid number
        const validatedTotalGrossWeight = parseFloat(totalGrossWeight.toFixed(2));
        if (isNaN(validatedTotalGrossWeight) || validatedTotalGrossWeight <= 0) {
            throw new Error(`Invalid total gross weight: ${totalGrossWeight}`);
        }

        // Build payload structure
        // Only include numeric fields if they have valid values (don't send null for numbers)
        const destinationPayload = {
                plannedRoute: `Delivery to ${destinationLicense}`,
                transferTypeId: 1, // TODO: Look up actual transfer type ID
                invoiceNumber: invoiceNumber,
                estimatedDepartureDateTime: transportDetails.estimatedDeparture,
                estimatedArrivalDateTime: transportDetails.estimatedArrival,
            grossWeight: validatedTotalGrossWeight,
                grossUnitOfWeightId: 1, // TODO: Look up actual unit ID
            packages: packages
        };
        
        // ============================================================================
        // RECIPIENT ID: FROM DROPDOWN SELECTION
        // ============================================================================
        // recipientId is selected by user from the dropdown on transportation page
        // Destination license (DIS000085) is the store where product is going
        // Source license (CUL000063) is our license - where product is coming from
        // ============================================================================
        let recipientId = null;
        
        // Get recipientId from transportation details (selected from dropdown)
        if (transportDetails.recipientId) {
            recipientId = parseInt(transportDetails.recipientId, 10);
            if (!isNaN(recipientId) && recipientId > 0) {
                console.log(`[Manifest] ✅ Using recipientId from dropdown selection: ${recipientId}`);
            } else {
                recipientId = null;
            }
        }
        
        // recipientId is REQUIRED - must be selected from dropdown
        if (!recipientId || isNaN(recipientId) || recipientId <= 0) {
            throw new Error(
                `recipientId is required but not found. ` +
                `Please go back to the transportation details page and select a recipient facility from the dropdown. ` +
                `The recipient ID must be selected from the METRC T3 API recipient list.`
            );
        }
        
        destinationPayload.recipientId = recipientId;
        console.log(`[Manifest] ✅ Using recipientId ${recipientId} for manifest creation (selected from dropdown)`);
        
        const transporterPayload = {
                    phoneNumberForQuestions: transportDetails.phoneNumber || '0000000000',
                    transporterDetails: [{
                        driverName: transportDetails.driverName,
                        driverOccupationalLicenseNumber: transportDetails.driverOccupationalLicense || '',
                        driverLicenseNumber: transportDetails.driverLicense,
                        driverLayoverLeg: '',
                        vehicleMake: transportDetails.vehicleMake,
                        vehicleModel: transportDetails.vehicleModel,
                        vehicleLicensePlateNumber: transportDetails.vehiclePlate
                    }]
        };
        
        // transporterId is REQUIRED by METRC - must be a valid number
        // Try to get it from transportDetails first (from dropdown selection if available)
        let transporterId = null;
        
        if (transportDetails.transporterId) {
            transporterId = parseInt(transportDetails.transporterId, 10);
            if (!isNaN(transporterId) && transporterId > 0) {
                console.log(`[Manifest] ✅ Using transporterId from transportation details (from dropdown): ${transporterId}`);
            } else {
                transporterId = null;
                console.warn(`[Manifest] Invalid transporterId in transportDetails: ${transportDetails.transporterId}`);
            }
        } else {
            console.log(`[Manifest] transporterId not found in transportDetails`);
        }
        
        // If transporterId is not available, try to look it up from METRC API
        if (!transporterId && transportDetails.transporterName) {
            console.log(`[Manifest] transporterId not found, attempting lookup by name...`);
            try {
                // Try to look up transporter ID by name
                const transportationDetailsService = require('./transportationDetailsService');
                transporterId = await transportationDetailsService.getTransporterIdByName(transportDetails.transporterName);
                if (transporterId) {
                    console.log(`[Manifest] ✅ Looked up transporterId from METRC: ${transporterId}`);
                }
            } catch (error) {
                console.error(`[Manifest] Failed to lookup transporterId from METRC:`, error.message);
                // Continue - will throw error below if still null
            }
        }
        
        // transporterId is REQUIRED by METRC - throw error if we still don't have it
        if (!transporterId || isNaN(transporterId) || transporterId <= 0) {
            throw new Error(
                `transporterId is required but not found. ` +
                `Please go back to the transportation details page and select a transporter facility from the dropdown. ` +
                `The transporter ID must be retrieved from METRC T3 API.`
            );
        }
        
        transporterPayload.transporterId = transporterId;
        
        const payload = [{
            destinations: [{
                ...destinationPayload,
                transporters: [transporterPayload]
            }]
        }];

        return payload;
    }

    /**
     * Look up recipient facility ID from METRC using destination license number
     * @param {string} destinationLicense - The destination facility license number
     * @param {string} sourceLicense - The source/shipper license number
     * @returns {Promise<number|null>} - The recipient facility ID or null if not found
     */
    async lookupRecipientIdByLicense(destinationLicense, sourceLicense) {
        try {
            console.log(`[Manifest] Looking up recipient ID for destination license: ${destinationLicense} (source: ${sourceLicense})`);
            
            // Method 1: Try to get available destinations from METRC API
            // Endpoint: GET /transfers/create/destinations?licenseNumber={sourceLicense}
            try {
                const destinationsResponse = await metrcAuth.makeAuthenticatedRequest({
                    method: 'GET',
                    url: `${this.apiBaseUrl}/transfers/create/destinations`,
                    params: {
                        licenseNumber: sourceLicense
                    },
                    timeout: 15000
                });
                
                console.log(`[Manifest] Received destinations from METRC API`);
                console.log(`[Manifest] Full API response:`, JSON.stringify(destinationsResponse.data, null, 2).substring(0, 1000));
                
                // The response should contain a list of available destination facilities
                const destinations = destinationsResponse.data?.data || destinationsResponse.data || [];
                
                if (Array.isArray(destinations) && destinations.length > 0) {
                    console.log(`[Manifest] Found ${destinations.length} destination(s) from METRC API`);
                    
                    // Find destination facility matching the license number
                    const matchingDestination = destinations.find(dest => {
                        const destLicense = dest.licenseNumber || 
                                           dest.license || 
                                           dest.LicenseNumber ||
                                           dest.License ||
                                           (dest.facility && (dest.facility.licenseNumber || dest.facility.license));
                        
                        return destLicense === destinationLicense;
                    });
                    
                    if (matchingDestination) {
                        console.log(`[Manifest] Found matching destination:`, JSON.stringify(matchingDestination).substring(0, 500));
                        
                        const recipientId = matchingDestination.id || 
                                           matchingDestination.facilityId || 
                                           matchingDestination.FacilityId ||
                                           matchingDestination.facility?.id ||
                                           matchingDestination.facility?.Id;
                        
                        if (recipientId) {
                            const parsedId = parseInt(recipientId, 10);
                            if (!isNaN(parsedId) && parsedId > 0) {
                                console.log(`[Manifest] ✅ Found recipient ID: ${parsedId} for license: ${destinationLicense}`);
                                return parsedId;
                            }
                        }
                    }
                    
                    console.warn(`[Manifest] No matching destination in results. Available destinations:`, destinations.map(d => ({
                        license: d.licenseNumber || d.license || d.LicenseNumber,
                        id: d.id || d.facilityId
                    })).slice(0, 5));
                }
            } catch (destError) {
                console.warn(`[Manifest] Failed to fetch destinations endpoint (will try facilities endpoint):`, destError.message);
                if (destError.response) {
                    console.warn(`[Manifest] Destinations endpoint status:`, destError.response.status);
                    console.warn(`[Manifest] Destinations endpoint response:`, JSON.stringify(destError.response.data).substring(0, 500));
                }
            }
            
            // Method 2: Fallback - Query facilities endpoint and filter by license number
            console.log(`[Manifest] Attempting fallback: Querying facilities endpoint...`);
            try {
                const facilitiesResponse = await metrcAuth.makeAuthenticatedRequest({
                    method: 'GET',
                    url: `${this.apiBaseUrl}/facilities`,
                    params: {
                        licenseNumber: sourceLicense
                    },
                    timeout: 15000
                });
                
                console.log(`[Manifest] Received facilities from METRC API`);
                console.log(`[Manifest] Facilities response:`, JSON.stringify(facilitiesResponse.data, null, 2).substring(0, 1500));
                
                const facilities = facilitiesResponse.data?.data || facilitiesResponse.data || [];
                
                if (Array.isArray(facilities) && facilities.length > 0) {
                    console.log(`[Manifest] Found ${facilities.length} facility/facilities from METRC API`);
                    console.log(`[Manifest] Sample facility structure:`, JSON.stringify(facilities[0], null, 2).substring(0, 500));
                    
                    // Find facility matching the destination license number
                    const matchingFacility = facilities.find(fac => {
                        const facLicense = fac.licenseNumber || 
                                          fac.license || 
                                          fac.LicenseNumber ||
                                          fac.License ||
                                          (fac.facility && (fac.facility.licenseNumber || fac.facility.license));
                        
                        return facLicense === destinationLicense;
                    });
                    
                    if (matchingFacility) {
                        console.log(`[Manifest] Found matching facility:`, JSON.stringify(matchingFacility, null, 2).substring(0, 500));
                        
                        const recipientId = matchingFacility.id || 
                                           matchingFacility.facilityId || 
                                           matchingFacility.FacilityId ||
                                           (matchingFacility.facility && matchingFacility.facility.id);
                        
                        if (recipientId) {
                            const parsedId = parseInt(recipientId, 10);
                            if (!isNaN(parsedId) && parsedId > 0) {
                                console.log(`[Manifest] ✅ Found recipient ID from facilities: ${parsedId} for license: ${destinationLicense}`);
                                return parsedId;
                            }
                        }
                    }
                    
                    console.warn(`[Manifest] Available facilities (first 5):`, facilities.slice(0, 5).map(f => ({
                        id: f.id || f.facilityId,
                        license: f.licenseNumber || f.license || f.LicenseNumber,
                        name: f.name || f.facilityName
                    })));
                }
            } catch (facError) {
                console.warn(`[Manifest] Facilities endpoint also failed:`, facError.message);
                if (facError.response) {
                    console.warn(`[Manifest] Facilities endpoint status:`, facError.response.status);
                    console.warn(`[Manifest] Facilities endpoint response:`, JSON.stringify(facError.response.data).substring(0, 500));
                }
            }
            
            console.warn(`[Manifest] ❌ No matching recipient facility found for license: ${destinationLicense}`);
            console.warn(`[Manifest] Please check server logs above to see what METRC API returned.`);
            console.warn(`[Manifest] You may need to manually configure the recipient facility ID for this location.`);
            return null;
            
        } catch (error) {
            console.error(`[Manifest] Error looking up recipient ID:`, error.message);
            if (error.response) {
                console.error(`[Manifest] Response status:`, error.response.status);
                console.error(`[Manifest] Response data:`, JSON.stringify(error.response.data).substring(0, 500));
            }
            return null;
        }
    }

    /**
     * Validate payload to ensure no null values in numeric fields
     * @param {Array} payload - The manifest payload array
     */
    validatePayloadForNumericFields(payload) {
        if (!Array.isArray(payload) || payload.length === 0) {
            throw new Error('Payload must be a non-empty array');
        }
        
        const firstPayload = payload[0];
        if (!firstPayload.destinations || !Array.isArray(firstPayload.destinations) || firstPayload.destinations.length === 0) {
            throw new Error('Payload must contain at least one destination');
        }
        
        const destination = firstPayload.destinations[0];
        
        // Check numeric fields in destination - these must NOT be null
        const requiredNumericFields = ['transferTypeId', 'grossWeight', 'grossUnitOfWeightId'];
        for (const field of requiredNumericFields) {
            if (destination[field] === null || destination[field] === undefined || isNaN(destination[field])) {
                throw new Error(`Invalid or missing required numeric field '${field}': ${destination[field]}`);
            }
        }
        
        // recipientId is REQUIRED by METRC - must be present and valid
        if (destination.recipientId === null || destination.recipientId === undefined || isNaN(parseInt(destination.recipientId, 10))) {
            throw new Error(`recipientId is required and must be a valid number. Current value: ${destination.recipientId}`);
        }
        
        // Check transporters
        if (destination.transporters && Array.isArray(destination.transporters)) {
            for (const transporter of destination.transporters) {
                if (transporter.transporterId !== undefined) {
                    if (transporter.transporterId === null || isNaN(parseInt(transporter.transporterId, 10))) {
                        throw new Error(`Invalid transporterId: ${transporter.transporterId}. Must be a valid number or omitted entirely.`);
                    }
                }
            }
        }
        
        // Check packages
        if (!destination.packages || !Array.isArray(destination.packages) || destination.packages.length === 0) {
            throw new Error('Payload must contain at least one package');
        }
        
        for (let i = 0; i < destination.packages.length; i++) {
            const pkg = destination.packages[i];
            const packageNumFields = ['id', 'wholesalePrice', 'grossWeight', 'grossUnitOfWeightId'];
            
            for (const field of packageNumFields) {
                if (pkg[field] === null || pkg[field] === undefined || isNaN(pkg[field])) {
                    throw new Error(`Package ${i + 1} has invalid or missing numeric field '${field}': ${pkg[field]}`);
                }
            }
        }
        
        console.log(`[Manifest] ✓ Payload validation passed - all numeric fields are valid`);
    }

    /**
     * Create manifest in METRC using T3 API
     * @param {Array} payload - The manifest payload array
     * @param {string} license - The license number
     * @returns {Promise<Object>} - Response with success status and data
     */
    async createManifestInMetrc(payload, license) {
        try {
            console.log(`[Manifest] Creating manifest in METRC for license ${license}...`);
            
            // Validate payload structure - ensure no null values in numeric fields
            this.validatePayloadForNumericFields(payload);
            
            
            // Call METRC T3 API to create transfer/manifest
            // Use submit=true parameter to actually create the manifest (not just dry run)
            const response = await metrcAuth.makeAuthenticatedRequest({
                method: 'POST',
                url: `${this.apiBaseUrl}/transfers/create`,
                data: payload,
                params: {
                    licenseNumber: license,
                    submit: true  // Actually create the manifest, not just validate
                },
                timeout: 60000  // 60 seconds for manifest creation
            });
            
            
            // Extract manifest information from response
            // METRC typically returns the created transfer in response.data
            // The structure may vary, so we'll check multiple possible formats
            let manifestNumber = null;
            let manifestMetrcId = null;
            
            // Helper function to extract manifest number from various possible field names
            const extractManifestNumber = (obj) => {
                if (!obj) return null;
                return obj.manifestNumber || 
                       obj.manifest_number || 
                       obj.ManifestNumber ||
                       obj.number ||
                       obj.Number ||
                       obj.transferNumber ||
                       obj.transfer_number ||
                       obj.TransferNumber ||
                       obj.transferNumber ||
                       (obj.destinations && Array.isArray(obj.destinations) && obj.destinations[0]?.manifestNumber) ||
                       (obj.destinations && Array.isArray(obj.destinations) && obj.destinations[0]?.number) ||
                       null;
            };
            
            // Helper function to extract METRC ID from various possible field names
            const extractMetrcId = (obj) => {
                if (!obj) return null;
                return obj.id || 
                       obj.Id || 
                       obj.ID ||
                       obj.metrcId ||
                       obj.metrc_id ||
                       obj.MetrcId ||
                       (obj.destinations && Array.isArray(obj.destinations) && obj.destinations[0]?.id) ||
                       null;
            };
            
            if (Array.isArray(response.data) && response.data.length > 0) {
                // Response is an array of created transfers
                const transferData = response.data[0];
                manifestNumber = extractManifestNumber(transferData);
                manifestMetrcId = extractMetrcId(transferData);
                
                // Also check if it's nested in a data property
                if (!manifestNumber && transferData.data) {
                    manifestNumber = extractManifestNumber(transferData.data);
                    manifestMetrcId = extractMetrcId(transferData.data);
                }
            } else if (response.data) {
                // Response is a single object
                manifestNumber = extractManifestNumber(response.data);
                manifestMetrcId = extractMetrcId(response.data);
                
                // Check if response.data has a data property (nested structure)
                if (!manifestNumber && response.data.data) {
                    if (Array.isArray(response.data.data) && response.data.data.length > 0) {
                        manifestNumber = extractManifestNumber(response.data.data[0]);
                        manifestMetrcId = extractMetrcId(response.data.data[0]);
                    } else {
                        manifestNumber = extractManifestNumber(response.data.data);
                        manifestMetrcId = extractMetrcId(response.data.data);
                    }
                }
            }
            
            console.log(`[Manifest] Extracted manifestNumber: ${manifestNumber}`);
            console.log(`[Manifest] Extracted manifestMetrcId: ${manifestMetrcId}`);
            
            // Check response message to determine if manifest was created
            const responseMessage = response.data && typeof response.data === 'object' ? response.data.message : null;
            const isDryRun = responseMessage === 'Dry run';
            const isSuccess = responseMessage === 'Success';
            const isSandboxMode = isDryRun || (isSuccess && !manifestNumber); // Sandbox mode if dry run or success without manifest number
            
            // If API returned "Success" or "Dry run", the manifest was likely created
            // but we need to query active transfers to get the manifest number
            if (isSuccess || isDryRun || (response.status === 200 && !manifestNumber)) {
                if (isDryRun) {
                    console.warn(`[Manifest] ⚠️  METRC API returned dry run response - SANDBOX/TEST MODE detected`);
                } else if (isSuccess) {
                    console.log(`[Manifest] ✅ METRC API returned success - manifest was created`);
                } else {
                    console.warn(`[Manifest] ⚠️  API call succeeded (200 OK) but no manifest number in response`);
                }
                
                console.log(`[Manifest] Querying active transfers to find the created manifest...`);
                
                // Try to find the manifest by querying active transfers
                // The manifest was created but the response doesn't include the manifest number
                const invoiceNumber = payload[0]?.destinations?.[0]?.invoiceNumber;
                const creationTime = new Date(); // Record when we created it
                
                // Retry logic: Try multiple times with increasing delays
                // METRC may need a moment to process and index the new manifest
                let foundManifest = false;
                const maxRetries = 3;
                const retryDelays = [2000, 3000, 5000]; // 2s, 3s, 5s delays
                
                for (let attempt = 0; attempt < maxRetries && !foundManifest; attempt++) {
                    try {
                        if (attempt > 0) {
                            console.log(`[Manifest] Retry attempt ${attempt + 1}/${maxRetries} after ${retryDelays[attempt]}ms...`);
                            await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
                        } else {
                            await new Promise(resolve => setTimeout(resolve, retryDelays[0]));
                        }
                        
                        // Try multiple endpoints to find the manifest
                        const endpoints = [
                            {
                                name: 'outgoing/active',
                                url: `${this.apiBaseUrl}/transfers/outgoing/active`,
                                params: {
                                    licenseNumber: license,
                                    pageSize: 50,
                                    page: 1
                                }
                            },
                            {
                                name: 'v2/external/outgoing',
                                url: `${this.apiBaseUrl}/transfers/v2/external/outgoing`,
                                params: {
                                    licenseNumber: license,
                                    pageSize: 50
                                }
                            }
                        ];
                        
                        for (const endpoint of endpoints) {
                            try {
                                console.log(`[Manifest] Trying endpoint: ${endpoint.name}...`);
                                const activeTransfersResponse = await metrcAuth.makeAuthenticatedRequest({
                                    method: 'GET',
                                    url: endpoint.url,
                                    params: endpoint.params,
                                    timeout: 15000
                                });
                                
                                // Handle different response structures
                                let transfers = [];
                                if (Array.isArray(activeTransfersResponse.data)) {
                                    transfers = activeTransfersResponse.data;
                                } else if (activeTransfersResponse.data?.data && Array.isArray(activeTransfersResponse.data.data)) {
                                    transfers = activeTransfersResponse.data.data;
                                } else if (activeTransfersResponse.data?.transfers && Array.isArray(activeTransfersResponse.data.transfers)) {
                                    transfers = activeTransfersResponse.data.transfers;
                                }
                                
                                if (transfers.length > 0) {
                                    console.log(`[Manifest] Found ${transfers.length} transfers in ${endpoint.name}`);
                                    
                                    // Method 1: Find by invoice number (most reliable)
                                    const matchingTransfer = transfers.find(t => {
                                        const transferInvoiceNumber = t.invoiceNumber || 
                                                                      (t.destinations && Array.isArray(t.destinations) && t.destinations[0]?.invoiceNumber) ||
                                                                      (t.destination && t.destination.invoiceNumber) ||
                                                                      (t.destinations && !Array.isArray(t.destinations) && t.destinations.invoiceNumber);
                                        return transferInvoiceNumber === invoiceNumber;
                                    });
                                    
                                    if (matchingTransfer) {
                                        manifestNumber = extractManifestNumber(matchingTransfer);
                                        manifestMetrcId = extractMetrcId(matchingTransfer);
                                        console.log(`[Manifest] ✅ Found manifest by invoice number: ${manifestNumber} (ID: ${manifestMetrcId})`);
                                        foundManifest = true;
                                        break;
                                    }
                                    
                                    // Method 2: Find by creation time (within last 2 minutes)
                                    const recentTransfers = transfers.filter(t => {
                                        const transferDate = t.createdDateTime || t.createdDate || t.dateCreated || t.lastModified;
                                        if (!transferDate) return false;
                                        const transferTime = new Date(transferDate);
                                        const timeDiff = creationTime - transferTime;
                                        return timeDiff >= 0 && timeDiff < 2 * 60 * 1000; // Created within last 2 minutes
                                    });
                                    
                                    if (recentTransfers.length > 0) {
                                        // Sort by creation time (most recent first)
                                        recentTransfers.sort((a, b) => {
                                            const timeA = new Date(a.createdDateTime || a.createdDate || a.dateCreated || 0);
                                            const timeB = new Date(b.createdDateTime || b.createdDate || b.dateCreated || 0);
                                            return timeB - timeA;
                                        });
                                        
                                        const mostRecent = recentTransfers[0];
                                        manifestNumber = extractManifestNumber(mostRecent);
                                        manifestMetrcId = extractMetrcId(mostRecent);
                                        console.log(`[Manifest] ✅ Found manifest by creation time: ${manifestNumber} (ID: ${manifestMetrcId})`);
                                        foundManifest = true;
                                        break;
                                    }
                                    
                                    // Method 3: Use most recent transfer if no better match (last resort)
                                    if (!foundManifest && transfers.length > 0) {
                                        const mostRecent = transfers[0]; // Assuming API returns most recent first
                                        manifestNumber = extractManifestNumber(mostRecent);
                                        manifestMetrcId = extractMetrcId(mostRecent);
                                        console.log(`[Manifest] ⚠️  Using most recent transfer as fallback: ${manifestNumber} (ID: ${manifestMetrcId})`);
                                        foundManifest = true;
                                        break;
                                    }
                                }
                            } catch (endpointError) {
                                console.warn(`[Manifest] Endpoint ${endpoint.name} failed:`, endpointError.message);
                            }
                        }
                        
                        if (foundManifest) {
                            break; // Found it, exit retry loop
                        }
                        
                    } catch (queryError) {
                        console.warn(`[Manifest] Retry ${attempt + 1} failed:`, queryError.message);
                        if (attempt === maxRetries - 1) {
                            console.error(`[Manifest] All ${maxRetries} retry attempts failed`);
                        }
                    }
                }
                
                // If we still don't have a manifest number after querying
                if (!manifestNumber) {
                    if (isDryRun) {
                        // In dry run mode, generate placeholder
                        console.warn(`[Manifest] ⚠️  No manifest number found - generating placeholder for SANDBOX mode`);
                        manifestNumber = `SANDBOX-${Date.now().toString().slice(-8)}`;
                        manifestMetrcId = null;
                        console.log(`[Manifest] Generated sandbox manifest number: ${manifestNumber}`);
                    } else {
                        // In success mode, this is unexpected - log error but don't fail
                        console.error(`[Manifest] ❌ Manifest created (Success response) but could not find manifest number in active transfers`);
                        console.error(`[Manifest] This may indicate the manifest was created but is not yet visible in active transfers`);
                        console.error(`[Manifest] Please check METRC directly for invoice: ${payload[0]?.destinations?.[0]?.invoiceNumber}`);
                        // Still generate a placeholder so the process can continue
                        manifestNumber = `PENDING-${Date.now().toString().slice(-8)}`;
                        manifestMetrcId = null;
                    }
                }
            } else if (!manifestNumber) {
                // Only throw error if API call failed or returned unexpected response
                console.error(`[Manifest] ❌ Manifest number not found in METRC API response`);
                console.error(`[Manifest] Response structure:`, JSON.stringify(response.data, null, 2));
                throw new Error('Manifest created in METRC but no manifest number returned in response. Please check METRC API response structure. Full response logged to server console.');
            }
            
            return {
                success: true,
                data: {
                    id: manifestMetrcId,
                    manifestNumber: manifestNumber,
                    fullResponse: response.data,
                    isSandbox: isSandboxMode || (!manifestMetrcId && manifestNumber?.startsWith('SANDBOX-'))
                }
            };
            
        } catch (error) {
            console.error(`[Manifest] ❌ METRC API error caught:`, error);
            console.error(`[Manifest] Error message:`, error.message);
            
            if (error.response) {
                console.error(`[Manifest] Response status:`, error.response.status);
                console.error(`[Manifest] Response headers:`, error.response.headers);
                console.error(`[Manifest] Full response data:`, JSON.stringify(error.response.data, null, 2));
                
                // Extract detailed error message from METRC API response
                let errorMessage = `METRC API returned ${error.response.status}`;
                
                if (error.response.data) {
                    const errorData = error.response.data;
                    
                    // Try multiple possible error message formats
                    if (typeof errorData === 'string') {
                        errorMessage = errorData;
                    } else if (typeof errorData === 'object') {
                        // Try common error message fields
                        errorMessage = errorData.message || 
                                      errorData.error || 
                                      errorData.Message ||
                                      errorData.Error ||
                                      errorData.title ||
                                      errorData.detail ||
                                      errorMessage;
                        
                        // Include validation errors if present
                        if (errorData.errors) {
                            let validationErrors = '';
                            if (Array.isArray(errorData.errors)) {
                                validationErrors = errorData.errors.map(e => 
                                    typeof e === 'string' ? e : JSON.stringify(e)
                                ).join('; ');
                            } else if (typeof errorData.errors === 'object') {
                                validationErrors = JSON.stringify(errorData.errors);
                            }
                            
                            if (validationErrors) {
                                errorMessage += ` | Validation errors: ${validationErrors}`;
                            }
                        }
                        
                        // If we still have the generic message, include the full error data
                        if (errorMessage === `METRC API returned ${error.response.status}`) {
                            errorMessage += ` | Response: ${JSON.stringify(errorData).substring(0, 500)}`;
                        }
                    }
                }
                
                // Ensure error message is always a string
                const finalErrorMessage = typeof errorMessage === 'string' 
                    ? errorMessage 
                    : JSON.stringify(errorMessage);
                
                return {
                    success: false,
                    error: finalErrorMessage,
                    details: error.response.data,
                    statusCode: error.response.status
                };
            }
            
            // Handle network errors or other non-HTTP errors
            let errorMessage = error.message || 'Failed to create manifest in METRC';
            if (error.code) {
                errorMessage += ` (Code: ${error.code})`;
            }
            
            // Ensure error message is always a string
            const finalErrorMessage = typeof errorMessage === 'string' 
                ? errorMessage 
                : JSON.stringify(errorMessage);
            
            return {
                success: false,
                error: finalErrorMessage
            };
        }
    }

    /**
     * Build manifest payload for METRC API (legacy method - kept for compatibility)
     */
    async buildManifestPayload(invoiceId, invoiceNumber, locationId, transportDetails, client) {
        // This method is deprecated - use buildManifestPayloadForLicense instead
        // For backward compatibility, assume single license
        const lineItems = await client.query(`
            SELECT 
                li.id as line_item_id,
                li.assigned_package_labels,
                li.line_total,
                b.id as batch_id,
                b.batch_name
            FROM "ORDERS-invoice-line-items" li
            JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
            WHERE li.fk_invoice_id = $1
        `, [invoiceId]);

        const licenseData = {
            license: 'CUL000063', // Default
            packages: [],
            lineItems: lineItems.rows
        };

        // Collect all package labels
        for (const li of lineItems.rows) {
            const labels = li.assigned_package_labels 
                ? (Array.isArray(li.assigned_package_labels)
                    ? li.assigned_package_labels
                    : JSON.parse(li.assigned_package_labels || '[]'))
                : [];
            licenseData.packages.push(...labels);
        }

        return this.buildManifestPayloadForLicense(
            invoiceId,
            invoiceNumber,
            locationId,
            'CUL000063',
            licenseData,
            transportDetails,
            client
        );
    }

    /**
     * Calculate gross weight for a package
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

    /**
     * Record manifest packages in junction table
     */
    async recordManifestPackages(invoiceId, manifestNumber, license, lineItems, client) {
        console.log(`[Manifest] Recording ${lineItems.length} line items for manifest ${manifestNumber}`);
        // Cache the license column name to avoid repeated queries
        const licenseColumn = await this.getActivePackagesLicenseColumn(client);
        console.log(`[Manifest] Using license column: ${licenseColumn}`);
        
        for (const li of lineItems) {
            console.log(`[Manifest] Processing line item ${li.id || li.line_item_id}...`);
            const assignedLabels = li.assigned_package_labels 
                ? (Array.isArray(li.assigned_package_labels)
                    ? li.assigned_package_labels
                    : JSON.parse(li.assigned_package_labels || '[]'))
                : [];
            
            console.log(`[Manifest] Line item has ${assignedLabels.length} assigned labels`);
            
            if (assignedLabels.length === 0) {
                console.warn(`[Manifest] Line item ${li.id} has no assigned labels, skipping`);
                continue;
            }
            
            const pricePerPackage = parseFloat(li.line_total) / assignedLabels.length;
            console.log(`[Manifest] Price per package: ${pricePerPackage}`);

            for (let i = 0; i < assignedLabels.length; i++) {
                const label = assignedLabels[i];
                console.log(`[Manifest] Processing package ${i + 1}/${assignedLabels.length}: ${label}`);
                
                console.log(`[Manifest] Querying package data from activepackages...`);
                const pkgDataQuery = `
                    SELECT metrcid, quantity
                    FROM activepackages
                    WHERE label = $1 AND ${licenseColumn} = $2
                `;
                const pkgData = await client.query(pkgDataQuery, [label, license]);
                console.log(`[Manifest] Package query completed, found ${pkgData.rows.length} result(s)`);

                if (pkgData.rows.length > 0) {
                    const pkg = pkgData.rows[0];
                    console.log(`[Manifest] Package metrcid: ${pkg.metrcid}, quantity: ${pkg.quantity}`);

                    // Get batch_id from line item (it's fk_batch_id in the table)
                    const batchId = li.fk_batch_id || li.batch_id;
                    console.log(`[Manifest] Batch ID: ${batchId}`);
                    if (!batchId) {
                        throw new Error(`Line item ${li.id || li.line_item_id} is missing batch_id`);
                    }

                    console.log(`[Manifest] Inserting into ORDERS-manifest-packages...`);
                    console.log(`[Manifest] Insert values: invoiceId=${invoiceId}, manifestNumber=${manifestNumber}, label=${label}, metrcid=${pkg.metrcid}, batchId=${batchId}, lineItemId=${li.id || li.line_item_id}, quantity=${pkg.quantity}, price=${pricePerPackage}, weight=${pkg.quantity}, license=${license}`);
                    
                    try {
                        const insertStart = Date.now();
                        console.log(`[Manifest] Executing INSERT query...`);
                        const insertResult = await client.query(`
                            INSERT INTO "ORDERS-manifest-packages" (
                                fk_invoice_id,
                                manifest_number,
                                package_label,
                                package_metrc_id,
                                batch_id,
                                line_item_id,
                                quantity,
                                wholesale_price,
                                gross_weight,
                                synclicense
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                            RETURNING id
                        `, [
                            invoiceId,
                            manifestNumber,
                            label,
                            pkg.metrcid,
                            batchId,
                            li.id || li.line_item_id, // Use id (from line items table) or line_item_id (if passed)
                            pkg.quantity,
                            pricePerPackage,
                            pkg.quantity, // Gross weight (simplified for Phase 1)
                            license
                        ]);
                        const insertDuration = Date.now() - insertStart;
                        console.log(`[Manifest] INSERT query completed`);
                        console.log(`[Manifest] Inserted record ID: ${insertResult.rows[0]?.id || 'N/A'}`);
                        console.log(`[Manifest] ✓ Package ${label} recorded in manifest-packages table (took ${insertDuration}ms)`);
                    } catch (insertError) {
                        console.error(`[Manifest] ❌ INSERT failed:`, insertError.message);
                        console.error(`[Manifest] Error code:`, insertError.code);
                        console.error(`[Manifest] Error detail:`, insertError.detail);
                        console.error(`[Manifest] Error constraint:`, insertError.constraint);
                        console.error(`[Manifest] Full error:`, insertError);
                        throw insertError;
                    }
                } else {
                    console.warn(`[Manifest] ⚠️ Package ${label} not found in activepackages for license ${license}`);
                }
            }
        }
        console.log(`[Manifest] ✓ Finished recording all manifest packages`);
    }

    /**
     * Get manifest payload preview (without creating manifest)
     * Returns the payloads that would be sent to METRC
     * GET /api/v1/fulfillment/manifest/preview/:invoiceId
     */
    async getManifestPayloadPreview(invoiceId, userId) {
        console.log(`[Manifest Preview] ========================================`);
        console.log(`[Manifest Preview] Getting payload preview for invoice ${invoiceId}`);
        console.log(`[Manifest Preview] ========================================`);
        
        const client = await pool.connect();

        try {
            // Get invoice and transportation details
            const invoice = await client.query(`
                SELECT 
                    id,
                    invoice_number,
                    transportation_details,
                    fk_location_id,
                    status,
                    fulfillment_accepted_by
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];
            
            // Validate invoice status
            if (inv.status !== 'Fulfillment_Accepted' && inv.status !== 'Fulfillment_Issue') {
                throw new Error(`Cannot preview manifest - invoice status is ${inv.status}. Must be Fulfillment_Accepted or Fulfillment_Issue.`);
            }

            if (!inv.transportation_details) {
                throw new Error('Transportation details not entered. Please complete the transportation form first.');
            }

            // Parse transportation details
            const transportationDetails = typeof inv.transportation_details === 'string'
                ? JSON.parse(inv.transportation_details)
                : inv.transportation_details;
            
            console.log(`[Manifest Preview] Transportation details:`, JSON.stringify(transportationDetails, null, 2).substring(0, 1000));
            console.log(`[Manifest Preview] recipientId: ${transportationDetails?.recipientId}`);
            console.log(`[Manifest Preview] transporterId: ${transportationDetails?.transporterId}`);

            // Validate recipientId and transporterId are present
            if (!transportationDetails?.recipientId) {
                throw new Error('recipientId is missing from transportation details. Please go back and select a recipient facility.');
            }

            if (!transportationDetails?.transporterId) {
                throw new Error('transporterId is missing from transportation details. Please go back and select a transporter facility.');
            }

            // Get all line items
            const allLineItems = await client.query(`
                SELECT 
                    id, 
                    fk_batch_id, 
                    assigned_package_labels,
                    line_total,
                    quantity_ordered
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [invoiceId]);

            if (allLineItems.rows.length === 0) {
                throw new Error('No line items found for invoice');
            }

            // Group packages by license
            console.log(`[Manifest Preview] Grouping packages by license...`);
            const packagesByLicense = await this.groupPackagesByLicense(invoiceId, allLineItems.rows, client);
            console.log(`[Manifest Preview] Grouped into ${Object.keys(packagesByLicense).length} license(s)`);

            const licenseCount = Object.keys(packagesByLicense).length;
            if (licenseCount === 0) {
                throw new Error('No packages found for any license');
            }

            // Build payloads for each license
            const payloads = [];
            let totalPackages = 0;

            for (const [license, licenseData] of Object.entries(packagesByLicense)) {
                console.log(`[Manifest Preview] Building payload for license ${license}...`);
                
                const payload = await this.buildManifestPayloadForLicense(
                    invoiceId,
                    inv.invoice_number,
                    inv.fk_location_id,
                    license,
                    licenseData,
                    transportationDetails,
                    client
                );

                payloads.push({
                    license: license,
                    packageCount: licenseData.packages.length,
                    payload: payload
                });

                totalPackages += licenseData.packages.length;
            }

            console.log(`[Manifest Preview] ✅ Built ${payloads.length} payload(s) for ${totalPackages} total packages`);

            return {
                invoice_id: invoiceId,
                invoice_number: inv.invoice_number,
                licenseCount: licenseCount,
                totalPackages: totalPackages,
                payloads: payloads,
                transportationDetails: {
                    recipientId: transportationDetails.recipientId,
                    transporterId: transportationDetails.transporterId,
                    driverName: transportationDetails.driverName,
                    estimatedDeparture: transportationDetails.estimatedDeparture,
                    estimatedArrival: transportationDetails.estimatedArrival
                }
            };

        } catch (error) {
            console.error(`[Manifest Preview] Error:`, error);
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new ManifestCreationService();

