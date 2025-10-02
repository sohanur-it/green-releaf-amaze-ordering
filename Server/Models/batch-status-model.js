const pool = require('../config/database');
const logger = require('../../Utilities/logger');

// Batch Status Model - handles ORDERS-batch_status table operations
// Tracks batch status decisions: Sellable, On Deck, On Hold

class BatchStatusModel {

    /**
     * Create a new batch status record
     * @param {Object} data - Batch status data
     * @returns {Object} Created batch status record
     */
    static async create(data) {
        try {
            const query = `
                INSERT INTO "ORDERS-batch_status" (
                    batch_name,
                    item_name,
                    product_detail_id,
                    original_batch_name,
                    custom_batch_name,
                    status,
                    batch_is_active
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `;

            const values = [
                data.batch_name,
                data.item_name,
                data.product_detail_id || null,
                data.original_batch_name || data.batch_name,
                data.custom_batch_name || null,
                data.status,
                data.batch_is_active !== undefined ? data.batch_is_active : true
            ];

            const result = await pool.query(query, values);
            logger.info(`Created batch status for ${data.batch_name} with status ${data.status}`);
            return result.rows[0];
        } catch (error) {
            logger.error('Error creating batch status:', error);
            throw error;
        }
    }

    /**
     * Bulk create batch status records (for Complete button)
     * @param {Array} batchStatuses - Array of batch status objects
     * @returns {Array} Created batch status records
     */
    static async bulkCreate(batchStatuses) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const results = [];
            for (const data of batchStatuses) {
                const query = `
                    INSERT INTO "ORDERS-batch_status" (
                        batch_name,
                        item_name,
                        product_detail_id,
                        original_batch_name,
                        custom_batch_name,
                        status,
                        batch_is_active
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (batch_name) DO UPDATE SET
                        status = EXCLUDED.status,
                        custom_batch_name = EXCLUDED.custom_batch_name,
                        batch_is_active = EXCLUDED.batch_is_active,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING *
                `;

                const values = [
                    data.batch_name,
                    data.item_name,
                    data.product_detail_id || null,
                    data.original_batch_name || data.batch_name,
                    data.custom_batch_name || null,
                    data.status,
                    data.batch_is_active !== undefined ? data.batch_is_active : true
                ];

                const result = await client.query(query, values);
                results.push(result.rows[0]);
            }

            await client.query('COMMIT');
            logger.info(`Bulk created/updated ${results.length} batch statuses`);
            return results;
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error in bulk create batch statuses:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get batch status by batch name
     * @param {string} batchName - Batch name
     * @returns {Object|null} Batch status record or null
     */
    static async getByBatchName(batchName) {
        try {
            const query = `
                SELECT * FROM "ORDERS-batch_status"
                WHERE batch_name = $1
            `;
            const result = await pool.query(query, [batchName]);
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`Error fetching batch status for ${batchName}:`, error);
            throw error;
        }
    }

    /**
     * Get all batch statuses for an item name
     * @param {string} itemName - Item name
     * @returns {Array} Batch status records
     */
    static async getByItemName(itemName) {
        try {
            const query = `
                SELECT * FROM "ORDERS-batch_status"
                WHERE item_name = $1
                ORDER BY created_at DESC
            `;
            const result = await pool.query(query, [itemName]);
            return result.rows;
        } catch (error) {
            logger.error(`Error fetching batch statuses for ${itemName}:`, error);
            throw error;
        }
    }

    /**
     * Get all marked batches with product and staging details
     * Groups display by display_item_name for unified product view
     * @returns {Array} Batch statuses joined with related data
     */
    static async getAllWithDetails() {
        try {
            const query = `
                SELECT
                    bs.*,
                    pd.item_name as product_display_name,
                    COALESCE(pd.display_item_name, pd.original_item_name) as display_item_name,
                    pd.original_item_name,
                    pd.category,
                    pd.brand,
                    staging.full_package_count,
                    staging.partial_package_count,
                    staging.thc_percentage,
                    staging.test_date,
                    staging.best_by_date,
                    staging.production_date,
                    staging.partial_package_details,
                    staging.full_package_details,
                    staging.is_active as staging_is_active
                FROM "ORDERS-batch_status" bs
                LEFT JOIN "ORDERS-product_details" pd ON bs.product_detail_id = pd.id
                LEFT JOIN "ORDERS-batch_staging" staging ON bs.batch_name = staging.batch_name
                WHERE bs.batch_is_active = true
                ORDER BY COALESCE(pd.display_item_name, pd.original_item_name), bs.created_at DESC
            `;

            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            logger.error('Error fetching all batch statuses with details:', error);
            throw error;
        }
    }

    /**
     * Update batch status and/or custom name
     * @param {string} batchName - Batch name
     * @param {string} status - New status
     * @param {string} customName - Optional custom name
     * @returns {Object} Updated batch status record
     */
    static async updateStatus(batchName, status, customName) {
        try {
            const query = `
                UPDATE "ORDERS-batch_status"
                SET status = $2,
                    custom_batch_name = $3,
                    updated_at = CURRENT_TIMESTAMP
                WHERE batch_name = $1
                RETURNING *
            `;

            const result = await pool.query(query, [batchName, status, customName || null]);

            if (result.rowCount === 0) {
                throw new Error(`Batch status not found for ${batchName}`);
            }

            logger.info(`Updated batch status for ${batchName} to ${status}`);
            return result.rows[0];
        } catch (error) {
            logger.error(`Error updating batch status for ${batchName}:`, error);
            throw error;
        }
    }

    /**
     * Sync batch_is_active status from staging table
     * This is called after batch sync to mark sold/moved batches as inactive
     * @returns {Object} Sync results
     */
    static async syncBatchActiveStatus() {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Update batch_is_active based on staging table is_active
            const updateQuery = `
                UPDATE "ORDERS-batch_status" bs
                SET batch_is_active = staging.is_active,
                    updated_at = CURRENT_TIMESTAMP
                FROM "ORDERS-batch_staging" staging
                WHERE bs.batch_name = staging.batch_name
                  AND bs.batch_is_active != staging.is_active
            `;

            const result = await client.query(updateQuery);

            await client.query('COMMIT');

            logger.info(`Synced batch_is_active status: ${result.rowCount} batches updated`);

            return {
                success: true,
                batchesUpdated: result.rowCount
            };
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error syncing batch active status:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get products with complete details that have pending (unmarked) batches
     * Used for batch workflow - only shows MASTER products (not children)
     * Includes batches from master's original_item_name AND all children's original_item_names
     * @returns {Array} Master products with pending batches (including children's batches)
     */
    static async getProductsWithPendingBatches() {
        try {
            const query = `
                WITH master_products AS (
                    -- Get only master products (not children) with completion status
                    SELECT
                        pd.*,
                        CASE WHEN
                            pd.category IS NOT NULL
                            AND pd.brand IS NOT NULL
                            AND pd.default_price IS NOT NULL
                            AND pd.strain_type IS NOT NULL
                            AND pd.product_description IS NOT NULL
                            AND pd.unit_weight IS NOT NULL
                            AND pd.packages_per_case IS NOT NULL
                            AND pd.unit_size_measurement IS NOT NULL
                            AND pd.strain_flavor IS NOT NULL
                            AND pd.display_item_name IS NOT NULL
                        THEN true ELSE false END as is_complete
                    FROM "ORDERS-product_details" pd
                    WHERE pd.parent_product_id IS NULL  -- Only masters (independent products or products with children)
                ),
                complete_masters AS (
                    -- Only show complete masters
                    SELECT * FROM master_products WHERE is_complete = true
                ),
                master_and_children AS (
                    -- Get each master and all its children's original_item_names
                    SELECT
                        m.id as master_id,
                        m.original_item_name as item_name
                    FROM complete_masters m
                    UNION
                    SELECT
                        m.id as master_id,
                        c.original_item_name as item_name
                    FROM complete_masters m
                    INNER JOIN "ORDERS-product_details" c ON c.parent_product_id = m.id
                ),
                pending_batches AS (
                    -- Get batches that don't have a status yet (for master + all children)
                    SELECT
                        staging.*,
                        staging.name as item_name,
                        mc.master_id
                    FROM "ORDERS-batch_staging" staging
                    INNER JOIN master_and_children mc ON staging.name = mc.item_name
                    LEFT JOIN "ORDERS-batch_status" bs ON staging.batch_name = bs.batch_name
                    WHERE staging.is_active = true
                      AND bs.id IS NULL
                ),
                masters_with_pending AS (
                    -- Get distinct masters that have at least one pending batch
                    SELECT DISTINCT master_id
                    FROM pending_batches
                )
                SELECT
                    m.id,
                    COALESCE(m.display_item_name, m.original_item_name) as display_item_name,
                    (
                        -- Get array of all original_item_names (master + children)
                        SELECT array_agg(DISTINCT original_item_name ORDER BY original_item_name)
                        FROM (
                            SELECT m.original_item_name
                            UNION
                            SELECT c.original_item_name
                            FROM "ORDERS-product_details" c
                            WHERE c.parent_product_id = m.id
                        ) all_items
                    ) as original_item_names,
                    (
                        -- Count of linked products (1 if no children, 1 + child count if has children)
                        SELECT 1 + COUNT(*)
                        FROM "ORDERS-product_details" c
                        WHERE c.parent_product_id = m.id
                    ) as linked_product_count,
                    m.item_name,
                    m.original_item_name,
                    m.sku,
                    m.category,
                    m.brand,
                    m.strain_flavor,
                    m.strain_type,
                    m.default_price,
                    m.unit_weight,
                    m.packages_per_case,
                    m.unit_size_measurement,
                    m.ingredients,
                    m.product_description,
                    m.internal_notes,
                    m.list_to_buyers,
                    m.featured_product,
                    m.created_at,
                    m.updated_at,
                    m.created_by,
                    m.updated_by,
                    m.last_modified,
                    json_agg(
                        json_build_object(
                            'batch_name', pb.batch_name,
                            'original_item_name', pb.item_name,
                            'full_package_count', pb.full_package_count,
                            'partial_package_count', pb.partial_package_count,
                            'partial_package_details', pb.partial_package_details,
                            'full_package_details', pb.full_package_details,
                            'thc_percentage', pb.thc_percentage,
                            'test_date', pb.test_date,
                            'best_by_date', pb.best_by_date,
                            'production_date', pb.production_date
                        ) ORDER BY pb.item_name, pb.batch_name
                    ) as pending_batches,
                    COUNT(pb.batch_name) as pending_batch_count
                FROM complete_masters m
                INNER JOIN masters_with_pending mwp ON m.id = mwp.master_id
                INNER JOIN pending_batches pb ON pb.master_id = m.id
                GROUP BY m.id, m.item_name, m.original_item_name, m.sku, m.category, m.brand,
                         m.strain_flavor, m.strain_type, m.default_price, m.unit_weight,
                         m.packages_per_case, m.unit_size_measurement, m.ingredients,
                         m.product_description, m.internal_notes, m.list_to_buyers,
                         m.featured_product, m.created_at, m.updated_at, m.created_by,
                         m.updated_by, m.last_modified, m.display_item_name
                ORDER BY COALESCE(m.display_item_name, m.original_item_name)
            `;

            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            logger.error('Error fetching products with pending batches:', error);
            throw error;
        }
    }

    /**
     * Get dashboard statistics
     * @returns {Object} Dashboard stats
     */
    static async getStatsForDashboard() {
        try {
            const query = `
                SELECT
                    -- Pending batches (no status yet, active in staging)
                    COUNT(DISTINCT staging.batch_name) FILTER (
                        WHERE staging.is_active = true
                          AND bs.id IS NULL
                    ) as pending_batches,

                    -- Products needing information (incomplete products)
                    COUNT(DISTINCT pd.id) FILTER (
                        WHERE pd.category IS NULL
                           OR pd.brand IS NULL
                           OR pd.default_price IS NULL
                           OR pd.strain_type IS NULL
                           OR pd.product_description IS NULL
                           OR pd.unit_weight IS NULL
                           OR pd.packages_per_case IS NULL
                           OR pd.unit_size_measurement IS NULL
                           OR pd.strain_flavor IS NULL
                    ) as products_needing_info,

                    -- Sellable batches
                    COUNT(DISTINCT bs.id) FILTER (
                        WHERE bs.status = 'Sellable' AND bs.batch_is_active = true
                    ) as sellable_batches,

                    -- On Deck batches
                    COUNT(DISTINCT bs.id) FILTER (
                        WHERE bs.status = 'On Deck' AND bs.batch_is_active = true
                    ) as on_deck_batches,

                    -- On Hold batches
                    COUNT(DISTINCT bs.id) FILTER (
                        WHERE bs.status = 'On Hold' AND bs.batch_is_active = true
                    ) as on_hold_batches,

                    -- Products with 100% completion
                    COUNT(DISTINCT pd.id) FILTER (
                        WHERE pd.category IS NOT NULL
                          AND pd.brand IS NOT NULL
                          AND pd.default_price IS NOT NULL
                          AND pd.strain_type IS NOT NULL
                          AND pd.product_description IS NOT NULL
                          AND pd.unit_weight IS NOT NULL
                          AND pd.packages_per_case IS NOT NULL
                          AND pd.unit_size_measurement IS NOT NULL
                          AND pd.strain_flavor IS NOT NULL
                          AND EXISTS (
                              SELECT 1 FROM "ORDERS-product_images" pi
                              WHERE pi.product_detail_id = pd.id
                          )
                    ) as products_complete,

                    -- Products with batches waiting (complete products with pending batches)
                    COUNT(DISTINCT pd.id) FILTER (
                        WHERE pd.category IS NOT NULL
                          AND pd.brand IS NOT NULL
                          AND pd.default_price IS NOT NULL
                          AND pd.strain_type IS NOT NULL
                          AND pd.product_description IS NOT NULL
                          AND pd.unit_weight IS NOT NULL
                          AND pd.packages_per_case IS NOT NULL
                          AND pd.unit_size_measurement IS NOT NULL
                          AND pd.strain_flavor IS NOT NULL
                          AND EXISTS (
                              SELECT 1 FROM "ORDERS-batch_staging" staging
                              LEFT JOIN "ORDERS-batch_status" pending_bs ON staging.batch_name = pending_bs.batch_name
                              WHERE staging.name = pd.original_item_name
                                AND staging.is_active = true
                                AND pending_bs.id IS NULL
                          )
                    ) as products_with_pending_batches

                FROM "ORDERS-batch_staging" staging
                FULL OUTER JOIN "ORDERS-batch_status" bs ON staging.batch_name = bs.batch_name
                FULL OUTER JOIN "ORDERS-product_details" pd ON staging.name = pd.original_item_name
            `;

            const result = await pool.query(query);
            return result.rows[0];
        } catch (error) {
            logger.error('Error fetching dashboard stats:', error);
            throw error;
        }
    }

    /**
     * Check if there are new batches since last check
     * @param {Date} lastCheckTime - Last time we checked for new batches
     * @returns {Object} New batches info
     */
    static async checkForNewBatches(lastCheckTime) {
        try {
            const query = `
                SELECT
                    staging.name as item_name,
                    COUNT(staging.batch_name) as new_batch_count
                FROM "ORDERS-batch_staging" staging
                LEFT JOIN "ORDERS-batch_status" bs ON staging.batch_name = bs.batch_name
                WHERE staging.is_active = true
                  AND bs.id IS NULL
                  AND staging.synced_at > $1
                GROUP BY staging.name
                ORDER BY staging.name
            `;

            const result = await pool.query(query, [lastCheckTime]);

            return {
                hasNewBatches: result.rows.length > 0,
                products: result.rows
            };
        } catch (error) {
            logger.error('Error checking for new batches:', error);
            throw error;
        }
    }

    /**
     * Delete batch status (if needed for cleanup)
     * @param {string} batchName - Batch name
     * @returns {boolean} True if deleted
     */
    static async delete(batchName) {
        try {
            const query = `
                DELETE FROM "ORDERS-batch_status"
                WHERE batch_name = $1
            `;
            const result = await pool.query(query, [batchName]);
            logger.info(`Deleted batch status for ${batchName}`);
            return result.rowCount > 0;
        } catch (error) {
            logger.error(`Error deleting batch status for ${batchName}:`, error);
            throw error;
        }
    }
}

module.exports = BatchStatusModel;
