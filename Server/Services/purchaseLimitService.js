/**
 * Purchase Limit Service
 * 
 * Validates purchase limits with PostgreSQL advisory locks for concurrency protection
 */

const { query } = require('../config/database');

class PurchaseLimitError extends Error {
    constructor(violations) {
        super('Purchase limit validation failed');
        this.violations = violations;
    }
}

class PurchaseLimitService {
    /**
     * Validate purchase limits for an invoice
     * Uses PostgreSQL advisory locks to prevent race conditions
     */
    async validatePurchaseLimits(invoiceId, client = null) {
        const queryFunc = client ? client.query.bind(client) : query;
        
        try {
            // Get invoice details including source
            const invoice = await queryFunc(`
                SELECT fk_location_id, total, source
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);
            
            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }
            
            // Skip purchase limit validation for internal invoices
            // Purchase limits are only enforced for external portal orders
            const invoiceSource = invoice.rows[0].source || 'Internal';
            if (invoiceSource === 'Internal') {
                return; // No validation needed for internal invoices
            }
            
            const locationId = invoice.rows[0].fk_location_id;
            const orderTotal = parseFloat(invoice.rows[0].total);
            
            // CRITICAL: Acquire advisory lock for this location
            // This ensures only ONE purchase limit check happens at a time per location
            await queryFunc(`SELECT pg_advisory_xact_lock($1)`, [locationId]);
            
            // Get limits (or defaults)
            const limits = await queryFunc(`
                SELECT
                    COALESCE(max_order_total, 20000.00) as max_order_total,
                    COALESCE(max_unshipped_orders, 3) as max_unshipped_orders,
                    COALESCE(max_unpaid_invoices, 6) as max_unpaid_invoices
                FROM "ORDERS-purchase-limits"
                WHERE fk_location_id = $1
            `, [locationId]);
            
            const lim = limits.rows.length > 0 ? limits.rows[0] : {
                max_order_total: 20000.00,
                max_unshipped_orders: 3,
                max_unpaid_invoices: 6
            };
            
            const violations = [];
            
            // Check 1: Order total
            if (orderTotal > lim.max_order_total) {
                violations.push({
                    type: 'order_total_exceeded',
                    message: `Order total ($${orderTotal}) exceeds limit ($${lim.max_order_total})`,
                    limit: lim.max_order_total,
                    current: orderTotal
                });
            }
            
            // Check 2: Unshipped orders
            // Note: No FOR UPDATE needed - advisory lock already provides concurrency protection
            const unshipped = await queryFunc(`
                SELECT COUNT(*) as count
                FROM "ORDERS-invoices"
                WHERE fk_location_id = $1
                  AND status NOT IN ('Shipped', 'Delivered', 'Paid', 'Cancelled',
                                     'Cancelled_After_Ship', 'Fully_Rejected')
            `, [locationId]);
            
            const currentUnshipped = parseInt(unshipped.rows[0].count);
            
            if (currentUnshipped >= lim.max_unshipped_orders) {
                violations.push({
                    type: 'unshipped_limit_exceeded',
                    message: `Location has ${currentUnshipped} unshipped orders (limit: ${lim.max_unshipped_orders})`,
                    limit: lim.max_unshipped_orders,
                    current: currentUnshipped
                });
            }
            
            // Check 3: Unpaid invoices
            // Note: No FOR UPDATE needed - advisory lock already provides concurrency protection
            // Unpaid invoices are those that have been delivered but not yet paid
            const unpaid = await queryFunc(`
                SELECT COUNT(*) as count
                FROM "ORDERS-invoices"
                WHERE fk_location_id = $1
                  AND status IN ('Delivered', 'Partially_Rejected', 'Issue_After_Shipped')
                  AND status != 'Paid'
            `, [locationId]);
            
            const currentUnpaid = parseInt(unpaid.rows[0].count);
            
            if (currentUnpaid >= lim.max_unpaid_invoices) {
                violations.push({
                    type: 'unpaid_limit_exceeded',
                    message: `Location has ${currentUnpaid} unpaid invoices (limit: ${lim.max_unpaid_invoices})`,
                    limit: lim.max_unpaid_invoices,
                    current: currentUnpaid
                });
            }
            
            // Store validation result
            await queryFunc(`
                UPDATE "ORDERS-invoices"
                SET purchase_limit_validated = $1,
                    outstanding_invoice_count_at_creation = $2
                WHERE id = $3
            `, [violations.length === 0, currentUnshipped + currentUnpaid, invoiceId]);
            
            // Advisory lock is automatically released at transaction end
            
            if (violations.length > 0) {
                throw new PurchaseLimitError(violations);
            }
            
            return { valid: true };
        } catch (error) {
            if (error instanceof PurchaseLimitError) {
                throw error;
            }
            console.error('Error validating purchase limits:', error);
            throw error;
        }
    }

    /**
     * Get purchase limits for a location
     */
    async getPurchaseLimits(locationId) {
        try {
            const result = await query(`
                SELECT *
                FROM "ORDERS-purchase-limits"
                WHERE fk_location_id = $1
            `, [locationId]);
            
            if (result.rows.length === 0) {
                // Return defaults
                return {
                    max_order_total: 20000.00,
                    max_unshipped_orders: 3,
                    max_unpaid_invoices: 6
                };
            }
            
            const limits = result.rows[0];
            return {
                max_order_total: parseFloat(limits.max_order_total || 20000.00),
                max_unshipped_orders: parseInt(limits.max_unshipped_orders || 3),
                max_unpaid_invoices: parseInt(limits.max_unpaid_invoices || 6)
            };
        } catch (error) {
            console.error('Error getting purchase limits:', error);
            return {
                max_order_total: 20000.00,
                max_unshipped_orders: 3,
                max_unpaid_invoices: 6
            };
        }
    }

    /**
     * Update purchase limits for a location
     */
    async updatePurchaseLimits(locationId, limits, userId) {
        try {
            const result = await query(`
                INSERT INTO "ORDERS-purchase-limits" (
                    fk_location_id, max_order_total, max_unshipped_orders,
                    max_unpaid_invoices, last_modified_by, last_modified_at
                ) VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (fk_location_id)
                DO UPDATE SET
                    max_order_total = EXCLUDED.max_order_total,
                    max_unshipped_orders = EXCLUDED.max_unshipped_orders,
                    max_unpaid_invoices = EXCLUDED.max_unpaid_invoices,
                    last_modified_by = EXCLUDED.last_modified_by,
                    last_modified_at = EXCLUDED.last_modified_at
                RETURNING *
            `, [
                locationId,
                limits.max_order_total,
                limits.max_unshipped_orders,
                limits.max_unpaid_invoices,
                userId
            ]);
            
            return { success: true, limits: result.rows[0] };
        } catch (error) {
            console.error('Error updating purchase limits:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new PurchaseLimitService();

