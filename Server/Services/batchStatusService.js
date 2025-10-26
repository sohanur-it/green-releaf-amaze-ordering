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
                    COALESCE(SUM(quantity - allocated_quantity), 0) as available_quantity
                FROM "ORDERS-batches" 
                WHERE fk_master_product_id = $1 
                AND status = 'Sellable'
            `;
            
            const result = await client.query(query, [productId]);
            const availableQty = parseFloat(result.rows[0].available_quantity);
            
            console.log(`📊 Product ${productId} available sellable inventory: ${availableQty}`);
            return availableQty <= 0;
            
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
                    batch_name,
                    quantity,
                    allocated_quantity,
                    fk_master_product_id,
                    status,
                    created_at
                FROM "ORDERS-batches" 
                WHERE fk_master_product_id = $1 
                AND status = 'On Deck'
                AND (quantity - allocated_quantity) > 0
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
                UPDATE "ORDERS-batches" 
                SET status = 'Sellable', updated_at = NOW()
                WHERE id = ANY($1)
                RETURNING id, batch_name, quantity, allocated_quantity
            `;
            
            const updateResult = await client.query(updateQuery, [batchIds]);
            
            // Log to batch history for each promoted batch
            for (const batch of updateResult.rows) {
                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id, change_type, field_name,
                        old_value, new_value, reason,
                        changed_by_system
                    ) VALUES ($1, 'status_changed', 'status', 'On Deck', 'Sellable', 
                              'Auto-promoted: Sellable inventory depleted', true)
                `, [batch.id]);
            }
            
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
                    batch_names: updateResult.rows.map(row => row.batch_name).join(', '),
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
     * Validate batch can be marked as Sellable
     * @param {number} batchId - Batch ID
     * @param {Object} client - Database client
     * @returns {Promise<Object>} - Validation result
     */
    async validateBatchForSellable(batchId, client) {
        const batchQuery = await client.query(`
            SELECT 
                items_table_missing,
                unit_weight_grams_missing,
                unit_count_missing,
                thc_percentage,
                thc_override
            FROM "ORDERS-batches"
            WHERE id = $1
        `, [batchId]);

        const b = batchQuery.rows[0];
        const warnings = [];

        if (b.items_table_missing) {
            warnings.push({
                level: 'ERROR',
                field: 'items_table_missing',
                message: 'This batch is missing critical data from the Items table. Cannot mark as Sellable until resolved.'
            });
        }

        if (b.unit_weight_grams_missing || b.unit_count_missing) {
            warnings.push({
                level: 'ERROR',
                field: 'unit_specifications',
                message: 'Unit weight or count is missing. Full/partial package detection may be inaccurate.'
            });
        }

        if (!b.thc_percentage && !b.thc_override) {
            warnings.push({
                level: 'WARNING',
                field: 'thc_percentage',
                message: 'No THC data available. Consider adding a manual override before marking Sellable.'
            });
        }

        const canBeSellable = warnings.filter(w => w.level === 'ERROR').length === 0;

        return {
            valid: canBeSellable,
            warnings: warnings
        };
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
            // Permission validation
            if (!userId || userId === 'SYSTEM') {
                return {
                    success: false,
                    error: 'Unauthorized: Valid user authentication required'
                };
            }

            await client.query('BEGIN');
            
            // Get current batch info
            const currentQuery = `
                SELECT id, batch_name, status, quantity, allocated_quantity, fk_master_product_id
                FROM "ORDERS-batches" 
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

            // Validate if trying to set to 'Sellable'
            if (newStatus === 'Sellable') {
                const validation = await this.validateBatchForSellable(batchId, client);
                if (!validation.valid) {
                    await client.query('ROLLBACK');
                    return {
                        success: false,
                        error: `Cannot mark batch as Sellable: ${validation.warnings.map(w => w.message).join('; ')}`,
                        validation_errors: validation.warnings
                    };
                }
                // Include warnings even if valid
                if (validation.warnings.length > 0) {
                    console.log(`⚠️ Batch ${batchId} has validation warnings:`, validation.warnings);
                }
            }
            
            // Update batch status
            const updateQuery = `
                UPDATE "ORDERS-batches" 
                SET status = $1
                WHERE id = $2
                RETURNING id, batch_name, status, quantity, allocated_quantity, fk_master_product_id
            `;
            
            const updateResult = await client.query(updateQuery, [newStatus, batchId]);

            // Log to batch history
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id, change_type, field_name,
                    old_value, new_value, reason,
                    changed_by_user_id, changed_by_system
                ) VALUES ($1, 'status_changed', 'status', $2, $3, 'Manual status change', $4, false)
            `, [batchId, oldStatus, newStatus, userId]);
            
            await client.query('COMMIT');
            
            // Log the manual update
            await auditLogger.logAction({
                userId: userId,
                action: 'batch_status_update',
                resourceType: 'Batch',
                resourceId: batchId.toString(),
                details: {
                    message: `User ID ${userId} manually updated Batch "${currentBatch.batch_name}" status from "${oldStatus}" to "${newStatus}" (Quantity: ${currentBatch.quantity})`,
                    batch_id: batchId,
                    batch_name: currentBatch.batch_name,
                    old_status: oldStatus,
                    new_status: newStatus,
                    quantity: currentBatch.quantity,
                    allocated_quantity: currentBatch.allocated_quantity,
                    product_id: currentBatch.fk_master_product_id,
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
