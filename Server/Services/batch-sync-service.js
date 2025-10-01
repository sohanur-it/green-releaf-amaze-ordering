const pool = require('../config/database');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../Utilities/logger');
const BatchPromotionService = require('./batch-promotion-service');

// Batch Sync Service
// Syncs METRC batch data to ORDERS-batch_staging table every 15 minutes
// Reduces load on main database by caching batch query results

class BatchSyncService {

    /**
     * Execute the METRC batch extractor query
     * @returns {Array} Batch query results
     */
    static async executeBatchQuery() {
        try {
            // Read the query file
            const queryPath = path.join(__dirname, '../../Queries/metrc-batch-extractor-query.sql');
            const queryText = await fs.readFile(queryPath, 'utf8');

            logger.debug('Executing METRC batch extractor query');
            const result = await pool.query(queryText);

            logger.info(`Batch query returned ${result.rowCount} results`);
            return result.rows;
        } catch (error) {
            logger.error('Error executing batch query:', error);
            throw error;
        }
    }

    /**
     * Sync batch data to staging table
     * @returns {Object} Sync result summary
     */
    static async syncBatches() {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            logger.info('Starting batch sync to staging table');

            // Get fresh batch data from METRC
            const batches = await this.executeBatchQuery();

            if (batches.length === 0) {
                logger.warn('Batch query returned no results');
                await client.query('COMMIT');
                return {
                    success: true,
                    batchesProcessed: 0,
                    batchesInserted: 0,
                    batchesUpdated: 0,
                    batchesDeactivated: 0
                };
            }

            // Mark all existing batches as inactive first
            await client.query(`
                UPDATE "ORDERS-batch_staging"
                SET is_active = false
            `);

            let inserted = 0;
            let updated = 0;

            // Upsert each batch
            for (const batch of batches) {
                const upsertQuery = `
                    INSERT INTO "ORDERS-batch_staging" (
                        batch_name,
                        name,
                        sourcepackagelabels,
                        package_count,
                        quantity,
                        full_package_count,
                        partial_package_count,
                        available_labels,
                        full_package_details,
                        partial_package_details,
                        thc_percentage,
                        production_date,
                        test_date,
                        best_by_date,
                        last_modified,
                        item_productcategoryname,
                        synclicense,
                        storage_location,
                        items_table_missing,
                        unit_weight_grams_missing,
                        unit_count_missing,
                        synced_at,
                        is_active
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                        $21, CURRENT_TIMESTAMP, true
                    )
                    ON CONFLICT (batch_name)
                    DO UPDATE SET
                        name = EXCLUDED.name,
                        sourcepackagelabels = EXCLUDED.sourcepackagelabels,
                        package_count = EXCLUDED.package_count,
                        quantity = EXCLUDED.quantity,
                        full_package_count = EXCLUDED.full_package_count,
                        partial_package_count = EXCLUDED.partial_package_count,
                        available_labels = EXCLUDED.available_labels,
                        full_package_details = EXCLUDED.full_package_details,
                        partial_package_details = EXCLUDED.partial_package_details,
                        thc_percentage = EXCLUDED.thc_percentage,
                        production_date = EXCLUDED.production_date,
                        test_date = EXCLUDED.test_date,
                        best_by_date = EXCLUDED.best_by_date,
                        last_modified = EXCLUDED.last_modified,
                        item_productcategoryname = EXCLUDED.item_productcategoryname,
                        synclicense = EXCLUDED.synclicense,
                        storage_location = EXCLUDED.storage_location,
                        items_table_missing = EXCLUDED.items_table_missing,
                        unit_weight_grams_missing = EXCLUDED.unit_weight_grams_missing,
                        unit_count_missing = EXCLUDED.unit_count_missing,
                        synced_at = CURRENT_TIMESTAMP,
                        is_active = true
                    RETURNING (xmax = 0) AS inserted
                `;

                const values = [
                    batch.batch_name,
                    batch.name,
                    batch.sourcepackagelabels,
                    batch.package_count || 0,
                    batch.quantity || 0,
                    batch.full_package_count || 0,
                    batch.partial_package_count || 0,
                    batch.available_labels || null,
                    batch.full_package_details || null,
                    batch.partial_package_details || null,
                    batch.thc_percentage || null,
                    batch.production_date || null,
                    batch.test_date || null,
                    batch.best_by_date || null,
                    batch.last_modified || null,
                    batch.item_productcategoryname || null,
                    batch.synclicense || null,
                    batch.storage_location || null,
                    batch.items_table_missing || false,
                    batch.unit_weight_grams_missing || false,
                    batch.unit_count_missing || false
                ];

                const result = await client.query(upsertQuery, values);

                // Check if this was an insert or update
                if (result.rows[0].inserted) {
                    inserted++;
                } else {
                    updated++;
                }
            }

            // Count how many batches were deactivated (not found in current sync)
            const deactivatedResult = await client.query(`
                SELECT COUNT(*) as count
                FROM "ORDERS-batch_staging"
                WHERE is_active = false
            `);
            const deactivated = parseInt(deactivatedResult.rows[0].count);

            await client.query('COMMIT');

            logger.info(`Batch sync complete: ${inserted} inserted, ${updated} updated, ${deactivated} deactivated`);

            // After batch sync completes, run promotion service
            logger.info('Running batch promotion service...');
            const promotionResult = await BatchPromotionService.syncAndPromote();
            logger.info('Batch promotion service completed');

            return {
                success: true,
                batchesProcessed: batches.length,
                batchesInserted: inserted,
                batchesUpdated: updated,
                batchesDeactivated: deactivated,
                promotionResult
            };

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error syncing batches:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get batches from staging table grouped by item name
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
                    json_agg(
                        json_build_object(
                            'batch_name', batch_name,
                            'full_package_count', full_package_count,
                            'partial_package_count', partial_package_count,
                            'thc_percentage', thc_percentage,
                            'test_date', test_date,
                            'best_by_date', best_by_date,
                            'synclicense', synclicense
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
            logger.error('Error getting batches from staging:', error);
            throw error;
        }
    }

    /**
     * Get batches for a specific item name from staging
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
     * Start periodic batch sync service
     * @param {number} intervalMinutes - How often to sync (default 15)
     */
    static startPeriodicSync(intervalMinutes = 15) {
        logger.info(`Starting periodic batch sync service: runs every ${intervalMinutes} minutes`);

        // Run immediately on start
        this.syncBatches().catch(error => {
            logger.error('Error in initial batch sync:', error);
        });

        // Then run periodically
        setInterval(async () => {
            try {
                await this.syncBatches();
            } catch (error) {
                logger.error('Error in periodic batch sync:', error);
            }
        }, intervalMinutes * 60 * 1000);
    }
}

module.exports = BatchSyncService;
