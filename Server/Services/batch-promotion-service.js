const pool = require('../config/database');
const BatchStatusModel = require('../Models/batch-status-model');
const ItemDetailsModel = require('../Models/item-details-model');
const logger = require('../../Utilities/logger');

// Batch Promotion Service
// Handles automatic promotion of "On Deck" batches to "Sellable" when all sellable batches are sold
// Updates list_to_buyers on product_details based on batch availability

class BatchPromotionService {

    /**
     * Promote "On Deck" batches to "Sellable" when all sellable batches for a product are sold
     * Called after batch sync completes
     * @returns {Object} Promotion results
     */
    static async promoteOnDeckBatches() {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            logger.info('Starting On Deck batch promotion check...');

            // Get all products that have batch statuses
            const productsQuery = `
                SELECT DISTINCT item_name, product_detail_id
                FROM "ORDERS-batch_status"
                WHERE batch_is_active = true
            `;
            const productsResult = await client.query(productsQuery);

            let totalPromoted = 0;
            const promotedProducts = [];

            for (const product of productsResult.rows) {
                // Check if product has any active "Sellable" batches
                const sellableCheckQuery = `
                    SELECT COUNT(*) as sellable_count
                    FROM "ORDERS-batch_status"
                    WHERE item_name = $1
                      AND status = 'Sellable'
                      AND batch_is_active = true
                `;
                const sellableResult = await client.query(sellableCheckQuery, [product.item_name]);
                const sellableCount = parseInt(sellableResult.rows[0].sellable_count);

                // If no sellable batches remain, promote oldest On Deck batches
                if (sellableCount === 0) {
                    // Get On Deck batches for this product (oldest first)
                    const onDeckQuery = `
                        SELECT batch_name
                        FROM "ORDERS-batch_status"
                        WHERE item_name = $1
                          AND status = 'On Deck'
                          AND batch_is_active = true
                        ORDER BY created_at ASC
                    `;
                    const onDeckResult = await client.query(onDeckQuery, [product.item_name]);

                    if (onDeckResult.rows.length > 0) {
                        // Promote all On Deck batches to Sellable
                        const promoteQuery = `
                            UPDATE "ORDERS-batch_status"
                            SET status = 'Sellable',
                                updated_at = CURRENT_TIMESTAMP
                            WHERE item_name = $1
                              AND status = 'On Deck'
                              AND batch_is_active = true
                        `;
                        const promoteResult = await client.query(promoteQuery, [product.item_name]);

                        totalPromoted += promoteResult.rowCount;
                        promotedProducts.push({
                            item_name: product.item_name,
                            batches_promoted: promoteResult.rowCount
                        });

                        logger.info(`Promoted ${promoteResult.rowCount} On Deck batch(es) to Sellable for ${product.item_name}`);

                        // Update list_to_buyers to true for this product
                        if (product.product_detail_id) {
                            await client.query(`
                                UPDATE "ORDERS-product_details"
                                SET list_to_buyers = true,
                                    updated_at = CURRENT_TIMESTAMP
                                WHERE id = $1
                            `, [product.product_detail_id]);

                            logger.info(`Set list_to_buyers=true for ${product.item_name}`);
                        }
                    }
                }
            }

            await client.query('COMMIT');

            logger.info(`Batch promotion complete: ${totalPromoted} batch(es) promoted across ${promotedProducts.length} product(s)`);

            return {
                success: true,
                totalPromoted,
                products: promotedProducts
            };

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error in batch promotion:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update list_to_buyers for all products based on batch availability
     * Sets to true if product has at least one active Sellable batch
     * Sets to false if product has no active Sellable batches
     * @returns {Object} Update results
     */
    static async updateListToBuyers() {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            logger.info('Updating list_to_buyers for all products...');

            // Set list_to_buyers = true for products with active Sellable batches
            const setTrueQuery = `
                UPDATE "ORDERS-product_details" pd
                SET list_to_buyers = true,
                    updated_at = CURRENT_TIMESTAMP
                WHERE EXISTS (
                    SELECT 1
                    FROM "ORDERS-batch_status" bs
                    WHERE bs.product_detail_id = pd.id
                      AND bs.status = 'Sellable'
                      AND bs.batch_is_active = true
                )
                AND pd.list_to_buyers = false
            `;
            const setTrueResult = await client.query(setTrueQuery);

            // Set list_to_buyers = false for products with NO active Sellable batches
            const setFalseQuery = `
                UPDATE "ORDERS-product_details" pd
                SET list_to_buyers = false,
                    updated_at = CURRENT_TIMESTAMP
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM "ORDERS-batch_status" bs
                    WHERE bs.product_detail_id = pd.id
                      AND bs.status = 'Sellable'
                      AND bs.batch_is_active = true
                )
                AND pd.list_to_buyers = true
            `;
            const setFalseResult = await client.query(setFalseQuery);

            await client.query('COMMIT');

            logger.info(`list_to_buyers update complete: ${setTrueResult.rowCount} set to true, ${setFalseResult.rowCount} set to false`);

            return {
                success: true,
                setToTrue: setTrueResult.rowCount,
                setToFalse: setFalseResult.rowCount
            };

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error updating list_to_buyers:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Sync batch_is_active status from staging table
     * Then run promotion and list_to_buyers update
     * This is the main entry point called after batch sync
     * @returns {Object} Combined results
     */
    static async syncAndPromote() {
        try {
            logger.info('Starting batch sync and promotion process...');

            // Step 1: Sync batch_is_active from staging
            const syncResult = await BatchStatusModel.syncBatchActiveStatus();

            // Step 2: Promote On Deck batches if needed
            const promotionResult = await this.promoteOnDeckBatches();

            // Step 3: Update list_to_buyers based on current batch availability
            const listToBuyersResult = await this.updateListToBuyers();

            return {
                success: true,
                sync: syncResult,
                promotion: promotionResult,
                listToBuyers: listToBuyersResult
            };

        } catch (error) {
            logger.error('Error in sync and promotion process:', error);
            throw error;
        }
    }
}

module.exports = BatchPromotionService;
