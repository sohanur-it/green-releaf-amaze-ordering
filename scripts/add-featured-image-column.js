/**
 * Migration Script: Add is_featured Column to Product Images Table
 * 
 * Adds is_featured boolean column to track which image is the featured image
 * Run with: node scripts/add-featured-image-column.js
 * For production: NODE_ENV=production node scripts/add-featured-image-column.js
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

async function addFeaturedImageColumn() {
    const client = await pool.connect();
    
    try {
        console.log('Starting migration: Add is_featured Column...');
        
        // Check if table exists
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'ORDERS-product-images'
            );
        `);

        if (!tableCheck.rows[0].exists) {
            console.error('❌ Table "ORDERS-product-images" does not exist. Please run add-product-images-table.js first.');
            process.exit(1);
        }

        // Check if column already exists
        const columnCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'ORDERS-product-images' 
            AND column_name = 'is_featured'
        `);

        if (columnCheck.rows.length > 0) {
            console.log('✓ Column "is_featured" already exists. Skipping creation.');
            return;
        }

        console.log('Adding column "is_featured"...');
        
        await client.query('BEGIN');

        // Add the column
        await client.query(`
            ALTER TABLE "ORDERS-product-images" 
            ADD COLUMN is_featured BOOLEAN DEFAULT false NOT NULL
        `);

        console.log('✓ Column added successfully.');

        // Set existing display_order = 0 images as featured
        console.log('Setting existing primary images (display_order = 0) as featured...');
        const updateResult = await client.query(`
            UPDATE "ORDERS-product-images"
            SET is_featured = true
            WHERE display_order = 0
              AND is_deleted = false
        `);
        console.log(`✓ Updated ${updateResult.rowCount} existing images to featured.`);

        // Create unique constraint to ensure only one featured image per product
        console.log('Creating unique constraint for featured images...');
        await client.query(`
            CREATE UNIQUE INDEX idx_product_images_featured_unique 
            ON "ORDERS-product-images"(fk_product_id) 
            WHERE is_featured = true AND is_deleted = false
        `);
        console.log('✓ Unique constraint created (ensures only one featured image per product).');

        // Add comment
        await client.query(`
            COMMENT ON COLUMN "ORDERS-product-images".is_featured IS 'Featured image shown in external portal. Only one image per product can be featured.';
        `);

        await client.query('COMMIT');
        
        console.log('\n✅ Migration completed successfully!');
        console.log('✓ Column "is_featured" added');
        console.log('✓ Existing primary images set as featured');
        console.log('✓ Unique constraint created');
        console.log('✓ Comment added');
        
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
addFeaturedImageColumn()
    .then(() => {
        console.log('\nMigration script finished.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });

