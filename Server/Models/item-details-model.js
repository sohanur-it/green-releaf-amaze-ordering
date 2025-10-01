const pool = require('../config/database');
const logger = require('../../Utilities/logger');

//item details model - handles ORDERS-product_details table operations

class ItemDetailsModel {

    //get product details by item name
    static async getByItemName(itemName) {
        try {
            const query = `
                SELECT * FROM "ORDERS-product_details"
                WHERE item_name = $1
            `;
            const result = await pool.query(query, [itemName]);
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`Error fetching product details for ${itemName}:`, error);
            throw error;
        }
    }

    //get all product details
    static async getAll() {
        try {
            const query = `
                SELECT * FROM "ORDERS-product_details"
                ORDER BY item_name
            `;
            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            logger.error('Error fetching all product details:', error);
            throw error;
        }
    }

    //check if product details exist for item name
    static async exists(itemName) {
        try {
            const query = `
                SELECT EXISTS(
                    SELECT 1 FROM "ORDERS-product_details"
                    WHERE item_name = $1
                ) as exists
            `;
            const result = await pool.query(query, [itemName]);
            return result.rows[0].exists;
        } catch (error) {
            logger.error(`Error checking if details exist for ${itemName}:`, error);
            throw error;
        }
    }

    //create new product details
    static async create(data) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const query = `
                INSERT INTO "ORDERS-product_details" (
                    item_name, original_item_name, display_item_name, sku, category, brand, strain_flavor, strain_type,
                    default_price, unit_weight, packages_per_case, unit_size_measurement,
                    ingredients, product_description, internal_notes,
                    list_to_buyers, featured_product, created_by, updated_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                RETURNING *
            `;

            const values = [
                data.item_name,
                data.original_item_name || data.item_name, // Set original to current if not provided
                data.display_item_name || null,
                data.sku || null,
                data.category,
                data.brand,
                data.strain_flavor || null,
                data.strain_type,
                data.default_price,
                data.unit_weight || null,
                data.packages_per_case || null,
                data.unit_size_measurement || null,
                data.ingredients || null,
                data.product_description || null,
                data.internal_notes || null,
                data.list_to_buyers !== undefined ? data.list_to_buyers : true,
                data.featured_product !== undefined ? data.featured_product : false,
                data.created_by || 'system',
                data.updated_by || 'system'
            ];

            const result = await client.query(query, values);

            //insert buyer visibility if provided
            if (data.buyer_types && data.buyer_types.length > 0) {
                await this._insertBuyerVisibility(client, result.rows[0].id, data.buyer_types);
            }

            await client.query('COMMIT');
            logger.info(`Created product details for ${data.item_name}`);
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error creating product details:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    //update existing product details
    static async update(itemName, data) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const query = `
                UPDATE "ORDERS-product_details"
                SET
                    display_item_name = $2,
                    sku = $3,
                    category = $4,
                    brand = $5,
                    strain_flavor = $6,
                    strain_type = $7,
                    default_price = $8,
                    unit_weight = $9,
                    packages_per_case = $10,
                    unit_size_measurement = $11,
                    ingredients = $12,
                    product_description = $13,
                    internal_notes = $14,
                    list_to_buyers = $15,
                    featured_product = $16,
                    updated_at = CURRENT_TIMESTAMP,
                    updated_by = $17
                WHERE item_name = $1
                RETURNING *
            `;

            const values = [
                itemName,
                data.display_item_name || null,
                data.sku || null,
                data.category,
                data.brand,
                data.strain_flavor || null,
                data.strain_type,
                data.default_price,
                data.unit_weight || null,
                data.packages_per_case || null,
                data.unit_size_measurement || null,
                data.ingredients || null,
                data.product_description || null,
                data.internal_notes || null,
                data.list_to_buyers !== undefined ? data.list_to_buyers : true,
                data.featured_product !== undefined ? data.featured_product : false,
                data.updated_by || 'system'
            ];

            const result = await client.query(query, values);

            //update buyer visibility if provided
            if (data.buyer_types && result.rows[0]) {
                await this._updateBuyerVisibility(client, result.rows[0].id, data.buyer_types);
            }

            await client.query('COMMIT');
            logger.info(`Updated product details for ${itemName}`);
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error updating product details:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    //delete product details
    static async delete(itemName) {
        try {
            const query = `
                DELETE FROM "ORDERS-product_details"
                WHERE item_name = $1
            `;
            const result = await pool.query(query, [itemName]);
            logger.info(`Deleted product details for ${itemName}`);
            return result.rowCount > 0;
        } catch (error) {
            logger.error(`Error deleting product details for ${itemName}:`, error);
            throw error;
        }
    }

    //get product details with images
    static async getWithImages(itemName) {
        try {
            const query = `
                SELECT
                    pd.*,
                    json_agg(
                        json_build_object(
                            'id', pi.id,
                            'file_name', pi.file_name,
                            'file_path', pi.file_path,
                            'sort_order', pi.sort_order,
                            'is_primary', pi.is_primary
                        ) ORDER BY pi.sort_order
                    ) FILTER (WHERE pi.id IS NOT NULL) as images
                FROM "ORDERS-product_details" pd
                LEFT JOIN "ORDERS-product_images" pi ON pd.id = pi.product_detail_id
                WHERE pd.item_name = $1
                GROUP BY pd.id
            `;
            const result = await pool.query(query, [itemName]);
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`Error fetching product details with images for ${itemName}:`, error);
            throw error;
        }
    }

    //get items with details for order page (only items that should be listed)
    static async getListableItems() {
        try {
            const query = `
                SELECT
                    pd.*,
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', pi.id,
                                'file_path', pi.file_path,
                                'sort_order', pi.sort_order,
                                'is_primary', pi.is_primary
                            ) ORDER BY pi.sort_order
                        )
                        FROM "ORDERS-product_images" pi
                        WHERE pi.product_detail_id = pd.id
                    ) as images
                FROM "ORDERS-product_details" pd
                WHERE pd.list_to_buyers = true
                ORDER BY pd.featured_product DESC, pd.item_name
            `;
            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            logger.error('Error fetching listable items:', error);
            throw error;
        }
    }

    //helper: insert buyer visibility records
    static async _insertBuyerVisibility(client, productDetailId, buyerTypeCodes) {
        //get buyer type ids from codes
        const buyerTypeQuery = `
            SELECT id FROM "ORDERS-buyer_types"
            WHERE buyer_type_code = ANY($1)
        `;
        const buyerTypeResult = await client.query(buyerTypeQuery, [buyerTypeCodes]);

        //insert visibility records
        for (const buyerType of buyerTypeResult.rows) {
            await client.query(`
                INSERT INTO "ORDERS-product_buyer_visibility"
                (product_detail_id, buyer_type_id, is_visible)
                VALUES ($1, $2, true)
            `, [productDetailId, buyerType.id]);
        }
    }

    //helper: update buyer visibility records
    static async _updateBuyerVisibility(client, productDetailId, buyerTypeCodes) {
        //delete existing visibility records
        await client.query(`
            DELETE FROM "ORDERS-product_buyer_visibility"
            WHERE product_detail_id = $1
        `, [productDetailId]);

        //insert new records
        await this._insertBuyerVisibility(client, productDetailId, buyerTypeCodes);
    }

    //get all product details with images and batch counts for admin table
    static async getAllWithMetadata() {
        try {
            const query = `
                SELECT
                    pd.*,
                    COALESCE(
                        (SELECT COUNT(*) FROM "ORDERS-product_images" WHERE product_detail_id = pd.id),
                        0
                    ) as image_count,
                    COALESCE(
                        (SELECT COUNT(*) FROM "ORDERS-batch_staging" WHERE name = pd.original_item_name AND is_active = true),
                        0
                    ) as batch_count,
                    COALESCE(
                        (SELECT SUM(full_package_count) FROM "ORDERS-batch_staging" WHERE name = pd.original_item_name AND is_active = true),
                        0
                    ) as total_packages,
                    (
                        SELECT json_agg(
                            json_build_object(
                                'id', pi.id,
                                'file_path', pi.file_path,
                                'sort_order', pi.sort_order,
                                'is_primary', pi.is_primary
                            ) ORDER BY pi.sort_order
                        )
                        FROM "ORDERS-product_images" pi
                        WHERE pi.product_detail_id = pd.id
                    ) as images
                FROM "ORDERS-product_details" pd
                ORDER BY pd.item_name
            `;
            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            logger.error('Error fetching all product details with metadata:', error);
            throw error;
        }
    }

    //update a single field for inline editing
    static async updateField(itemName, fieldName, fieldValue) {
        try {
            // Validate field name to prevent SQL injection
            const allowedFields = [
                'display_item_name', 'sku', 'category', 'brand', 'strain_flavor',
                'strain_type', 'default_price', 'unit_weight', 'packages_per_case',
                'unit_size_measurement', 'product_description', 'internal_notes',
                'list_to_buyers', 'featured_product'
            ];

            if (!allowedFields.includes(fieldName)) {
                throw new Error(`Field ${fieldName} is not allowed for inline editing`);
            }

            const query = `
                UPDATE "ORDERS-product_details"
                SET ${fieldName} = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_name = $1
                RETURNING *
            `;

            const result = await pool.query(query, [itemName, fieldValue]);

            if (result.rowCount === 0) {
                throw new Error(`Product with item_name ${itemName} not found`);
            }

            logger.info(`Updated field ${fieldName} for ${itemName}`);
            return result.rows[0];
        } catch (error) {
            logger.error(`Error updating field ${fieldName} for ${itemName}:`, error);
            throw error;
        }
    }

    //get by original_item_name (for staging table lookups)
    static async getByOriginalItemName(originalItemName) {
        try {
            const query = `
                SELECT * FROM "ORDERS-product_details"
                WHERE original_item_name = $1
            `;
            const result = await pool.query(query, [originalItemName]);
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`Error fetching product details by original name ${originalItemName}:`, error);
            throw error;
        }
    }
}

module.exports = ItemDetailsModel;