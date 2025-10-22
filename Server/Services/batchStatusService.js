/**
 * Batch Status Service
 * 
 * Handles automatic batch status updates and promotions
 * Implements business logic for "On Deck" → "Sellable" transitions
 */

const { Pool } = require('pg');
const auditLogger = require('./auditLogger');

class BatchStatusService {
    constructor() {
        this.pool = new Pool({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_DATABASE,
            password: process.env.DB_PASSWORD,
            port: parseInt(process.env.DB_PORT, 10) || 5432,
        });
    }

    /**
     * Check if sellable inventory is depleted for a product
     * @param {number} productId - Product ID to check
     * @returns {Promise<boolean>} - True if inventory is depleted
     */
    async isInventoryDepleted(productId) {
        const client = await this.pool.connect();
        
        try {
            const query = `
                SELECT 
                    COALESCE(SUM(quantity), 0) as total_sellable_quantity
                FROM batches 
                WHERE product_id = $1 
                AND status = 'Sellable'
                AND quantity > 0
            `;
            
            const result = await client.query(query, [productId]);
            const totalSellable = parseFloat(result.rows[0].total_sellable_quantity);
            
            console.log(`📊 Product ${productId} sellable inventory: ${totalSellable}`);
            return totalSellable <= 0;
            
        } catch (error) {
            console.error('❌ Error checking inventory depletion:', error.message);
            return false;
        } finally {
            client.release();
        }
    }

    /**
     * Get all "On Deck" batches for a product
     * @param {number} productId - Product ID
     * @returns {Promise<Array>} - Array of On Deck batches
     */
    async getOnDeckBatches(productId) {
        const client = await this.pool.connect();
        
        try {
            const query = `
                SELECT 
                    id,
                    batch_number,
                    quantity,
                    product_id,
                    status,
                    created_at
                FROM batches 
                WHERE product_id = $1 
                AND status = 'On Deck'
                AND quantity > 0
                ORDER BY created_at ASC
            `;
            
            const result = await client.query(query, [productId]);
            console.log(`📦 Found ${result.rows.length} On Deck batches for product ${productId}`);
            return result.rows;
            
        } catch (error) {
            console.error('❌ Error fetching On Deck batches:', error.message);
            return [];
        } finally {
            client.release();
        }
    }

    /**
     * Promote On Deck batches to Sellable status
     * @param {number} productId - Product ID
     * @returns {Promise<Object>} - Promotion result
     */
    async promoteBatchesToSellable(productId) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get On Deck batches
            const onDeckBatches = await this.getOnDeckBatches(productId);
            
            if (onDeckBatches.length === 0) {
                await client.query('ROLLBACK');
                return {
                    success: true,
                    message: 'No On Deck batches to promote',
                    updatedBatches: []
                };
            }

            // Update batch statuses
            const batchIds = onDeckBatches.map(batch => batch.id);
            const updateQuery = `
                UPDATE batches 
                SET status = 'Sellable', updated_at = NOW()
                WHERE id = ANY($1)
                RETURNING id, batch_number, quantity
            `;
            
            const updateResult = await client.query(updateQuery, [batchIds]);
            
            await client.query('COMMIT');
            
            // Log the promotion action
            await auditLogger.logAction({
                userId: null, // SYSTEM action
                action: 'batch_status_update',
                resourceType: 'Batch',
                resourceId: productId.toString(),
                details: {
                    message: `System automatically promoted ${updateResult.rows.length} batch(es) to Sellable for Product ID ${productId} due to inventory depletion`,
                    batch_count: updateResult.rows.length,
                    batch_numbers: updateResult.rows.map(row => row.batch_number).join(', '),
                    new_status: 'Sellable',
                    product_id: productId,
                    promotion_reason: 'Inventory depletion'
                },
                status: 'success',
                sourceIp: null
            });

            console.log(`✅ Promoted ${updateResult.rows.length} batches to Sellable for product ${productId}`);
            
            return {
                success: true,
                message: `Successfully promoted ${updateResult.rows.length} batches to Sellable`,
                updatedBatches: updateResult.rows
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error promoting batches:', error.message);
            
            // Log the failure
            await auditLogger.logAction({
                userId: null,
                action: 'batch_status_update',
                resourceType: 'Batch',
                resourceId: productId.toString(),
                details: {
                    message: `System failed to automatically promote batches for Product ID ${productId}: ${error.message}`,
                    error: error.message,
                    product_id: productId,
                    promotion_reason: 'Inventory depletion'
                },
                status: 'failure',
                sourceIp: null
            });
            
            return {
                success: false,
                error: error.message,
                updatedBatches: []
            };
        } finally {
            client.release();
        }
    }

    /**
     * Check and promote batches for all products with depleted inventory
     * @returns {Promise<Object>} - Overall promotion result
     */
    async checkAndPromoteAllProducts() {
        const client = await this.pool.connect();
        
        try {
            // Get all products
            const productsQuery = `
                SELECT DISTINCT product_id 
                FROM batches 
                WHERE status IN ('Sellable', 'On Deck')
            `;
            
            const productsResult = await client.query(productsQuery);
            const products = productsResult.rows.map(row => row.product_id);
            
            console.log(`🔍 Checking ${products.length} products for inventory depletion`);
            
            const promotionResults = [];
            
            for (const productId of products) {
                const isDepleted = await this.isInventoryDepleted(productId);
                
                if (isDepleted) {
                    console.log(`⚠️ Product ${productId} inventory depleted, promoting On Deck batches`);
                    const result = await this.promoteBatchesToSellable(productId);
                    promotionResults.push({
                        productId,
                        ...result
                    });
                }
            }
            
            const totalPromoted = promotionResults.reduce((sum, result) => 
                sum + (result.updatedBatches ? result.updatedBatches.length : 0), 0
            );
            
            console.log(`🎯 Batch promotion complete: ${totalPromoted} batches promoted across ${promotionResults.length} products`);
            
            return {
                success: true,
                totalProducts: products.length,
                productsProcessed: promotionResults.length,
                totalBatchesPromoted: totalPromoted,
                results: promotionResults
            };
            
        } catch (error) {
            console.error('❌ Error in batch promotion process:', error.message);
            return {
                success: false,
                error: error.message,
                totalProducts: 0,
                productsProcessed: 0,
                totalBatchesPromoted: 0,
                results: []
            };
        } finally {
            client.release();
        }
    }

    /**
     * Get batch status summary for a product
     * @param {number} productId - Product ID
     * @returns {Promise<Object>} - Batch status summary
     */
    async getBatchStatusSummary(productId) {
        const client = await this.pool.connect();
        
        try {
            const query = `
                SELECT 
                    status,
                    COUNT(*) as batch_count,
                    SUM(quantity) as total_quantity
                FROM batches 
                WHERE product_id = $1
                GROUP BY status
                ORDER BY status
            `;
            
            const result = await client.query(query, [productId]);
            
            const summary = {
                productId,
                statuses: result.rows,
                totalBatches: result.rows.reduce((sum, row) => sum + parseInt(row.batch_count), 0),
                totalQuantity: result.rows.reduce((sum, row) => sum + parseFloat(row.total_quantity), 0)
            };
            
            return summary;
            
        } catch (error) {
            console.error('❌ Error getting batch status summary:', error.message);
            return {
                productId,
                statuses: [],
                totalBatches: 0,
                totalQuantity: 0,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Manually update batch status (for admin use)
     * @param {number} batchId - Batch ID
     * @param {string} newStatus - New status
     * @param {number} userId - User ID performing the action
     * @returns {Promise<Object>} - Update result
     */
    async updateBatchStatus(batchId, newStatus, userId) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get current batch info
            const currentQuery = `
                SELECT id, batch_number, status, quantity, product_id
                FROM batches 
                WHERE id = $1
            `;
            
            const currentResult = await client.query(currentQuery, [batchId]);
            
            if (currentResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    error: 'Batch not found'
                };
            }
            
            const currentBatch = currentResult.rows[0];
            const oldStatus = currentBatch.status;
            
            // Update batch status
            const updateQuery = `
                UPDATE batches 
                SET status = $1, updated_at = NOW()
                WHERE id = $2
                RETURNING id, batch_number, status, quantity, product_id
            `;
            
            const updateResult = await client.query(updateQuery, [newStatus, batchId]);
            
            await client.query('COMMIT');
            
            // Log the manual update
            const userText = userId === 'SYSTEM' ? 'System' : `User ID ${userId}`;
            await auditLogger.logAction({
                userId: userId === 'SYSTEM' ? null : userId,
                action: 'batch_status_update',
                resourceType: 'Batch',
                resourceId: batchId.toString(),
                details: {
                    message: `${userText} manually updated Batch ${currentBatch.batch_number} status from "${oldStatus}" to "${newStatus}" (Quantity: ${currentBatch.quantity})`,
                    batch_id: batchId,
                    batch_number: currentBatch.batch_number,
                    old_status: oldStatus,
                    new_status: newStatus,
                    quantity: currentBatch.quantity,
                    product_id: currentBatch.product_id,
                    update_type: 'manual'
                },
                status: 'success',
                sourceIp: null
            });
            
            console.log(`✅ Batch ${batchId} status updated: ${oldStatus} → ${newStatus}`);
            
            return {
                success: true,
                message: `Batch ${batchId} status updated to ${newStatus}`,
                batch: updateResult.rows[0]
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error updating batch status:', error.message);
            
            // Log the failure
            await auditLogger.logAction({
                userId: userId,
                action: 'batch_status_update',
                resourceType: 'Batch',
                resourceId: batchId.toString(),
                details: {
                    error: error.message,
                    update_type: 'manual'
                },
                status: 'failure',
                sourceIp: null
            });
            
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }
}

module.exports = new BatchStatusService();
