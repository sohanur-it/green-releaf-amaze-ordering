/**
 * Script to add CHECK constraint to prevent negative allocated_quantity
 * 
 * This script adds a database constraint to prevent allocated_quantity from going negative.
 * Run fix-negative-allocations.js first to correct any existing negative values.
 * 
 * Usage: node scripts/add-allocated-quantity-constraint.js
 */

const { Pool } = require('pg');
const path = require('path');

// Load environment variables based on NODE_ENV (same as other scripts)
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

// Also load .env if it exists (for backward compatibility)
require('dotenv').config();

const isDevelopment = process.env.NODE_ENV !== 'production';

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ...(isDevelopment ? {} : {
        ssl: { rejectUnauthorized: false }
    })
});

async function addConstraint() {
    const client = await pool.connect();
    
    try {
        // Check if constraint already exists
        const constraintCheck = await client.query(`
            SELECT constraint_name
            FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'ORDERS-batches'
                AND constraint_name = 'chk_allocated_quantity_non_negative'
        `);
        
        if (constraintCheck.rows.length > 0) {
            console.log('✅ Constraint chk_allocated_quantity_non_negative already exists.');
            return;
        }
        
        // Check for existing negative values
        const negativeCheck = await client.query(`
            SELECT COUNT(*) as count
            FROM "ORDERS-batches"
            WHERE allocated_quantity < 0
        `);
        
        const negativeCount = parseInt(negativeCheck.rows[0].count);
        
        if (negativeCount > 0) {
            console.error(`❌ Cannot add constraint: Found ${negativeCount} batch(es) with negative allocated_quantity.`);
            console.error('   Please run fix-negative-allocations.js first to correct these values.');
            process.exit(1);
        }
        
        console.log('🔧 Adding CHECK constraint to prevent negative allocated_quantity...');
        
        await client.query(`
            ALTER TABLE "ORDERS-batches"
            ADD CONSTRAINT chk_allocated_quantity_non_negative
            CHECK (allocated_quantity >= 0)
        `);
        
        console.log('✅ Constraint added successfully.');
        
    } catch (error) {
        console.error('❌ Error adding constraint:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Main execution
console.log('🔧 Adding Allocated Quantity Constraint');
console.log('========================================\n');
console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🏢 Database: ${process.env.DB_DATABASE || 'green_releaf_dev'}`);
console.log(`🌐 Host: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}\n`);

addConstraint()
    .then(() => {
        console.log('\n✅ Script completed successfully.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Script failed:', error);
        process.exit(1);
    })
    .finally(() => {
        pool.end();
    });

