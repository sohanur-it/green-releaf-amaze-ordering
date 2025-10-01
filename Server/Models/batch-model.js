const pool = require('../config/database');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../Utilities/logger');

//batch model - handles running the metrc batch extractor query

class BatchModel {

    //run the batch extractor query to get current batches
    static async getAllBatches() {
        try {
            //read the query file
            const queryPath = path.join(__dirname, '../../Queries/metrc-batch-extractor-query.sql');
            const queryText = await fs.readFile(queryPath, 'utf8');

            logger.debug('Executing batch extractor query');
            const result = await pool.query(queryText);

            logger.info(`Batch query returned ${result.rowCount} results`);
            return result.rows;
        } catch (error) {
            logger.error('Error executing batch query:', error);
            throw error;
        }
    }

    //get batches grouped by item name with aggregated quantities
    static async getBatchesGroupedByName() {
        try {
            const batches = await this.getAllBatches();

            //group batches by name
            const grouped = {};

            batches.forEach(batch => {
                const itemName = batch.name;
                if (!grouped[itemName]) {
                    grouped[itemName] = {
                        item_name: itemName,
                        total_full_packages: 0,
                        total_partial_packages: 0,
                        batches: []
                    };
                }

                grouped[itemName].total_full_packages += (batch.full_package_count || 0);
                grouped[itemName].total_partial_packages += (batch.partial_package_count || 0);
                grouped[itemName].batches.push(batch);
            });

            return Object.values(grouped);
        } catch (error) {
            logger.error('Error grouping batches:', error);
            throw error;
        }
    }

    //get batches for a specific item name
    static async getBatchesByItemName(itemName) {
        try {
            const batches = await this.getAllBatches();
            return batches.filter(b => b.name === itemName);
        } catch (error) {
            logger.error(`Error getting batches for item ${itemName}:`, error);
            throw error;
        }
    }

    //get unique item names from batches
    static async getUniqueItemNames() {
        try {
            const batches = await this.getAllBatches();
            const names = [...new Set(batches.map(b => b.name))];
            return names.sort();
        } catch (error) {
            logger.error('Error getting unique item names:', error);
            throw error;
        }
    }
}

module.exports = BatchModel;