/**
 * Product Image Service
 * 
 * Handles product image management operations
 */

const { query } = require('../config/database');
const fs = require('fs');
const path = require('path');

class ProductImageService {
    /**
     * Get all images for a product
     * @param {number} productId - Product ID
     * @returns {Array} - Array of image objects
     */
    async getProductImages(productId) {
        try {
            const result = await query(`
                SELECT 
                    id,
                    fk_product_id,
                    filename,
                    original_filename,
                    file_path,
                    file_size,
                    mime_type,
                    display_order,
                    is_featured,
                    alt_text,
                    uploaded_at
                FROM "ORDERS-product-images"
                WHERE fk_product_id = $1
                  AND is_deleted = false
                ORDER BY is_featured DESC, display_order ASC, uploaded_at ASC
            `, [productId]);

            return result.rows.map(row => ({
                ...row,
                url: `/public/${row.file_path}` // Public URL for accessing the image
            }));
        } catch (error) {
            console.error('Error getting product images:', error);
            throw error;
        }
    }

    /**
     * Get primary/featured image for a product
     * @param {number} productId - Product ID
     * @returns {Object|null} - Featured image or null
     */
    async getPrimaryImage(productId) {
        try {
            const result = await query(`
                SELECT 
                    id,
                    filename,
                    file_path,
                    alt_text
                FROM "ORDERS-product-images"
                WHERE fk_product_id = $1
                  AND is_deleted = false
                  AND is_featured = true
                ORDER BY uploaded_at ASC
                LIMIT 1
            `, [productId]);

            if (result.rows.length === 0) {
                return null;
            }

            const image = result.rows[0];
            return {
                ...image,
                url: `/public/${image.file_path}`
            };
        } catch (error) {
            console.error('Error getting primary image:', error);
            return null;
        }
    }

    /**
     * Save uploaded image(s) to database
     * @param {number} productId - Product ID
     * @param {Array} files - Array of multer file objects
     * @param {number} userId - User ID who uploaded
     * @returns {Array} - Array of saved image IDs
     */
    async saveProductImages(productId, files, userId) {
        try {
            if (!files || files.length === 0) {
                return [];
            }

            // Get current max display_order
            const currentMax = await query(`
                SELECT COALESCE(MAX(display_order), -1) as max_order
                FROM "ORDERS-product-images"
                WHERE fk_product_id = $1 AND is_deleted = false
            `, [productId]);

            let nextOrder = (currentMax.rows[0].max_order || -1) + 1;

            // Check if product already has a featured image
            const hasFeatured = await query(`
                SELECT COUNT(*) as count
                FROM "ORDERS-product-images"
                WHERE fk_product_id = $1 
                  AND is_deleted = false 
                  AND is_featured = true
            `, [productId]);

            const isFirstImage = hasFeatured.rows[0].count === 0;
            const imageIds = [];

            for (const file of files) {
                const filePath = `product/images/${file.filename}`;
                
                const result = await query(`
                    INSERT INTO "ORDERS-product-images" (
                        fk_product_id,
                        filename,
                        original_filename,
                        file_path,
                        file_size,
                        mime_type,
                        display_order,
                        is_featured,
                        uploaded_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    RETURNING id
                `, [
                    productId,
                    file.filename,
                    file.originalname,
                    filePath,
                    file.size,
                    file.mimetype,
                    nextOrder,
                    isFirstImage && nextOrder === 0, // First image (order 0) is featured if no featured exists
                    userId
                ]);

                imageIds.push(result.rows[0].id);
                nextOrder++;
            }

            return imageIds;
        } catch (error) {
            console.error('Error saving product images:', error);
            throw error;
        }
    }

    /**
     * Delete product image (soft delete)
     * @param {number} imageId - Image ID
     * @param {number} userId - User ID
     * @returns {boolean} - Success status
     */
    async deleteProductImage(imageId, userId) {
        try {
            // Get image info first
            const image = await query(`
                SELECT file_path, fk_product_id, is_featured
                FROM "ORDERS-product-images"
                WHERE id = $1 AND is_deleted = false
            `, [imageId]);

            if (image.rows.length === 0) {
                return { success: false, error: 'Image not found' };
            }

            const imageData = image.rows[0];

            // Soft delete
            await query(`
                UPDATE "ORDERS-product-images"
                SET is_deleted = true,
                    deleted_at = NOW(),
                    deleted_by = $1
                WHERE id = $2
            `, [userId, imageId]);

            // Delete physical file
            const filePath = path.join(__dirname, '../../public', imageData.file_path);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            // If this was the featured image, promote next image to featured
            if (imageData.is_featured) {
                await this.promoteNextFeaturedImage(imageData.fk_product_id);
            }

            return { success: true };
        } catch (error) {
            console.error('Error deleting product image:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Promote next image to featured
     * @param {number} productId - Product ID
     */
    async promoteNextFeaturedImage(productId) {
        try {
            // Get next image by display_order
            const next = await query(`
                SELECT id
                FROM "ORDERS-product-images"
                WHERE fk_product_id = $1
                  AND is_deleted = false
                  AND is_featured = false
                ORDER BY display_order ASC, uploaded_at ASC
                LIMIT 1
            `, [productId]);

            if (next.rows.length > 0) {
                // Update this image to be featured
                await query(`
                    UPDATE "ORDERS-product-images"
                    SET is_featured = true
                    WHERE id = $1
                `, [next.rows[0].id]);
            }
        } catch (error) {
            console.error('Error promoting featured image:', error);
        }
    }

    /**
     * Set an image as featured (unset others)
     * @param {number} imageId - Image ID
     * @param {number} productId - Product ID
     * @returns {boolean} - Success status
     */
    async setFeaturedImage(imageId, productId) {
        try {
            const client = await require('../config/database').pool.connect();
            
            try {
                await client.query('BEGIN');

                // Unset all other featured images for this product
                await client.query(`
                    UPDATE "ORDERS-product-images"
                    SET is_featured = false
                    WHERE fk_product_id = $1
                      AND is_deleted = false
                      AND id != $2
                `, [productId, imageId]);

                // Set this image as featured
                await client.query(`
                    UPDATE "ORDERS-product-images"
                    SET is_featured = true
                    WHERE id = $1
                      AND fk_product_id = $2
                      AND is_deleted = false
                `, [imageId, productId]);

                await client.query('COMMIT');
                return { success: true };
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error setting featured image:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Reorder images
     * @param {number} productId - Product ID
     * @param {Array} imageIds - Array of image IDs in new order
     * @returns {boolean} - Success status
     */
    async reorderImages(productId, imageIds) {
        try {
            const client = await require('../config/database').pool.connect();
            
            try {
                await client.query('BEGIN');

                for (let i = 0; i < imageIds.length; i++) {
                    await client.query(`
                        UPDATE "ORDERS-product-images"
                        SET display_order = $1
                        WHERE id = $2 AND fk_product_id = $3
                    `, [i, imageIds[i], productId]);
                }

                await client.query('COMMIT');
                return { success: true };
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error reordering images:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update image alt text
     * @param {number} imageId - Image ID
     * @param {string} altText - Alt text
     * @returns {boolean} - Success status
     */
    async updateImageAltText(imageId, altText) {
        try {
            await query(`
                UPDATE "ORDERS-product-images"
                SET alt_text = $1
                WHERE id = $2
            `, [altText, imageId]);

            return { success: true };
        } catch (error) {
            console.error('Error updating alt text:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new ProductImageService();

