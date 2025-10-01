const pool = require('../config/database');
const FileUploadService = require('./file-upload-service');
const logger = require('../../Utilities/logger');

// Cleanup Service
// Handles cleanup of incomplete product details with orphaned images
// Grace period: 20 minutes from last_modified timestamp

class CleanupService {

    /**
     * Find incomplete product details that haven't been modified in grace period
     * @param {number} graceMinutes - Grace period in minutes (default 20)
     * @returns {Array} Array of incomplete product detail IDs to clean up
     */
    static async findIncompleteProducts(graceMinutes = 20) {
        try {
            const query = `
                SELECT
                    pd.id,
                    pd.item_name,
                    pd.original_item_name,
                    pd.last_modified,
                    pd.category,
                    pd.brand,
                    pd.default_price,
                    pd.strain_type,
                    pd.product_description,
                    pd.unit_weight,
                    pd.packages_per_case,
                    pd.unit_size_measurement,
                    pd.strain_flavor,
                    COALESCE(
                        (SELECT COUNT(*) FROM "ORDERS-product_images" WHERE product_detail_id = pd.id),
                        0
                    ) as image_count
                FROM "ORDERS-product_details" pd
                WHERE pd.last_modified < NOW() - INTERVAL '${graceMinutes} minutes'
            `;

            const result = await pool.query(query);

            // Filter for truly incomplete products (missing required fields)
            const incompleteProducts = result.rows.filter(product => {
                const missingRequired = !product.category ||
                                       !product.brand ||
                                       !product.default_price ||
                                       !product.strain_type ||
                                       !product.product_description ||
                                       !product.unit_weight ||
                                       !product.packages_per_case ||
                                       !product.unit_size_measurement ||
                                       !product.strain_flavor ||
                                       product.image_count === 0;

                return missingRequired;
            });

            logger.info(`Found ${incompleteProducts.length} incomplete products past grace period`);
            return incompleteProducts;

        } catch (error) {
            logger.error('Error finding incomplete products:', error);
            throw error;
        }
    }

    /**
     * Clean up a single incomplete product and its associated images
     * @param {number} productDetailId - ID of product detail to clean up
     * @returns {Object} Cleanup result
     */
    static async cleanupProduct(productDetailId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Get all images for this product
            const imagesQuery = `
                SELECT id, file_path, file_name
                FROM "ORDERS-product_images"
                WHERE product_detail_id = $1
            `;
            const imagesResult = await client.query(imagesQuery, [productDetailId]);
            const images = imagesResult.rows;

            // Delete image files from filesystem
            for (const image of images) {
                try {
                    await FileUploadService.deleteFile(image.file_path);
                    logger.debug(`Deleted image file: ${image.file_path}`);
                } catch (fileError) {
                    logger.warn(`Failed to delete image file ${image.file_path}:`, fileError);
                    // Continue with database cleanup even if file deletion fails
                }
            }

            // Delete image records from database (cascade will handle this, but explicit is clearer)
            await client.query(`
                DELETE FROM "ORDERS-product_images"
                WHERE product_detail_id = $1
            `, [productDetailId]);

            // Delete product detail record
            const deleteQuery = `
                DELETE FROM "ORDERS-product_details"
                WHERE id = $1
                RETURNING item_name, original_item_name
            `;
            const deleteResult = await client.query(deleteQuery, [productDetailId]);

            await client.query('COMMIT');

            const deletedProduct = deleteResult.rows[0];
            logger.info(`Cleaned up incomplete product: ${deletedProduct?.item_name || deletedProduct?.original_item_name} (ID: ${productDetailId})`);

            return {
                success: true,
                productDetailId,
                itemName: deletedProduct?.item_name || deletedProduct?.original_item_name,
                imagesDeleted: images.length
            };

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error(`Error cleaning up product ${productDetailId}:`, error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Run cleanup process for all incomplete products past grace period
     * @param {number} graceMinutes - Grace period in minutes (default 20)
     * @returns {Object} Cleanup summary
     */
    static async runCleanup(graceMinutes = 20) {
        try {
            logger.info(`Starting cleanup process with ${graceMinutes} minute grace period`);

            const incompleteProducts = await this.findIncompleteProducts(graceMinutes);

            if (incompleteProducts.length === 0) {
                logger.info('No incomplete products to clean up');
                return {
                    success: true,
                    productsFound: 0,
                    productsCleaned: 0,
                    imagesDeleted: 0,
                    errors: []
                };
            }

            const results = {
                success: true,
                productsFound: incompleteProducts.length,
                productsCleaned: 0,
                imagesDeleted: 0,
                errors: []
            };

            for (const product of incompleteProducts) {
                try {
                    const cleanupResult = await this.cleanupProduct(product.id);
                    results.productsCleaned++;
                    results.imagesDeleted += cleanupResult.imagesDeleted;
                } catch (error) {
                    results.errors.push({
                        productId: product.id,
                        itemName: product.item_name || product.original_item_name,
                        error: error.message
                    });
                }
            }

            logger.info(`Cleanup complete: ${results.productsCleaned}/${results.productsFound} products cleaned, ${results.imagesDeleted} images deleted`);

            if (results.errors.length > 0) {
                logger.warn(`Cleanup had ${results.errors.length} errors`);
            }

            return results;

        } catch (error) {
            logger.error('Error running cleanup process:', error);
            throw error;
        }
    }

    /**
     * Start periodic cleanup service (runs every hour)
     * @param {number} intervalMinutes - How often to run cleanup (default 60)
     * @param {number} graceMinutes - Grace period for incomplete products (default 20)
     */
    static startPeriodicCleanup(intervalMinutes = 60, graceMinutes = 20) {
        logger.info(`Starting periodic cleanup service: runs every ${intervalMinutes} minutes with ${graceMinutes} minute grace period`);

        // Run immediately on start
        this.runCleanup(graceMinutes).catch(error => {
            logger.error('Error in initial cleanup run:', error);
        });

        // Then run periodically
        setInterval(async () => {
            try {
                await this.runCleanup(graceMinutes);
            } catch (error) {
                logger.error('Error in periodic cleanup run:', error);
            }
        }, intervalMinutes * 60 * 1000);
    }
}

module.exports = CleanupService;
