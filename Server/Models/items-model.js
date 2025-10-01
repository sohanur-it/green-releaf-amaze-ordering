const pool = require('../config/database');
const logger = require('../../Utilities/logger');

//items model - interacts with the items table
//pulls default values for unit_weight_grams, unit_count, brand, strain, ingredients

class ItemsModel {

    //get item details from items table by name
    static async getItemByName(itemName) {
        try {
            const query = `
                SELECT
                    metrcid,
                    name,
                    unit_weight_grams,
                    unit_count,
                    brand_name,
                    strainname,
                    publicingredients,
                    productcategoryname,
                    description
                FROM items
                WHERE name = $1
                AND historical = false
                LIMIT 1
            `;

            const result = await pool.query(query, [itemName]);
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`Error fetching item ${itemName}:`, error);
            throw error;
        }
    }

    //update unit_weight_grams in items table if it's empty
    static async updateUnitWeight(itemName, unitWeight) {
        try {
            const query = `
                UPDATE items
                SET unit_weight_grams = $1,
                    lastmodified = CURRENT_TIMESTAMP
                WHERE name = $2
                AND historical = false
                AND (unit_weight_grams IS NULL OR unit_weight_grams = 0)
            `;

            const result = await pool.query(query, [unitWeight, itemName]);
            logger.info(`Updated unit_weight for ${itemName}: ${result.rowCount} rows affected`);
            return result.rowCount > 0;
        } catch (error) {
            logger.error(`Error updating unit weight for ${itemName}:`, error);
            throw error;
        }
    }

    //update unit_count in items table if it's empty
    static async updateUnitCount(itemName, unitCount) {
        try {
            const query = `
                UPDATE items
                SET unit_count = $1,
                    lastmodified = CURRENT_TIMESTAMP
                WHERE name = $2
                AND historical = false
                AND (unit_count IS NULL OR unit_count = 0)
            `;

            const result = await pool.query(query, [unitCount, itemName]);
            logger.info(`Updated unit_count for ${itemName}: ${result.rowCount} rows affected`);
            return result.rowCount > 0;
        } catch (error) {
            logger.error(`Error updating unit count for ${itemName}:`, error);
            throw error;
        }
    }

    //update brand in items table (always updates)
    static async updateBrand(itemName, brandName) {
        try {
            const query = `
                UPDATE items
                SET brand_name = $1,
                    lastmodified = CURRENT_TIMESTAMP
                WHERE name = $2
                AND historical = false
            `;

            const result = await pool.query(query, [brandName, itemName]);
            logger.info(`Updated brand for ${itemName}: ${result.rowCount} rows affected`);
            return result.rowCount > 0;
        } catch (error) {
            logger.error(`Error updating brand for ${itemName}:`, error);
            throw error;
        }
    }
}

module.exports = ItemsModel;