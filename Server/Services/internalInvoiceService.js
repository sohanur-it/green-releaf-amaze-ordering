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
            
            // Validate sales rep access (placeholder - implement proper RBAC check)
            // const canCreate = await this.validateSalesRepAccess(salesRepId, invoiceData.fk_buyer_id, client);
            // if (!canCreate) {
            //     throw new Error('Sales rep not authorized for this buyer');
            // }
            
            // Generate invoice number
            const invoiceNumber = await this.generateInvoiceNumber(client);
            
            // Get location license number
            const locationResult = await client.query(`
                SELECT license_number FROM "ORDERS-buyer_locations" WHERE id = $1
            `, [invoiceData.fk_location_id]);
            
            if (locationResult.rows.length === 0) {
                throw new Error('Location not found');
            }
            
            const locationLicense = locationResult.rows[0].license_number;
            
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
            
            // Add line items with allocation
            for (const item of invoiceData.line_items) {
                await this.addLineItem(invoiceId, item, salesRepId, client);
            }
            
            // Calculate totals
            await this.recalculateTotals(invoiceId, client);
            
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
            await client.query('ROLLBACK');
            console.error('Error creating internal invoice:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Add line item to invoice with allocation
     */
    async addLineItem(invoiceId, itemData, userId, client) {
        // Get batch info and pricing
        const batch = await client.query(`
            SELECT b.id, b.batch_name, b.fk_master_product_id, b.quantity,
                   b.allocated_quantity,
                   COALESCE(b.override_price, p.default_price, 0) as unit_price
            FROM "ORDERS-batches" b
            LEFT JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
            WHERE b.id = $1
            FOR UPDATE
        `, [itemData.fk_batch_id]);
        
        if (batch.rows.length === 0) {
            throw new Error('Batch not found');
        }
        
        const b = batch.rows[0];
        const available = b.quantity - b.allocated_quantity;
        
        if (available < itemData.quantity) {
            throw new Error(
                `Insufficient inventory. Available: ${available}, Requested: ${itemData.quantity}`
            );
        }
        
        // Handle partial packages if specified
        let specificLabels = null;
        if (itemData.partial_packages_selected && itemData.partial_packages_selected.length > 0) {
            specificLabels = itemData.partial_packages_selected;
            
            // Validate partial packages exist in METRC
            for (const label of specificLabels) {
                const exists = await client.query(`
                    SELECT metrcid FROM activepackages
                    WHERE label = $1
                      AND synclicense IN ('CUL000063', 'MAN000072')
                `, [label]);
                
                if (exists.rows.length === 0) {
                    throw new Error(
                        `Partial package ${label} is no longer available`
                    );
                }
            }
        }
        
        // Get invoice location for standing discount check
        const invoiceResult = await client.query(
            'SELECT fk_location_id FROM "ORDERS-invoices" WHERE id = $1', [invoiceId]
        );
        const locationId = invoiceResult.rows[0].fk_location_id;
        
        // Check for standing discount
        const standingDiscount = await discountService.getApplicableStandingDiscount(
            locationId, b.fk_master_product_id, client
        );
        
        let unitPrice = parseFloat(b.unit_price);
        let lineTotal = unitPrice * itemData.quantity;
        let discountAmount = 0;
        let standingDiscountId = null;
        
        if (standingDiscount) {
            discountAmount = discountService.calculateDiscount(
                standingDiscount, unitPrice, itemData.quantity
            );
            lineTotal -= discountAmount;
            standingDiscountId = standingDiscount.id;
        }
        
        // Create line item
        const lineItem = await client.query(`
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
        
        // Allocate from batch (using allocation service for proper WebSocket broadcasts)
        const allocationService = require('./allocationService');
        
        // Update quantity_allocated on line item first
        await client.query(`
            UPDATE "ORDERS-invoice-line-items"
            SET quantity_allocated = $1
            WHERE id = $2
        `, [itemData.quantity, lineItem.rows[0].id]);
        
        // Allocate from batch and broadcast via WebSocket
        const oldAllocated = b.allocated_quantity;
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
        
        return lineItem.rows[0].id;
    }

    /**
     * Recalculate invoice totals
     */
    async recalculateTotals(invoiceId, client) {
        const totals = await client.query(`
            SELECT 
                COALESCE(SUM(line_total), 0) as subtotal
            FROM "ORDERS-invoice-line-items"
            WHERE fk_invoice_id = $1
        `, [invoiceId]);
        
        const subtotal = parseFloat(totals.rows[0].subtotal);
        
        await client.query(`
            UPDATE "ORDERS-invoices"
            SET subtotal = $1, total = $1
            WHERE id = $2
        `, [subtotal, invoiceId]);
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
     * Close database connections
     */
    async close() {
        await this.pool.end();
    }
}

module.exports = new InternalInvoiceService();

