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
const auditLogger = require('../Services/auditLogger');
const { Pool } = require('pg');
const { query } = require('../config/database');
const { requireAuth: auth } = require('../Middleware/auth');

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
const batchSyncService = new BatchSyncService();

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

        // Validate batches before linking - check if source packages exist
        const batchesToLink = await client.query(`
            SELECT 
                b.id,
                b.batch_name,
                b.metrc_item_name,
                b.first_sourcepackage_label,
                b.sourcepackagelabels,
                b.status,
                -- Check if source package exists
                EXISTS (
                    SELECT 1 FROM activepackages 
                    WHERE label = b.first_sourcepackage_label
                    AND isarchived = false
                    AND isfinished = false
                ) as source_package_exists,
                -- Check if any packages from sourcepackagelabels exist
                (
                    SELECT COUNT(*) 
                    FROM activepackages 
                    WHERE label = ANY(string_to_array(b.sourcepackagelabels, ','))
                    AND isarchived = false
                    AND isfinished = false
                ) as existing_package_count
            FROM "ORDERS-batches" b
            WHERE b.metrc_item_name = ANY($1)
        `, [metrc_item_names]);
        
        // Separate batches with warnings (missing source packages) but link ALL batches
        const allBatchIds = batchesToLink.rows.map(b => b.id);
        const batchesWithWarnings = [];
        
        for (const batch of batchesToLink.rows) {
            // Check if batch has source package issues (for warning only, not blocking)
            if (!batch.source_package_exists || batch.existing_package_count === 0) {
                batchesWithWarnings.push({
                    id: batch.id,
                    batch_name: batch.batch_name,
                    metrc_item_name: batch.metrc_item_name,
                    first_sourcepackage_label: batch.first_sourcepackage_label,
                    reason: batch.source_package_exists 
                        ? `No active packages found (source package exists but no packages available)`
                        : `Source package "${batch.first_sourcepackage_label}" does not exist in activepackages`
                });
            }
        }
        
        // Warn about batches with missing source packages but still link them
        if (batchesWithWarnings.length > 0) {
            console.warn(`⚠️  WARNING: ${batchesWithWarnings.length} batch(es) have invalid/missing source packages (will still be linked):`);
            batchesWithWarnings.forEach(b => {
                console.warn(`   - Batch ${b.id} (${b.batch_name}): ${b.reason}`);
            });
            
            // Log warning to audit log
            await auditLogger.logAction({
                userId: userId,
                action: 'batch_validation_warning',
                resourceType: 'Master Product',
                resourceId: productId.toString(),
                details: {
                    message: `${batchesWithWarnings.length} batch(es) have invalid/missing source packages but were still linked`,
                    batches_with_warnings: batchesWithWarnings,
                    product_name: productName
                },
                status: 'warning',
                sourceIp: req.ip
            });
        }
        
        // Link ALL batches that match the METRC item names (immediate linking)
        let result;
        if (allBatchIds.length > 0) {
            result = await client.query(`
                UPDATE "ORDERS-batches"
                SET fk_master_product_id = $1
                WHERE id = ANY($2)
                RETURNING id, batch_name, metrc_item_name, status
            `, [productId, allBatchIds]);
        } else {
            // No batches found to link
            result = { rows: [], rowCount: 0 };
        }

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

        // CRITICAL: Automatically refresh batches from METRC after linking
        // This ensures batch quantities and inventory are immediately up-to-date
        let refreshResult = null;
        try {
            console.log(`🔄 Auto-refreshing batches for linked METRC items: ${metrc_item_names.join(', ')}`);
            refreshResult = await batchSyncService.refreshBatchesForItems(metrc_item_names);
            console.log(`✅ Auto-refresh completed: ${refreshResult.updated || 0} batch(es) updated`);
        } catch (refreshError) {
            console.error('⚠️ Warning: Failed to auto-refresh batches after linking:', refreshError.message);
            // Don't fail the entire operation if refresh fails - batches will sync on next scheduled sync
        }

        // Build response message
        let message = `Successfully linked ${metrc_item_names.length} METRC items to ${productName}`;
        if (result.rowCount > 0) {
            message += ` (${result.rowCount} batch(es) linked immediately)`;
        } else {
            message += `. No existing batches found - batches will appear after the next sync.`;
        }
        if (refreshResult && refreshResult.updated > 0) {
            message += ` Refreshed ${refreshResult.updated} batch(es) with latest METRC data.`;
        }
        if (batchesWithWarnings.length > 0) {
            message += ` Note: ${batchesWithWarnings.length} batch(es) have missing source packages but were still linked.`;
        }
        
        res.json({
            success: true,
            batches_updated: result.rowCount,
            batches_linked: result.rowCount,
            batches_refreshed: refreshResult ? refreshResult.updated : 0,
            batches_with_warnings: batchesWithWarnings.length,
            batches_with_warnings_details: batchesWithWarnings.length > 0 ? batchesWithWarnings : undefined,
            message: message,
            product_id: productId  // Include product ID for redirect
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

/**
 * @swagger
 * /api/v1/products/master/{id}/refresh-batches:
 *   post:
 *     summary: Refresh METRC batches for linked items (immediate quantity update)
 *     description: >
 *       Re-runs the METRC batch extraction logic for the specified METRC item names and
 *       updates the corresponding ORDERS-batches rows so that quantity/availability
 *       are correct immediately after linking.
 *     tags: [Module 3 - Batches]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Master Product ID (for context; not used directly in refresh)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               metrc_item_names:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["M00002313117: V2 Amaze 3.5g - Amaze Orange"]
 *     responses:
 *       200:
 *         description: Batches refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 updated:
 *                   type: integer
 *                 batches:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Batch'
 */
router.post('/products/master/:id/refresh-batches', auth, async (req, res) => {
    try {
        const { metrc_item_names } = req.body || {};
        const productId = parseInt(req.params.id);

        if (!Array.isArray(metrc_item_names) || metrc_item_names.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'metrc_item_names (non-empty array) is required'
            });
        }

        if (isNaN(productId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid product ID'
            });
        }

        // Pass productId to ensure batches are linked to this product
        const result = await batchSyncService.refreshBatchesForItems(metrc_item_names, productId);

        res.json({
            success: true,
            updated: result.updated || 0,
            batches: result.batches || []
        });
    } catch (error) {
        console.error('Error refreshing batches for METRC items:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to refresh batches for specified METRC items',
            message: error.message
        });
    }
});

/**
 * @swagger
 * /api/v1/products/refresh-all-batches:
 *   post:
 *     summary: Refresh batches for all products with linked METRC items
 *     description: >
 *       Refreshes batches from METRC for all products that have metrc_linked_items.
 *       This ensures all product batches are up-to-date without requiring manual refresh per product.
 *     tags: [Module 3 - Products]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Batch refresh completed for all products
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 products_processed:
 *                   type: integer
 *                 total_batches_refreshed:
 *                   type: integer
 *                 duration_ms:
 *                   type: integer
 */
router.post('/products/refresh-all-batches', auth, async (req, res) => {
    const startTime = Date.now();
    const client = await pool.connect();
    const userId = req.user?.id || req.session?.userId;
    
    // Get WebSocket service for real-time updates
    let websocketService;
    try {
        websocketService = require('../Services/websocketService');
    } catch (err) {
        console.warn('⚠️ WebSocket service not available for real-time updates');
    }
    
    // Helper function to send progress update to specific user
    const sendProgress = (progress) => {
        if (websocketService && websocketService.getServer() && userId) {
            try {
                const wss = websocketService.getServer();
                const message = JSON.stringify({
                    type: 'batch_refresh_progress',
                    user_id: userId,
                    ...progress
                });
                
                // Send only to the user who initiated the refresh
                wss.clients.forEach(client => {
                    if (client.readyState === require('ws').OPEN && client.userId === userId) {
                        client.send(message);
                    }
                });
            } catch (err) {
                console.warn('⚠️ Failed to send WebSocket progress update:', err.message);
            }
        }
    };
    
    try {
        // Get all products with linked METRC items
        const productsResult = await client.query(`
            SELECT entry_id, name, metrc_linked_items
            FROM "ORDERS-products"
            WHERE metrc_linked_items IS NOT NULL
              AND metrc_linked_items::text != '[]'
              AND (is_archived = FALSE OR is_archived IS NULL)
            ORDER BY entry_id
        `);
        
        if (productsResult.rows.length === 0) {
            sendProgress({
                status: 'completed',
                products_processed: 0,
                total_batches_refreshed: 0,
                message: 'No products with linked METRC items found'
            });
            return res.json({
                success: true,
                products_processed: 0,
                total_batches_refreshed: 0,
                duration_ms: Date.now() - startTime,
                message: 'No products with linked METRC items found'
            });
        }
        
        console.log(`🔄 Refreshing batches for ${productsResult.rows.length} products...`);
        
        // Send initial progress
        sendProgress({
            status: 'started',
            total_products: productsResult.rows.length,
            products_processed: 0,
            total_batches_refreshed: 0,
            message: `Starting refresh for ${productsResult.rows.length} products...`
        });
        
        let totalBatchesRefreshed = 0;
        let productsProcessed = 0;
        const results = [];
        
        // Process products ONE AT A TIME to send real-time updates
        for (let i = 0; i < productsResult.rows.length; i++) {
            const product = productsResult.rows[i];
            
            try {
                const linkedItems = Array.isArray(product.metrc_linked_items) 
                    ? product.metrc_linked_items 
                    : JSON.parse(product.metrc_linked_items || '[]');
                
                if (linkedItems.length > 0) {
                    console.log(`   🔄 [${i + 1}/${productsResult.rows.length}] Refreshing batches for product ${product.entry_id} (${product.name}) with ${linkedItems.length} linked METRC item(s)...`);
                    
                    // Send "processing" update before starting
                    sendProgress({
                        status: 'progress',
                        products_processed: productsProcessed,
                        total_products: productsResult.rows.length,
                        total_batches_refreshed: totalBatchesRefreshed,
                        current_product: {
                            id: product.entry_id,
                            name: product.name,
                            status: 'processing'
                        },
                        message: `Processing ${product.name}... (${i + 1}/${productsResult.rows.length} products)`
                    });
                    
                    // Small delay to ensure UI updates
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    const result = await batchSyncService.refreshBatchesForItems(linkedItems, product.entry_id);
                    // Use 'updated' which now includes both created and modified batches
                    const batchesRefreshed = result.updated || 0;
                    totalBatchesRefreshed += batchesRefreshed;
                    productsProcessed++;
                    
                    console.log(`   ✅ [${i + 1}/${productsResult.rows.length}] Product ${product.entry_id}: ${batchesRefreshed} batch(es) refreshed (${result.created || 0} new, ${result.modified || 0} updated, ${result.total || 0} total)`);
                    
                    results.push({
                        product_id: product.entry_id,
                        product_name: product.name,
                        batches_refreshed: batchesRefreshed,
                        batches_created: result.created || 0,
                        batches_modified: result.modified || 0,
                        batches_total: result.total || 0,
                        success: true
                    });
                    
                    // Send real-time progress update AFTER processing
                    sendProgress({
                        status: 'progress',
                        products_processed: productsProcessed,
                        total_products: productsResult.rows.length,
                        total_batches_refreshed: totalBatchesRefreshed,
                        current_product: {
                            id: product.entry_id,
                            name: product.name,
                            batches_refreshed: batchesRefreshed,
                            batches_created: result.created || 0,
                            batches_modified: result.modified || 0,
                            status: 'completed'
                        },
                        message: `✅ Updated ${batchesRefreshed} batch(es) for ${product.name} (${productsProcessed}/${productsResult.rows.length} products)`
                    });
                    
                    // Log to console for debugging
                    console.log(`   📊 Progress: ${productsProcessed}/${productsResult.rows.length} products, ${totalBatchesRefreshed} total batches`);
                    
                    // Small delay between products to allow UI to update
                    await new Promise(resolve => setTimeout(resolve, 200));
                } else {
                    console.log(`   ⚠️ [${i + 1}/${productsResult.rows.length}] Product ${product.entry_id} (${product.name}) has no linked METRC items, skipping...`);
                    productsProcessed++;
                }
            } catch (error) {
                console.error(`⚠️ [${i + 1}/${productsResult.rows.length}] Failed to refresh batches for product ${product.entry_id} (${product.name}):`, error.message);
                productsProcessed++;
                results.push({
                    product_id: product.entry_id,
                    product_name: product.name,
                    batches_refreshed: 0,
                    success: false,
                    error: error.message
                });
                
                // Send error progress update
                sendProgress({
                    status: 'progress',
                    products_processed: productsProcessed,
                    total_products: productsResult.rows.length,
                    total_batches_refreshed: totalBatchesRefreshed,
                    current_product: {
                        id: product.entry_id,
                        name: product.name,
                        error: error.message,
                        status: 'error'
                    },
                    message: `❌ Failed to refresh ${product.name}: ${error.message}`
                });
            }
        }
        
        const duration = Date.now() - startTime;
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        console.log(`✅ Refreshed batches for ${successful} products (${failed} failed), ${totalBatchesRefreshed} total batches refreshed in ${duration}ms`);
        
        // Send completion update
        sendProgress({
            status: 'completed',
            products_processed: productsProcessed,
            total_products: productsResult.rows.length,
            products_successful: successful,
            products_failed: failed,
            total_batches_refreshed: totalBatchesRefreshed,
            duration_ms: duration,
            message: `Completed: ${successful} products successful, ${totalBatchesRefreshed} batches refreshed`
        });
        
        res.json({
            success: true,
            products_processed: productsResult.rows.length,
            products_successful: successful,
            products_failed: failed,
            total_batches_refreshed: totalBatchesRefreshed,
            duration_ms: duration,
            results: results
        });
    } catch (error) {
        console.error('❌ Error refreshing batches for all products:', error.message);
        
        // Send error update
        sendProgress({
            status: 'error',
            error: error.message,
            message: `Error: ${error.message}`
        });
        
        res.status(500).json({
            success: false,
            error: 'Failed to refresh batches for all products',
            message: error.message
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
    const userId = req.user?.id || req.session?.userId || null;
    let batchBeforeUpdate = null;
    
    try {
        const { status, reason } = req.body;
        const batchId = req.params.id;

        // Validate status
        if (!['Sellable', 'On Deck', 'On Hold'].includes(status)) {
            // Log failed attempt
            await auditLogger.logAction({
                userId: userId,
                action: 'batch_status_update',
                resourceType: 'Batch',
                resourceId: batchId.toString(),
                details: {
                    error: 'Invalid status. Must be Sellable, On Deck, or On Hold',
                    attempted_status: status,
                    update_type: 'manual'
                },
                status: 'failure',
                sourceIp: req.ip
            });
            
            return res.status(400).json({
                success: false,
                error: 'Invalid status. Must be Sellable, On Deck, or On Hold'
            });
        }

        // Get batch details BEFORE update for audit logging
        const batchQuery = await client.query(`
            SELECT 
                id, batch_name, status, quantity, allocated_quantity, 
                fk_master_product_id, override_price, thc_percentage, production_date
            FROM "ORDERS-batches" 
            WHERE id = $1
        `, [batchId]);

        if (batchQuery.rows.length === 0) {
            // Log batch not found
            await auditLogger.logAction({
                userId: userId,
                action: 'batch_status_update',
                resourceType: 'Batch',
                resourceId: batchId.toString(),
                details: {
                    error: 'Batch not found',
                    attempted_status: status,
                    update_type: 'manual'
                },
                status: 'failure',
                sourceIp: req.ip
            });
            
            return res.status(404).json({
                success: false,
                error: 'Batch not found'
            });
        }

        batchBeforeUpdate = batchQuery.rows[0];
        const oldStatus = batchBeforeUpdate.status;

        // Validate batch can be marked as Sellable
        if (status === 'Sellable') {
            const validation = await client.query(`
                SELECT can_batch_be_sellable($1) as can_be_sellable
            `, [batchId]);

            if (!validation.rows[0].can_be_sellable) {
                // Log validation failure
                await auditLogger.logAction({
                    userId: userId,
                    action: 'batch_status_update',
                    resourceType: 'Batch',
                    resourceId: batchId.toString(),
                    details: {
                        error: 'Batch cannot be marked as Sellable due to missing critical data',
                        batch_name: batchBeforeUpdate.batch_name,
                        old_status: oldStatus,
                        attempted_status: status,
                        update_type: 'manual'
                    },
                    status: 'failure',
                    sourceIp: req.ip
                });
                
                return res.status(400).json({
                    success: false,
                    error: 'Batch cannot be marked as Sellable due to missing critical data'
                });
            }
        }

        if (oldStatus === status) {
            // Log no change (but still successful)
            await auditLogger.logAction({
                userId: userId,
                action: 'batch_status_update',
                resourceType: 'Batch',
                resourceId: batchId.toString(),
                details: {
                    message: `Batch "${batchBeforeUpdate.batch_name}" status unchanged (already ${status})`,
                    batch_name: batchBeforeUpdate.batch_name,
                    status: status,
                    update_type: 'manual',
                    changed: false
                },
                status: 'success',
                sourceIp: req.ip
            });
            
            return res.json({
                success: true,
                changed: false,
                message: 'Status unchanged'
            });
        }

        await client.query('BEGIN');

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
        `, [batchId, oldStatus, status, reason || 'Manual status change', userId]);

        await client.query('COMMIT');

        // Log to audit trail
        await auditLogger.logAction({
            userId: userId,
            action: 'batch_status_update',
            resourceType: 'Batch',
            resourceId: batchId.toString(),
            details: {
                message: `User ID ${userId} manually updated Batch "${batchBeforeUpdate.batch_name}" status from "${oldStatus}" to "${status}" (Quantity: ${batchBeforeUpdate.quantity})`,
                batch_id: batchId,
                batch_name: batchBeforeUpdate.batch_name,
                old_status: oldStatus,
                new_status: status,
                quantity: batchBeforeUpdate.quantity,
                allocated_quantity: batchBeforeUpdate.allocated_quantity,
                product_id: batchBeforeUpdate.fk_master_product_id,
                reason: reason || 'Manual status change',
                update_type: 'manual',
                changed: true
            },
            status: 'success',
            sourceIp: req.ip
        });

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
        
        // Log error to audit trail
        await auditLogger.logAction({
            userId: userId,
            action: 'batch_status_update',
            resourceType: 'Batch',
            resourceId: req.params.id?.toString() || 'unknown',
            details: {
                error: error.message,
                attempted_status: req.body?.status,
                batch_name: batchBeforeUpdate?.batch_name || null,
                old_status: batchBeforeUpdate?.status || null,
                update_type: 'manual'
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
 * /api/v1/products/master/{id}/archive:
 *   patch:
 *     summary: Archive/Unarchive a product
 *     description: Archives a product (soft delete) so it stops listing externally but batches remain usable internally. Admin only.
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
 *             required: [is_archived]
 *             properties:
 *               is_archived:
 *                 type: boolean
 *                 description: True to archive, false to unarchive
 *                 example: true
 *     responses:
 *       200:
 *         description: Product archived/unarchived successfully
 *       403:
 *         description: Not authorized (admin only)
 *       500:
 *         description: Server error
 */
router.patch('/products/master/:id/archive', async (req, res) => {
    const client = await pool.connect();
    try {
        const { is_archived } = req.body;
        const productId = req.params.id;
        const userIdRaw = req.session?.userId || req.user?.id || req.user?.userId || null;
        const userId = userIdRaw ? parseInt(userIdRaw, 10) : null;

        // Get product info before archiving
        const productInfo = await client.query(`
            SELECT name, is_archived FROM "ORDERS-products" WHERE entry_id = $1
        `, [productId]);

        if (productInfo.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        const product = productInfo.rows[0];
        const action = is_archived ? 'archived' : 'unarchived';

        // Update product archive status
        await client.query(`
            UPDATE "ORDERS-products"
            SET is_archived = $1,
                archived_at = CASE WHEN $1 = TRUE THEN NOW() ELSE NULL END,
                archived_by = CASE WHEN $1 = TRUE THEN $2::INTEGER ELSE NULL END
            WHERE entry_id = $3
        `, [is_archived, userId, productId]);

        // Log audit action
        await auditLogger.logAction({
            userId,
            action: is_archived ? 'product_archived' : 'product_unarchived',
            resourceType: 'Product',
            resourceId: productId.toString(),
            details: {
                product_name: product.name,
                previous_status: product.is_archived ? 'archived' : 'active',
                new_status: is_archived ? 'archived' : 'active',
                message: `Product "${product.name}" ${action} by admin`
            },
            status: 'success',
            sourceIp: req.ip
        });

        res.json({
            success: true,
            message: `Product ${action} successfully`,
            product_id: productId,
            product_name: product.name,
            is_archived
        });

    } catch (error) {
        console.error('Error archiving product:', error.message);
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
    const batchSyncService = new BatchSyncService();
    const { pool } = require('../config/database'); // Use existing pool
    const syncFailureTracker = require('../Services/syncFailureTracker');
    let historyId = null;
    const startTime = Date.now();
    let client = null;
    
    try {
        // Check authentication (optional - allow both authenticated and system calls)
        const userId = req.user?.id || req.session?.userId || null;
        const licenseNumber = process.env.SYNC_LICENSE || 'CUL000063';
        
        // Create sync history entry
        client = await pool.connect();
        try {
            const historyResult = await client.query(`
                INSERT INTO sync_history (license_number, sync_type, start_time, status, user_id, script_name)
                VALUES ($1, $2, NOW(), 'started', $3, $4)
                RETURNING id
            `, [licenseNumber, 'batches', userId, 'sync-batches-api']);
            historyId = historyResult.rows[0].id;
        } catch (historyError) {
            console.error('⚠️ Failed to create sync history:', historyError.message);
        }
        
        // Run batch sync with timeout protection
        console.log('🔄 Starting batch sync via API...');
        const syncPromise = batchSyncService.syncBatches();
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Batch sync timeout after 5 minutes')), 300000); // 5 minutes
        });
        
        const result = await Promise.race([syncPromise, timeoutPromise]);
        
        const duration = Date.now() - startTime;
        
        // Update sync history on success (before closing connections)
        if (historyId && client) {
            try {
                const scriptOutput = `Batch sync completed: ${result.changes.new} new, ${result.changes.updated} updated, ${result.changes.removed} removed, ${result.changes.packageChanges} package changes`;
                await client.query(`
                    UPDATE sync_history 
                    SET end_time = NOW(), status = 'completed', duration_ms = $1, script_output = $2
                    WHERE id = $3
                `, [duration, scriptOutput, historyId]);
            } catch (updateError) {
                console.error('⚠️ Failed to update sync history:', updateError.message);
            }
        }
        
        // Record success (before closing connections)
        try {
            await syncFailureTracker.recordSuccess('sync-batches', licenseNumber);
        } catch (trackError) {
            console.error('⚠️ Failed to record success:', trackError.message);
        }

        console.log('✅ Batch sync completed successfully via API');
        
        // Send response BEFORE closing pool (non-blocking)
        res.json({
            success: true,
            duration_ms: duration,
            changes: result.changes
        });
        
        // Close pool asynchronously after response is sent (with timeout)
        setTimeout(async () => {
            try {
                await Promise.race([
                    batchSyncService.close(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Pool close timeout')), 10000)
                    )
                ]);
            } catch (closeError) {
                console.warn('⚠️ Error closing batch sync pool (non-critical):', closeError.message);
            }
        }, 100);

    } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error.message || 'Unknown error';
        const licenseNumber = process.env.SYNC_LICENSE || 'CUL000063';
        
        // Update sync history on failure
        if (historyId && client) {
            try {
                await client.query(`
                    UPDATE sync_history 
                    SET end_time = NOW(), status = 'failed', duration_ms = $1, script_error_output = $2
                    WHERE id = $3
                `, [duration, errorMessage, historyId]);
            } catch (updateError) {
                console.error('⚠️ Failed to update sync history:', updateError.message);
            }
        }
        
        // Record failure
        try {
            await syncFailureTracker.recordFailure('sync-batches', errorMessage, licenseNumber);
        } catch (trackError) {
            console.error('⚠️ Failed to record failure:', trackError.message);
        }
        
        console.error('❌ Error running batch sync:', errorMessage);
        res.status(500).json({
            success: false,
            error: errorMessage
        });
    } finally {
        if (client) {
            client.release();
        }
        // Don't close batchSyncService here - it's closed asynchronously after response
        // Closing here would block the response and cause freezing
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

/**
 * Get real-time available partial packages for a batch
 * GET /api/v1/batches/:batchId/partial-packages/available
 * Permissions: sales_rep, sales_admin
 */
router.get('/batches/:batchId/partial-packages/available', auth, async (req, res) => {
    try {
        const { batchId } = req.params;

        // Get batch with partial package details
        const batch = await query(`
            SELECT 
                id,
                batch_name,
                partial_package_count,
                partial_package_details
            FROM "ORDERS-batches"
            WHERE id = $1
        `, [batchId]);

        if (batch.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Batch not found'
            });
        }

        const batchData = batch.rows[0];

        if (!batchData.partial_package_details || batchData.partial_package_count === 0) {
            return res.json({
                success: true,
                batch_id: parseInt(batchId),
                batch_name: batchData.batch_name,
                partial_packages: []
            });
        }

        // Parse partial package details
        const partialPackageDetails = batchData.partial_package_details.partial_packages || [];
        
        // Check which packages are allocated to active invoices
        const partialPackages = await Promise.all(
            partialPackageDetails.map(async (pkg) => {
                // Check if this package is allocated to any active invoice
                const allocationCheck = await query(`
                    SELECT 
                        i.id as invoice_id,
                        i.invoice_number,
                        i.status
                    FROM "ORDERS-invoice-line-items" li
                    INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                    WHERE li.fk_batch_id = $1
                      AND li.specific_package_labels @> $2::jsonb
                      AND i.status NOT IN ('Cancelled', 'Paid', 'Fully_Rejected')
                `, [batchId, JSON.stringify([pkg.label])]);

                const isAllocated = allocationCheck.rows.length > 0;
                const allocatedTo = isAllocated ? allocationCheck.rows[0].invoice_number : null;

                return {
                    label: pkg.label,
                    quantity: parseFloat(pkg.quantity || 0),
                    available: !isAllocated,
                    allocated_to: allocatedTo
                };
            })
        );

        res.json({
            success: true,
            batch_id: parseInt(batchId),
            batch_name: batchData.batch_name,
            partial_packages: partialPackages
        });
    } catch (error) {
        console.error('Error getting partial packages:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get partial packages',
            details: error.message
        });
    }
});

// =============================================
// PRODUCT IMAGE MANAGEMENT
// =============================================
const { uploadMultiple, handleUploadError } = require('../Middleware/upload');
const productController = require('../Controllers/productController');

// Upload product images
router.post('/products/:id/images', 
    auth, 
    uploadMultiple, 
    handleUploadError,
    productController.uploadProductImages
);

// Get product images
router.get('/products/:id/images', 
    auth, 
    productController.getProductImages
);

// Delete product image
router.delete('/products/:id/images/:imageId', 
    auth, 
    productController.deleteProductImage
);

// Set featured image
router.post('/products/:id/images/:imageId/featured', 
    auth, 
    productController.setFeaturedImage
);

module.exports = router;

