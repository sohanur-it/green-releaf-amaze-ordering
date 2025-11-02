/**
 * Account Credit Service
 * 
 * Handles account credits with oldest-first ordering and proportional application
 */

const { query } = require('../config/database');

class AccountCreditService {
    /**
     * Issue a new account credit
     */
    async issueCredit(creditData, userId) {
        try {
            const result = await query(`
                INSERT INTO "ORDERS-account-credits" (
                    fk_location_id, credit_amount, remaining_balance,
                    issued_by, reason, related_invoice_id, expires_at
                ) VALUES ($1, $2, $2, $3, $4, $5, $6)
                RETURNING *
            `, [
                creditData.fk_location_id,
                creditData.amount,
                creditData.amount,
                userId,
                creditData.reason,
                creditData.related_invoice_id || null,
                creditData.expires_at || null
            ]);
            
            return { success: true, credit: result.rows[0] };
        } catch (error) {
            console.error('Error issuing credit:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Apply available credits to an invoice
     * Uses oldest-first ordering to prevent expiration
     * Applies proportionally across all line items
     */
    async applyCreditsToInvoice(invoiceId, client = null) {
        const queryFunc = client ? client.query.bind(client) : query;
        
        try {
            // Get invoice details
            const invoice = await queryFunc(`
                SELECT 
                    id, fk_location_id, subtotal,
                    COALESCE(credit_applied, 0) as current_credit_applied
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);
            
            if (invoice.rows.length === 0) {
                return { success: false, error: 'Invoice not found' };
            }
            
            const invoiceData = invoice.rows[0];
            const locationId = invoiceData.fk_location_id;
            const subtotal = parseFloat(invoiceData.subtotal);
            const currentCredit = parseFloat(invoiceData.current_credit_applied);
            const balanceNeeded = subtotal - currentCredit;
            
            if (balanceNeeded <= 0) {
                return { success: true, applied: 0, message: 'Invoice already covered by credits' };
            }
            
            // Get available credits for this location, oldest first
            const credits = await queryFunc(`
                SELECT *
                FROM "ORDERS-account-credits"
                WHERE fk_location_id = $1
                  AND remaining_balance > 0
                  AND is_expired = false
                  AND is_fully_used = false
                  AND (expires_at IS NULL OR expires_at > NOW())
                ORDER BY issued_at ASC
            `, [locationId]);
            
            if (credits.rows.length === 0) {
                return { success: true, applied: 0, message: 'No available credits' };
            }
            
            let totalApplied = 0;
            const creditApplications = [];
            
            // Apply credits oldest-first until invoice is covered
            for (const credit of credits.rows) {
                if (totalApplied >= balanceNeeded) break;
                
                const available = parseFloat(credit.remaining_balance);
                const stillNeeded = balanceNeeded - totalApplied;
                const toApply = Math.min(available, stillNeeded);
                
                // Update credit balance
                const newBalance = available - toApply;
                await queryFunc(`
                    UPDATE "ORDERS-account-credits"
                    SET remaining_balance = $1,
                        is_fully_used = $2,
                        fully_used_at = CASE WHEN $2 THEN NOW() ELSE NULL END
                    WHERE id = $3
                `, [newBalance, newBalance === 0, credit.id]);
                
                // Record application
                creditApplications.push({
                    credit_id: credit.id,
                    amount: toApply
                });
                
                totalApplied += toApply;
            }
            
            // Calculate proportional distribution across line items
            const lineItems = await queryFunc(`
                SELECT id, line_total
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [invoiceId]);
            
            // Apply credits proportionally to each line item
            for (const item of lineItems.rows) {
                const itemTotal = parseFloat(item.line_total);
                const proportion = itemTotal / subtotal;
                const itemCredit = totalApplied * proportion;
                
                await queryFunc(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET credit_portion = credit_portion + $1,
                        line_total = line_total - $1
                    WHERE id = $2
                `, [itemCredit, item.id]);
            }
            
            // Update invoice with total credit applied
            await queryFunc(`
                UPDATE "ORDERS-invoices"
                SET 
                    credit_applied = COALESCE(credit_applied, 0) + $1,
                    total = subtotal - (COALESCE(credit_applied, 0) + $1),
                    updated_at = NOW()
                WHERE id = $2
            `, [totalApplied, invoiceId]);
            
            // Record credit applications in audit table
            for (const app of creditApplications) {
                await queryFunc(`
                    INSERT INTO "orders-credit-applications" (
                        fk_credit_id, fk_invoice_id, amount_applied
                    ) VALUES ($1, $2, $3)
                `, [app.credit_id, invoiceId, app.amount]);
            }
            
            // Log to invoice history
            await queryFunc(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id, modification_type, field_name,
                    old_value, new_value, reason, changed_by_system
                ) VALUES ($1, 'credit_applied', 'credit_applied',
                          $2, $3, 'Account credit applied automatically', true)
            `, [
                invoiceId,
                currentCredit.toString(),
                (currentCredit + totalApplied).toString()
            ]);
            
            return {
                success: true,
                applied: totalApplied,
                credits_used: creditApplications.length
            };
        } catch (error) {
            console.error('Error applying credits to invoice:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all available credits for a location
     */
    async getAvailableCredits(locationId) {
        try {
            const result = await query(`
                SELECT 
                    c.*,
                    b.name as buyer_name,
                    l.name as location_name,
                    u.username as issued_by_username
                FROM "ORDERS-account-credits" c
                INNER JOIN "ORDERS-buyer_locations" l ON c.fk_location_id = l.id
                INNER JOIN "ORDERS-buyers" b ON l.orders_buyer_id = b.entry_id
                LEFT JOIN users u ON c.issued_by = u.id
                WHERE c.fk_location_id = $1
                ORDER BY c.issued_at DESC
            `, [locationId]);
            
            return result.rows;
        } catch (error) {
            console.error('Error getting available credits:', error);
            return [];
        }
    }

    /**
     * Check for expired credits (called by cron job)
     */
    async expireCredits() {
        try {
            const result = await query(`
                UPDATE "ORDERS-account-credits"
                SET is_expired = true
                WHERE is_expired = false
                  AND expires_at IS NOT NULL
                  AND expires_at < NOW()
                RETURNING id, fk_location_id, remaining_balance
            `);
            
            console.log(`Expired ${result.rows.length} credits`);
            return { success: true, expired_count: result.rows.length };
        } catch (error) {
            console.error('Error expiring credits:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new AccountCreditService();

