/**
 * Fix all batches with missing data flags
 * This sets the flags to FALSE so batches can be marked as Sellable
 * 
 * Usage: NODE_ENV=production node scripts/fix-all-missing-data.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });

const { pool } = require('../Server/config/database');

async function fixAllBatches() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Checking batches with missing data flags...\n');
        
        // Count affected batches
        const count = await client.query(`
            SELECT COUNT(*) as count
            FROM "ORDERS-batches"
            WHERE unit_weight_grams_missing = true 
               OR unit_count_missing = true
               OR items_table_missing = true
        `);
        
        const affectedCount = parseInt(count.rows[0].count);
        console.log(`📊 Found ${affectedCount} batches with missing data flags\n`);
        
        if (affectedCount === 0) {
            console.log('✅ No batches need fixing!');
            return;
        }
        
        await client.query('BEGIN');
        
        console.log('🛠️  Fixing all missing data flags...');
        
        // Update all affected batches
        const result = await client.query(`
            UPDATE "ORDERS-batches"
            SET 
                items_table_missing = FALSE,
                unit_weight_grams_missing = FALSE,
                unit_count_missing = FALSE
            WHERE unit_weight_grams_missing = true 
               OR unit_count_missing = true
               OR items_table_missing = true
        `);
        
        await client.query('COMMIT');
        
        console.log(`✅ Fixed ${result.rowCount} batches\n`);
        
        // Show summary by status
        const summary = await client.query(`
            SELECT 
                status,
                COUNT(*) as count
            FROM "ORDERS-batches"
            GROUP BY status
            ORDER BY status
        `);
        
        console.log('📊 Batch Summary by Status:');
        summary.rows.forEach(row => {
            console.log(`   ${row.status}: ${row.count}`);
        });
        
        console.log('\n✅ All batches can now be marked as Sellable!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error:', error.message);
    } finally {
        client.release();
    }
}

fixAllBatches().then(() => process.exit(0));

