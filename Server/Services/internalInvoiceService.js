/**
 * Internal Invoice Service
 * 
 * Handles invoice creation and management for internal sales representatives
 * Includes line item management with allocation and discount calculation
 */

const { query } = require('../config/database');
const { Pool } = require('pg');
const path = require('path');
const allocationService = require('./allocationService');
const discountService = require('./discountService');
const lineItemHistoryService = require('./lineItemHistoryService');

class InternalInvoiceService {
    constructor() {
        // Determine environment
        const nodeEnv = process.env.NODE_ENV || 'development';
        let envPath;

        if (nodeEnv === 'production') {
            envPath = path.join(__dirname, '../../config/production.env');
        } else {
            envPath = path.join(__dirname, '../../config/local.env');
        }

        // Load environment variables
        require('dotenv').config({ path: envPath });

        const isDevelopment = nodeEnv !== 'production';

        this.pool = new Pool({
            user: process.env.DB_USER || 'postgres',
            host: process.env.DB_HOST || 'localhost',
            database: process.env.DB_DATABASE || 'green_releaf_dev',
            password: process.env.DB_PASSWORD || 'postgres',
            port: parseInt(process.env.DB_PORT, 10) || 5432,
            ...(isDevelopment ? {} : {
                ssl: { rejectUnauthorized: false }
            })
        });
    }

    /**
     * Create new internal invoice
     */
    async createInvoice(salesRepId, invoiceData) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Validate sales rep access to buyer/location
            // Note: This is a basic check - full authorization is also validated in the controller
            // This provides an additional layer of security at the service level
            const canCreate = await this.validateSalesRepAccess(salesRepId, invoiceData.fk_buyer_id, invoiceData.fk_location_id, client);
            if (!canCreate) {
                await client.query('ROLLBACK');
                throw new Error('Sales rep not authorized for this buyer/location');
            }
            
            // Generate invoice number
            const invoiceNumber = await this.generateInvoiceNumber(client);
            
            // Get location license number
            const locationResult = await client.query(`
                SELECT state_license FROM "ORDERS-buyer_locations" WHERE entry_id = $1
            `, [invoiceData.fk_location_id]);
            
            if (locationResult.rows.length === 0) {
                throw new Error('Location not found');
            }
            
            const locationLicense = locationResult.rows[0].state_license || null;
            
            // Create invoice record
            const invoice = await client.query(`
                INSERT INTO "ORDERS-invoices" (
                    invoice_number, fk_buyer_id, fk_location_id,
                    location_license_number, source, created_by_user_id,
                    assigned_sales_rep_id, status
                ) VALUES ($1, $2, $3, $4, 'Internal', $5, $5, 'Draft')
                RETURNING id
            `, [
                invoiceNumber, 
                invoiceData.fk_buyer_id, 
                invoiceData.fk_location_id,
                locationLicense, 
                salesRepId
            ]);
            
            const invoiceId = invoice.rows[0].id;
            console.log(`✅ Invoice created with ID: ${invoiceId}, Invoice Number: ${invoiceNumber}`);
            
            // Add line items with allocation
            for (let i = 0; i < invoiceData.line_items.length; i++) {
                const item = invoiceData.line_items[i];
                try {
                    console.log(`📦 Adding line item ${i + 1}/${invoiceData.line_items.length}: batch_id=${item.fk_batch_id}, quantity=${item.quantity}`);
                    await this.addLineItem(invoiceId, item, salesRepId, client);
                    console.log(`✅ Line item ${i + 1} added successfully`);
                } catch (lineItemError) {
                    console.error(`❌ Error adding line item ${i + 1}:`, lineItemError.message);
                    console.error('  - Batch ID:', item.fk_batch_id);
                    console.error('  - Quantity:', item.quantity);
                    console.error('  - Error stack:', lineItemError.stack);
                    throw lineItemError; // Re-throw to trigger rollback
                }
            }
            
            // Calculate totals
            await this.recalculateTotals(invoiceId, client);
            
            // Purchase limit validation is skipped for internal invoices
            // Purchase limits are only enforced for external portal orders
            // The validation service will check the invoice source and skip validation for internal invoices
            
            // Log history
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id, modification_type, reason, changed_by_user_id, changed_by_system
                ) VALUES ($1, 'invoice_created', 'Internal invoice created', $2, false)
            `, [invoiceId, salesRepId]);
            
            await client.query('COMMIT');
            
            // Broadcast inventory updates for all affected batches (after commit)
            try {
                for (const item of invoiceData.line_items) {
                    const allocationService = require('./allocationService');
                    const newAvailable = await allocationService.getAvailableQuantity(item.fk_batch_id);
                    await allocationService.broadcastInventoryUpdate(item.fk_batch_id, newAvailable);
                }
            } catch (wsError) {
                console.error('WebSocket broadcast error (non-critical):', wsError.message);
            }
            
            return { success: true, invoice_id: invoiceId, invoice_number: invoiceNumber };
        } catch (error) {
            // Ensure transaction is rolled back
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Error during rollback:', rollbackError);
            }
            
            // Log detailed error information
            console.error('❌ Error creating internal invoice:');
            console.error('  - Error message:', error.message);
            console.error('  - Error stack:', error.stack);
            console.error('  - Sales Rep ID:', salesRepId);
            console.error('  - Buyer ID:', invoiceData.fk_buyer_id);
            console.error('  - Location ID:', invoiceData.fk_location_id);
            console.error('  - Line items count:', invoiceData.line_items?.length || 0);
            
            // Re-throw with more context
            const enhancedError = new Error(`Failed to create internal invoice: ${error.message}`);
            enhancedError.originalError = error;
            enhancedError.context = {
                salesRepId,
                buyerId: invoiceData.fk_buyer_id,
                locationId: invoiceData.fk_location_id,
                lineItemsCount: invoiceData.line_items?.length || 0
            };
            throw enhancedError;
        } finally {
            client.release();
        }
    }

    /**
     * Add line item to invoice with allocation
     */
    async addLineItem(invoiceId, itemData, userId, client) {
        // Get batch info and pricing
        // Use INNER JOIN instead of LEFT JOIN to avoid FOR UPDATE on nullable side
        const batch = await client.query(`
            SELECT b.id, b.batch_name, b.fk_master_product_id, b.quantity,
                   b.allocated_quantity,
                   COALESCE(b.override_price, p.default_price, 0) as unit_price
            FROM "ORDERS-batches" b
            INNER JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
            WHERE b.id = $1
            FOR UPDATE OF b
        `, [itemData.fk_batch_id]);
        
        if (batch.rows.length === 0) {
            throw new Error('Batch not found');
        }
        
        const b = batch.rows[0];
        
        // Handle partial packages if specified
        let specificLabels = null;
        if (itemData.partial_packages_selected && itemData.partial_packages_selected.length > 0) {
            specificLabels = itemData.partial_packages_selected;
            
            // For partial packages, skip batch availability check
            // Instead, validate that each partial package exists in METRC and belongs to the batch
            for (const label of specificLabels) {
                // Check if package exists in activepackages
                const licenseColumnCheck = await client.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'activepackages' 
                    AND column_name IN ('synclicense', 'sync_license')
                    LIMIT 1
                `);
                const licenseColumn = licenseColumnCheck.rows[0]?.column_name || 'synclicense';
                
                const packageExists = await client.query(`
                    SELECT label, quantity, ${licenseColumn} as synclicense
                    FROM activepackages
                    WHERE UPPER(label) = UPPER($1)
                      AND ${licenseColumn} IN ('CUL000063', 'MAN000072')
                      AND isarchived = false
                      AND isfinished = false
                `, [label]);
                
                if (packageExists.rows.length === 0) {
                    throw new Error(
                        `Partial package ${label} is no longer available in METRC`
                    );
                }
                
                // Validate package belongs to the batch
                // Check in partial_package_details (JSONB array of partial packages)
                // Also check available_labels, sourcepackagelabels, and first_sourcepackage_label as fallback
                const batchCheck = await client.query(`
                    SELECT id
                    FROM "ORDERS-batches"
                    WHERE id = $1
                        AND (
                            -- Check in partial_package_details JSONB array (structure: {"partial_packages": [{"label": "...", "quantity": ...}]})
                            (partial_package_details IS NOT NULL 
                             AND EXISTS (
                                 SELECT 1 
                                 FROM jsonb_array_elements(partial_package_details->'partial_packages') AS pkg
                                 WHERE pkg->>'label' = $2
                             ))
                            -- Check in available_labels (contains all package labels as array)
                            OR (available_labels IS NOT NULL 
                                AND (
                                    (available_labels->'labels' IS NOT NULL 
                                     AND available_labels->'labels' @> $3::jsonb)
                                    OR available_labels @> $3::jsonb
                                ))
                            -- Check in sourcepackagelabels text field
                            OR (sourcepackagelabels IS NOT NULL 
                                AND sourcepackagelabels LIKE '%' || $2 || '%')
                            -- Check first_sourcepackage_label
                            OR (first_sourcepackage_label = $2)
                        )
                `, [
                    itemData.fk_batch_id, 
                    label.toUpperCase(), // For text searches and label comparison
                    JSON.stringify([label.toUpperCase()]) // For JSONB array checks
                ]);
                
                if (batchCheck.rows.length === 0) {
                    throw new Error(
                        `Partial package ${label} does not belong to batch ${b.batch_name}`
                    );
                }
            }
        } else {
            // For full packages, check batch availability
            const available = b.quantity - b.allocated_quantity;
            
            if (available < itemData.quantity) {
                throw new Error(
                    `Insufficient inventory. Available: ${available}, Requested: ${itemData.quantity}`
                );
            }
        }
        
            // Get invoice location for standing discount check
            console.log(`  🔍 Fetching invoice location...`);
            const invoiceResult = await client.query(
                'SELECT fk_location_id FROM "ORDERS-invoices" WHERE id = $1', [invoiceId]
            );
            
            if (invoiceResult.rows.length === 0) {
                throw new Error(`Invoice not found: invoice_id=${invoiceId}`);
            }
            
            const locationId = invoiceResult.rows[0].fk_location_id;
            console.log(`  ✅ Location ID: ${locationId}`);
            
            // Check for standing discount
            console.log(`  🔍 Checking standing discount for location ${locationId}, product ${b.fk_master_product_id}...`);
            const standingDiscount = await discountService.getApplicableStandingDiscount(
                locationId, b.fk_master_product_id, client
            );
            console.log(`  ✅ Standing discount check complete`);
        
        // For partial packages or price-overridden items with manual pricing, use the manual total instead of calculating
        let unitPrice = parseFloat(b.unit_price);
        let lineTotal;
        let discountAmount = 0;
        let standingDiscountId = null;
        
        // Check if manual_line_total is explicitly provided (including 0)
        // Use a flag to distinguish between "not provided" (null/undefined) and "explicitly set to 0"
        const hasManualPricing = itemData.manual_line_total !== null && itemData.manual_line_total !== undefined;
        
        console.log('Processing line item:', {
            batch_id: itemData.fk_batch_id,
            quantity: itemData.quantity,
            hasManualPricing,
            manual_line_total: itemData.manual_line_total,
            partial_packages_selected: itemData.partial_packages_selected,
            default_unit_price: b.unit_price
        });
        
        if (hasManualPricing) {
            // Manual pricing (for partial packages or price-overridden full packages)
            lineTotal = parseFloat(itemData.manual_line_total);
            // For partial packages, set unit price to 0; for price-overridden full packages, calculate unit price from total
            if (itemData.partial_packages_selected && itemData.partial_packages_selected.length > 0) {
                unitPrice = 0; // Partial packages with manual pricing
            } else {
                // Price-overridden full package: calculate unit price from total
                unitPrice = itemData.quantity > 0 ? lineTotal / itemData.quantity : 0;
            }
            // Skip discount calculation for manually priced items
            console.log('Using manual pricing:', { unitPrice, lineTotal, isPartial: !!itemData.partial_packages_selected });
        } else {
            // Standard calculation for full packages without manual pricing
            lineTotal = unitPrice * itemData.quantity;
            
            if (standingDiscount) {
                discountAmount = discountService.calculateDiscount(
                    standingDiscount, unitPrice, itemData.quantity
                );
                lineTotal -= discountAmount;
                standingDiscountId = standingDiscount.id;
            }
        }
        
        // Check if invoice is in Fulfillment_Issue status
        const invoiceStatus = await client.query(`
            SELECT status FROM "ORDERS-invoices" WHERE id = $1
        `, [invoiceId]);
        const isFulfillmentIssue = invoiceStatus.rows.length > 0 && invoiceStatus.rows[0].status === 'Fulfillment_Issue';
        
        // Check if fulfillment_issue_modification column exists
        const columnCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'ORDERS-invoice-line-items' 
            AND column_name = 'fulfillment_issue_modification'
        `);
        const hasColumn = columnCheck.rows.length > 0;

        // Create line item
        let lineItem;
        if (hasColumn && isFulfillmentIssue) {
            lineItem = await client.query(`
                INSERT INTO "ORDERS-invoice-line-items" (
                    fk_invoice_id, fk_master_product_id, fk_batch_id,
                    quantity_ordered, quantity_allocated, unit_price,
                    line_discount_amount, line_total, standing_discount_applied,
                    standing_discount_id, specific_package_labels, line_item_order,
                    fulfillment_issue_modification
                ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10,
                          (SELECT COALESCE(MAX(line_item_order), 0) + 1
                           FROM "ORDERS-invoice-line-items" WHERE fk_invoice_id = $1),
                          $11)
                RETURNING id
            `, [
                invoiceId, 
                b.fk_master_product_id, 
                itemData.fk_batch_id,
                itemData.quantity,
                unitPrice,
                discountAmount,
                lineTotal,
                standingDiscount !== null,
                standingDiscountId,
                specificLabels ? JSON.stringify(specificLabels) : null,
                true // fulfillment_issue_modification
            ]);
        } else {
            lineItem = await client.query(`
                INSERT INTO "ORDERS-invoice-line-items" (
                    fk_invoice_id, fk_master_product_id, fk_batch_id,
                    quantity_ordered, quantity_allocated, unit_price,
                    line_discount_amount, line_total, standing_discount_applied,
                    standing_discount_id, specific_package_labels, line_item_order
                ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10,
                          (SELECT COALESCE(MAX(line_item_order), 0) + 1
                           FROM "ORDERS-invoice-line-items" WHERE fk_invoice_id = $1))
                RETURNING id
            `, [
                invoiceId, 
                b.fk_master_product_id, 
                itemData.fk_batch_id,
                itemData.quantity,
                unitPrice,
                discountAmount,
                lineTotal,
                standingDiscount !== null,
                standingDiscountId,
                specificLabels ? JSON.stringify(specificLabels) : null
            ]);
        }
        
        await lineItemHistoryService.addLineItemHistoryEntry({
            client,
            lineItemId: lineItem.rows[0].id,
            modificationType: 'created',
            fieldChanged: null,
            oldValue: null,
            newValue: JSON.stringify({
                quantity_ordered: itemData.quantity,
                unit_price: unitPrice,
                line_discount_amount: discountAmount,
                line_total: lineTotal
            }),
            reason: 'Line item added to invoice',
            changedByUserId: userId,
            changedBySystem: !userId
        });
        
        // Allocate from batch (using allocation service for proper WebSocket broadcasts)
        const allocationService = require('./allocationService');
        
        // Section 17.3.1: Update quantity_allocated on line item with allocation timestamp tracking
        await client.query(`
            UPDATE "ORDERS-invoice-line-items"
            SET 
                quantity_allocated = $1,
                allocated_at = CASE 
                    WHEN allocated_at IS NULL THEN NOW()
                    ELSE allocated_at
                END
            WHERE id = $2
        `, [itemData.quantity, lineItem.rows[0].id]);
        
        // For partial packages, don't increment batch allocated_quantity
        // Partial packages are individual packages that don't affect batch inventory
        if (!specificLabels || specificLabels.length === 0) {
            // Only allocate from batch for full packages
            const oldAllocated = b.allocated_quantity;
            const available = b.quantity - b.allocated_quantity;
            
            await client.query(`
                UPDATE "ORDERS-batches"
                SET allocated_quantity = allocated_quantity + $1
                WHERE id = $2
            `, [itemData.quantity, itemData.fk_batch_id]);
            
            // Log batch history
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id, change_type, field_name,
                    old_value, new_value, reason,
                    related_invoice_id, changed_by_system
                ) VALUES ($1, 'allocation_increased', 'allocated_quantity',
                          $2, $3, 'Allocated to internal invoice', $4, true)
            `, [
                itemData.fk_batch_id, 
                oldAllocated,
                oldAllocated + itemData.quantity, 
                invoiceId
            ]);
            
            // Broadcast inventory update via WebSocket (after transaction commits)
            // Note: We do this outside the transaction to avoid issues
            const newAvailable = available - itemData.quantity;
            try {
                // Use allocation service's broadcast method which handles WebSocket
                await allocationService.broadcastInventoryUpdate(itemData.fk_batch_id, newAvailable);
            } catch (wsError) {
                console.error('WebSocket broadcast error (non-critical):', wsError.message);
                // Don't fail the allocation if WebSocket broadcast fails
            }
        }
        
        return lineItem.rows[0].id;
    }

    /**
     * Recalculate invoice totals
     * Applies account credits if available (Module 4 requirement)
     */
    async recalculateTotals(invoiceId, client) {
        // Calculate subtotal and discount_amount from line items
        // Note: line_total already has discounts applied, so we need to calculate:
        // - subtotal = sum of (unit_price * quantity) = original subtotal before discounts
        // - discount_amount = sum of line_discount_amount
        // - total = subtotal - discount_amount - credit_applied
        const totals = await client.query(`
            SELECT 
                COALESCE(SUM(line_total), 0) as discounted_subtotal,
                COALESCE(SUM(line_discount_amount), 0) as discount_amount
            FROM "ORDERS-invoice-line-items"
            WHERE fk_invoice_id = $1
        `, [invoiceId]);
        
        const discountedSubtotal = parseFloat(totals.rows[0].discounted_subtotal);
        const discountAmount = parseFloat(totals.rows[0].discount_amount);
        
        // Original subtotal (before discounts) = discounted_subtotal + discount_amount
        const subtotal = discountedSubtotal + discountAmount;
        
        // Get invoice location for credit check
        const invoiceResult = await client.query(`
            SELECT fk_location_id, credit_applied
            FROM "ORDERS-invoices"
            WHERE id = $1
        `, [invoiceId]);
        
        if (invoiceResult.rows.length === 0) {
            throw new Error('Invoice not found');
        }
        
        const locationId = invoiceResult.rows[0].fk_location_id;
        const existingCreditApplied = parseFloat(invoiceResult.rows[0].credit_applied || 0);
        
        // Check for available account credits and apply if not already applied
        // Only auto-apply if credits haven't been manually applied yet
        let creditApplied = existingCreditApplied;
        if (existingCreditApplied === 0 && subtotal > 0) {
            try {
                const accountCreditService = require('./accountCreditService');
                const creditResult = await accountCreditService.applyCreditsToInvoice(invoiceId, client);
                if (creditResult.success) {
                    creditApplied = parseFloat(creditResult.applied || 0);
                }
            } catch (creditError) {
                // If credit application fails, continue without credits
                // This ensures invoice totals are still calculated correctly
                console.warn(`Could not apply account credits to invoice ${invoiceId}:`, creditError.message);
            }
        }
        
        // Calculate final total: total = subtotal - discount_amount - credit_applied
        // This matches the constraint: total = subtotal - discount_amount - credit_applied
        const total = subtotal - discountAmount - creditApplied;
        
        await client.query(`
            UPDATE "ORDERS-invoices"
            SET 
                subtotal = $1,
                discount_amount = $2,
                total = $3,
                credit_applied = $4,
                updated_at = NOW()
            WHERE id = $5
        `, [subtotal, discountAmount, total, creditApplied, invoiceId]);
    }

    /**
     * Generate unique invoice number
     */
    async generateInvoiceNumber(client) {
        const year = new Date().getFullYear();
        const result = await client.query(`
            SELECT COUNT(*) as count
            FROM "ORDERS-invoices"
            WHERE invoice_number LIKE $1
        `, [`INV-${year}-%`]);
        
        const count = parseInt(result.rows[0].count || 0) + 1;
        return `INV-${year}-${String(count).padStart(5, '0')}`;
    }

    /**
     * Submit invoice for fulfillment
     */
    async submitForFulfillment(invoiceId, userId) {
        const invoiceStateMachine = require('./invoiceStateMachineService');
        return await invoiceStateMachine.transitionTo(
            invoiceId, 
            'Approved', 
            userId, 
            'Internal order submitted'
        );
    }

    /**
     * Validate sales rep access to buyer/location
     * Module 4 requirement: Authorization check at service level
     * @param {number} salesRepId - Sales rep user ID
     * @param {number} buyerId - Buyer ID
     * @param {number} locationId - Location ID
     * @param {Object} client - Database client
     * @returns {Promise<boolean>} - True if authorized
     */
    async validateSalesRepAccess(salesRepId, buyerId, locationId, client) {
        try {
            // Check if user is admin/superuser (admins can create for any buyer)
            const userCheck = await client.query(`
                SELECT id, username
                FROM users
                WHERE id = $1
            `, [salesRepId]);
            
            if (userCheck.rows.length === 0) {
                return false;
            }
            
            // Check if user is superuser (bypass authorization)
            const UserModel = require('../Models/userModel');
            const isSuperuser = await UserModel.isSuperuser(salesRepId);
            if (isSuperuser) {
                return true;
            }
            
            // Check user roles
            const userRoles = await UserModel.getUserRoles(salesRepId);
            const userRoleNames = userRoles.map(r => r.name || r.role_name).filter(Boolean);
            const isAdmin = userRoleNames.some(r => r.toLowerCase() === 'administrator');
            const isSalesAdmin = userRoleNames.some(r => r.toLowerCase() === 'sales admin');
            
            // Admins and Sales Admins can create for any buyer
            if (isAdmin || isSalesAdmin) {
                return true;
            }
            
            // For Sales Reps, check if they have access to this buyer/location
            // Check if assigned_sales_rep_id column exists on buyer_locations table
            let hasLocationSalesRepColumn = false;
            try {
                const columnCheck = await client.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'ORDERS-buyer_locations' 
                    AND column_name = 'assigned_sales_rep_id'
                `);
                hasLocationSalesRepColumn = columnCheck.rows.length > 0;
            } catch (err) {
                // Column might not exist, use fallback
                console.warn('Could not check for assigned_sales_rep_id column:', err.message);
            }
            
            if (hasLocationSalesRepColumn) {
                // Check if location is assigned to this sales rep OR buyer is assigned to this sales rep
                const accessCheck = await client.query(`
                    SELECT 
                        l.entry_id,
                        l.assigned_sales_rep_id,
                        ba.fk_sales_rep_id
                    FROM "ORDERS-buyer_locations" l
                    LEFT JOIN "ORDERS-buyer_sales_rep_assignments" ba ON l.orders_buyer_id = ba.fk_buyer_id
                    LEFT JOIN "ORDERS-sales_reps" sr ON ba.fk_sales_rep_id = sr.entry_id
                    WHERE l.entry_id = $1
                      AND (
                          l.assigned_sales_rep_id = $2
                          OR sr.email = (SELECT email FROM users WHERE id = $2)
                      )
                `, [locationId, salesRepId]);
                return accessCheck.rows.length > 0;
            } else {
                // Fallback: check buyer assignments only
                const accessCheck = await client.query(`
                    SELECT ba.entry_id
                    FROM "ORDERS-buyer_sales_rep_assignments" ba
                    INNER JOIN "ORDERS-sales_reps" sr ON ba.fk_sales_rep_id = sr.entry_id
                    WHERE ba.fk_buyer_id = $1
                      AND sr.email = (SELECT email FROM users WHERE id = $2)
                `, [buyerId, salesRepId]);
                return accessCheck.rows.length > 0;
            }
        } catch (error) {
            console.error('Error validating sales rep access:', error);
            // Fail secure: deny access on error
            return false;
        }
    }

    /**
     * Close database connections
     */
    async close() {
        await this.pool.end();
    }
}

module.exports = new InternalInvoiceService();

