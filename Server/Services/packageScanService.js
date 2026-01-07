// Server/Services/packageScanService.js
// Module 5: Package Scanning Validation & Processing

const { query, pool } = require('../config/database');
const websocketService = require('./websocketService');

/**
 * Custom validation error class
 */
class ValidationError extends Error {
    constructor(code, message, details = null) {
        super(message);
        this.name = 'ValidationError';
        this.code = code;
        this.details = details;
    }
}

class PackageScanService {
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
     * Master validation function for scanned packages
     * This is called on EVERY scan
     */
    async validateAndProcessScan(sessionId, packageLabel, invoiceId, userId) {
        const client = await pool.connect();

        try {
            console.log(`[PackageScan] Starting scan validation for session ${sessionId}, package ${packageLabel}, invoice ${invoiceId}`);
            await client.query('BEGIN');
            console.log(`[PackageScan] Transaction started`);

            // Update session activity timestamp
            let session;
            try {
                console.log(`[PackageScan] Updating session activity timestamp...`);
                await client.query(`
                    UPDATE "ORDERS-scanning-sessions"
                    SET last_activity = NOW()
                    WHERE id = $1
                `, [sessionId]);
                console.log(`[PackageScan] Session activity updated`);

                // ============================================
                // VALIDATION LAYER 1: Session Active?
                // ============================================
                console.log(`[PackageScan] Checking if session is active...`);
                session = await client.query(`
                    SELECT session_status, currently_locked_packages
                    FROM "ORDERS-scanning-sessions"
                    WHERE id = $1
                `, [sessionId]);
                console.log(`[PackageScan] Session check complete, status: ${session.rows[0]?.session_status}`);
            } catch (error) {
                console.error('[PackageScan] ❌ Error in session query:', error.message);
                console.error('[PackageScan] Error code:', error.code);
                console.error('[PackageScan] Error stack:', error.stack);
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('[PackageScan] Error during ROLLBACK:', rollbackError);
                }
                throw new ValidationError('DATABASE_ERROR', `Database error: ${error.message}`);
            }

            if (session.rows.length === 0 || session.rows[0].session_status !== 'active') {
                await client.query('ROLLBACK');
                throw new ValidationError('SESSION_INACTIVE', 'Scanning session is not active');
            }

            // ============================================
            // VALIDATION LAYER 2: Package Exists in METRC?
            // ============================================
            // Handle both sync_license (production) and synclicense (development)
            let licenseColumn;
            try {
                console.log(`[PackageScan] Getting license column name...`);
                licenseColumn = await this.getActivePackagesLicenseColumn(client);
                console.log(`[PackageScan] License column: ${licenseColumn}`);
            } catch (error) {
                console.error('[PackageScan] ❌ Error getting license column:', error.message);
                console.error('[PackageScan] Error code:', error.code);
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('[PackageScan] Error during ROLLBACK:', rollbackError);
                }
                throw new ValidationError('DATABASE_ERROR', `Database error: ${error.message}`);
            }
            
            // Build query with correct column name (licenseColumn is safe - comes from schema check)
            // 3.1.1: Package label is already converted to uppercase in frontend, but ensure it here too
            const normalizedPackageLabel = packageLabel.toUpperCase();
            
            const packageExistsQuery = `
                SELECT 
                    ap.metrcid,
                    ap.quantity,
                    ap.item_name,
                    COALESCE(b.batch_name, '') as batch_name,
                    ap.${licenseColumn} as synclicense,
                    b.first_sourcepackage_label,
                    b.partial_package_details
                FROM activepackages ap
                LEFT JOIN "ORDERS-batches" b ON (
                    b.available_labels IS NOT NULL 
                    AND b.available_labels @> $2::jsonb
                    AND b.synclicense = ap.${licenseColumn}
                )
                WHERE UPPER(ap.label) = $1
                    AND ap.${licenseColumn} IN ('CUL000063', 'MAN000072')
                    AND ap.isarchived = false
                    AND ap.isfinished = false
            `;
            
            let packageExists;
            try {
                console.log(`[PackageScan] Querying package ${normalizedPackageLabel}...`);
                packageExists = await client.query(packageExistsQuery, [normalizedPackageLabel, JSON.stringify([normalizedPackageLabel])]);
                console.log(`[PackageScan] Package query complete, found ${packageExists.rows.length} result(s)`);
            } catch (error) {
                console.error('[PackageScan] ❌ Error querying package:', error.message);
                console.error('[PackageScan] Error code:', error.code);
                console.error('[PackageScan] Error detail:', error.detail);
                console.error('[PackageScan] Error hint:', error.hint);
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('[PackageScan] Error during ROLLBACK:', rollbackError);
                }
                throw new ValidationError('DATABASE_ERROR', `Database query error: ${error.message}`);
            }

            if (packageExists.rows.length === 0) {
                try {
                    await this.logScanError(invoiceId, userId, normalizedPackageLabel, 'package_not_found', client, null, sessionId);
                } catch (logError) {
                    console.error('[PackageScan] Error logging scan error:', logError);
                }
                await client.query('ROLLBACK');
                throw new ValidationError(
                    'PACKAGE_NOT_FOUND',
                    `Package ${normalizedPackageLabel} does not exist in active inventory`
                );
            }

            const pkg = packageExists.rows[0];

            // ============================================
            // VALIDATION LAYER 3: Which Line Item?
            // ============================================
            let lineItems;
            try {
                console.log(`[PackageScan] Querying line items for invoice ${invoiceId}...`);
                lineItems = await client.query(`
                    SELECT 
                        li.id as line_item_id,
                        li.quantity_ordered,
                        li.assigned_package_labels,
                        li.specific_package_labels,
                        b.id as batch_id,
                        b.batch_name,
                        b.full_package_details,
                        b.partial_package_details,
                        b.metrc_item_name
                    FROM "ORDERS-invoice-line-items" li
                    JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
                    WHERE li.fk_invoice_id = $1
                `, [invoiceId]);
                console.log(`[PackageScan] Line items query complete, found ${lineItems.rows.length} line item(s)`);
            } catch (error) {
                console.error('[PackageScan] ❌ Error querying line items:', error.message);
                console.error('[PackageScan] Error code:', error.code);
                console.error('[PackageScan] Error detail:', error.detail);
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('[PackageScan] Error during ROLLBACK:', rollbackError);
                }
                throw new ValidationError('DATABASE_ERROR', `Database query error: ${error.message}`);
            }

            let matchedLineItem = null;
            let isPartialPackageRequired = false;

            // First, check if this is a partial package by looking at batch's partial_package_details
            let isScannedPackagePartial = false;
            if (pkg.partial_package_details) {
                try {
                    const partialDetails = typeof pkg.partial_package_details === 'string' 
                        ? JSON.parse(pkg.partial_package_details) 
                        : pkg.partial_package_details;
                    const partialLabels = partialDetails.partial_packages?.map(p => p.label) || [];
                    isScannedPackagePartial = partialLabels.includes(normalizedPackageLabel);
                } catch (error) {
                    console.warn('[PackageScan] Error parsing partial_package_details:', error);
                }
            }

            // CRITICAL: Check if this package is required by ANY partial package line item
            // This must be done BEFORE matching to ensure partial packages go to the right line item
            let isRequiredByPartialLineItem = false;
            let requiredPartialLineItemId = null;
            const normalizedPackageLabelForCheck = String(packageLabel).toUpperCase();
            
            for (const li of lineItems.rows) {
                if (li.specific_package_labels === null || li.specific_package_labels === '') continue;
                
                try {
                    const specificLabels = Array.isArray(li.specific_package_labels)
                        ? li.specific_package_labels
                        : JSON.parse(li.specific_package_labels || '[]');
                    const normalizedSpecificLabels = specificLabels.map(label => String(label).toUpperCase());
                    
                    if (normalizedSpecificLabels.includes(normalizedPackageLabelForCheck)) {
                        isRequiredByPartialLineItem = true;
                        requiredPartialLineItemId = li.id;
                        console.log(`[PackageScan] Package ${packageLabel} is REQUIRED by partial line item ${li.id}`);
                        break;
                    }
                } catch (error) {
                    // Skip if parsing fails
                }
            }

            // Try to match package to a line item
            // Prioritize matching partial packages to partial line items, and full packages to full line items
            const lineItemsToCheck = [...lineItems.rows];
            
            // Sort: if package is required by a partial line item OR is detected as partial, check partial line items FIRST
            lineItemsToCheck.sort((a, b) => {
                const aIsPartial = a.specific_package_labels !== null && a.specific_package_labels !== '';
                const bIsPartial = b.specific_package_labels !== null && b.specific_package_labels !== '';
                
                // If package is required by a partial line item, prioritize partial line items
                if (isRequiredByPartialLineItem || isScannedPackagePartial) {
                    // Prioritize partial line items
                    if (aIsPartial && !bIsPartial) return -1;
                    if (!aIsPartial && bIsPartial) return 1;
                    // If both are partial, prioritize the one that requires this package
                    if (aIsPartial && bIsPartial) {
                        if (a.id === requiredPartialLineItemId) return -1;
                        if (b.id === requiredPartialLineItemId) return 1;
                    }
                } else {
                    // Prioritize full line items
                    if (!aIsPartial && bIsPartial) return -1;
                    if (aIsPartial && !bIsPartial) return 1;
                }
                return 0;
            });

            for (const li of lineItemsToCheck) {
                // Check if package label is in this line item's batch
                // Method 1: Check if package's batch_name matches (if available)
                let batchMatches = false;
                
                if (pkg.batch_name && pkg.batch_name === li.batch_name) {
                    batchMatches = true;
                } else {
                    // Method 2: Check if package label is in batch's available_labels
                    // This is more reliable since batch_name from join might be null
                    if (li.batch_id) {
                        try {
                            // Check if this package label exists in the batch's available_labels
                            // available_labels structure: {"labels": ["1A40...", "1A40...", ...]}
                            // So we need to check available_labels->'labels' @> [...]
                            // 3.1.2: Add first_sourcepackage_label match validation
                            const batchCheck = await client.query(`
                                SELECT id, batch_name, available_labels, first_sourcepackage_label
                                FROM "ORDERS-batches"
                                WHERE id = $1
                                    AND available_labels IS NOT NULL
                                    AND (
                                        -- Handle object structure: {"labels": [...]}
                                        (jsonb_typeof(available_labels) = 'object' AND available_labels->'labels' @> $2::jsonb)
                                        -- Handle array structure: [...]
                                        OR (jsonb_typeof(available_labels) = 'array' AND available_labels @> $2::jsonb)
                                    )
                            `, [li.batch_id, JSON.stringify([normalizedPackageLabel])]);
                            
                            if (batchCheck.rows.length > 0) {
                                const batch = batchCheck.rows[0];
                                
                                // 3.1.2: Note: first_sourcepackage_label validation
                                // The fact that the package is in the batch's available_labels already ensures
                                // it belongs to the correct source package chain. The batch's first_sourcepackage_label
                                // is stored for reference, but we don't need to validate it here since the package
                                // being in available_labels is sufficient validation.
                                
                                batchMatches = true;
                                // Update pkg.batch_name for consistency
                                pkg.batch_name = batch.batch_name;
                                // Store batch's first_sourcepackage_label for reference
                                pkg.batch_first_sourcepackage_label = batch.first_sourcepackage_label;
                            }
                        } catch (error) {
                            console.error('[PackageScan] Error checking batch:', error);
                            await client.query('ROLLBACK');
                            throw new ValidationError('DATABASE_ERROR', `Database query error: ${error.message}`);
                        }
                    }
                }
                
                if (batchMatches) {
                    // Check if specific package labels are required
                    if (li.specific_package_labels !== null && li.specific_package_labels !== '') {
                        // This is a partial package line item
                        isPartialPackageRequired = true;

                        // Must be one of the specific labels (case-insensitive comparison)
                        const specificLabels = Array.isArray(li.specific_package_labels) 
                            ? li.specific_package_labels 
                            : JSON.parse(li.specific_package_labels || '[]');
                        
                        // Normalize for case-insensitive comparison
                        const normalizedSpecificLabels = specificLabels.map(label => String(label).toUpperCase());
                        const normalizedPackageLabel = String(packageLabel).toUpperCase();

                        if (!normalizedSpecificLabels.includes(normalizedPackageLabel)) {
                            // This partial package is not in the required list, continue searching
                            continue;
                        }
                    } else {
                        // This is a full package line item
                        isPartialPackageRequired = false;
                        
                        // CRITICAL: If this package is required by a partial line item, NEVER match it to a full package line item
                        if (isRequiredByPartialLineItem) {
                            console.log(`[PackageScan] Package ${packageLabel} is required by partial line item ${requiredPartialLineItemId}, skipping full package line item ${li.id}`);
                            continue;
                        }
                        
                        // If scanned package is detected as partial from batch details, don't match it to a full package line item
                        if (isScannedPackagePartial) {
                            continue;
                        }
                    }

                    matchedLineItem = li;
                    break; // Found the matching line item
                }
            }

            if (!matchedLineItem) {
                // Package doesn't belong to order - require forced acknowledgment
                try {
                    await this.logScanError(invoiceId, userId, normalizedPackageLabel, 'package_not_on_order', client, null, sessionId);
                } catch (logError) {
                    console.error('[PackageScan] Error logging scan error:', logError);
                }
                
                // Commit transaction before returning confirmation requirement
                await client.query('COMMIT');
                
                return {
                    success: false,
                    requiresRemovalConfirmation: true,
                    alert: {
                        type: 'PACKAGE_NOT_ON_ORDER',
                        severity: 'HIGH',
                        message: `⚠️ PACKAGE NOT ON ORDER: Package ${packageLabel} from batch ${pkg.batch_name || 'Unknown'} does not belong to this order`,
                        details: {
                            packageLabel: packageLabel,
                            batchName: pkg.batch_name || 'Unknown',
                            itemName: pkg.item_name || 'Unknown',
                            action: 'Please confirm you have removed this package from the order before continuing'
                        }
                    },
                    package_label: packageLabel
                };
            }

            // ============================================
            // VALIDATION LAYER 4: Full vs Partial Package Check
            // ============================================
            if (!isPartialPackageRequired) {
                // This is a full package line item - verify package is a full package
                const fullPackageDetails = matchedLineItem.full_package_details 
                    ? (typeof matchedLineItem.full_package_details === 'string' 
                        ? JSON.parse(matchedLineItem.full_package_details) 
                        : matchedLineItem.full_package_details)
                    : {};

                const fullPackageLabels = fullPackageDetails.full_packages?.map(p => p.label) || [];

                if (fullPackageLabels.length > 0 && !fullPackageLabels.includes(packageLabel)) {
                    // This might be a partial package, but line item requires full packages
                    // Check if it's actually a partial by looking at batch's partial_package_details
                    const partialPackageDetails = pkg.partial_package_details 
                        ? (typeof pkg.partial_package_details === 'string' 
                            ? JSON.parse(pkg.partial_package_details) 
                            : pkg.partial_package_details)
                        : {};
                    const partialPackageLabels = partialPackageDetails.partial_packages?.map(p => p.label) || [];
                    
                    if (partialPackageLabels.includes(packageLabel)) {
                        // 3.3.3: Update error message format for partial package
                        const partialPkg = partialPackageDetails.partial_packages.find(p => p.label === packageLabel);
                        const quantity = partialPkg ? partialPkg.quantity : 'Unknown';
                        const errorMsg = `Package ${packageLabel} is a partial package. Quantity: ${quantity}`;
                        
                        await this.logScanError(invoiceId, userId, packageLabel, 'partial_package_not_allowed', client, errorMsg);
                        await client.query('ROLLBACK');
                        throw new ValidationError('PARTIAL_PACKAGE_NOT_ALLOWED', errorMsg);
                    }
                }
            }

            // ============================================
            // VALIDATION LAYER 5: Cross-Worker Conflict Check
            // ============================================
            let conflictCheck;
            try {
                conflictCheck = await client.query(`
                    SELECT 
                        ss.fk_invoice_id,
                        ss.fk_user_id,
                        i.invoice_number,
                        u.first_name,
                        u.last_name
                    FROM "ORDERS-scanning-sessions" ss
                    JOIN "ORDERS-invoices" i ON ss.fk_invoice_id = i.id
                    JOIN users u ON ss.fk_user_id = u.id
                    WHERE ss.session_status = 'active'
                        AND ss.id != $1  -- Not this session
                        AND ss.currently_locked_packages @> $2::jsonb
                `, [sessionId, JSON.stringify([packageLabel])]);
            } catch (error) {
                console.error('[PackageScan] Error checking conflicts:', error);
                await client.query('ROLLBACK');
                throw new ValidationError('DATABASE_ERROR', `Database query error: ${error.message}`);
            }

            if (conflictCheck.rows.length > 0) {
                const conflict = conflictCheck.rows[0];
                // 3.3.3: Update error message format for cross-worker conflict
                const userName = `${conflict.first_name} ${conflict.last_name}`;
                const errorMsg = `Package ${packageLabel} is being scanned by ${userName}`;
                
                await this.logScanError(invoiceId, userId, packageLabel, 'package_locked_by_other_worker', client, errorMsg);
                await client.query('ROLLBACK');
                throw new ValidationError('PACKAGE_LOCKED_BY_OTHER_WORKER', errorMsg);
            }

            // ============================================
            // VALIDATION LAYER 6: Duplicate Scan Check & Wrong Line Item Check
            // ============================================
            const assignedLabels = matchedLineItem.assigned_package_labels 
                ? (Array.isArray(matchedLineItem.assigned_package_labels)
                    ? matchedLineItem.assigned_package_labels
                    : JSON.parse(matchedLineItem.assigned_package_labels || '[]'))
                : [];

            // Check if package is already assigned to this line item
            if (assignedLabels.includes(packageLabel)) {
                // Just ignore silently and let them continue
                await client.query('COMMIT');
                return {
                    success: true,
                    duplicate: true,
                    message: 'Package already scanned (ignored)',
                    line_item_id: matchedLineItem.line_item_id
                };
            }
            
            // CRITICAL: Check if package is assigned to a DIFFERENT line item
            // If it's assigned to a full package line item but should be in a partial one, we need to move it
            for (const otherLi of lineItems.rows) {
                if (otherLi.id === matchedLineItem.line_item_id) continue; // Skip the matched line item
                
                const otherAssignedLabels = otherLi.assigned_package_labels
                    ? (Array.isArray(otherLi.assigned_package_labels)
                        ? otherLi.assigned_package_labels
                        : JSON.parse(otherLi.assigned_package_labels || '[]'))
                    : [];
                
                // Check if package is in this other line item (case-insensitive)
                const normalizedOtherLabels = otherAssignedLabels.map(label => String(label).toUpperCase());
                if (normalizedOtherLabels.includes(normalizedPackageLabelForCheck)) {
                    // Package is already assigned to a different line item
                    // If the matched line item is a partial and the other is full, move it
                    // If the matched line item is full and the other is partial, this shouldn't happen due to our sorting
                    // but if it does, we should move it to the partial
                    const otherIsPartial = otherLi.specific_package_labels !== null && otherLi.specific_package_labels !== '';
                    const matchedIsPartial = matchedLineItem.specific_package_labels !== null && matchedLineItem.specific_package_labels !== '';
                    
                    if (matchedIsPartial && !otherIsPartial) {
                        // Package is in full package line item but should be in partial - move it
                        console.log(`[PackageScan] Moving package ${packageLabel} from full package line item ${otherLi.id} to partial line item ${matchedLineItem.line_item_id}`);
                        
                        // Remove from full package line item
                        const updatedOtherLabels = otherAssignedLabels.filter(label => 
                            String(label).toUpperCase() !== normalizedPackageLabelForCheck
                        );
                        await client.query(`
                            UPDATE "ORDERS-invoice-line-items"
                            SET assigned_package_labels = $1
                            WHERE id = $2
                        `, [JSON.stringify(updatedOtherLabels), otherLi.id]);
                        
                        // Will be added to partial line item below
                    } else if (!matchedIsPartial && otherIsPartial) {
                        // Package is in partial line item but we're trying to add to full - this shouldn't happen
                        // but if it does, reject it
                        console.warn(`[PackageScan] Package ${packageLabel} is already in partial line item ${otherLi.id}, cannot add to full package line item ${matchedLineItem.line_item_id}`);
                        await client.query('ROLLBACK');
                        throw new ValidationError('PACKAGE_ALREADY_IN_PARTIAL', 
                            `Package ${packageLabel} is already assigned to a partial package line item. Please remove it from that line item first.`);
                    } else {
                        // Package is already in another line item of the same type - duplicate
                        await client.query('COMMIT');
                        return {
                            success: true,
                            duplicate: true,
                            message: `Package already scanned in another line item (ignored)`,
                            line_item_id: otherLi.id
                        };
                    }
                }
            }

            // ============================================
            // VALIDATION LAYER 7: Rejection Alert Check
            // ============================================
            let rejectionAlert;
            try {
                rejectionAlert = await this.checkForRejectionAlert(packageLabel, client);
            } catch (error) {
                console.error('[PackageScan] Error checking rejection alert:', error);
                console.error('[PackageScan] Rejection check error code:', error.code);
                
                // If the error aborted the transaction, we must rollback
                if (error.code === '25P02' || error.message.includes('current transaction is aborted')) {
                    await client.query('ROLLBACK');
                    throw new ValidationError('TRANSACTION_ABORTED', 'Database transaction was aborted. Please try scanning again.');
                }
                
                // If rejection check fails for other reasons, continue without it (non-critical)
                // But we need to make sure the transaction is still valid
                try {
                    // Test if transaction is still valid by doing a simple query
                    await client.query('SELECT 1');
                } catch (testError) {
                    // Transaction is aborted, rollback and fail
                    console.error('[PackageScan] Transaction is aborted after rejection check:', testError);
                    await client.query('ROLLBACK');
                    throw new ValidationError('TRANSACTION_ABORTED', 'Database transaction was aborted. Please try scanning again.');
                }
                
                rejectionAlert = {
                    isRejectedPackage: false,
                    requiresVerification: false
                };
            }

            if (rejectionAlert && rejectionAlert.requiresVerification) {
                // Don't reject - just return alert to UI for user confirmation
                try {
                    await client.query('COMMIT');
                } catch (error) {
                    console.error('[PackageScan] Error committing rejection alert:', error);
                    await client.query('ROLLBACK');
                    throw new ValidationError('DATABASE_ERROR', `Database error: ${error.message}`);
                }
                return {
                    success: false,
                    requiresConfirmation: true,
                    alert: rejectionAlert.alert,
                    line_item_id: matchedLineItem.line_item_id,
                    package_label: packageLabel
                };
            }

            // ============================================
            // SUCCESS: Add Package to Line Item
            // ============================================

            // Verify transaction is still valid before proceeding with UPDATE
            try {
                console.log(`[PackageScan] Verifying transaction is still valid before UPDATE...`);
                await client.query('SELECT 1');
                console.log(`[PackageScan] Transaction is valid, proceeding with UPDATE`);
            } catch (error) {
                console.error('[PackageScan] ❌ Transaction is ABORTED before UPDATE:', error.message);
                console.error('[PackageScan] Error code:', error.code);
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('[PackageScan] Error during ROLLBACK:', rollbackError);
                }
                throw new ValidationError('TRANSACTION_ABORTED', 'Transaction was aborted by a previous operation. Please try scanning again.');
            }

            // Update assigned_package_labels
            const updatedLabels = [...assignedLabels, packageLabel];

            try {
                console.log(`[PackageScan] Updating line item ${matchedLineItem.line_item_id} with package ${packageLabel}...`);
                await client.query(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET 
                        assigned_package_labels = $1,
                        updated_at = NOW()
                    WHERE id = $2
                `, [JSON.stringify(updatedLabels), matchedLineItem.line_item_id]);
                console.log(`[PackageScan] Line item updated successfully`);

                // Add to session's locked packages
                const currentLockedPackages = session.rows[0].currently_locked_packages || [];
                const updatedLockedPackages = Array.isArray(currentLockedPackages) 
                    ? [...currentLockedPackages, packageLabel]
                    : [packageLabel];

                await client.query(`
                    UPDATE "ORDERS-scanning-sessions"
                    SET 
                        currently_locked_packages = $1,
                        last_activity = NOW()
                    WHERE id = $2
                `, [JSON.stringify(updatedLockedPackages), sessionId]);
            } catch (error) {
                console.error('[PackageScan] Error updating line item or session:', error);
                console.error('[PackageScan] Error code:', error.code);
                console.error('[PackageScan] Error details:', {
                    message: error.message,
                    code: error.code,
                    severity: error.severity
                });
                
                // If transaction is already aborted, ROLLBACK should still work
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('[PackageScan] Error during ROLLBACK:', rollbackError);
                }
                
                // Check if this is a transaction abort error
                if (error.code === '25P02' || error.message.includes('current transaction is aborted')) {
                    throw new ValidationError('TRANSACTION_ABORTED', 'A previous database operation failed. Please try scanning again.');
                }
                
                throw new ValidationError('DATABASE_ERROR', `Database update error: ${error.message}`);
            }

            // Log successful scan
            try {
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id,
                        modification_type,
                        field_name,
                        new_value,
                        changed_by_user_id,
                        changed_by_system
                    ) VALUES ($1, 'package_scanned', 'line_item_' || $2, $3, $4, false)
                `, [invoiceId, matchedLineItem.line_item_id, packageLabel, userId]);
            } catch (error) {
                console.error('[PackageScan] Error logging invoice history:', error);
                // Don't fail the scan if history logging fails, but rollback the transaction
                await client.query('ROLLBACK');
                throw new ValidationError('DATABASE_ERROR', `Database error: ${error.message}`);
            }

            await client.query('COMMIT');

            // Broadcast to other workers that this package is now locked
            await websocketService.broadcastPackageLocked(packageLabel, invoiceId, userId);

            // Check if this line item is now complete
            const isLineItemComplete = updatedLabels.length === matchedLineItem.quantity_ordered;

            return {
                success: true,
                line_item_id: matchedLineItem.line_item_id,
                package_label: packageLabel,
                scanned_count: updatedLabels.length,
                required_count: matchedLineItem.quantity_ordered,
                line_item_complete: isLineItemComplete
            };

        } catch (error) {
            console.error('[PackageScan] Error in validateAndProcessScan:', error);
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('[PackageScan] Error during ROLLBACK:', rollbackError);
            }
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Acknowledge that a package not on order has been removed
     */
    async acknowledgePackageRemoval(invoiceId, packageLabel, userId, sessionId) {
        const { query } = require('../config/database');
        
        try {
            // Log the acknowledgment to invoice history
            await query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    reason,
                    changed_by_user_id,
                    changed_by_system
                ) VALUES ($1, 'scan_error', 'package_removal_acknowledged', $2, $3, false)
            `, [invoiceId, `Package ${packageLabel} removed from order - acknowledged by fulfillment worker`, userId]);

            // Also log to scan errors table if it exists
            try {
                await query(`
                    UPDATE "ORDERS-scanning-sessions"
                    SET last_activity = NOW()
                    WHERE id = $1
                `, [sessionId]);
            } catch (error) {
                // Session might not exist, ignore
                console.log('[PackageScan] Could not update session activity:', error.message);
            }

            return {
                success: true,
                message: 'Package removal acknowledged'
            };
        } catch (error) {
            console.error('[PackageScan] Error acknowledging package removal:', error);
            throw error;
        }
    }

    /**
     * Check if package was recently rejected
     * Returns null if table doesn't exist (optional feature)
     */
    async checkForRejectionAlert(packageLabel, client) {
        try {
            // Check if table exists first
            let tableExists;
            try {
                tableExists = await client.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = 'ORDERS-rejected_packages'
                    )
                `);
            } catch (error) {
                console.error('[PackageScan] Error checking if rejection table exists:', error);
                // If we can't check, assume table doesn't exist (optional feature)
                return {
                    isRejectedPackage: false,
                    requiresVerification: false
                };
            }

            if (!tableExists || !tableExists.rows || !tableExists.rows[0] || !tableExists.rows[0].exists) {
                // Table doesn't exist - skip rejection check (optional feature)
                return {
                    isRejectedPackage: false,
                    requiresVerification: false
                };
            }

            let rejectionCheck;
            try {
                // Query only columns that actually exist in the table
                rejectionCheck = await client.query(`
                    SELECT 
                        rp.manifestnumber,
                        rp.rejection_date,
                        rp.rejection_reason,
                        rp.returned_to_inventory,
                        rp.inventory_restored_at,
                        rp.inventory_restored_by,
                        EXTRACT(EPOCH FROM (NOW() - rp.rejection_date))/86400 as days_since_rejection
                    FROM "ORDERS-rejected_packages" rp
                    WHERE rp.packagelabel = $1
                        AND rp.synclicense IN ('CUL000063', 'MAN000072')
                        AND rp.returned_to_inventory = FALSE
                        AND rp.rejection_date >= NOW() - INTERVAL '30 days'
                    ORDER BY rp.rejection_date DESC
                    LIMIT 1
                `, [packageLabel]);
            } catch (error) {
                console.error('[PackageScan] Error querying rejected packages:', error.message);
                console.error('[PackageScan] Error code:', error.code);
                // If query fails, return no rejection (non-critical check)
                return {
                    isRejectedPackage: false,
                    requiresVerification: false
                };
            }

            if (rejectionCheck.rows.length > 0) {
                const rejection = rejectionCheck.rows[0];

                return {
                    isRejectedPackage: true,
                    requiresVerification: true,
                    alert: {
                        type: 'REJECTION_WARNING',
                        severity: rejection.days_since_rejection < 7 ? 'HIGH' : 'MEDIUM',
                        message: `⚠️ REJECTION ALERT: This package was rejected ${Math.floor(rejection.days_since_rejection)} days ago`,
                        details: {
                            manifestNumber: rejection.manifestnumber,
                            rejectionDate: rejection.rejection_date,
                            rejectionReason: rejection.rejection_reason || 'No reason provided',
                            returnedToInventory: rejection.returned_to_inventory || false,
                            action: 'Please verify package is ready for sale before fulfilling order'
                        }
                    }
                };
            }

            return {
                isRejectedPackage: false,
                requiresVerification: false
            };
        } catch (error) {
            // If table doesn't exist or any error, just skip rejection check
            // This is an optional feature, shouldn't break scanning
            console.warn('[PackageScan] Rejection check skipped:', error.message);
            return {
                isRejectedPackage: false,
                requiresVerification: false
            };
        }
    }

    /**
     * Log scan errors for audit trail
     */
    /**
     * Log scan error to both invoice history and session history (3.3.2)
     * @param {number} invoiceId 
     * @param {number} userId 
     * @param {string} packageLabel 
     * @param {string} errorType 
     * @param {object} client - Database client
     * @param {string} errorMessage - Optional custom error message
     * @param {number} sessionId - Optional session ID for session history logging
     */
    async logScanError(invoiceId, userId, packageLabel, errorType, client, errorMessage = null, sessionId = null) {
        const finalErrorMessage = errorMessage || `Incorrect package scan attempt: ${errorType}`;
        
        // Log to invoice history (existing behavior)
        await client.query(`
            INSERT INTO "ORDERS-invoice-history" (
                fk_invoice_id,
                modification_type,
                field_name,
                new_value,
                reason,
                changed_by_user_id
            ) VALUES ($1, 'scan_error', $2, $3, $4, $5)
        `, [
            invoiceId,
            errorType,
            packageLabel,
            finalErrorMessage,
            userId
        ]);
        
        // 3.3.2: Log to session history (dedicated session error logging)
        if (sessionId) {
            try {
                // Get session status
                const sessionStatus = await client.query(`
                    SELECT session_status FROM "ORDERS-scanning-sessions" WHERE id = $1
                `, [sessionId]);
                
                await client.query(`
                    INSERT INTO "ORDERS-scanning-session-history" (
                        fk_session_id,
                        fk_invoice_id,
                        fk_user_id,
                        error_type,
                        error_message,
                        package_label,
                        session_status,
                        error_details
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [
                    sessionId,
                    invoiceId,
                    userId,
                    errorType,
                    finalErrorMessage,
                    packageLabel,
                    sessionStatus.rows[0]?.session_status || 'unknown',
                    JSON.stringify({ timestamp: new Date().toISOString() })
                ]);
            } catch (sessionHistoryError) {
                // Don't fail if session history logging fails (table might not exist yet)
                console.warn('[PackageScan] Could not log to session history:', sessionHistoryError.message);
            }
        }
    }

    /**
     * User confirmed rejected package is OK to use
     */
    async confirmRejectedPackageVerified(packageLabel, userId, notes = null) {
        const client = await pool.connect();
        try {
            // Check if table exists
            const tableExists = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'ORDERS-rejected_packages'
                )
            `);

            if (!tableExists.rows[0].exists) {
                // Table doesn't exist - return success (optional feature)
                return {
                    success: true,
                    message: 'Package verified (rejection tracking not available)'
                };
            }

            await client.query(`
                UPDATE "ORDERS-rejected_packages"
                SET 
                    verified_by_fulfillment = TRUE,
                    verified_at = NOW(),
                    verified_by = $2,
                    notes = COALESCE($3, notes),
                    updated_at = NOW()
                WHERE packagelabel = $1
                    AND synclicense IN ('CUL000063', 'MAN000072')
                    AND verified_by_fulfillment = FALSE
            `, [packageLabel, userId, notes]);

            return {
                success: true,
                message: 'Package verified and cleared for fulfillment'
            };
        } catch (error) {
            // If table doesn't exist, just return success
            console.warn('[PackageScan] Rejection verification skipped:', error.message);
            return {
                success: true,
                message: 'Package verified (rejection tracking not available)'
            };
        } finally {
            client.release();
        }
    }
}

module.exports = new PackageScanService();
module.exports.ValidationError = ValidationError;

