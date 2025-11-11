/**
 * Cart Cleanup Service
 * 
 * Handles automatic cleanup of expired shopping carts
 * Runs as a cron job every hour
 */

const { query } = require('../config/database');
const { Pool } = require('pg');
const path = require('path');
const allocationService = require('./allocationService');

class CartCleanupService {
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
     * Clear expired cart (releases allocations and deletes invoice)
     * @param {number} cartId - Invoice ID
     * @param {Object} client - Optional database client (for transactions)
     */
    async clearExpiredCart(cartId, client = null) {
        const shouldCommit = !client;
        if (!client) {
            client = await this.pool.connect();
            await client.query('BEGIN');
        }

        try {
            // Check if cart still exists and is expired
            const cart = await client.query(`
                SELECT id, status, cart_expires_at, source
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE SKIP LOCKED
            `, [cartId]);

            if (cart.rows.length === 0) {
                if (shouldCommit) await client.query('COMMIT');
                return { skipped: true, reason: 'already_cleaned_or_locked' };
            }

            const cartData = cart.rows[0];

            // Double-check it's actually expired (safety check)
            if (new Date(cartData.cart_expires_at) > new Date()) {
                if (shouldCommit) await client.query('COMMIT');
                return { skipped: true, reason: 'not_expired' };
            }

            // Verify it's a draft external cart
            if (cartData.status !== 'Draft' || cartData.source !== 'External') {
                if (shouldCommit) await client.query('COMMIT');
                return { skipped: true, reason: 'not_draft_external_cart' };
            }

            console.log(`🧹 Cleaning expired cart ${cartId}...`);

            // Release all allocations
            await this.releaseAllAllocations(cartId, client);

            // Delete line items
            await client.query(`
                DELETE FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [cartId]);

            // Delete invoice
            await client.query(`
                DELETE FROM "ORDERS-invoices"
                WHERE id = $1
            `, [cartId]);

            if (shouldCommit) await client.query('COMMIT');

            console.log(`✅ Expired cart ${cartId} cleaned successfully`);
            return { success: true, cart_id: cartId };
        } catch (error) {
            if (shouldCommit) await client.query('ROLLBACK');
            console.error(`❌ Error clearing expired cart ${cartId}:`, error.message);
            throw error;
        } finally {
            if (shouldCommit) client.release();
        }
    }

    /**
     * Release all allocations for an invoice
     * @param {number} invoiceId - Invoice ID
     * @param {Object} client - Database client
     */
    async releaseAllAllocations(invoiceId, client) {
        try {
            // Get all line items with allocations
            const lineItems = await client.query(`
                SELECT id, fk_batch_id, quantity_allocated
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1 AND quantity_allocated > 0
            `, [invoiceId]);

            // Release each allocation
            for (const item of lineItems.rows) {
                // Decrement allocated_quantity on batch
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET allocated_quantity = allocated_quantity - $1
                    WHERE id = $2
                `, [item.quantity_allocated, item.fk_batch_id]);

                // Log batch history
                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id, change_type, field_name,
                        old_value, new_value, reason,
                        related_invoice_id, changed_by_system
                    ) VALUES ($1, 'allocation_decreased', 'allocated_quantity',
                              $2, $3, 'Cart expired - allocation released', $4, true)
                `, [
                    item.fk_batch_id,
                    item.quantity_allocated.toString(),
                    '0',
                    invoiceId
                ]);

                // Broadcast inventory update
                try {
                    const batch = await client.query(`
                        SELECT quantity, allocated_quantity
                        FROM "ORDERS-batches"
                        WHERE id = $1
                    `, [item.fk_batch_id]);

                    if (batch.rows.length > 0) {
                        const newAvailable = batch.rows[0].quantity - batch.rows[0].allocated_quantity;
                        await allocationService.broadcastInventoryUpdate(item.fk_batch_id, newAvailable);
                    }
                } catch (wsError) {
                    console.error('WebSocket broadcast error (non-critical):', wsError.message);
                }
            }

            console.log(`✅ Released ${lineItems.rows.length} allocation(s) from cart ${invoiceId}`);
        } catch (error) {
            console.error('Error releasing allocations:', error);
            throw error;
        }
    }

    /**
     * Cleanup all expired carts (called by cron job)
     * Processes up to 100 expired carts at a time
     */
    async cleanupExpiredCarts() {
        try {
            // Find expired carts
            const expiredCarts = await query(`
                SELECT id, invoice_number, fk_buyer_id, cart_expires_at
                FROM "ORDERS-invoices"
                WHERE status = 'Draft'
                  AND source = 'External'
                  AND cart_expires_at < NOW()
                  AND cart_expires_at IS NOT NULL
                ORDER BY cart_expires_at ASC
                LIMIT 100
            `);

            if (expiredCarts.rows.length === 0) {
                return { success: true, cleaned: 0, message: 'No expired carts found' };
            }

            console.log(`🧹 Found ${expiredCarts.rows.length} expired cart(s) to clean`);

            let cleaned = 0;
            let failed = 0;
            const errors = [];

            for (const cart of expiredCarts.rows) {
                try {
                    const result = await this.clearExpiredCart(cart.id);
                    if (result.success) {
                        cleaned++;
                    } else if (result.skipped) {
                        console.log(`⏭️  Skipped cart ${cart.id}: ${result.reason}`);
                    }
                } catch (error) {
                    failed++;
                    errors.push({ cart_id: cart.id, error: error.message });
                    console.error(`❌ Failed to clear cart ${cart.id}:`, error.message);
                }
            }

            return {
                success: true,
                cleaned,
                failed,
                total_found: expiredCarts.rows.length,
                errors: errors.length > 0 ? errors : undefined
            };
        } catch (error) {
            console.error('❌ Cart cleanup job crashed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new CartCleanupService();

