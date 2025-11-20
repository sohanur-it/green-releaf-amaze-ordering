/**
 * Add cart expiry tracking fields to ORDERS-invoices table
 * - cart_started_at: When cart first started holding inventory (for 48h limit)
 * - extended_until: Maximum expiry time (cart_started_at + 48 hours)
 * 
 * This script is idempotent - safe to run multiple times
 */

const { Pool } = require('pg');
const path = require('path');

// Determine environment and load appropriate config
const nodeEnv = process.env.NODE_ENV || 'development';
let envPath;

if (nodeEnv === 'production') {
    envPath = path.join(__dirname, '../config/production.env');
    console.log('📦 Loading PRODUCTION environment configuration...');
} else {
    envPath = path.join(__dirname, '../config/local.env');
    console.log('💻 Loading LOCAL environment configuration...');
}

// Load environment variables
require('dotenv').config({ path: envPath });

// Log database connection info (without password)
console.log('🔌 Database connection settings:');
console.log(`   Host: ${process.env.DB_HOST}`);
console.log(`   Database: ${process.env.DB_DATABASE}`);
console.log(`   User: ${process.env.DB_USER}`);
console.log(`   Port: ${process.env.DB_PORT}`);
console.log(`   Environment: ${nodeEnv}`);

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10),
    ...(nodeEnv === 'production' ? {
        ssl: { rejectUnauthorized: false }
    } : {})
});

async function addCartExpiryFields() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🔧 Adding cart expiry fields to ORDERS-invoices table...');
        
        // Add cart_started_at if it doesn't exist
        const checkCartStartedAt = await client.query(`
            SELECT column_name
            FROM information_schema.columns 
            WHERE table_name = 'ORDERS-invoices' 
            AND column_name = 'cart_started_at'
        `);
        
        if (checkCartStartedAt.rows.length === 0) {
            console.log('  ➕ Adding cart_started_at column...');
            await client.query(`
                ALTER TABLE "ORDERS-invoices" 
                ADD COLUMN cart_started_at TIMESTAMPTZ
            `);
            
            // Set cart_started_at = cart_created_at for existing carts
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET cart_started_at = cart_created_at
                WHERE cart_started_at IS NULL 
                  AND cart_created_at IS NOT NULL
            `);
            
            await client.query(`
                COMMENT ON COLUMN "ORDERS-invoices".cart_started_at IS 
                'When cart first started holding inventory (for 48h extension limit)'
            `);
            
            console.log('  ✅ cart_started_at column added');
        } else {
            console.log('  ✓ cart_started_at column already exists');
        }
        
        // Add extended_until if it doesn't exist
        const checkExtendedUntil = await client.query(`
            SELECT column_name
            FROM information_schema.columns 
            WHERE table_name = 'ORDERS-invoices' 
            AND column_name = 'extended_until'
        `);
        
        if (checkExtendedUntil.rows.length === 0) {
            console.log('  ➕ Adding extended_until column...');
            await client.query(`
                ALTER TABLE "ORDERS-invoices" 
                ADD COLUMN extended_until TIMESTAMPTZ
            `);
            
            await client.query(`
                COMMENT ON COLUMN "ORDERS-invoices".extended_until IS 
                'Maximum expiry time (cart_started_at + 48 hours)'
            `);
            
            console.log('  ✅ extended_until column added');
        } else {
            console.log('  ✓ extended_until column already exists');
        }
        
        // Add indexes
        console.log('  ➕ Adding indexes...');
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_invoices_cart_started_at 
            ON "ORDERS-invoices" (cart_started_at) 
            WHERE status = 'Draft' AND source = 'External'
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_invoices_extended_until 
            ON "ORDERS-invoices" (extended_until) 
            WHERE status = 'Draft' AND source = 'External'
        `);
        
        console.log('  ✅ Indexes added');
        
        await client.query('COMMIT');
        console.log('✅ Migration completed successfully!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run migration
addCartExpiryFields()
    .then(() => {
        console.log('🎉 Done!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Migration error:', error);
        process.exit(1);
    });

