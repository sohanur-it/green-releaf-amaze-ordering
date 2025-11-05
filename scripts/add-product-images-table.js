/**
 * Migration Script: Add Product Images Table
 * 
 * Creates the ORDERS-product-images table for storing product images
 * Run with: node scripts/add-product-images-table.js
 * For production: NODE_ENV=production node scripts/add-product-images-table.js
 */

const { Pool } = require('pg');
const path = require('path');

// Load environment variables based on NODE_ENV
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000
});

async function createProductImagesTable() {
    const client = await pool.connect();
    
    try {
        console.log('Starting migration: Add Product Images Table...');
        
        // Check if table already exists
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'ORDERS-product-images'
            );
        `);

        if (tableCheck.rows[0].exists) {
            console.log('✓ Table "ORDERS-product-images" already exists. Skipping creation.');
            
            // Check if indexes exist
            const indexCheck = await client.query(`
                SELECT indexname 
                FROM pg_indexes 
                WHERE tablename = 'ORDERS-product-images';
            `);
            
            console.log(`✓ Found ${indexCheck.rows.length} index(es) on the table.`);
            return;
        }

        console.log('Creating table "ORDERS-product-images"...');
        
        await client.query('BEGIN');

        // Create the table
        await client.query(`
            CREATE TABLE "ORDERS-product-images" (
                id SERIAL PRIMARY KEY,
                fk_product_id INTEGER NOT NULL REFERENCES "ORDERS-products"(entry_id) ON DELETE CASCADE,
                
                -- Image Information
                filename VARCHAR(255) NOT NULL,
                original_filename VARCHAR(255) NOT NULL,
                file_path VARCHAR(500) NOT NULL,
                file_size BIGINT NOT NULL,
                mime_type VARCHAR(100) NOT NULL,
                
                -- Display Order
                display_order INTEGER NOT NULL DEFAULT 0,
                
                -- Metadata
                alt_text TEXT,
                uploaded_by INTEGER REFERENCES users(id),
                uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                
                -- Soft delete
                is_deleted BOOLEAN DEFAULT false,
                deleted_at TIMESTAMPTZ,
                deleted_by INTEGER REFERENCES users(id)
            );
        `);

        console.log('✓ Table created successfully.');

        // Create indexes
        console.log('Creating indexes...');
        
        await client.query(`
            CREATE INDEX idx_product_images_product 
            ON "ORDERS-product-images"(fk_product_id) 
            WHERE is_deleted = false;
        `);
        console.log('✓ Index idx_product_images_product created.');

        await client.query(`
            CREATE INDEX idx_product_images_display_order 
            ON "ORDERS-product-images"(fk_product_id, display_order) 
            WHERE is_deleted = false;
        `);
        console.log('✓ Index idx_product_images_display_order created.');

        await client.query(`
            CREATE INDEX idx_product_images_primary 
            ON "ORDERS-product-images"(fk_product_id, display_order) 
            WHERE is_deleted = false AND display_order = 0;
        `);
        console.log('✓ Index idx_product_images_primary created.');

        // Add comments
        await client.query(`
            COMMENT ON TABLE "ORDERS-product-images" IS 'Stores product images. First image (display_order = 0) is the primary/featured image shown in external portal.';
        `);
        
        await client.query(`
            COMMENT ON COLUMN "ORDERS-product-images".display_order IS 'Display order for images. 0 = primary/featured image, 1+ = additional images. Lower numbers appear first.';
        `);
        
        await client.query(`
            COMMENT ON COLUMN "ORDERS-product-images".file_path IS 'Relative path from public directory, e.g., "product/images/filename.jpg"';
        `);

        await client.query('COMMIT');
        
        console.log('\n✅ Migration completed successfully!');
        console.log('✓ Table "ORDERS-product-images" created');
        console.log('✓ Indexes created');
        console.log('✓ Comments added');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n❌ Migration failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the migration
createProductImagesTable()
    .then(() => {
        console.log('\nMigration script finished.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });

