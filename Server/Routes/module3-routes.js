/**
 * Module 3 API Routes
 * 
 * Product & Inventory Management API endpoints
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
 * Create Master Product
 * POST /api/v1/products/master
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
 * Link METRC Items to Master Product (with impact preview)
 * POST /api/v1/products/master/:id/link-items
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
 * Confirm METRC Item Linking
 * POST /api/v1/products/master/:id/link-items/confirm
 */
router.post('/products/master/:id/link-items/confirm', async (req, res) => {
    const client = await pool.connect();
    try {
        const { metrc_item_names } = req.body;
        const productId = req.params.id;

        await client.query('BEGIN');

        // Update the Master Product's JSONB array
        await client.query(`
            UPDATE "ORDERS-products"
            SET metrc_linked_items = metrc_linked_items || $1::jsonb
            WHERE entry_id = $2
        `, [JSON.stringify(metrc_item_names), productId]);

        // Update all affected batches to link to this Master Product
        const result = await client.query(`
            UPDATE "ORDERS-batches"
            SET fk_master_product_id = $1
            WHERE metrc_item_name = ANY($2)
            RETURNING id
        `, [productId, metrc_item_names]);

        // Log this action for each affected batch
        for (const row of result.rows) {
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id, change_type, reason,
                    changed_by_user_id, changed_by_system
                ) VALUES ($1, 'master_product_linked', 'Linked to Master Product', $2, false)
            `, [row.id, req.user?.id || null]);
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            batches_updated: result.rowCount
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error linking METRC items:', error.message);
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
 * Get Batches for Master Product
 * GET /api/v1/products/master/:id/batches
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
 * Update Batch Status
 * PATCH /api/v1/batches/:id/status
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
 * Update Product Default Price
 * PATCH /api/v1/products/master/:id/price
 */
router.patch('/products/master/:id/price', async (req, res) => {
    const client = await pool.connect();
    try {
        const { default_price } = req.body;
        const productId = req.params.id;

        await client.query('BEGIN');

        // Update the primary product
        await client.query(`
            UPDATE "ORDERS-products"
            SET default_price = $1,
                price_updated_at = NOW(),
                price_updated_by = $2
            WHERE entry_id = $3
        `, [default_price, req.user?.id || null, productId]);

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
 * Bulk Update Category Prices
 * POST /api/v1/products/categories/:categoryName/bulk-price-update
 */
router.post('/products/categories/:categoryName/bulk-price-update', async (req, res) => {
    const client = await pool.connect();
    try {
        const { new_price, exclude_product_ids = [] } = req.body;
        const categoryName = req.params.categoryName;

        await client.query('BEGIN');

        const result = await client.query(`
            UPDATE "ORDERS-products"
            SET default_price = $1,
                price_updated_at = NOW(),
                price_updated_by = $2
            WHERE category_name = $3
              AND entry_id != ALL($4)
            RETURNING entry_id, name
        `, [new_price, req.user?.id || null, categoryName, exclude_product_ids]);

        // Audit log
        await client.query(`
            INSERT INTO "ORDERS-audit_log" (
                user_id, action, resource_type, resource_id, details
            ) VALUES ($1, 'bulk_price_update', 'Category', $2, $3)
        `, [
            req.user?.id || null,
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

// =============================================
// ADMIN / SYNC
// =============================================

/**
 * Force Batch Sync
 * POST /api/v1/admin/sync/batches
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
            string_agg(DISTINCT status::text, ', ') as statuses_present
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

    if (impact.batch_count === 0) {
        warnings.push({
            level: 'INFO',
            message: 'No existing batches found for these METRC items. This product will appear empty until the next sync.'
        });
    } else {
        warnings.push({
            level: 'SUCCESS',
            message: `${impact.batch_count} batches will be linked to this product, totaling ${impact.quantity_aggregated} units.`
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

