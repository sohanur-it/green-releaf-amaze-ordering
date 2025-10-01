const pool = require('../config/database');
const logger = require('../../Utilities/logger');

//product images model - handles ORDERS-product_images table operations

class ProductImagesModel {

    //get all images for a product
    static async getByProductId(productDetailId) {
        try {
            const query = `
                SELECT * FROM "ORDERS-product_images"
                WHERE product_detail_id = $1
                ORDER BY sort_order, id
            `;
            const result = await pool.query(query, [productDetailId]);
            return result.rows;
        } catch (error) {
            logger.error(`Error fetching images for product ${productDetailId}:`, error);
            throw error;
        }
    }

    //add new image
    static async create(data) {
        try {
            const query = `
                INSERT INTO "ORDERS-product_images" (
                    product_detail_id, file_name, file_path, file_size,
                    mime_type, sort_order, is_primary, uploaded_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `;

            const values = [
                data.product_detail_id,
                data.file_name,
                data.file_path,
                data.file_size || null,
                data.mime_type || null,
                data.sort_order || 999,
                data.is_primary || false,
                data.uploaded_by || 'system'
            ];

            const result = await pool.query(query, values);
            logger.info(`Added image ${data.file_name} for product ${data.product_detail_id}`);
            return result.rows[0];
        } catch (error) {
            logger.error('Error adding product image:', error);
            throw error;
        }
    }

    //update image sort order
    static async updateSortOrder(imageId, sortOrder, isPrimary = false) {
        try {
            const query = `
                UPDATE "ORDERS-product_images"
                SET sort_order = $2,
                    is_primary = $3
                WHERE id = $1
                RETURNING *
            `;
            const result = await pool.query(query, [imageId, sortOrder, isPrimary]);
            return result.rows[0];
        } catch (error) {
            logger.error(`Error updating sort order for image ${imageId}:`, error);
            throw error;
        }
    }

    //bulk update sort orders for a product
    static async bulkUpdateSortOrders(productDetailId, imageOrders) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            //imageOrders is array of {id, sort_order, is_primary}
            for (const imageOrder of imageOrders) {
                await client.query(`
                    UPDATE "ORDERS-product_images"
                    SET sort_order = $2,
                        is_primary = $3
                    WHERE id = $1
                    AND product_detail_id = $4
                `, [imageOrder.id, imageOrder.sort_order, imageOrder.is_primary || false, productDetailId]);
            }

            await client.query('COMMIT');
            logger.info(`Updated sort orders for product ${productDetailId}`);
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error bulk updating sort orders:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    //delete an image
    static async delete(imageId) {
        try {
            const query = `
                DELETE FROM "ORDERS-product_images"
                WHERE id = $1
                RETURNING file_path
            `;
            const result = await pool.query(query, [imageId]);
            logger.info(`Deleted image ${imageId}`);
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`Error deleting image ${imageId}:`, error);
            throw error;
        }
    }

    //get primary image for a product
    static async getPrimaryImage(productDetailId) {
        try {
            const query = `
                SELECT * FROM "ORDERS-product_images"
                WHERE product_detail_id = $1
                AND is_primary = true
                LIMIT 1
            `;
            const result = await pool.query(query, [productDetailId]);

            //if no primary, get first by sort order
            if (result.rowCount === 0) {
                const fallbackQuery = `
                    SELECT * FROM "ORDERS-product_images"
                    WHERE product_detail_id = $1
                    ORDER BY sort_order, id
                    LIMIT 1
                `;
                const fallbackResult = await pool.query(fallbackQuery, [productDetailId]);
                return fallbackResult.rows[0] || null;
            }

            return result.rows[0];
        } catch (error) {
            logger.error(`Error fetching primary image for product ${productDetailId}:`, error);
            throw error;
        }
    }
}

module.exports = ProductImagesModel;