/**
 * Script to fix negative allocated_quantity values in ORDERS-batches table
 * 
 * This script:
 * 1. Finds all batches with negative allocated_quantity
 * 2. Sets them to 0
 * 3. Logs the correction to batch history
 * 
 * Usage: node scripts/fix-negative-allocations.js [--dry-run]
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

async function fixNegativeAllocations(dryRun = false) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Find all batches with negative allocated_quantity
        const negativeBatches = await client.query(`
            SELECT 
                id,
                batch_name,
                quantity,
                allocated_quantity,
                fk_master_product_id
            FROM "ORDERS-batches"
            WHERE allocated_quantity < 0
            ORDER BY id
        `);
        
        if (negativeBatches.rows.length === 0) {
            console.log('✅ No batches with negative allocated_quantity found.');
            await client.query('ROLLBACK');
            return;
        }
        
        console.log(`\n🔍 Found ${negativeBatches.rows.length} batch(es) with negative allocated_quantity:\n`);
        
        for (const batch of negativeBatches.rows) {
            const oldValue = batch.allocated_quantity;
            const newValue = 0;
            
            console.log(`  Batch ID: ${batch.id}`);
            console.log(`  Batch Name: ${batch.batch_name}`);
            console.log(`  Quantity: ${batch.quantity}`);
            console.log(`  Current Allocated: ${oldValue} → ${newValue}`);
            console.log(`  Product ID: ${batch.fk_master_product_id || 'N/A'}`);
            console.log('');
            
            if (!dryRun) {
                // Update allocated_quantity to 0
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET allocated_quantity = 0
                    WHERE id = $1
                `, [batch.id]);
                
                // Log to batch history
                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id,
                        change_type,
                        field_name,
                        old_value,
                        new_value,
                        reason,
                        changed_by_system
                    ) VALUES ($1, 'allocation_corrected', 'allocated_quantity',
                              $2, $3, 'Data correction: Fixed negative allocated_quantity', true)
                `, [batch.id, oldValue.toString(), newValue.toString()]);
            }
        }
        
        if (dryRun) {
            console.log('🔍 DRY RUN - No changes made. Run without --dry-run to apply fixes.');
            await client.query('ROLLBACK');
        } else {
            await client.query('COMMIT');
            console.log(`\n✅ Fixed ${negativeBatches.rows.length} batch(es) with negative allocated_quantity.`);
        }
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error fixing negative allocations:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Main execution
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

console.log('🔧 Fixing Negative Allocations Script');
console.log('=====================================\n');
console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🏢 Database: ${process.env.DB_DATABASE || 'green_releaf_dev'}`);
console.log(`🌐 Host: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}\n`);

if (dryRun) {
    console.log('⚠️  Running in DRY RUN mode - no changes will be made\n');
}

fixNegativeAllocations(dryRun)
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

