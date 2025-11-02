/**
 * Discount Service
 * 
 * Handles standing discounts and manual discounts for invoices
 */

const { query } = require('../config/database');

class DiscountService {
    /**
     * Get applicable standing discount for a location and product
     */
    async getApplicableStandingDiscount(locationId, productId, client = null) {
        const clientToUse = client || query;
        const queryFunc = client ? client.query.bind(client) : query;
        
        try {
            const result = await queryFunc(`
                SELECT *
                FROM "orders-standing-discounts"
                WHERE fk_location_id = $1
                  AND fk_master_product_id = $2
                  AND is_active = true
                  AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
                  AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
                ORDER BY created_at DESC
                LIMIT 1
            `, [locationId, productId]);
            
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error getting standing discount:', error);
            return null;
        }
    }

    /**
     * Calculate discount amount based on discount type
     * @param {Object} discount - The discount object
     * @param {number} unitPrice - Unit price
     * @param {number} quantity - Quantity ordered
     * @returns {number} - Discount amount
     */
    calculateDiscount(discount, unitPrice, quantity) {
        if (!discount) return 0;
        
        switch (discount.discount_type) {
            case 'Percentage':
                return (unitPrice * quantity * parseFloat(discount.discount_value)) / 100;
            
            case 'Fixed_Amount':
                // Fixed amount is per line item, not per unit
                return parseFloat(discount.discount_value);
            
            case 'BOGO':
                // Buy X, get Y at discount%
                const buyQty = discount.bogo_buy_quantity || 1;
                const getQty = discount.bogo_get_quantity || 1;
                const discountPercent = parseFloat(discount.bogo_discount_percent || 100);
                
                // How many full BOGO cycles?
                const cycles = Math.floor(quantity / (buyQty + getQty));
                // How many items in cycles get the discount?
                const discountedItems = cycles * getQty;
                
                return (unitPrice * discountedItems * discountPercent) / 100;
            
            default:
                return 0;
        }
    }

    /**
     * Apply manual discount to a line item
     * Requires Sales Admin permission
     */
    async applyManualDiscount(lineItemId, discountAmount, reason, userId, client = null) {
        const queryFunc = client ? client.query.bind(client) : query;
        
        try {
            // Get line item details
            const lineItemResult = await queryFunc(`
                SELECT 
                    li.*,
                    i.fk_location_id,
                    i.status
                FROM "ORDERS-invoice-line-items" li
                INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                WHERE li.id = $1
            `, [lineItemId]);
            
            if (lineItemResult.rows.length === 0) {
                return { success: false, error: 'Line item not found' };
            }
            
            const lineItem = lineItemResult.rows[0];
            
            // Check if line item is in a state that allows modification
            const allowableStatuses = ['Draft', 'Pending_Approval'];
            if (!allowableStatuses.includes(lineItem.status)) {
                return {
                    success: false,
                    error: `Cannot apply discount to invoice in status: ${lineItem.status}`
                };
            }
            
            // Validate discount amount
            const maxDiscount = parseFloat(lineItem.line_total);
            const discount = parseFloat(discountAmount);
            
            if (discount > maxDiscount) {
                return {
                    success: false,
                    error: `Discount amount cannot exceed line total (${maxDiscount})`
                };
            }
            
            if (discount <= 0) {
                return { success: false, error: 'Discount amount must be positive' };
            }
            
            // Update line item with manual discount
            await queryFunc(`
                UPDATE "ORDERS-invoice-line-items"
                SET 
                    line_discount_amount = line_discount_amount + $1,
                    line_total = line_total - $1,
                    manual_discount_applied = true,
                    manual_discount_reason = $2,
                    updated_at = NOW()
                WHERE id = $3
            `, [discount, reason, lineItemId]);
            
            // Recalculate invoice totals
            await this.recalculateInvoiceTotals(lineItem.fk_invoice_id, client);
            
            // Log to invoice history
            await queryFunc(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id, modification_type, field_name,
                    old_value, new_value, reason, changed_by_user_id
                ) VALUES ($1, 'discount_applied', 'manual_discount', 
                          $2, $3, $4, $5)
            `, [
                lineItem.fk_invoice_id,
                lineItem.line_discount_amount.toString(),
                (lineItem.line_discount_amount + discount).toString(),
                reason,
                userId
            ]);
            
            return { success: true };
        } catch (error) {
            console.error('Error applying manual discount:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove manual discount from a line item
     */
    async removeManualDiscount(lineItemId, userId, client = null) {
        const queryFunc = client ? client.query.bind(client) : query;
        
        try {
            const lineItemResult = await queryFunc(`
                SELECT 
                    li.*,
                    i.status
                FROM "ORDERS-invoice-line-items" li
                INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                WHERE li.id = $1
            `, [lineItemId]);
            
            if (lineItemResult.rows.length === 0) {
                return { success: false, error: 'Line item not found' };
            }
            
            const lineItem = lineItemResult.rows[0];
            
            // Check if there's a manual discount to remove
            if (!lineItem.manual_discount_applied) {
                return { success: false, error: 'No manual discount applied to this line item' };
            }
            
            // Calculate manual discount portion (all of line_discount_amount)
            // Note: In a more complex system, we'd track standing vs manual separately
            const discountToRemove = parseFloat(lineItem.line_discount_amount || 0);
            
            // Remove manual discount
            await queryFunc(`
                UPDATE "ORDERS-invoice-line-items"
                SET 
                    line_discount_amount = 0,
                    line_total = line_total + $1,
                    manual_discount_applied = false,
                    manual_discount_reason = NULL,
                    updated_at = NOW()
                WHERE id = $2
            `, [discountToRemove, lineItemId]);
            
            // Recalculate invoice totals
            await this.recalculateInvoiceTotals(lineItem.fk_invoice_id, client);
            
            // Log to invoice history
            await queryFunc(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id, modification_type, field_name,
                    old_value, new_value, reason, changed_by_user_id
                ) VALUES ($1, 'discount_removed', 'manual_discount', 
                          $2, '0', 'Manual discount removed', $3)
            `, [
                lineItem.fk_invoice_id,
                lineItem.line_discount_amount.toString(),
                userId
            ]);
            
            return { success: true };
        } catch (error) {
            console.error('Error removing manual discount:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Recalculate invoice totals after discount changes
     */
    async recalculateInvoiceTotals(invoiceId, client = null) {
        const queryFunc = client ? client.query.bind(client) : query;
        
        try {
            const totals = await queryFunc(`
                SELECT 
                    COALESCE(SUM(line_total), 0) as subtotal,
                    COALESCE(SUM(line_discount_amount), 0) as total_discounts
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [invoiceId]);
            
            const subtotal = parseFloat(totals.rows[0].subtotal);
            const totalDiscounts = parseFloat(totals.rows[0].total_discounts);
            
            // Get existing credit applied if any
            const invoiceResult = await queryFunc(`
                SELECT credit_applied
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);
            
            const creditApplied = parseFloat(invoiceResult.rows[0]?.credit_applied || 0);
            const total = subtotal - creditApplied;
            
            await queryFunc(`
                UPDATE "ORDERS-invoices"
                SET 
                    subtotal = $1,
                    discount_amount = $2,
                    total = $3,
                    updated_at = NOW()
                WHERE id = $4
            `, [subtotal, totalDiscounts, total, invoiceId]);
            
            return { success: true };
        } catch (error) {
            console.error('Error recalculating invoice totals:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all standing discounts for a location
     */
    async getStandingDiscountsForLocation(locationId) {
        try {
            const result = await query(`
                SELECT 
                    sd.*,
                    p.name as product_name,
                    p.brand_name
                FROM "orders-standing-discounts" sd
                INNER JOIN "ORDERS-products" p ON sd.fk_master_product_id = p.entry_id
                WHERE sd.fk_location_id = $1
                ORDER BY sd.created_at DESC
            `, [locationId]);
            
            return result.rows;
        } catch (error) {
            console.error('Error getting standing discounts:', error);
            return [];
        }
    }

    /**
     * Create a new standing discount
     */
    async createStandingDiscount(discountData, userId) {
        try {
            const result = await query(`
                INSERT INTO "orders-standing-discounts" (
                    fk_location_id, fk_master_product_id, discount_type,
                    discount_value, bogo_buy_quantity, bogo_get_quantity,
                    bogo_discount_percent, valid_from, valid_until,
                    is_active, created_by, notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING *
            `, [
                discountData.fk_location_id,
                discountData.fk_master_product_id,
                discountData.discount_type,
                discountData.discount_value,
                discountData.bogo_buy_quantity || null,
                discountData.bogo_get_quantity || null,
                discountData.bogo_discount_percent || null,
                discountData.valid_from || null,
                discountData.valid_until || null,
                discountData.is_active !== false, // default to true
                userId,
                discountData.notes || null
            ]);
            
            return { success: true, discount: result.rows[0] };
        } catch (error) {
            console.error('Error creating standing discount:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update a standing discount
     */
    async updateStandingDiscount(discountId, discountData, userId) {
        try {
            const result = await query(`
                UPDATE "orders-standing-discounts"
                SET 
                    discount_type = $1,
                    discount_value = $2,
                    bogo_buy_quantity = $3,
                    bogo_get_quantity = $4,
                    bogo_discount_percent = $5,
                    valid_from = $6,
                    valid_until = $7,
                    is_active = $8,
                    notes = $9
                WHERE id = $10
                RETURNING *
            `, [
                discountData.discount_type,
                discountData.discount_value,
                discountData.bogo_buy_quantity || null,
                discountData.bogo_get_quantity || null,
                discountData.bogo_discount_percent || null,
                discountData.valid_from || null,
                discountData.valid_until || null,
                discountData.is_active !== false,
                discountData.notes || null,
                discountId
            ]);
            
            return { success: true, discount: result.rows[0] };
        } catch (error) {
            console.error('Error updating standing discount:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete a standing discount
     */
    async deleteStandingDiscount(discountId) {
        try {
            await query(`
                DELETE FROM "orders-standing-discounts"
                WHERE id = $1
            `, [discountId]);
            
            return { success: true };
        } catch (error) {
            console.error('Error deleting standing discount:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new DiscountService();

