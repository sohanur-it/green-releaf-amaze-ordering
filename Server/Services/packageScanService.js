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
            await client.query('BEGIN');

            // Update session activity timestamp
            await client.query(`
                UPDATE "ORDERS-scanning-sessions"
                SET last_activity = NOW()
                WHERE id = $1
            `, [sessionId]);

            // ============================================
            // VALIDATION LAYER 1: Session Active?
            // ============================================
            const session = await client.query(`
                SELECT session_status, currently_locked_packages
                FROM "ORDERS-scanning-sessions"
                WHERE id = $1
            `, [sessionId]);

            if (session.rows.length === 0 || session.rows[0].session_status !== 'active') {
                throw new ValidationError('SESSION_INACTIVE', 'Scanning session is not active');
            }

            // ============================================
            // VALIDATION LAYER 2: Package Exists in METRC?
            // ============================================
            // Handle both sync_license (production) and synclicense (development)
            const licenseColumn = await this.getActivePackagesLicenseColumn(client);
            
            // Build query with correct column name (licenseColumn is safe - comes from schema check)
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
                WHERE ap.label = $1
                    AND ap.${licenseColumn} IN ('CUL000063', 'MAN000072')
                    AND ap.isarchived = false
                    AND ap.isfinished = false
            `;
            
            const packageExists = await client.query(packageExistsQuery, [packageLabel, JSON.stringify([packageLabel])]);

            if (packageExists.rows.length === 0) {
                await this.logScanError(invoiceId, userId, packageLabel, 'package_not_found', client);
                throw new ValidationError(
                    'PACKAGE_NOT_FOUND',
                    `Package ${packageLabel} does not exist in active inventory`
                );
            }

            const pkg = packageExists.rows[0];

            // ============================================
            // VALIDATION LAYER 3: Which Line Item?
            // ============================================
            const lineItems = await client.query(`
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

            let matchedLineItem = null;
            let isPartialPackageRequired = false;

            // Try to match package to a line item
            for (const li of lineItems.rows) {
                // Check if package label is in this line item's batch
                // Method 1: Check if package's batch_name matches (if available)
                let batchMatches = false;
                
                if (pkg.batch_name && pkg.batch_name === li.batch_name) {
                    batchMatches = true;
                } else {
                    // Method 2: Check if package label is in batch's available_labels
                    // This is more reliable since batch_name from join might be null
                    if (li.batch_id) {
                        // Check if this package label exists in the batch's available_labels
                        // available_labels structure: {"labels": ["1A40...", "1A40...", ...]}
                        // So we need to check available_labels->'labels' @> [...]
                        const batchCheck = await client.query(`
                            SELECT id, batch_name, available_labels
                            FROM "ORDERS-batches"
                            WHERE id = $1
                                AND available_labels IS NOT NULL
                                AND (
                                    -- Handle object structure: {"labels": [...]}
                                    (jsonb_typeof(available_labels) = 'object' AND available_labels->'labels' @> $2::jsonb)
                                    -- Handle array structure: [...]
                                    OR (jsonb_typeof(available_labels) = 'array' AND available_labels @> $2::jsonb)
                                )
                        `, [li.batch_id, JSON.stringify([packageLabel])]);
                        
                        if (batchCheck.rows.length > 0) {
                            batchMatches = true;
                            // Update pkg.batch_name for consistency
                            pkg.batch_name = batchCheck.rows[0].batch_name;
                        }
                    }
                }
                
                if (batchMatches) {
                    matchedLineItem = li;

                    // Check if specific package labels are required
                    if (li.specific_package_labels !== null) {
                        isPartialPackageRequired = true;

                        // Must be one of the specific labels
                        const specificLabels = Array.isArray(li.specific_package_labels) 
                            ? li.specific_package_labels 
                            : JSON.parse(li.specific_package_labels || '[]');

                        if (!specificLabels.includes(packageLabel)) {
                            throw new ValidationError(
                                'WRONG_PARTIAL_PACKAGE',
                                `This line item requires specific partial packages. ${packageLabel} is not in the required list.`,
                                { allowedLabels: specificLabels }
                            );
                        }
                    }

                    break; // Found the matching line item
                }
            }

            if (!matchedLineItem) {
                await this.logScanError(invoiceId, userId, packageLabel, 'package_not_on_order', client);
                throw new ValidationError(
                    'PACKAGE_NOT_ON_ORDER',
                    `Package ${packageLabel} from batch ${pkg.batch_name} does not belong to any line item on this order`
                );
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
                        throw new ValidationError(
                            'PARTIAL_PACKAGE_NOT_ALLOWED',
                            `Package ${packageLabel} is a partial package, but this line item requires full packages only`
                        );
                    }
                }
            }

            // ============================================
            // VALIDATION LAYER 5: Cross-Worker Conflict Check
            // ============================================
            const conflictCheck = await client.query(`
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

            if (conflictCheck.rows.length > 0) {
                const conflict = conflictCheck.rows[0];
                throw new ValidationError(
                    'PACKAGE_LOCKED_BY_OTHER_WORKER',
                    `Package ${packageLabel} is currently being used by ${conflict.first_name} ${conflict.last_name} for Order ${conflict.invoice_number}`
                );
            }

            // ============================================
            // VALIDATION LAYER 6: Duplicate Scan Check
            // ============================================
            const assignedLabels = matchedLineItem.assigned_package_labels 
                ? (Array.isArray(matchedLineItem.assigned_package_labels)
                    ? matchedLineItem.assigned_package_labels
                    : JSON.parse(matchedLineItem.assigned_package_labels || '[]'))
                : [];

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

            // ============================================
            // VALIDATION LAYER 7: Rejection Alert Check
            // ============================================
            const rejectionAlert = await this.checkForRejectionAlert(packageLabel, client);

            if (rejectionAlert.requiresVerification) {
                // Don't reject - just return alert to UI for user confirmation
                await client.query('COMMIT');
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

            // Update assigned_package_labels
            const updatedLabels = [...assignedLabels, packageLabel];

            await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET 
                    assigned_package_labels = $1,
                    updated_at = NOW()
                WHERE id = $2
            `, [JSON.stringify(updatedLabels), matchedLineItem.line_item_id]);

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

            // Log successful scan
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
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Check if package was recently rejected
     * Returns null if table doesn't exist (optional feature)
     */
    async checkForRejectionAlert(packageLabel, client) {
        try {
            // Check if table exists first
            const tableExists = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'ORDERS-rejected_packages'
                )
            `);

            if (!tableExists.rows[0].exists) {
                // Table doesn't exist - skip rejection check (optional feature)
                return {
                    isRejectedPackage: false,
                    requiresVerification: false
                };
            }

            const rejectionCheck = await client.query(`
                SELECT 
                    rp.manifestnumber,
                    rp.rejection_date,
                    rp.rejected_by_facility,
                    rp.rejected_by_person,
                    rp.verified_by_fulfillment,
                    rp.notes,
                    EXTRACT(EPOCH FROM (NOW() - rp.rejection_date))/86400 as days_since_rejection
                FROM "ORDERS-rejected_packages" rp
                WHERE rp.packagelabel = $1
                    AND rp.synclicense IN ('CUL000063', 'MAN000072')
                    AND rp.verified_by_fulfillment = FALSE
                    AND rp.rejection_date >= NOW() - INTERVAL '30 days'
                ORDER BY rp.rejection_date DESC
                LIMIT 1
            `, [packageLabel]);

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
                            rejectedBy: rejection.rejected_by_person,
                            facility: rejection.rejected_by_facility,
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
    async logScanError(invoiceId, userId, packageLabel, errorType, client) {
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
            `Incorrect package scan attempt: ${errorType}`,
            userId
        ]);
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

