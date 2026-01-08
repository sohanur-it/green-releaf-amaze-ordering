/**
 * Product Controller
 * Handles all product management UI and operations
 */

const { Pool } = require('pg');
const productImageService = require('../Services/productImageService');
const { uploadMultiple, handleUploadError } = require('../Middleware/upload');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000
});

/**
 * Show all products page
 */
exports.getAllProducts = async (req, res) => {
    const client = await pool.connect();
    try {
        // Set query timeout to prevent hanging
        await client.query('SET statement_timeout = 30000'); // 30 seconds
        
        // Check if user wants to see archived products
        const showArchived = req.query.show_archived === 'true';
        
        const result = await client.query(`
            SELECT 
                p.*,
                COUNT(b.id) as batch_count,
                GREATEST(0, SUM(CASE 
                    WHEN b.status = 'Sellable' THEN GREATEST(0, b.quantity - GREATEST(0, COALESCE(b.allocated_quantity, 0))) 
                    ELSE 0 
                END)) as available_quantity,
                (
                    SELECT file_path 
                    FROM "ORDERS-product-images" pi
                    WHERE pi.fk_product_id = p.entry_id
                      AND pi.is_deleted = false
                      AND pi.is_featured = true
                    ORDER BY pi.uploaded_at ASC
                    LIMIT 1
                ) as primary_image_path
            FROM "ORDERS-products" p
            LEFT JOIN "ORDERS-batches" b ON p.entry_id = b.fk_master_product_id
            ${showArchived ? '' : 'WHERE p.is_archived = FALSE OR p.is_archived IS NULL'}
            GROUP BY p.entry_id
            ORDER BY p.is_archived NULLS FIRST, p.created_at DESC NULLS LAST, p.entry_id DESC
        `);

        // Add primary image URL to each product
        const products = result.rows.map(product => ({
            ...product,
            primary_image_url: product.primary_image_path ? `/public/${product.primary_image_path}` : null
        }));

        res.render('admin/products/index', {
            title: 'Master Products',
            layout: 'layouts/main',
            products: products,
            showArchived: showArchived,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).send('Error loading products: ' + error.message);
    } finally {
        client.release();
    }
};

/**
 * Show create product form
 */
exports.showCreateProductForm = async (req, res) => {
    try {
        // Get distinct categories from existing products
        const categoriesResult = await pool.query(`
            SELECT DISTINCT category_name 
            FROM "ORDERS-products" 
            WHERE category_name IS NOT NULL 
            ORDER BY category_name
        `);

        res.render('admin/products/create', {
            title: 'Create Master Product',
            layout: 'layouts/main',
            categories: categoriesResult.rows.map(r => r.category_name),
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading create form:', error);
        res.status(500).send('Error loading form');
    }
};

/**
 * Create new product
 */
exports.createProduct = async (req, res) => {
    try {
        const {
            name,
            category_name,
            default_price,
            description,
            brand_name,
            product_type_name,
            cultivar_name,
            lineage
        } = req.body;

        const result = await pool.query(`
            INSERT INTO "ORDERS-products" (
                name, category_name, default_price, description,
                brand_name, product_type_name, cultivar_name, lineage,
                metrc_linked_items, price_updated_at, price_updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
            RETURNING entry_id
        `, [
            name,
            category_name,
            parseFloat(default_price) || null,
            description || null,
            brand_name || null,
            product_type_name || null,
            cultivar_name || null,
            lineage || null,
            JSON.stringify([]),
            req.session.userId || null
        ]);

        const productId = result.rows[0].entry_id;

        // Handle image uploads if any
        if (req.files && req.files.length > 0) {
            try {
                await productImageService.saveProductImages(
                    productId,
                    req.files,
                    req.session.userId || null
                );
            } catch (imageError) {
                console.error('Error saving product images:', imageError);
                // Continue even if image upload fails
            }
        }

        // Redirect to link items page
        res.redirect(`/admin/products/${productId}/link-items`);
    } catch (error) {
        console.error('Error creating product:', error);
        res.status(500).send('Error creating product: ' + error.message);
    }
};

/**
 * Upload product images
 * POST /api/admin/products/:id/images
 */
exports.uploadProductImages = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session?.userId || req.user?.id;

        console.log('Upload request:', {
            productId: id,
            userId: userId,
            filesCount: req.files?.length || 0,
            files: req.files?.map(f => ({ name: f.originalname, size: f.size })) || []
        });

        if (!req.files || req.files.length === 0) {
            console.log('No files in request');
            return res.status(400).json({
                success: false,
                error: 'No files uploaded'
            });
        }

        const imageIds = await productImageService.saveProductImages(
            parseInt(id),
            req.files,
            userId
        );

        console.log('Images saved:', imageIds);

        // Get updated images list
        const images = await productImageService.getProductImages(parseInt(id));

        res.json({
            success: true,
            message: `${imageIds.length} image(s) uploaded successfully`,
            images: images
        });
    } catch (error) {
        console.error('Error uploading product images:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Failed to upload images',
            details: error.message
        });
    }
};

/**
 * Get product images
 * GET /api/admin/products/:id/images
 */
exports.getProductImages = async (req, res) => {
    try {
        const { id } = req.params;
        const images = await productImageService.getProductImages(parseInt(id));

        res.json({
            success: true,
            images: images
        });
    } catch (error) {
        console.error('Error getting product images:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get images',
            details: error.message
        });
    }
};

/**
 * Delete product image
 * DELETE /api/admin/products/:id/images/:imageId
 */
exports.deleteProductImage = async (req, res) => {
    try {
        const { imageId } = req.params;
        const userId = req.session.userId || req.user?.id;

        const result = await productImageService.deleteProductImage(
            parseInt(imageId),
            userId
        );

        if (result.success) {
            res.json({
                success: true,
                message: 'Image deleted successfully'
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error
            });
        }
    } catch (error) {
        console.error('Error deleting product image:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete image',
            details: error.message
        });
    }
};

/**
 * Set featured image
 * POST /api/admin/products/:id/images/:imageId/featured
 */
exports.setFeaturedImage = async (req, res) => {
    try {
        const { id, imageId } = req.params;

        const result = await productImageService.setFeaturedImage(
            parseInt(imageId),
            parseInt(id)
        );

        if (result.success) {
            // Get updated images list
            const images = await productImageService.getProductImages(parseInt(id));

            res.json({
                success: true,
                message: 'Featured image updated successfully',
                images: images
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error || 'Failed to set featured image'
            });
        }
    } catch (error) {
        console.error('Error setting featured image:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to set featured image',
            details: error.message
        });
    }
};

/**
 * Show product image management modal/page
 * GET /admin/products/:id/images/manage
 */
exports.showImageManagement = async (req, res) => {
    try {
        const { id } = req.params;

        // Get product
        const productResult = await pool.query(`
            SELECT entry_id, name FROM "ORDERS-products" WHERE entry_id = $1
        `, [id]);

        if (productResult.rows.length === 0) {
            return res.status(404).send('Product not found');
        }

        // Get existing images
        const images = await productImageService.getProductImages(parseInt(id));

        res.render('admin/products/image-management', {
            title: 'Manage Product Images',
            layout: 'layouts/main',
            product: productResult.rows[0],
            images: images,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading image management:', error);
        res.status(500).send('Error loading page: ' + error.message);
    }
};

/**
 * Show link METRC items page
 */
exports.showLinkItemsPage = async (req, res) => {
    try {
        const productId = req.params.id;

        // Get the product
        const productResult = await pool.query(`
            SELECT * FROM "ORDERS-products" WHERE entry_id = $1
        `, [productId]);

        if (productResult.rows.length === 0) {
            return res.status(404).send('Product not found');
        }

        const product = productResult.rows[0];
        const linkedItems = product.metrc_linked_items || [];

        // Get all available METRC items - FILTERED by Bud/Flower Final Packaging only
        const itemsResult = await pool.query(`
            SELECT DISTINCT name, productcategoryname, unitofmeasurename
            FROM items 
            WHERE sync_license IN ('CUL000063', 'MAN000072')
              AND productcategoryname ILIKE '%Final Packaging%'
              AND name IS NOT NULL
              AND name != ''
            ORDER BY name
        `);

        res.render('admin/products/link-items', {
            title: 'Link METRC Items',
            layout: 'layouts/main',
            product: product,
            linkedItems: linkedItems,
            availableItems: itemsResult.rows.map(r => r.name),
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading link items page:', error);
        res.status(500).send('Error loading page: ' + error.message);
    }
};

/**
 * Show product details
 */
exports.getProductById = async (req, res) => {
    try {
        const productId = req.params.id;

        const productResult = await pool.query(`
            SELECT * FROM "ORDERS-products" WHERE entry_id = $1
        `, [productId]);

        if (productResult.rows.length === 0) {
            return res.status(404).send('Product not found');
        }

        const product = productResult.rows[0];
        
        // OPTIONAL: Only refresh batches if explicitly requested via query parameter
        // This prevents slow page loads on every view
        // Users can click "Refresh from METRC" button for manual refresh
        const refreshBatches = req.query.refresh === 'true';
        
        if (refreshBatches && product.metrc_linked_items && product.metrc_linked_items.length > 0) {
            try {
                const BatchSyncService = require('../Services/BatchSyncService');
                const batchSyncService = new BatchSyncService();
                const linkedItems = Array.isArray(product.metrc_linked_items) 
                    ? product.metrc_linked_items 
                    : JSON.parse(product.metrc_linked_items || '[]');
                
                if (linkedItems.length > 0) {
                    console.log(`🔄 Refreshing batches for product ${productId} (explicitly requested)...`);
                    // Pass productId to ensure batches are linked to this product
                    await batchSyncService.refreshBatchesForItems(linkedItems, productId);
                    console.log(`✅ Batches refreshed for product ${productId}`);
                    await batchSyncService.close();
                }
            } catch (refreshError) {
                console.warn(`⚠️ Failed to refresh batches for product ${productId}:`, refreshError.message);
                // Continue even if refresh fails - will show current DB state
            }
        }

        // Get batches for this product (after refresh)
        const batchesResult = await pool.query(`
            SELECT * FROM "ORDERS-batches" 
            WHERE fk_master_product_id = $1
            ORDER BY status, production_date DESC
        `, [productId]);

        // Calculate available partial packages for each batch
        // (exclude those allocated to active invoices)
        const batchesWithAvailablePartials = await Promise.all(
            batchesResult.rows.map(async (batch) => {
                if (!batch.partial_package_details || batch.partial_package_count === 0) {
                    return {
                        ...batch,
                        available_partial_count: 0
                    };
                }

                const partialPackageDetails = batch.partial_package_details.partial_packages || [];
                
                // Check which packages are allocated to active invoices
                // Use case-insensitive comparison by normalizing labels to uppercase
                const availablePartials = await Promise.all(
                    partialPackageDetails.map(async (pkg) => {
                        const normalizedLabel = String(pkg.label).toUpperCase();
                        const allocationCheck = await pool.query(`
                            SELECT 
                                i.id as invoice_id,
                                i.status
                            FROM "ORDERS-invoice-line-items" li
                            INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                            WHERE li.fk_batch_id = $1
                              AND li.specific_package_labels IS NOT NULL
                              AND EXISTS (
                                  SELECT 1
                                  FROM jsonb_array_elements_text(li.specific_package_labels) AS label
                                  WHERE UPPER(label) = $2
                              )
                              AND i.status NOT IN ('Cancelled', 'Voided', 'Paid', 'Fully_Rejected')
                        `, [batch.id, normalizedLabel]);

                        return allocationCheck.rows.length === 0; // Available if not allocated
                    })
                );

                const availableCount = availablePartials.filter(available => available).length;

                return {
                    ...batch,
                    available_partial_count: availableCount
                };
            })
        );

        // Helper function to decode HTML entities
        function decodeHtmlEntities(str) {
            if (!str) return str;
            return str.replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
        }

        // Decode HTML entities in description and lineage if they exist
        if (product.description) {
            product.description = decodeHtmlEntities(product.description);
        }
        if (product.lineage) {
            product.lineage = decodeHtmlEntities(product.lineage);
        }

        res.render('admin/products/details', {
            title: 'Product Details',
            layout: 'layouts/main',
            product: product,
            batches: batchesWithAvailablePartials,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).send('Error loading product');
    }
};

module.exports = exports;

