/**
 * Allocation Service
 * 
 * Handles batch allocation to orders with proper locking and history tracking
 * Implements Module 4 preview functionality for order fulfillment
 */

const { Pool } = require('pg');
const path = require('path');

class AllocationService {
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
     * Allocate batch to order with row locking to prevent overselling
     * @param {number} batchId - Batch ID
     * @param {number} requestedQty - Requested quantity
     * @param {number} orderId - Order ID
     * @param {number} userId - User ID performing allocation
     * @returns {Promise<Object>} - Allocation result
     */
    async allocateBatchToOrder(batchId, requestedQty, orderId, userId) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');

            // Lock the batch row FOR UPDATE to prevent race conditions
            const batch = await client.query(`
                SELECT 
                    id, batch_name, quantity, allocated_quantity, 
                    fk_master_product_id, status
                FROM "ORDERS-batches"
                WHERE id = $1
                FOR UPDATE
            `, [batchId]);

            if (batch.rows.length === 0) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    error: 'Batch not found'
                };
            }

            const batchData = batch.rows[0];
            const available = batchData.quantity - batchData.allocated_quantity;

            // Check if sufficient inventory available
            if (available < requestedQty) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    error: `Insufficient inventory. Available: ${available}, Requested: ${requestedQty}`,
                    batch_name: batchData.batch_name,
                    available: available,
                    requested: requestedQty
                };
            }

            // Increment allocated_quantity
            const oldAllocated = batchData.allocated_quantity;
            const newAllocated = oldAllocated + requestedQty;

            await client.query(`
                UPDATE "ORDERS-batches"
                SET allocated_quantity = $1
                WHERE id = $2
            `, [newAllocated, batchId]);

            // Create order_items record
            const orderItemResult = await client.query(`
                INSERT INTO order_items (
                    order_id, batch_id, requested_quantity, 
                    allocated_quantity, unit_price, 
                    allocated_at, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, 
                        COALESCE((SELECT override_price FROM "ORDERS-batches" WHERE id = $2),
                                (SELECT default_price FROM "ORDERS-products" p 
                                 INNER JOIN "ORDERS-batches" b ON p.entry_id = b.fk_master_product_id 
                                 WHERE b.id = $2)), 0.00),
                        NOW(), NOW(), NOW())
                ON CONFLICT (order_id, batch_id) 
                DO UPDATE SET 
                    requested_quantity = EXCLUDED.requested_quantity,
                    allocated_quantity = EXCLUDED.allocated_quantity
                RETURNING id, unit_price, (allocated_quantity * unit_price) as total_price
            `, [orderId, batchId, requestedQty, requestedQty]);

            const orderItem = orderItemResult.rows[0];

            // Log to batch history
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id, change_type, field_name,
                    old_value, new_value, reason,
                    related_invoice_id, changed_by_user_id,
                    changed_by_system
                ) VALUES ($1, 'allocation_increased', 'allocated_quantity', 
                          $2, $3, 'Allocated to order', $4, $5, true)
            `, [
                batchId,
                oldAllocated.toString(),
                newAllocated.toString(),
                orderId,
                userId
            ]);

            await client.query('COMMIT');

            console.log(`✅ Allocated ${requestedQty} units from batch ${batchId} to order ${orderId}`);

            // Check if this allocation should trigger auto-promotion
            try {
                const batchStatusService = require('./batchStatusService');
                const isDepleted = await batchStatusService.isInventoryDepleted(batchData.fk_master_product_id);
                
                if (isDepleted) {
                    console.log(`⚠️ Product ${batchData.fk_master_product_id} depleted! Triggering auto-promotion...`);
                    await batchStatusService.promoteBatchesToSellable(batchData.fk_master_product_id);
                }
            } catch (promotionError) {
                console.error('❌ Error during auto-promotion after allocation:', promotionError.message);
                // Don't fail the allocation if promotion fails
            }

            return {
                success: true,
                batch_id: batchId,
                batch_name: batchData.batch_name,
                old_allocated: oldAllocated,
                new_allocated: newAllocated,
                available_before: available,
                available_after: available - requestedQty,
                order_item_id: orderItem.id,
                unit_price: orderItem.unit_price,
                total_price: orderItem.total_price
            };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error allocating batch to order:', error.message);
            
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Release allocation (e.g., when order is cancelled)
     * @param {number} orderId - Order ID
     * @param {number} userId - User ID
     * @returns {Promise<Object>} - Release result
     */
    async releaseAllocation(orderId, userId) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');

            // Get all allocations for this order
            const allocations = await client.query(`
                SELECT oi.batch_id, oi.allocated_quantity, b.batch_name
                FROM order_items oi
                INNER JOIN "ORDERS-batches" b ON oi.batch_id = b.id
                WHERE oi.order_id = $1 AND oi.allocated_quantity > 0
            `, [orderId]);

            let releasedBatches = [];

            for (const allocation of allocations.rows) {
                const batchId = allocation.batch_id;
                const releasedQty = allocation.allocated_quantity;

                // Decrement allocated_quantity
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET allocated_quantity = allocated_quantity - $1
                    WHERE id = $2
                `, [releasedQty, batchId]);

                // Mark order item as released
                await client.query(`
                    UPDATE order_items
                    SET allocated_quantity = 0,
                        updated_at = NOW()
                    WHERE order_id = $1 AND batch_id = $2
                `, [orderId, batchId]);

                // Log to batch history
                const currentAllocated = await client.query(`
                    SELECT allocated_quantity FROM "ORDERS-batches" WHERE id = $1
                `, [batchId]);

                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id, change_type, field_name,
                        old_value, new_value, reason,
                        related_invoice_id, changed_by_user_id,
                        changed_by_system
                    ) VALUES ($1, 'allocation_released', 'allocated_quantity', 
                              $2, $3, 'Order cancelled or modified', $4, $5, false)
                `, [
                    batchId,
                    releasedQty.toString(),
                    currentAllocated.rows[0].allocated_quantity.toString(),
                    orderId,
                    userId
                ]);

                releasedBatches.push({
                    batch_id: batchId,
                    batch_name: allocation.batch_name,
                    released_quantity: releasedQty
                });

                console.log(`✅ Released ${releasedQty} units from batch ${allocation.batch_name}`);
            }

            await client.query('COMMIT');

            return {
                success: true,
                released_count: releasedBatches.length,
                batches: releasedBatches
            };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error releasing allocation:', error.message);
            
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Close database connections
     */
    async close() {
        await this.pool.end();
    }
}

module.exports = new AllocationService();

