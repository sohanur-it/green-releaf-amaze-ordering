/**
 * Product Controller
 * Handles all product management UI and operations
 */

const { Pool } = require('pg');

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
    try {
        const result = await pool.query(`
            SELECT 
                p.*,
                COUNT(b.id) as batch_count,
                SUM(CASE WHEN b.status = 'Sellable' THEN b.quantity - b.allocated_quantity ELSE 0 END) as available_quantity
            FROM "ORDERS-products" p
            LEFT JOIN "ORDERS-batches" b ON p.entry_id = b.fk_master_product_id
            GROUP BY p.entry_id
            ORDER BY p.name
        `);

        res.render('admin/products/index', {
            title: 'Master Products',
            layout: 'layouts/main',
            products: result.rows,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).send('Error loading products');
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

        // Redirect to link items page
        res.redirect(`/admin/products/${productId}/link-items`);
    } catch (error) {
        console.error('Error creating product:', error);
        res.status(500).send('Error creating product: ' + error.message);
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

        // Get all available METRC items
        const itemsResult = await pool.query(`
            SELECT DISTINCT name 
            FROM items 
            WHERE sync_license IN ('CUL000063', 'MAN000072')
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

        // Get batches for this product
        const batchesResult = await pool.query(`
            SELECT * FROM "ORDERS-batches" 
            WHERE fk_master_product_id = $1
            ORDER BY status, production_date DESC
        `, [productId]);

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

        const product = productResult.rows[0];
        
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
            batches: batchesResult.rows,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).send('Error loading product');
    }
};

module.exports = exports;

