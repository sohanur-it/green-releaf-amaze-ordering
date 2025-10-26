#!/usr/bin/env node

/**
 * One-time Migration Script to Promote First Batches to Sellable
 * 
 * This script promotes the OLDEST batch of each metrc_item_name to 'Sellable'
 * if no Sellable batches currently exist for that item.
 * 
 * Usage: node scripts/promote-first-batches.js
 *        NODE_ENV=production node scripts/promote-first-batches.js  # For production
 */

const { Pool } = require('pg');
const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const isDevelopment = process.env.NODE_ENV !== 'production';

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    // Only use SSL in production
    ...(isDevelopment ? {} : {
        ssl: { rejectUnauthorized: false }
    })
});

async function promoteFirstBatches() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Starting batch promotion migration...');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 Database: ${process.env.DB_DATABASE || 'green_releaf_dev'}\n`);
        
        await client.query('BEGIN');
        
        // Find all unique metrc_item_names
        const items = await client.query(`
            SELECT DISTINCT metrc_item_name
            FROM "ORDERS-batches"
        `);
        
        console.log(`📦 Found ${items.rowCount} unique METRC items\n`);
        
        let promotedCount = 0;
        let alreadyHasSellableCount = 0;
        let noOnHoldCount = 0;
        
        for (const item of items.rows) {
            const itemName = item.metrc_item_name;
            
            // Check if this item already has Sellable batches
            const sellableCheck = await client.query(`
                SELECT COUNT(*) as count
                FROM "ORDERS-batches"
                WHERE metrc_item_name = $1 AND status = 'Sellable'
            `, [itemName]);
            
            if (sellableCheck.rows[0].count > 0) {
                alreadyHasSellableCount++;
                continue; // Skip - already has Sellable batches
            }
            
            // Find the oldest 'On Hold' batch for this item
            const oldestBatch = await client.query(`
                SELECT id, batch_name, created_at
                FROM "ORDERS-batches"
                WHERE metrc_item_name = $1
                  AND status = 'On Hold'
                ORDER BY created_at ASC
                LIMIT 1
            `, [itemName]);
            
            if (oldestBatch.rows.length === 0) {
                noOnHoldCount++;
                console.log(`  ⚠️  Item "${itemName}" has no On Hold batches`);
                continue;
            }
            
            const batchId = oldestBatch.rows[0].id;
            const batchName = oldestBatch.rows[0].batch_name;
            
            // Promote the oldest batch to Sellable
            await client.query(`
                UPDATE "ORDERS-batches"
                SET status = 'Sellable'
                WHERE id = $1
            `, [batchId]);
            
            // Log history
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id, change_type, field_name,
                    old_value, new_value, reason, changed_by_system
                ) VALUES ($1, 'status_changed', 'status', 'On Hold', 'Sellable', 
                          'Migration: Auto-promoted as first batch for item', true)
            `, [batchId]);
            
            console.log(`  ✅ Promoted: "${batchName}"`);
            promotedCount++;
        }
        
        await client.query('COMMIT');
        
        console.log('\n📊 Migration Results:');
        console.log(`   ✅ Promoted: ${promotedCount} batches`);
        console.log(`   ⏭️  Already Sellable: ${alreadyHasSellableCount} items`);
        console.log(`   ⚠️  No On Hold batches: ${noOnHoldCount} items`);
        console.log(`\n✨ Migration completed successfully!`);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the migration
if (require.main === module) {
    promoteFirstBatches()
        .then(() => {
            console.log('🎉 Done!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Migration failed:', error.message);
            process.exit(1);
        });
}

module.exports = { promoteFirstBatches };

