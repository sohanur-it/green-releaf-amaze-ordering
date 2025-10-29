/**
 * Module 3 API Routes
 * 
 * Product & Inventory Management API endpoints
 * 
 * @swagger
 * tags:
 *   - name: Module 3 - Products
 *     description: Master Product management endpoints
 *   - name: Module 3 - Batches
 *     description: Batch status and inventory management endpoints
 *   - name: Module 3 - Pricing
 *     description: Product and batch pricing engine
 *   - name: Module 3 - Allocation
 *     description: Batch allocation to orders
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     MasterProduct:
 *       type: object
 *       properties:
 *         entry_id:
 *           type: integer
 *           example: 394
 *         name:
 *           type: string
 *           example: "Amaze Orange 3.5g new"
 *         category_name:
 *           type: string
 *           example: "Flower - 3.5g Jars"
 *         default_price:
 *           type: number
 *           format: float
 *           example: 50.00
 *         metrc_linked_items:
 *           type: array
 *           items:
 *             type: string
 *           example: ["M00002313117: V2 Amaze 3.5g - Amaze Orange"]
 *     
 *     Batch:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 472
 *         batch_name:
 *           type: string
 *           example: "1A40C03000049D5000094872_M00002313117: V2 Amaze 3.5g - Amaze Orange"
 *         metrc_item_name:
 *           type: string
 *           example: "M00002313117: V2 Amaze 3.5g - Amaze Orange"
 *         quantity:
 *           type: integer
 *           example: 3
 *         allocated_quantity:
 *           type: integer
 *           example: 0
 *         available:
 *           type: integer
 *           example: 3
 *         thc_percentage:
 *           type: number
 *           format: float
 *           example: 28.5
 *         status:
 *           type: string
 *           enum: [Sellable, On Deck, On Hold]
 *           example: "Sellable"
 *         effective_price:
 *           type: number
 *           format: float
 *           example: 50.00
 */

const express = require('express');
const router = express.Router();
const BatchSyncService = require('../Services/BatchSyncService');
const { Pool } = require('pg');

// Database configuration
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false }
};

const pool = new Pool(DB_CONFIG);

// =============================================
// MASTER PRODUCT MANAGEMENT
// =============================================

/**
 * @swagger
 * /api/v1/products/master:
 *   post:
 *     summary: Create a new Master Product
 *     description: Creates a master product in the system with name, price, and category information
 *     tags: [Module 3 - Products]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, default_price]
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Amaze Orange 3.5g new"
 *               category_name:
 *                 type: string
 *                 example: "Flower - 3.5g Jars"
 *               default_price:
 *                 type: number
 *                 format: float
 *                 example: 50.00
 *               description:
 *                 type: string
 *               brand_name:
 *                 type: string
 *               product_type_name:
 *                 type: string
 *               cultivar_name:
 *                 type: string
 *               lineage:
 *                 type: string
 *     responses:
 *       200:
 *         description: Master product created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 product_id:
 *                   type: integer
 *                   example: 394
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Server error
 */
router.post('/products/master', async (req, res) => {
    const client = await pool.connect();
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

        const result = await client.query(`
            INSERT INTO "ORDERS-products" (
                name, category_name, default_price, description,
                brand_name, product_type_name, cultivar_name, lineage,
                metrc_linked_items, price_updated_at, price_updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
            RETURNING entry_id
        `, [
            name, category_name, default_price, description,
            brand_name, product_type_name, cultivar_name, lineage,
            JSON.stringify([]), // Empty array for linked items
            req.user?.id || null
        ]);

        res.json({
            success: true,
            product_id: result.rows[0].entry_id
        });

    } catch (error) {
        console.error('Error creating master product:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * @swagger
 * /api/v1/products/master/{id}/link-items:
 *   post:
 *     summary: Preview linking METRC items to Master Product
 *     description: Shows impact preview before actually linking METRC items (batches affected, quantities, conflicts)
 *     tags: [Module 3 - Products]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Master Product ID
 *         example: 394
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [metrc_item_names]
 *             properties:
 *               metrc_item_names:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["M00002313117: V2 Amaze 3.5g - Amaze Orange", "M00001245007: Amaze 3.5g - Amaze Orange"]
 *     responses:
 *       200:
 *         description: Impact preview generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 preview:
 *                   type: object
 *                   properties:
 *                     batches_affected:
 *                       type: integer
 *                       example: 4
 *                     quantity_aggregated:
 *                       type: integer
 *                       example: 33
 *                     allocated_quantity:
 *                       type: integer
 *                     statuses_present:
 *                       type: string
 *                     conflicts:
 *                       type: array
 */
router.post('/products/master/:id/link-items', async (req, res) => {
    const client = await pool.connect();
    try {
        const { metrc_item_names } = req.body;
        const productId = req.params.id;

        // Generate impact preview
        const impact = await generateLinkingImpactPreview(productId, metrc_item_names, client);

        res.json({
            success: true,
            preview: impact
        });

    } catch (error) {
        console.error('Error generating link preview:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * @swagger
 * /api/v1/products/master/{id}/link-items/confirm:
 *   post:
 *     summary: Confirm and link METRC items to Master Product
 *     description: Actually links METRC items to the master product after preview. Updates metrc_linked_items JSONB array and links all affected batches.
 *     tags: [Module 3 - Products]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Master Product ID
 *         example: 394
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [metrc_item_names]
 *             properties:
 *               metrc_item_names:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["M00002313117: V2 Amaze 3.5g - Amaze Orange", "M00001245007: Amaze 3.5g - Amaze Orange"]
 *     responses:
 *       200:
 *         description: METRC items linked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 batches_updated:
 *                   type: integer
 *                   example: 4
 *                 linked_items_count:
 *                   type: integer
 *                   example: 2
 */
router.post('/products/master/:id/link-items/confirm', async (req, res) => {
    const client = await pool.connect();
    const auditLogger = require('../Services/auditLogger');
    
    try {
        const { metrc_item_names } = req.body;
        const productId = req.params.id;
        const userId = req.user?.id || req.session?.userId || null;

        await client.query('BEGIN');

        // Get product details for audit log
        const productInfo = await client.query(`
            SELECT name FROM "ORDERS-products" WHERE entry_id = $1
        `, [productId]);
        
        const productName = productInfo.rows[0]?.name || 'Unknown Product';

        // Update the Master Product's JSONB array (REPLACE, not append)
        await client.query(`
            UPDATE "ORDERS-products"
            SET metrc_linked_items = $1::jsonb
            WHERE entry_id = $2
        `, [JSON.stringify(metrc_item_names), productId]);

        // Update all affected batches to link to this Master Product
        const result = await client.query(`
            UPDATE "ORDERS-batches"
            SET fk_master_product_id = $1
            WHERE metrc_item_name = ANY($2)
            RETURNING id, metrc_item_name
        `, [productId, metrc_item_names]);

        // Log this action for each affected batch
        for (const row of result.rows) {
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id, change_type, reason,
                    changed_by_user_id, changed_by_system
                ) VALUES ($1, 'master_product_linked', 'Linked to Master Product', $2, false)
            `, [row.id, userId]);
        }

        // Create audit log for the linking action
        await auditLogger.logAction({
            userId: userId,
            action: 'master_product_items_linked',
            resourceType: 'Master Product',
            resourceId: productId.toString(),
            details: {
                message: `${metrc_item_names.length} METRC item(s) linked to Master Product "${productName}" affecting ${result.rowCount} batch(es)`,
                product_name: productName,
                product_id: productId,
                linked_items: metrc_item_names,
                batches_affected: result.rowCount,
                batch_details: result.rows.map(r => ({ id: r.id, item_name: r.metrc_item_name }))
            },
            status: 'success',
            sourceIp: req.ip
        });

        await client.query('COMMIT');

        res.json({
            success: true,
            batches_updated: result.rowCount,
            message: `Successfully linked ${metrc_item_names.length} METRC items to ${productName}`
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error linking METRC items:', error.message);
        
        // Log failure
        const auditLogger = require('../Services/auditLogger');
        await auditLogger.logAction({
            userId: req.user?.id || req.session?.userId || null,
            action: 'master_product_items_linked',
            resourceType: 'Master Product',
            resourceId: req.params.id.toString(),
            details: {
                message: `Failed to link METRC items to Master Product: ${error.message}`,
                attempted_items: req.body.metrc_item_names,
                error: error.message
            },
            status: 'failure',
            sourceIp: req.ip
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

// =============================================
// BATCH MANAGEMENT
// =============================================

/**
 * @swagger
 * /api/v1/products/master/{id}/batches:
 *   get:
 *     summary: Get batches for a Master Product
 *     description: Retrieves all batches for a specific master product with optional filtering by status and sorting
 *     tags: [Module 3 - Batches]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Master Product ID
 *         example: 394
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Sellable, On Deck, On Hold]
 *         description: Filter by batch status
 *         example: Sellable
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [production_date_asc, production_date_desc, quantity_desc]
 *         description: Sort order
 *         example: production_date_asc
 *     responses:
 *       200:
 *         description: Batches retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 master_product:
 *                   $ref: '#/components/schemas/MasterProduct'
 *                 batches:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Batch'
 */
router.get('/products/master/:id/batches', async (req, res) => {
    const client = await pool.connect();
    try {
        const { status, sort = 'production_date_asc' } = req.query;
        const productId = req.params.id;

        let whereClause = 'WHERE fk_master_product_id = $1';
        let params = [productId];

        if (status) {
            whereClause += ' AND status = $2';
            params.push(status);
        }

        let orderClause = 'ORDER BY ';
        switch (sort) {
            case 'production_date_asc':
                orderClause += 'production_date ASC';
                break;
            case 'production_date_desc':
                orderClause += 'production_date DESC';
                break;
            case 'quantity_desc':
                orderClause += 'quantity DESC';
                break;
            default:
                orderClause += 'production_date ASC';
        }

        // Get master product info
        const productResult = await client.query(`
            SELECT name, default_price
            FROM "ORDERS-products"
            WHERE entry_id = $1
        `, [productId]);

        if (productResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Master product not found'
            });
        }

        // Get batches
        const batchesResult = await client.query(`
            SELECT 
                id, batch_name, quantity, allocated_quantity,
                (quantity - allocated_quantity) as available,
                thc_percentage, production_date, status,
                override_price, get_effective_price(id) as effective_price,
                full_package_details, partial_package_details
            FROM "ORDERS-batches"
            ${whereClause}
            ${orderClause}
        `, params);

        res.json({
            success: true,
            master_product: productResult.rows[0],
            batches: batchesResult.rows
        });

    } catch (error) {
        console.error('Error fetching batches:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * @swagger
 * /api/v1/batches/{id}/status:
 *   patch:
 *     summary: Update batch status
 *     description: Manually change batch status (Sellable, On Deck, On Hold) with validation
 *     tags: [Module 3 - Batches]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Batch ID
 *         example: 472
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [Sellable, On Deck, On Hold]
 *                 example: "On Hold"
 *               reason:
 *                 type: string
 *                 example: "Reserved for VIP client"
 *     responses:
 *       200:
 *         description: Batch status updated successfully
 *       400:
 *         description: Invalid status or validation failed
 *       500:
 *         description: Server error
 */
router.patch('/batches/:id/status', async (req, res) => {
    const client = await pool.connect();
    try {
        const { status, reason } = req.body;
        const batchId = req.params.id;

        // Validate status
        if (!['Sellable', 'On Deck', 'On Hold'].includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid status. Must be Sellable, On Deck, or On Hold'
            });
        }

        // Validate batch can be marked as Sellable
        if (status === 'Sellable') {
            const validation = await client.query(`
                SELECT can_batch_be_sellable($1) as can_be_sellable
            `, [batchId]);

            if (!validation.rows[0].can_be_sellable) {
                return res.status(400).json({
                    success: false,
                    error: 'Batch cannot be marked as Sellable due to missing critical data'
                });
            }
        }

        await client.query('BEGIN');

        // Get current status
        const current = await client.query(`
            SELECT status FROM "ORDERS-batches" WHERE id = $1
        `, [batchId]);

        if (current.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Batch not found'
            });
        }

        const oldStatus = current.rows[0].status;

        if (oldStatus === status) {
            await client.query('ROLLBACK');
            return res.json({
                success: true,
                changed: false,
                message: 'Status unchanged'
            });
        }

        // Update status
        await client.query(`
            UPDATE "ORDERS-batches"
            SET status = $1
            WHERE id = $2
        `, [status, batchId]);

        // Log history
        await client.query(`
            INSERT INTO "ORDERS-batch-history" (
                batch_id, change_type, field_name,
                old_value, new_value, reason,
                changed_by_user_id, changed_by_system
            ) VALUES ($1, 'status_changed', 'status', $2, $3, $4, $5, false)
        `, [batchId, oldStatus, status, reason || 'Manual status change', req.user?.id || null]);

        await client.query('COMMIT');

        // If changed TO "Sellable", broadcast inventory availability
        if (status === 'Sellable' && oldStatus !== 'Sellable') {
            try {
                const websocketService = require('../Services/websocketService');
                
                // Get batch details for broadcast
                const batchDetails = await client.query(`
                    SELECT 
                        b.id,
                        b.batch_name,
                        b.quantity,
                        b.thc_percentage,
                        b.fk_master_product_id,
                        p.name as product_name,
                        p.category_name
                    FROM "ORDERS-batches" b
                    LEFT JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
                    WHERE b.id = $1
                `, [batchId]);

                if (batchDetails.rows.length > 0) {
                    const batch = batchDetails.rows[0];
                    await websocketService.broadcastNewInventoryAvailable({
                        master_product_id: batch.fk_master_product_id,
                        product_name: batch.product_name,
                        category: batch.category_name,
                        newly_available_batches: [{
                            id: batch.id,
                            batch_name: batch.batch_name,
                            quantity: batch.quantity,
                            thc_percentage: batch.thc_percentage
                        }],
                        total_quantity_available: parseInt(batch.quantity) || 0
                    });
                }
            } catch (broadcastError) {
                console.error('⚠️  Failed to broadcast new inventory:', broadcastError.message);
                // Don't fail the response if broadcast fails
            }
        }

        res.json({
            success: true,
            changed: true,
            old_status: oldStatus,
            new_status: status
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating batch status:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

// =============================================
// PRICING MANAGEMENT
// =============================================

/**
 * @swagger
 * /api/v1/products/master/{id}/price:
 *   patch:
 *     summary: Update product default price
 *     description: Updates the default price of a master product and returns category siblings for bulk update option
 *     tags: [Module 3 - Pricing]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Product ID
 *         example: 394
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [default_price]
 *             properties:
 *               default_price:
 *                 type: number
 *                 format: float
 *                 example: 55.00
 *     responses:
 *       200:
 *         description: Price updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 updated:
 *                   type: boolean
 *                 product_id:
 *                   type: integer
 *                 product_name:
 *                   type: string
 *                 new_price:
 *                   type: number
 *                 category:
 *                   type: string
 *                 category_siblings:
 *                   type: array
 *                 prompt_bulk_update:
 *                   type: boolean
 */
router.patch('/products/master/:id/price', async (req, res) => {
    const client = await pool.connect();
    try {
        const { default_price } = req.body;
        const productId = req.params.id;

        // Get user ID from session (primary source)
        const userId = req.session?.userId || req.user?.id || req.user?.userId || null;
        console.log('🔍 Updating price - User ID:', userId, 'Session:', req.session);

        await client.query('BEGIN');

        // Update the primary product
        await client.query(`
            UPDATE "ORDERS-products"
            SET default_price = $1,
                price_updated_at = NOW(),
                price_updated_by = $2
            WHERE entry_id = $3
        `, [default_price, userId, productId]);

        // Get the category
        const productInfo = await client.query(`
            SELECT category_name, name
            FROM "ORDERS-products"
            WHERE entry_id = $1
        `, [productId]);

        const { category_name, name } = productInfo.rows[0];

        // Find other products in same category
        const siblings = await client.query(`
            SELECT entry_id, name, default_price
            FROM "ORDERS-products"
            WHERE category_name = $1
              AND entry_id != $2
        `, [category_name, productId]);

        await client.query('COMMIT');

        res.json({
            success: true,
            updated: true,
            product_id: productId,
            product_name: name,
            new_price: default_price,
            category: category_name,
            category_siblings: siblings.rows,
            prompt_bulk_update: siblings.rowCount > 0
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating product price:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * @swagger
 * /api/v1/products/categories/{categoryName}/bulk-price-update:
 *   post:
 *     summary: Bulk update category prices
 *     description: Updates prices for multiple products within a category, excluding specified products. Used by pricing engine.
 *     tags: [Module 3 - Pricing]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: categoryName
 *         required: true
 *         schema:
 *           type: string
 *         description: Category name (URL encoded)
 *         example: "Flower - 3.5g Jars"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [new_price]
 *             properties:
 *               new_price:
 *                 type: number
 *                 format: float
 *                 example: 55.00
 *               exclude_product_ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 example: [394]
 *     responses:
 *       200:
 *         description: Prices updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 updated_count:
 *                   type: integer
 *                   example: 12
 *                 products:
 *                   type: array
 */
router.post('/products/categories/:categoryName/bulk-price-update', async (req, res) => {
    const client = await pool.connect();
    try {
        const { new_price, exclude_product_ids = [] } = req.body;
        const categoryName = req.params.categoryName;

        // Get user ID from session (primary source)
        const userId = req.session?.userId || req.user?.id || req.user?.userId || null;
        console.log('🔍 Bulk updating category prices - User ID:', userId, 'Session:', req.session);

        await client.query('BEGIN');

        const result = await client.query(`
            UPDATE "ORDERS-products"
            SET default_price = $1,
                price_updated_at = NOW(),
                price_updated_by = $2
            WHERE category_name = $3
              AND entry_id != ALL($4)
            RETURNING entry_id, name
        `, [new_price, userId, categoryName, exclude_product_ids]);

        // Audit log
        await client.query(`
            INSERT INTO "ORDERS-audit_log" (
                user_id, action, resource_type, resource_id, details
            ) VALUES ($1, 'bulk_price_update', 'Category', $2, $3)
        `, [
            userId,
            categoryName,
            JSON.stringify({
                new_price: new_price,
                products_updated: result.rows.map(r => ({
                    id: r.entry_id,
                    name: r.name
                }))
            })
        ]);

        await client.query('COMMIT');

        res.json({
            success: true,
            updated_count: result.rowCount,
            products: result.rows
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error bulk updating prices:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * @swagger
 * /api/v1/batches/{id}/price:
 *   patch:
 *     summary: Set batch price override
 *     description: Sets a batch-specific price override that takes precedence over the master product default price
 *     tags: [Module 3 - Pricing]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Batch ID
 *         example: 472
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [override_price]
 *             properties:
 *               override_price:
 *                 type: number
 *                 format: float
 *                 example: 40.00
 *               reason:
 *                 type: string
 *                 example: "Aged inventory discount"
 *     responses:
 *       200:
 *         description: Batch price override set successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 batch_id:
 *                   type: integer
 *                 batch_name:
 *                   type: string
 *                 old_price:
 *                   type: number
 *                 new_price:
 *                   type: number
 *                 message:
 *                   type: string
 */
router.patch('/batches/:id/price', async (req, res) => {
    const client = await pool.connect();
    const auditLogger = require('../Services/auditLogger');
    
    try {
        const { override_price, reason } = req.body;
        const batchId = req.params.id;
        const userId = req.user?.id || req.session?.userId || null;

        if (!override_price || isNaN(override_price)) {
            return res.status(400).json({
                success: false,
                error: 'Valid override_price is required'
            });
        }

        await client.query('BEGIN');

        // Get current batch info
        const batchQuery = await client.query(`
            SELECT 
                id, batch_name, override_price, fk_master_product_id,
                quantity, allocated_quantity
            FROM "ORDERS-batches"
            WHERE id = $1
        `, [batchId]);

        if (batchQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Batch not found'
            });
        }

        const batch = batchQuery.rows[0];
        const oldPrice = batch.override_price;

        // Update override price
        await client.query(`
            UPDATE "ORDERS-batches"
            SET override_price = $1
            WHERE id = $2
        `, [override_price, batchId]);

        // Log to batch history
        await client.query(`
            INSERT INTO "ORDERS-batch-history" (
                batch_id, change_type, field_name,
                old_value, new_value, reason,
                changed_by_user_id, changed_by_system
            ) VALUES ($1, 'price_override_set', 'override_price', $2, $3, $4, $5, false)
        `, [
            batchId,
            oldPrice?.toString() || 'NULL',
            override_price.toString(),
            reason || 'Manual override price change',
            userId
        ]);

        // Get master product name for audit log
        const productQuery = await client.query(`
            SELECT name FROM "ORDERS-products" WHERE entry_id = $1
        `, [batch.fk_master_product_id]);

        const productName = productQuery.rows[0]?.name || 'Unknown Product';

        await client.query('COMMIT');

        // Create audit log
        await auditLogger.logAction({
            userId: userId,
            action: 'batch_price_override',
            resourceType: 'Batch',
            resourceId: batchId.toString(),
            details: {
                message: `Batch "${batch.batch_name}" price override ${oldPrice ? `changed from ${oldPrice}` : 'set'} to ${override_price}`,
                batch_id: batchId,
                batch_name: batch.batch_name,
                old_price: oldPrice,
                new_price: override_price,
                product_id: batch.fk_master_product_id,
                product_name: productName,
                quantity: batch.quantity,
                allocated_quantity: batch.allocated_quantity,
                reason: reason || 'Manual override'
            },
            status: 'success',
            sourceIp: req.ip
        });

        res.json({
            success: true,
            batch_id: batchId,
            batch_name: batch.batch_name,
            old_price: oldPrice,
            new_price: override_price,
            message: `Batch price override ${oldPrice ? 'updated' : 'set'} successfully`
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error setting batch override price:', error.message);
        
        // Log failure
        await auditLogger.logAction({
            userId: req.user?.id || req.session?.userId || null,
            action: 'batch_price_override',
            resourceType: 'Batch',
            resourceId: req.params.id.toString(),
            details: {
                error: error.message,
                attempted_price: req.body.override_price
            },
            status: 'failure',
            sourceIp: req.ip
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * @swagger
 * /api/v1/products/master/{id}/unlink-item:
 *   delete:
 *     summary: Unlink METRC item from Master Product
 *     description: Removes a METRC item from the master product's metrc_linked_items array and unlinks associated batches
 *     tags: [Module 3 - Products]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Master Product ID
 *         example: 394
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [metrc_item_name]
 *             properties:
 *               metrc_item_name:
 *                 type: string
 *                 example: "M00002313117: V2 Amaze 3.5g - Amaze Orange"
 *     responses:
 *       200:
 *         description: Item unlinked successfully
 */
router.delete('/products/master/:id/unlink-item', async (req, res) => {
    const client = await pool.connect();
    const auditLogger = require('../Services/auditLogger');
    
    try {
        const { metrc_item_name } = req.body;
        const productId = req.params.id;
        const userId = req.user?.id || req.session?.userId || null;

        if (!metrc_item_name) {
            return res.status(400).json({
                success: false,
                error: 'metrc_item_name is required'
            });
        }

        await client.query('BEGIN');

        // Get current linked items
        const product = await client.query(`
            SELECT name, metrc_linked_items
            FROM "ORDERS-products"
            WHERE entry_id = $1
        `, [productId]);

        if (product.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Master product not found'
            });
        }

        const currentItems = product.rows[0].metrc_linked_items || [];
        const updatedItems = currentItems.filter(item => item !== metrc_item_name);

        // Update metrc_linked_items
        await client.query(`
            UPDATE "ORDERS-products"
            SET metrc_linked_items = $1::jsonb
            WHERE entry_id = $2
        `, [JSON.stringify(updatedItems), productId]);

        // Unlink batches
        const batchResult = await client.query(`
            UPDATE "ORDERS-batches"
            SET fk_master_product_id = NULL
            WHERE metrc_item_name = $1 AND fk_master_product_id = $2
            RETURNING id, batch_name
        `, [metrc_item_name, productId]);

        // Log for each batch
        for (const row of batchResult.rows) {
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id, change_type, reason,
                    changed_by_user_id, changed_by_system
                ) VALUES ($1, 'master_product_unlinked', 'Unlinked from Master Product', $2, false)
            `, [row.id, userId]);
        }

        await client.query('COMMIT');

        // Create audit log
        await auditLogger.logAction({
            userId: userId,
            action: 'master_product_items_unlinked',
            resourceType: 'Master Product',
            resourceId: productId.toString(),
            details: {
                message: `Unlinked "${metrc_item_name}" from Master Product "${product.rows[0].name}"`,
                product_name: product.rows[0].name,
                unlinked_item: metrc_item_name,
                batches_affected: batchResult.rowCount,
                remaining_items: updatedItems
            },
            status: 'success',
            sourceIp: req.ip
        });

        res.json({
            success: true,
            batches_affected: batchResult.rowCount,
            remaining_linked_items: updatedItems.length,
            message: `Successfully unlinked ${metrc_item_name}`
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error unlinking METRC item:', error.message);
        
        await auditLogger.logAction({
            userId: req.user?.id || req.session?.userId || null,
            action: 'master_product_items_unlinked',
            resourceType: 'Master Product',
            resourceId: req.params.id.toString(),
            details: {
                error: error.message,
                attempted_item: req.body.metrc_item_name
            },
            status: 'failure',
            sourceIp: req.ip
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * @swagger
 * /api/v1/batches/{id}/history:
 *   get:
 *     summary: Get batch history
 *     description: Retrieves complete history of changes for a batch including status changes, allocations, and package removals
 *     tags: [Module 3 - Batches]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Batch ID
 *         example: 472
 *     responses:
 *       200:
 *         description: Batch history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 batch_name:
 *                   type: string
 *                 history:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       change_type:
 *                         type: string
 *                       field_name:
 *                         type: string
 *                       old_value:
 *                         type: string
 *                       new_value:
 *                         type: string
 *                       reason:
 *                         type: string
 *                       changed_by:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 */
router.get('/batches/:id/history', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const batchId = req.params.id;

        // Get batch info
        const batchResult = await client.query(`
            SELECT batch_name
            FROM "ORDERS-batches"
            WHERE id = $1
        `, [batchId]);

        if (batchResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Batch not found'
            });
        }

        // Get batch history
        const historyResult = await client.query(`
            SELECT 
                id, change_type, field_name,
                old_value, new_value, reason,
                related_invoice_id, related_package_label,
                change_details,
                changed_by_user_id, changed_by_system,
                timestamp
            FROM "ORDERS-batch-history"
            WHERE batch_id = $1
            ORDER BY timestamp DESC
        `, [batchId]);

        // Get user names for user IDs
        const userIds = [...new Set(historyResult.rows
            .map(r => r.changed_by_user_id)
            .filter(id => id !== null))];

        let userNames = {};
        if (userIds.length > 0) {
            const usersResult = await client.query(`
                SELECT id, username
                FROM users
                WHERE id = ANY($1)
            `, [userIds]);
            
            usersResult.rows.forEach(u => {
                userNames[u.id] = u.username;
            });
        }

        const history = historyResult.rows.map(row => ({
            id: row.id,
            change_type: row.change_type,
            field_name: row.field_name,
            old_value: row.old_value,
            new_value: row.new_value,
            reason: row.reason,
            related_invoice_id: row.related_invoice_id,
            related_package_label: row.related_package_label,
            change_details: row.change_details,
            changed_by: row.changed_by_user_id 
                ? userNames[row.changed_by_user_id] || `User ID ${row.changed_by_user_id}`
                : (row.changed_by_system ? 'SYSTEM' : 'Unknown'),
            changed_by_system: row.changed_by_system,
            timestamp: row.timestamp
        }));

        res.json({
            success: true,
            batch_name: batchResult.rows[0].batch_name,
            history: history
        });

    } catch (error) {
        console.error('Error fetching batch history:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * @swagger
 * /api/v1/batches/{id}/thc-override:
 *   patch:
 *     summary: Override THC percentage
 *     description: Manually sets THC override for missing lab data. Useful when METRC lab results are incomplete.
 *     tags: [Module 3 - Batches]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Batch ID
 *         example: 472
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [thc_override]
 *             properties:
 *               thc_override:
 *                 type: number
 *                 format: float
 *                 minimum: 0
 *                 maximum: 100
 *                 example: 25.0
 *     responses:
 *       200:
 *         description: THC override set successfully
 *       400:
 *         description: Invalid THC value
 */
router.patch('/batches/:id/thc-override', async (req, res) => {
    const client = await pool.connect();
    const auditLogger = require('../Services/auditLogger');
    
    try {
        const { thc_override } = req.body;
        const batchId = req.params.id;
        const userId = req.user?.id || req.session?.userId || null;

        if (!thc_override || isNaN(thc_override) || thc_override < 0 || thc_override > 100) {
            return res.status(400).json({
                success: false,
                error: 'Valid thc_override (0-100) is required'
            });
        }

        await client.query('BEGIN');

        // Get current batch info
        const batchQuery = await client.query(`
            SELECT 
                id, batch_name, thc_override, thc_percentage, 
                fk_master_product_id
            FROM "ORDERS-batches"
            WHERE id = $1
        `, [batchId]);

        if (batchQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Batch not found'
            });
        }

        const batch = batchQuery.rows[0];
        const oldThc = batch.thc_override;

        // Update thc_override
        await client.query(`
            UPDATE "ORDERS-batches"
            SET thc_override = $1
            WHERE id = $2
        `, [thc_override, batchId]);

        // Log to batch history
        await client.query(`
            INSERT INTO "ORDERS-batch-history" (
                batch_id, change_type, field_name,
                old_value, new_value, reason,
                changed_by_user_id, changed_by_system
            ) VALUES ($1, 'thc_override_set', 'thc_override', 
                      $2, $3, 'Manual THC override', $4, false)
        `, [
            batchId,
            oldThc?.toString() || 'NULL',
            thc_override.toString(),
            userId
        ]);

        // Get master product name for audit log
        const productQuery = await client.query(`
            SELECT name FROM "ORDERS-products" WHERE entry_id = $1
        `, [batch.fk_master_product_id]);

        const productName = productQuery.rows[0]?.name || 'Unknown Product';

        await client.query('COMMIT');

        // Create audit log
        await auditLogger.logAction({
            userId: userId,
            action: 'batch_thc_override',
            resourceType: 'Batch',
            resourceId: batchId.toString(),
            details: {
                message: `Batch "${batch.batch_name}" THC override ${oldThc ? `changed from ${oldThc}%` : 'set'} to ${thc_override}%`,
                batch_id: batchId,
                batch_name: batch.batch_name,
                old_thc: oldThc,
                new_thc_override: thc_override,
                original_thc: batch.thc_percentage,
                product_id: batch.fk_master_product_id,
                product_name: productName
            },
            status: 'success',
            sourceIp: req.ip
        });

        res.json({
            success: true,
            batch_id: batchId,
            batch_name: batch.batch_name,
            old_thc_override: oldThc,
            new_thc_override: thc_override,
            original_thc_percentage: batch.thc_percentage,
            message: `THC override ${oldThc ? 'updated' : 'set'} successfully`
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error setting THC override:', error.message);
        
        await auditLogger.logAction({
            userId: req.user?.id || req.session?.userId || null,
            action: 'batch_thc_override',
            resourceType: 'Batch',
            resourceId: req.params.id.toString(),
            details: {
                error: error.message,
                attempted_thc: req.body.thc_override
            },
            status: 'failure',
            sourceIp: req.ip
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

// =============================================
// ALLOCATION MANAGEMENT
// =============================================

/**
 * @swagger
 * /api/v1/batches/{id}/allocate:
 *   post:
 *     summary: Allocate batch to order
 *     description: Allocates batch inventory to an order with row locking to prevent overselling. Increments allocated_quantity and triggers auto-promotion.
 *     tags: [Module 3 - Allocation]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Batch ID
 *         example: 472
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [order_id, requested_quantity]
 *             properties:
 *               order_id:
 *                 type: integer
 *                 example: 456
 *               requested_quantity:
 *                 type: integer
 *                 example: 10
 *     responses:
 *       200:
 *         description: Batch allocated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 batch_id:
 *                   type: integer
 *                 batch_name:
 *                   type: string
 *                 old_allocated:
 *                   type: integer
 *                 new_allocated:
 *                   type: integer
 *                 available_before:
 *                   type: integer
 *                 available_after:
 *                   type: integer
 *       400:
 *         description: Insufficient inventory
 */
router.post('/batches/:id/allocate', async (req, res) => {
    const allocationService = require('../Services/allocationService');
    
    try {
        const { order_id, requested_quantity } = req.body;
        const batchId = req.params.id;
        const userId = req.user?.id || req.session?.userId || null;

        if (!order_id || !requested_quantity || requested_quantity <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Valid order_id and requested_quantity are required'
            });
        }

        const result = await allocationService.allocateBatchToOrder(
            batchId, 
            requested_quantity, 
            order_id, 
            userId
        );

        if (result.success) {
            res.json({
                success: true,
                ...result
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error
            });
        }

    } catch (error) {
        console.error('Error allocating batch:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @swagger
 * /api/v1/orders/{id}/release-allocation:
 *   post:
 *     summary: Release batch allocation
 *     description: Releases all batch allocations for an order (e.g., when order is cancelled). Decrements allocated_quantity and logs to batch history.
 *     tags: [Module 3 - Allocation]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Order ID
 *         example: 456
 *     responses:
 *       200:
 *         description: Allocations released successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 released_count:
 *                   type: integer
 *                   example: 3
 *                 batches:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       batch_id:
 *                         type: integer
 *                       batch_name:
 *                         type: string
 *                       released_quantity:
 *                         type: integer
 */
router.post('/orders/:id/release-allocation', async (req, res) => {
    const allocationService = require('../Services/allocationService');
    
    try {
        const orderId = req.params.id;
        const userId = req.user?.id || req.session?.userId || null;

        const result = await allocationService.releaseAllocation(orderId, userId);

        if (result.success) {
            res.json({
                success: true,
                ...result
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error
            });
        }

    } catch (error) {
        console.error('Error releasing allocation:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================
// ADMIN / SYNC
// =============================================

/**
 * @swagger
 * /api/v1/admin/sync/batches:
 *   post:
 *     summary: Force batch synchronization
 *     description: Manually triggers batch sync from METRC. Runs batch extraction query, detects changes, applies updates, and triggers auto-promotion.
 *     tags: [Module 3 - Batches]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Batch sync completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 duration_ms:
 *                   type: integer
 *                   example: 3456
 *                 changes:
 *                   type: object
 *                   properties:
 *                     new:
 *                       type: integer
 *                       example: 3
 *                     updated:
 *                       type: integer
 *                       example: 45
 *                     removed:
 *                       type: integer
 *                       example: 2
 *                     packageChanges:
 *                       type: integer
 *                       example: 12
 */
router.post('/admin/sync/batches', async (req, res) => {
    try {
        const batchSyncService = new BatchSyncService();
        const result = await batchSyncService.syncBatches();
        await batchSyncService.close();

        res.json({
            success: true,
            duration_ms: result.duration,
            changes: result.changes
        });

    } catch (error) {
        console.error('Error running batch sync:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================
// HELPER FUNCTIONS
// =============================================

/**
 * Generate linking impact preview
 */
async function generateLinkingImpactPreview(masterProductId, newMetrcItemNames, client) {
    // Query how many batches will be affected
    const batchesQuery = await client.query(`
        SELECT 
            COUNT(*) as batch_count,
            SUM(quantity) as total_quantity,
            SUM(allocated_quantity) as total_allocated,
            string_agg(DISTINCT status::text, ', ') as statuses_present,
            (SELECT i.unitofmeasurename 
             FROM items i 
             WHERE i.name = ANY($1) 
             LIMIT 1) as unit_of_measure
        FROM "ORDERS-batches"
        WHERE metrc_item_name = ANY($1)
    `, [newMetrcItemNames]);

    const impact = batchesQuery.rows[0];

    // Check for existing links
    const conflicts = await client.query(`
        SELECT name, entry_id
        FROM "ORDERS-products"
        WHERE metrc_linked_items ?| $1
          AND entry_id != $2
    `, [newMetrcItemNames, masterProductId]);

    return {
        batches_affected: impact.batch_count,
        quantity_aggregated: impact.total_quantity,
        allocated_quantity: impact.total_allocated,
        statuses: impact.statuses_present,
        unit_of_measure: impact.unit_of_measure || 'units',
        conflicts: conflicts.rows,
        warning_messages: generateWarnings(impact, conflicts.rows)
    };
}

/**
 * Generate warning messages for linking impact
 */
function generateWarnings(impact, conflicts) {
    const warnings = [];

    if (conflicts.length > 0) {
        warnings.push({
            level: 'ERROR',
            message: `Cannot link: these METRC items are already linked to other Master Products: ${conflicts.map(c => c.name).join(', ')}`
        });
    }

    if (impact.batch_count === 0 || !impact.batch_count) {
        warnings.push({
            level: 'INFO',
            message: 'No existing batches found for these METRC items. This product will appear empty until the next sync.'
        });
    } else {
        const quantity = impact.total_quantity || impact.quantity_aggregated || 0;
        const unit = impact.unit_of_measure || 'units';
        warnings.push({
            level: 'SUCCESS',
            message: `${impact.batch_count} ${impact.batch_count === 1 ? 'batch' : 'batches'} will be linked to this product, totaling ${quantity} ${unit}.`
        });
    }

    if (impact.statuses_present && impact.statuses_present.includes('Sellable')) {
        warnings.push({
            level: 'WARNING',
            message: 'Some batches are currently Sellable. They will immediately appear under this Master Product for buyers.'
        });
    }

    return warnings;
}

module.exports = router;

