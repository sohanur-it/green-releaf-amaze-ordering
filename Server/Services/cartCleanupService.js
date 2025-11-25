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

            // Get buyer_id and location_id for WebSocket broadcast before deletion
            const cartInfo = await client.query(`
                SELECT fk_buyer_id, fk_location_id
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [cartId]);
            
            const buyerId = cartInfo.rows[0]?.fk_buyer_id;
            const locationId = cartInfo.rows[0]?.fk_location_id;

            // Get ALL line items (with their batch_ids) BEFORE deleting them
            // We need to broadcast inventory updates for ALL batches in the cart
            // Get distinct batch IDs that were in the cart
            const lineItems = await client.query(`
                SELECT DISTINCT fk_batch_id as batch_id,
                       SUM(quantity_allocated) as total_allocated
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
                GROUP BY fk_batch_id
            `, [cartId]);

            // Release all allocations (updates database within transaction)
            await this.releaseAllAllocations(cartId, client);

            // Delete related records first (foreign key constraints)
            // Order matters: delete child records before parent
            
            // 1. Delete credit applications (if any)
            try {
                const creditAppsDeleted = await client.query(`
                    DELETE FROM "orders-credit-applications"
                    WHERE fk_invoice_id = $1
                `, [cartId]);
                if (creditAppsDeleted.rowCount > 0) {
                    console.log(`🗑️  Deleted ${creditAppsDeleted.rowCount} credit application(s) for cart ${cartId}`);
                }
            } catch (creditError) {
                console.warn(`⚠️  Error deleting credit applications for cart ${cartId}:`, creditError.message);
                // If this fails, we can't delete the invoice - throw error
                throw new Error(`Cannot delete cart ${cartId}: credit applications exist and cannot be deleted - ${creditError.message}`);
            }

            // 2. Delete invoice history
            try {
                const historyDeleted = await client.query(`
                    DELETE FROM "ORDERS-invoice-history"
                    WHERE fk_invoice_id = $1
                `, [cartId]);
                if (historyDeleted.rowCount > 0) {
                    console.log(`🗑️  Deleted ${historyDeleted.rowCount} history record(s) for cart ${cartId}`);
                }
            } catch (historyError) {
                console.warn(`⚠️  Error deleting invoice history (non-critical):`, historyError.message);
                // History deletion failure is non-critical - continue
            }

            // 3. Delete scanning sessions (if any)
            try {
                const sessionsDeleted = await client.query(`
                    DELETE FROM "ORDERS-scanning-sessions"
                    WHERE fk_invoice_id = $1
                `, [cartId]);
                if (sessionsDeleted.rowCount > 0) {
                    console.log(`🗑️  Deleted ${sessionsDeleted.rowCount} scanning session(s) for cart ${cartId}`);
                }
            } catch (sessionError) {
                console.warn(`⚠️  Error deleting scanning sessions (non-critical):`, sessionError.message);
            }

            // 4. Delete cancelled shipment packages (if any)
            try {
                const cancelledPkgsDeleted = await client.query(`
                    DELETE FROM "ORDERS-cancelled-shipment-packages"
                    WHERE fk_invoice_id = $1
                `, [cartId]);
                if (cancelledPkgsDeleted.rowCount > 0) {
                    console.log(`🗑️  Deleted ${cancelledPkgsDeleted.rowCount} cancelled shipment package(s) for cart ${cartId}`);
                }
            } catch (cancelledError) {
                console.warn(`⚠️  Error deleting cancelled shipment packages (non-critical):`, cancelledError.message);
            }

            // 5. Delete manifest packages (if any)
            try {
                const manifestPkgsDeleted = await client.query(`
                    DELETE FROM "ORDERS-manifest-packages"
                    WHERE fk_invoice_id = $1
                `, [cartId]);
                if (manifestPkgsDeleted.rowCount > 0) {
                    console.log(`🗑️  Deleted ${manifestPkgsDeleted.rowCount} manifest package(s) for cart ${cartId}`);
                }
            } catch (manifestError) {
                console.warn(`⚠️  Error deleting manifest packages (non-critical):`, manifestError.message);
            }

            // Delete line items
            await client.query(`
                DELETE FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [cartId]);

            // Delete invoice completely from database (silent - no warnings)
            // This permanently removes the invoice record
            const deleteResult = await client.query(`
                DELETE FROM "ORDERS-invoices"
                WHERE id = $1
                RETURNING id, invoice_number
            `, [cartId]);
            
            if (deleteResult.rows.length === 0) {
                // Invoice was already deleted (race condition)
                if (shouldCommit) await client.query('COMMIT');
                return { skipped: true, reason: 'already_deleted' };
            }
            
            console.log(`🗑️  Invoice ${cartId} (${deleteResult.rows[0].invoice_number}) deleted from database`);

            if (shouldCommit) await client.query('COMMIT');
            
            // CRITICAL: Broadcast inventory updates AFTER transaction commits
            // This ensures inventory is properly updated and visible to all clients
            // Use websocketService directly (same as manual cart clearing) for consistency
            const websocketService = require('./websocketService');
            const allocationService = require('./allocationService');
            
            // Broadcast inventory update for each unique batch that was in the cart
            console.log(`📡 Preparing to broadcast inventory updates for ${lineItems.rows.length} batch(es) after cart expiration`);
            
            for (const item of lineItems.rows) {
                // Handle both fk_batch_id and batch_id column names
                const batchId = item.batch_id || item.fk_batch_id;
                if (!batchId) {
                    console.warn(`⚠️  Skipping inventory broadcast - no batch_id found in item:`, item);
                    continue;
                }
                
                try {
                    // Get the current available quantity after allocation was released
                    const newAvailable = await allocationService.getAvailableQuantity(batchId);
                    
                    console.log(`📦 Batch ${batchId}: Releasing ${item.total_allocated || 0} allocated, new available: ${newAvailable}`);
                    
                    // Broadcast the inventory update using websocketService directly
                    // This matches the pattern used in removeFromCart for consistency
                    await websocketService.broadcastInventoryUpdate(batchId, newAvailable);
                    
                    console.log(`✅ Broadcasted inventory update: Batch ${batchId} now has ${newAvailable} available (cart expired)`);
                } catch (broadcastError) {
                    console.error(`❌ Failed to broadcast inventory for batch ${batchId}:`, broadcastError.message);
                }
            }

            // Broadcast invoice deletion via WebSocket (after commit)
            try {
                const websocketService = require('./websocketService');
                await websocketService.broadcastInvoiceEvent(cartId, 'invoice_deleted', {
                    buyer_id: buyerId,
                    location_id: locationId,
                    reason: 'cart_expired',
                    triggered_by: 'system',
                    cart_expired: true
                });
            } catch (wsError) {
                console.error('WebSocket broadcast error (non-critical):', wsError.message);
            }

            console.log(`✅ Expired cart ${cartId} cleaned successfully (silent deletion)`);
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
     * Release all allocations for an invoice (within transaction)
     * Inventory broadcasting happens AFTER transaction commits
     * @param {number} invoiceId - Invoice ID
     * @param {Object} client - Database client (transaction context)
     */
    async releaseAllAllocations(invoiceId, client) {
        try {
            // Get all line items with allocations
            // CRITICAL: Get ALL items, even if quantity_allocated is 0, to ensure we process everything
            const lineItems = await client.query(`
                SELECT id, fk_batch_id, quantity_allocated
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
                AND quantity_allocated > 0
            `, [invoiceId]);

            if (lineItems.rows.length === 0) {
                console.log(`No allocations to release for invoice ${invoiceId}`);
                return;
            }

            // Release each allocation within the transaction
            // Note: Broadcasting happens AFTER commit in clearExpiredCart
            for (const item of lineItems.rows) {
                // Lock batch for update
                const batch = await client.query(`
                    SELECT allocated_quantity FROM "ORDERS-batches"
                    WHERE id = $1
                    FOR UPDATE
                `, [item.fk_batch_id]);

                if (batch.rows.length === 0) continue;

                const currentAllocated = batch.rows[0].allocated_quantity;

                // Decrement allocated_quantity on batch (within transaction)
                const updateResult = await client.query(`
                    UPDATE "ORDERS-batches"
                    SET allocated_quantity = allocated_quantity - $1
                    WHERE id = $2
                    RETURNING id, quantity, allocated_quantity
                `, [item.quantity_allocated, item.fk_batch_id]);

                if (updateResult.rows.length === 0) {
                    console.warn(`⚠️  Batch ${item.fk_batch_id} not found when releasing allocation`);
                    continue;
                }

                const newAllocated = updateResult.rows[0].allocated_quantity;
                const batchQuantity = updateResult.rows[0].quantity;
                const newAvailable = batchQuantity - newAllocated;

                console.log(`📦 Released allocation: Batch ${item.fk_batch_id} - Allocated: ${currentAllocated} → ${newAllocated}, Available: ${newAvailable}`);

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
                    currentAllocated.toString(),
                    newAllocated.toString(),
                    invoiceId
                ]);
            }

            console.log(`✅ Released ${lineItems.rows.length} allocation(s) from cart ${invoiceId} (database updated)`);
            
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
            // Find expired carts (silently delete - no warnings)
            // CRITICAL: Delete ALL expired carts, not just first 100
            const expiredCarts = await query(`
                SELECT id, invoice_number, fk_buyer_id, fk_location_id, cart_expires_at
                FROM "ORDERS-invoices"
                WHERE status = 'Draft'
                  AND source = 'External'
                  AND cart_expires_at IS NOT NULL
                  AND cart_expires_at < NOW()
                ORDER BY cart_expires_at ASC
            `);

            if (expiredCarts.rows.length === 0) {
                return { success: true, cleaned: 0, message: 'No expired carts found' };
            }

            if (expiredCarts.rows.length === 0) {
                return { success: true, cleaned: 0, message: 'No expired carts found' };
            }

            console.log(`🧹 Found ${expiredCarts.rows.length} expired cart(s) to delete from database`);

            let cleaned = 0;
            let failed = 0;
            const errors = [];

            for (const cart of expiredCarts.rows) {
                try {
                    const result = await this.clearExpiredCart(cart.id);
                    if (result.success) {
                        cleaned++;
                        console.log(`✅ Deleted expired invoice ${cart.id} (invoice_number: ${cart.invoice_number})`);
                    } else if (result.skipped) {
                        console.log(`⏭️  Skipped cart ${cart.id}: ${result.reason}`);
                    }
                } catch (error) {
                    failed++;
                    errors.push({ cart_id: cart.id, error: error.message });
                    console.error(`❌ Failed to delete expired cart ${cart.id}:`, error.message);
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

