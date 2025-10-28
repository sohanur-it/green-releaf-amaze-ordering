/**
 * Fix ALL batches that have missing data flags
 * This manually sets the flags to FALSE so batches can be marked as Sellable
 * 
 * Usage: node scripts/fix-all-batches-sellable.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });

const { pool } = require('../Server/config/database');

async function fixAllBatches() {
    const client = await pool.connect();
    
    try {
        // First, check how many batches have missing data flags
        const affected = await client.query(`
            SELECT COUNT(*) as count
            FROM "ORDERS-batches"
            WHERE unit_weight_grams_missing = true 
               OR unit_count_missing = true
               OR items_table_missing = true
        `);
        
        console.log(`📊 Found ${affected.rows[0].count} batches with missing data flags\n`);
        
        if (affected.rows[0].count === 0) {
            console.log('✅ No batches need fixing!');
            return;
        }
        
        // Get list of affected batches
        const batches = await client.query(`
            SELECT 
                id,
                batch_name,
                metrc_item_name,
                items_table_missing,
                unit_weight_grams_missing,
                unit_count_missing,
                status
            FROM "ORDERS-batches"
            WHERE unit_weight_grams_missing = true 
               OR unit_count_missing = true
               OR items_table_missing = true
            LIMIT 10
        `);
        
        console.log('📋 Sample of affected batches:');
        batches.rows.forEach(batch => {
            console.log(`   Batch ${batch.id}: ${batch.batch_name}`);
            console.log(`     Status: ${batch.status}`);
            console.log(`     Items missing: ${batch.items_table_missing}`);
            console.log(`     Unit weight missing: ${batch.unit_weight_grams_missing}`);
            console.log(`     Unit count missing: ${batch.unit_count_missing}`);
            console.log('');
        });
        
        // Ask for confirmation
        console.log('⚠️  This will set missing data flags to FALSE for ALL batches.');
        console.log('   This allows batches to be marked as Sellable despite missing Items data.\n');
        console.log('   Continue? (Answer: yes to proceed)');
        
        // For now, just show what would happen
        console.log('\n💡 To fix all batches, uncomment the UPDATE query in this script.');
        console.log('   Or use: UPDATE "ORDERS-batches" SET');
        console.log('       items_table_missing = FALSE,');
        console.log('       unit_weight_grams_missing = FALSE,');
        console.log('       unit_count_missing = FALSE;');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        client.release();
    }
}

fixAllBatches().then(() => process.exit(0));

