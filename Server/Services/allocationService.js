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
     * Allocate batch to invoice with row locking to prevent overselling
     * Module 4 compliant - works with ORDERS-invoices and ORDERS-invoice-line-items
     * @param {number} batchId - Batch ID
     * @param {number} quantity - Requested quantity
     * @param {number} invoiceId - Invoice ID
     * @param {number} lineItemId - Line item ID (optional, will be created if not provided)
     * @returns {Promise<Object>} - Allocation result
     */
    async allocateBatchToInvoice(batchId, quantity, invoiceId, lineItemId = null) {
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
            if (available < quantity) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    error: 'insufficient_inventory',
                    available: available,
                    requested: quantity,
                    batch_name: batchData.batch_name
                };
            }

            // Increment allocated_quantity
            const oldAllocated = batchData.allocated_quantity;
            const newAllocated = oldAllocated + quantity;

            await client.query(`
                UPDATE "ORDERS-batches"
                SET allocated_quantity = allocated_quantity + $1
                WHERE id = $2
            `, [quantity, batchId]);

            // Update line item if provided, otherwise log allocation separately
            if (lineItemId) {
                await client.query(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET quantity_allocated = COALESCE(quantity_allocated, 0) + $1
                    WHERE id = $2
                `, [quantity, lineItemId]);
            }

            // Log to batch history
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id, change_type, field_name,
                    old_value, new_value, reason,
                    related_invoice_id, changed_by_system
                ) VALUES ($1, 'allocation_increased', 'allocated_quantity',
                          $2, $3, 'Allocated to invoice', $4, true)
            `, [
                batchId,
                oldAllocated.toString(),
                newAllocated.toString(),
                invoiceId
            ]);

            await client.query('COMMIT');

            console.log(`✅ Allocated ${quantity} units from batch ${batchId} to invoice ${invoiceId}`);

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

            // Broadcast inventory update via WebSocket
            try {
                await this.broadcastInventoryUpdate(batchId, available - quantity);
            } catch (wsError) {
                console.error('WebSocket broadcast error (non-critical):', wsError.message);
            }

            return {
                success: true,
                batch_id: batchId,
                batch_name: batchData.batch_name,
                allocated: quantity,
                remaining_available: available - quantity
            };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error allocating batch to invoice:', error.message);
            
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Release allocation for a specific batch (cart removal, order cancellation, etc.)
     * @param {number} batchId - Batch ID
     * @param {number} quantity - Quantity to release
     * @param {number} invoiceId - Invoice ID
     * @param {string} reason - Reason for release
     * @returns {Promise<Object>} - Release result
     */
    async releaseAllocation(batchId, quantity, invoiceId, reason) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');

            const batch = await client.query(`
                SELECT allocated_quantity FROM "ORDERS-batches"
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

            const currentAllocated = batch.rows[0].allocated_quantity;

            // Decrement allocation
            await client.query(`
                UPDATE "ORDERS-batches"
                SET allocated_quantity = allocated_quantity - $1
                WHERE id = $2
            `, [quantity, batchId]);

            // Log history
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id, change_type, field_name,
                    old_value, new_value, reason,
                    related_invoice_id, changed_by_system
                ) VALUES ($1, 'allocation_decreased', 'allocated_quantity',
                          $2, $3, $4, $5, true)
            `, [batchId, currentAllocated, currentAllocated - quantity, reason, invoiceId]);

            await client.query('COMMIT');

            // Broadcast inventory update via WebSocket
            try {
                const newAvailable = await this.getAvailableQuantity(batchId);
                await this.broadcastInventoryUpdate(batchId, newAvailable);
            } catch (wsError) {
                console.error('WebSocket broadcast error (non-critical):', wsError.message);
            }

            return { success: true };

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
     * Release ALL allocations for an invoice (cancellation)
     * Module 4 compliant
     * @param {number} invoiceId - Invoice ID
     * @param {Object} client - Database client (will create own if not provided)
     */
    async releaseAllAllocations(invoiceId, client = null) {
        const shouldReleaseClient = !client;
        if (!client) {
            client = await this.pool.connect();
        }
        
        const shouldReleaseTransaction = !client._transactionStarted;
        try {
            if (shouldReleaseTransaction) {
                await client.query('BEGIN');
            }
            
            const lineItems = await client.query(`
                SELECT id, fk_batch_id, quantity_allocated
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1 AND quantity_allocated > 0
            `, [invoiceId]);
            
            for (const item of lineItems.rows) {
                const batchId = item.fk_batch_id;
                const quantity = item.quantity_allocated;
                
                // Lock batch
                const batch = await client.query(`
                    SELECT allocated_quantity FROM "ORDERS-batches"
                    WHERE id = $1
                    FOR UPDATE
                `, [batchId]);
                
                if (batch.rows.length === 0) continue;
                
                const currentAllocated = batch.rows[0].allocated_quantity;
                
                // Decrement allocation
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET allocated_quantity = allocated_quantity - $1
                    WHERE id = $2
                `, [quantity, batchId]);
                
                // Log history
                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id, change_type, field_name,
                        old_value, new_value, reason,
                        related_invoice_id, changed_by_system
                    ) VALUES ($1, 'allocation_decreased', 'allocated_quantity',
                              $2, $3, 'Invoice cancelled', $4, true)
                `, [batchId, currentAllocated, currentAllocated - quantity, invoiceId]);
                
                // Zero out line item allocation
                await client.query(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET quantity_allocated = 0
                    WHERE id = $1
                `, [item.id]);
            }
            
            if (shouldReleaseTransaction) {
                await client.query('COMMIT');
            }
            
            return { success: true };
        } catch (error) {
            if (shouldReleaseTransaction) {
                await client.query('ROLLBACK');
            }
            console.error('Error releasing all allocations:', error);
            return { success: false, error: error.message };
        } finally {
            if (shouldReleaseClient) {
                client.release();
            }
        }
    }

    /**
     * Finalize inventory deduction after delivery
     * This is when we actually remove from batch.quantity
     * Module 4 compliant
     * @param {number} invoiceId - Invoice ID
     * @param {Object} client - Database client (will create own if not provided)
     */
    async finalizeInventoryDeductions(invoiceId, client = null) {
        const shouldReleaseClient = !client;
        if (!client) {
            client = await this.pool.connect();
        }
        
        try {
            const lineItems = await client.query(`
                SELECT fk_batch_id, quantity_fulfilled
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [invoiceId]);
            
            for (const item of lineItems.rows) {
                const batchId = item.fk_batch_id;
                const quantity = item.quantity_fulfilled;
                
                // Decrease actual quantity AND allocated_quantity
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET quantity = quantity - $1, allocated_quantity = allocated_quantity - $1
                    WHERE id = $2
                `, [quantity, batchId]);
                
                // Log the final deduction
                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id, change_type, reason,
                        related_invoice_id, changed_by_system
                    ) VALUES ($1, 'quantity_deducted', 'Invoice delivered and finalized', $2, true)
                `, [batchId, invoiceId]);
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error finalizing inventory deductions:', error);
            return { success: false, error: error.message };
        } finally {
            if (shouldReleaseClient) {
                client.release();
            }
        }
    }

    /**
     * Get available quantity for a batch
     * @param {number} batchId - Batch ID
     * @returns {Promise<number>} - Available quantity
     */
    async getAvailableQuantity(batchId) {
        const result = await this.pool.query(`
            SELECT (quantity - allocated_quantity) as available
            FROM "ORDERS-batches"
            WHERE id = $1
        `, [batchId]);
        
        return result.rows[0]?.available || 0;
    }

    /**
     * Broadcast inventory update via WebSocket (placeholder)
     * @param {number} batchId - Batch ID
     * @param {number} availableQuantity - New available quantity
     */
    async broadcastInventoryUpdate(batchId, availableQuantity) {
        try {
            const websocketService = require('./websocketService');
            await websocketService.broadcastInventoryUpdate(batchId, availableQuantity);
            console.log(`📡 Broadcast: Batch ${batchId} now has ${availableQuantity} available`);
        } catch (error) {
            console.error('Error broadcasting inventory update:', error);
            // Don't throw - WebSocket issues shouldn't break allocations
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

