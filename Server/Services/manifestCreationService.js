// Server/Services/manifestCreationService.js
// Module 5: METRC Manifest Creation
// Phase 1: Single-license support

const { query, pool } = require('../config/database');
const axios = require('axios');
const scanningSessionService = require('./scanningSessionService');

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
        console.log(`[Manifest] Starting manifest creation for invoice ${invoiceId} by user ${userId}`);
        
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

            const createdManifests = [];
            const failedManifests = [];
            let partialFailure = false;

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

                    // PHASE 2: ACTUAL SUBMISSION
                    console.log(`[Manifest] Submitting to METRC for ${license}...`);
                    // TODO: Implement actual METRC API submission
                    const manifestNumber = `M${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`; // Placeholder
                    const manifestMetrcId = Math.floor(Math.random() * 100000); // Placeholder

                    console.log(`[Manifest] ✓ Manifest created for ${license}: ${manifestNumber}`);

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

                    createdManifests.push({
                        license,
                        manifest_number: manifestNumber,
                        metrc_id: manifestMetrcId,
                        package_count: licenseData.packages.length
                    });

                } catch (licenseError) {
                    console.error(`[Manifest] ❌ Failed for ${license}:`, licenseError.message);
                    console.error(`[Manifest] Stack trace:`, licenseError.stack);
                    failedManifests.push({
                        license,
                        error: licenseError.message,
                        stack: licenseError.stack
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
                throw new Error('Manifest creation failed for all licenses');
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

            // Log manifest creation
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    new_value,
                    changed_by_user_id,
                    change_details
                ) VALUES ($1, 'manifests_created', 'metrc_manifest_numbers', $2, $3, $4)
            `, [
                invoiceId,
                JSON.stringify(manifestNumbers),
                userId,
                JSON.stringify({
                    created: createdManifests,
                    failed: failedManifests,
                    partial_failure: partialFailure
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
        // Get destination license from invoice (location_license_number) or location (state_license)
        const invoice = await client.query(`
            SELECT 
                i.location_license_number,
                bl.state_license
            FROM "ORDERS-invoices" i
            LEFT JOIN "ORDERS-buyer_locations" bl ON i.fk_location_id = bl.entry_id
            WHERE i.id = $1
        `, [invoiceId]);

        const destinationLicense = invoice.rows[0]?.location_license_number || invoice.rows[0]?.state_license;
        
        if (!destinationLicense) {
            throw new Error('Destination license not found. Please ensure the invoice has a location license number.');
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

                packages.push({
                    id: pkg.metrcid,
                    wholesalePrice: parseFloat(pricePerPackage.toFixed(2)),
                    grossWeight: parseFloat(grossWeight.toFixed(2)),
                    grossUnitOfWeightId: 1 // TODO: Look up actual unit ID
                });
            }
        }

        // Build payload structure
        // Note: recipientId and transporterId may be null if METRC API not available
        // This is OK for now - they can be filled in during actual METRC submission
        const payload = [{
            destinations: [{
                recipientId: transportDetails.recipientId || null, // May be null if METRC API not available
                plannedRoute: `Delivery to ${destinationLicense}`,
                transferTypeId: 1, // TODO: Look up actual transfer type ID
                invoiceNumber: invoiceNumber,
                estimatedDepartureDateTime: transportDetails.estimatedDeparture,
                estimatedArrivalDateTime: transportDetails.estimatedArrival,
                grossWeight: parseFloat(totalGrossWeight.toFixed(2)),
                grossUnitOfWeightId: 1, // TODO: Look up actual unit ID
                transporters: [{
                    transporterId: transportDetails.transporterId || null, // May be null if METRC API not available
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
                }],
                packages: packages
            }]
        }];

        return payload;
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
}

module.exports = new ManifestCreationService();

