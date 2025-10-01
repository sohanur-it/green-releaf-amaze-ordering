const pool = require('../config/database');
const logger = require('../../Utilities/logger');

// Batch Staging Model - handles ORDERS-batch_staging table operations
// Uses pre-synced batch data instead of running expensive queries

class BatchStagingModel {

    /**
     * Get all active batches from staging
     * @returns {Array} All active batch records
     */
    static async getAll() {
        try {
            const query = `
                SELECT * FROM "ORDERS-batch_staging"
                WHERE is_active = true
                ORDER BY name, batch_name
            `;
            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            logger.error('Error fetching all batches from staging:', error);
            throw error;
        }
    }

    /**
     * Get batches grouped by item name with aggregated data
     * @returns {Array} Batches grouped by name
     */
    static async getBatchesGroupedByName() {
        try {
            const query = `
                SELECT
                    name as item_name,
                    COUNT(*) as batch_count,
                    SUM(full_package_count) as total_full_packages,
                    SUM(partial_package_count) as total_partial_packages,
                    SUM(quantity) as total_quantity_available,
                    json_agg(
                        json_build_object(
                            'batch_name', batch_name,
                            'full_package_count', full_package_count,
                            'partial_package_count', partial_package_count,
                            'thc_percentage', thc_percentage,
                            'test_date', test_date,
                            'best_by_date', best_by_date,
                            'production_date', production_date,
                            'synclicense', synclicense,
                            'storage_location', storage_location
                        ) ORDER BY batch_name
                    ) as batches
                FROM "ORDERS-batch_staging"
                WHERE is_active = true
                GROUP BY name
                ORDER BY name
            `;

            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            logger.error('Error getting grouped batches from staging:', error);
            throw error;
        }
    }

    /**
     * Get batches for a specific item name
     * @param {string} itemName - Item name to filter by
     * @returns {Array} Batches for the item
     */
    static async getBatchesByItemName(itemName) {
        try {
            const query = `
                SELECT *
                FROM "ORDERS-batch_staging"
                WHERE name = $1 AND is_active = true
                ORDER BY batch_name
            `;

            const result = await pool.query(query, [itemName]);
            return result.rows;
        } catch (error) {
            logger.error(`Error getting batches for item ${itemName}:`, error);
            throw error;
        }
    }

    /**
     * Get unique item names from staging
     * @returns {Array} Array of unique item names
     */
    static async getUniqueItemNames() {
        try {
            const query = `
                SELECT DISTINCT name
                FROM "ORDERS-batch_staging"
                WHERE is_active = true
                ORDER BY name
            `;

            const result = await pool.query(query);
            return result.rows.map(row => row.name);
        } catch (error) {
            logger.error('Error getting unique item names from staging:', error);
            throw error;
        }
    }

    /**
     * Get total quantity available for an item
     * @param {string} itemName - Item name
     * @returns {number} Total quantity of full packages available
     */
    static async getTotalQuantityByItemName(itemName) {
        try {
            const query = `
                SELECT COALESCE(SUM(quantity), 0) as total_quantity
                FROM "ORDERS-batch_staging"
                WHERE name = $1 AND is_active = true
            `;

            const result = await pool.query(query, [itemName]);
            return parseInt(result.rows[0].total_quantity);
        } catch (error) {
            logger.error(`Error getting total quantity for ${itemName}:`, error);
            throw error;
        }
    }

    /**
     * Check if batches exist for an item name
     * @param {string} itemName - Item name
     * @returns {boolean} True if batches exist
     */
    static async hasActiveBatches(itemName) {
        try {
            const query = `
                SELECT EXISTS(
                    SELECT 1 FROM "ORDERS-batch_staging"
                    WHERE name = $1 AND is_active = true
                ) as exists
            `;

            const result = await pool.query(query, [itemName]);
            return result.rows[0].exists;
        } catch (error) {
            logger.error(`Error checking if batches exist for ${itemName}:`, error);
            throw error;
        }
    }

    /**
     * Get sync status and timestamp
     * @returns {Object} Sync status information
     */
    static async getSyncStatus() {
        try {
            const query = `
                SELECT
                    COUNT(*) as total_batches,
                    COUNT(*) FILTER (WHERE is_active = true) as active_batches,
                    COUNT(*) FILTER (WHERE is_active = false) as inactive_batches,
                    MAX(synced_at) as last_sync,
                    COUNT(DISTINCT name) as unique_items
                FROM "ORDERS-batch_staging"
            `;

            const result = await pool.query(query);
            return result.rows[0];
        } catch (error) {
            logger.error('Error getting sync status:', error);
            throw error;
        }
    }
}

module.exports = BatchStagingModel;
