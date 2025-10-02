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

    /**
     * Update list_to_buyers for all products sharing the same display_item_name
     * This ensures that when one product in a group becomes sellable, all related products are shown
     * @param {string} displayItemName - The display_item_name to update
     * @param {boolean} listToBuyers - Whether to show products to buyers
     * @returns {number} Number of rows updated
     */
    static async updateListToBuyersByDisplayName(displayItemName, listToBuyers) {
        try {
            const query = `
                UPDATE "ORDERS-product_details"
                SET list_to_buyers = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE COALESCE(display_item_name, original_item_name) = $1
                RETURNING *
            `;
            const result = await pool.query(query, [displayItemName, listToBuyers]);
            logger.info(`Updated list_to_buyers=${listToBuyers} for ${result.rowCount} products with display_item_name=${displayItemName}`);
            return result.rowCount;
        } catch (error) {
            logger.error(`Error updating list_to_buyers for display_item_name ${displayItemName}:`, error);
            throw error;
        }
    }

    /**
     * Get all products with the same display_item_name
     * @param {string} displayItemName - The display_item_name to search for
     * @returns {Array} Array of product records
     */
    static async getAllByDisplayName(displayItemName) {
        try {
            const query = `
                SELECT * FROM "ORDERS-product_details"
                WHERE COALESCE(display_item_name, original_item_name) = $1
                ORDER BY last_modified DESC NULLS LAST
            `;
            const result = await pool.query(query, [displayItemName]);
            return result.rows;
        } catch (error) {
            logger.error(`Error fetching products by display_item_name ${displayItemName}:`, error);
            throw error;
        }
    }

    // ============================================
    // MASTER/CHILD PAIRING METHODS
    // ============================================

    /**
     * Get the master (parent) product for a given product
     * @param {number} productId - The product ID
     * @returns {Object|null} Master product or null if this is not a child
     */
    static async getMasterProduct(productId) {
        try {
            const query = `
                SELECT parent.*
                FROM "ORDERS-product_details" child
                INNER JOIN "ORDERS-product_details" parent ON child.parent_product_id = parent.id
                WHERE child.id = $1
            `;
            const result = await pool.query(query, [productId]);
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`Error fetching master product for product ID ${productId}:`, error);
            throw error;
        }
    }

    /**
     * Get all child products for a given master product
     * @param {number} masterProductId - The master product ID
     * @returns {Array} Array of child products
     */
    static async getChildProducts(masterProductId) {
        try {
            const query = `
                SELECT * FROM "ORDERS-product_details"
                WHERE parent_product_id = $1
                ORDER BY original_item_name
            `;
            const result = await pool.query(query, [masterProductId]);
            return result.rows;
        } catch (error) {
            logger.error(`Error fetching child products for master ID ${masterProductId}:`, error);
            throw error;
        }
    }

    /**
     * Get product with inheritance - if it's a child, return master's data merged with child's identity
     * @param {string} itemName - item_name to lookup
     * @returns {Object|null} Product with inherited data if applicable
     */
    static async getProductWithInheritance(itemName) {
        try {
            const query = `
                SELECT
                    child.*,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.id ELSE child.id END as effective_id,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.display_item_name ELSE child.display_item_name END as effective_display_name,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.category ELSE child.category END as effective_category,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.brand ELSE child.brand END as effective_brand,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.strain_flavor ELSE child.strain_flavor END as effective_strain_flavor,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.strain_type ELSE child.strain_type END as effective_strain_type,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.default_price ELSE child.default_price END as effective_default_price,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.unit_weight ELSE child.unit_weight END as effective_unit_weight,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.packages_per_case ELSE child.packages_per_case END as effective_packages_per_case,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.unit_size_measurement ELSE child.unit_size_measurement END as effective_unit_size_measurement,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.product_description ELSE child.product_description END as effective_product_description,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.list_to_buyers ELSE child.list_to_buyers END as effective_list_to_buyers,
                    CASE WHEN child.parent_product_id IS NOT NULL THEN parent.featured_product ELSE child.featured_product END as effective_featured_product,
                    parent.id as master_id,
                    parent.item_name as master_item_name
                FROM "ORDERS-product_details" child
                LEFT JOIN "ORDERS-product_details" parent ON child.parent_product_id = parent.id
                WHERE child.item_name = $1
            `;
            const result = await pool.query(query, [itemName]);
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`Error fetching product with inheritance for ${itemName}:`, error);
            throw error;
        }
    }

    /**
     * Validate if a product can become a master (has all required fields + display_item_name)
     * Note: Images are NOT required for pairing (82% completion is sufficient)
     * @param {number} productId - The product ID
     * @returns {Object} { isValid: boolean, missingFields: string[] }
     */
    static async validateMasterRequirements(productId) {
        try {
            const query = `
                SELECT
                    id,
                    display_item_name,
                    category,
                    brand,
                    strain_type,
                    default_price,
                    unit_weight,
                    packages_per_case,
                    unit_size_measurement,
                    strain_flavor,
                    product_description
                FROM "ORDERS-product_details"
                WHERE id = $1
            `;
            const result = await pool.query(query, [productId]);

            if (!result.rows[0]) {
                return { isValid: false, missingFields: ['Product not found'] };
            }

            const product = result.rows[0];
            const missingFields = [];

            // Check required fields (NOTE: Images NOT required for pairing)
            if (!product.display_item_name) missingFields.push('Display Name');
            if (!product.category) missingFields.push('Category');
            if (!product.brand) missingFields.push('Brand');
            if (!product.strain_type) missingFields.push('Strain Type');
            if (!product.default_price) missingFields.push('Price');
            if (!product.unit_weight) missingFields.push('Unit Weight');
            if (!product.packages_per_case) missingFields.push('Packages Per Case');
            if (!product.unit_size_measurement) missingFields.push('Unit Size Measurement');
            if (!product.strain_flavor) missingFields.push('Strain/Flavor');
            if (!product.product_description) missingFields.push('Product Description');

            return {
                isValid: missingFields.length === 0,
                missingFields
            };
        } catch (error) {
            logger.error(`Error validating master requirements for product ID ${productId}:`, error);
            throw error;
        }
    }

    /**
     * Pair multiple products to a master product
     * @param {number} masterProductId - The master product ID
     * @param {Array<number>} childProductIds - Array of child product IDs to pair
     * @returns {Object} { success: boolean, pairedCount: number, errors: Array }
     */
    static async pairProducts(masterProductId, childProductIds) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Validate master requirements
            const validation = await this.validateMasterRequirements(masterProductId);
            if (!validation.isValid) {
                throw new Error(`Master product is incomplete. Missing: ${validation.missingFields.join(', ')}`);
            }

            // Get master product
            const masterQuery = `SELECT * FROM "ORDERS-product_details" WHERE id = $1`;
            const masterResult = await client.query(masterQuery, [masterProductId]);
            const master = masterResult.rows[0];

            if (!master) {
                throw new Error('Master product not found');
            }

            const errors = [];
            let pairedCount = 0;

            for (const childId of childProductIds) {
                try {
                    // Validate child is not already a parent or child of another
                    const childCheckQuery = `
                        SELECT id, item_name, parent_product_id,
                               (SELECT COUNT(*) FROM "ORDERS-product_details" WHERE parent_product_id = $1) as child_count
                        FROM "ORDERS-product_details"
                        WHERE id = $1
                    `;
                    const childCheck = await client.query(childCheckQuery, [childId]);

                    if (!childCheck.rows[0]) {
                        errors.push({ childId, error: 'Product not found' });
                        continue;
                    }

                    const child = childCheck.rows[0];

                    if (child.parent_product_id) {
                        errors.push({ childId, itemName: child.item_name, error: 'Already paired to another master' });
                        continue;
                    }

                    if (child.child_count > 0) {
                        errors.push({ childId, itemName: child.item_name, error: 'This product is already a master with children' });
                        continue;
                    }

                    if (childId === masterProductId) {
                        errors.push({ childId, error: 'Cannot pair product to itself' });
                        continue;
                    }

                    // Pair the child to the master
                    const pairQuery = `
                        UPDATE "ORDERS-product_details"
                        SET parent_product_id = $1,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $2
                    `;
                    await client.query(pairQuery, [masterProductId, childId]);
                    pairedCount++;

                    logger.info(`Paired product ${child.item_name} to master ${master.item_name}`);

                } catch (error) {
                    errors.push({ childId, error: error.message });
                }
            }

            await client.query('COMMIT');

            return {
                success: true,
                pairedCount,
                errors
            };

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error pairing products:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Unpair a child product from its master
     * @param {number} childProductId - The child product ID to unpair
     * @returns {Object} { success: boolean, productId: number, hadBatches: boolean }
     */
    static async unpairProduct(childProductId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Get the child product info
            const childQuery = `
                SELECT id, item_name, original_item_name, parent_product_id
                FROM "ORDERS-product_details"
                WHERE id = $1
            `;
            const childResult = await client.query(childQuery, [childProductId]);

            if (!childResult.rows[0]) {
                throw new Error('Product not found');
            }

            const child = childResult.rows[0];

            if (!child.parent_product_id) {
                throw new Error('This product is not paired to any master');
            }

            // Check if this product has any batches
            const batchCheckQuery = `
                SELECT COUNT(*) as batch_count
                FROM "ORDERS-batch_status" bs
                WHERE bs.item_name = $1 AND bs.batch_is_active = true
            `;
            const batchCheck = await client.query(batchCheckQuery, [child.original_item_name]);
            const hadBatches = parseInt(batchCheck.rows[0].batch_count) > 0;

            // Unpair the product
            const unpairQuery = `
                UPDATE "ORDERS-product_details"
                SET parent_product_id = NULL,
                    list_to_buyers = false,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING *
            `;
            await client.query(unpairQuery, [childProductId]);

            // If product has batches, set them to "On Hold"
            if (hadBatches) {
                const updateBatchesQuery = `
                    UPDATE "ORDERS-batch_status"
                    SET status = 'On Hold',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE item_name = $1 AND batch_is_active = true
                `;
                await client.query(updateBatchesQuery, [child.original_item_name]);
                logger.info(`Set batches for ${child.original_item_name} to "On Hold" after unpairing`);
            }

            await client.query('COMMIT');

            logger.info(`Unpaired product ${child.item_name} (ID: ${childProductId})`);

            return {
                success: true,
                productId: childProductId,
                hadBatches
            };

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error(`Error unpairing product ID ${childProductId}:`, error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get products available for pairing to a specific master
     * Includes ALL products from batch staging, even if they don't have product_details yet
     * Excludes ONLY: the master itself, products that are already children, products that are already masters
     * @param {number} masterProductId - The master product ID
     * @returns {Array} Array of products available for pairing
     */
    static async getAvailableForPairing(masterProductId) {
        try {
            const query = `
                WITH all_products AS (
                    -- Get all unique product names from batch staging
                    SELECT DISTINCT
                        staging.name as item_name,
                        staging.name as original_item_name
                    FROM "ORDERS-batch_staging" staging
                    WHERE staging.is_active = true
                ),
                products_with_details AS (
                    -- Get all products, merging batch staging with product_details if exists
                    SELECT
                        pd.id,
                        COALESCE(pd.item_name, ap.item_name) as item_name,
                        COALESCE(pd.original_item_name, ap.original_item_name) as original_item_name,
                        pd.display_item_name,
                        pd.category,
                        pd.brand,
                        pd.parent_product_id,
                        (SELECT COUNT(*) FROM "ORDERS-product_details" WHERE parent_product_id = pd.id) as child_count
                    FROM all_products ap
                    LEFT JOIN "ORDERS-product_details" pd ON ap.item_name = pd.item_name
                )
                SELECT
                    id,
                    item_name,
                    original_item_name,
                    display_item_name,
                    category,
                    brand
                FROM products_with_details
                WHERE (id IS NULL OR id != $1)  -- Exclude the master itself (if it has details)
                  AND (parent_product_id IS NULL)  -- Exclude products that are already children
                  AND (child_count IS NULL OR child_count = 0)  -- Exclude products that are already masters
                ORDER BY original_item_name
            `;
            const result = await pool.query(query, [masterProductId]);
            return result.rows;
        } catch (error) {
            logger.error(`Error fetching products available for pairing to master ID ${masterProductId}:`, error);
            throw error;
        }
    }

    /**
     * Check if a product is a child (paired to a master)
     * @param {number} productId - The product ID
     * @returns {Object} { isChild: boolean, masterId: number|null, masterName: string|null }
     */
    static async isPaired(productId) {
        try {
            const query = `
                SELECT
                    child.parent_product_id,
                    parent.id as master_id,
                    parent.item_name as master_name,
                    parent.display_item_name as master_display_name
                FROM "ORDERS-product_details" child
                LEFT JOIN "ORDERS-product_details" parent ON child.parent_product_id = parent.id
                WHERE child.id = $1
            `;
            const result = await pool.query(query, [productId]);

            if (!result.rows[0]) {
                return { isChild: false, masterId: null, masterName: null };
            }

            const row = result.rows[0];
            return {
                isChild: row.parent_product_id !== null,
                masterId: row.master_id,
                masterName: row.master_display_name || row.master_name
            };
        } catch (error) {
            logger.error(`Error checking if product ID ${productId} is paired:`, error);
            throw error;
        }
    }
}

module.exports = ItemDetailsModel;