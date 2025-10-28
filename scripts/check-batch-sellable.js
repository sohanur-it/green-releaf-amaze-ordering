/**
 * Check why a batch cannot be marked as Sellable
 * Usage: node scripts/check-batch-sellable.js <batchId>
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });

const { pool } = require('../Server/config/database');

async function checkBatch(batchId) {
    const client = await pool.connect();
    
    try {
        console.log(`🔍 Checking batch ${batchId}...\n`);
        
        const result = await client.query(`
            SELECT 
                id,
                batch_name,
                metrc_item_name,
                items_table_missing,
                unit_weight_grams_missing,
                unit_count_missing,
                thc_percentage,
                thc_override,
                status,
                quantity,
                allocated_quantity
            FROM "ORDERS-batches"
            WHERE id = $1
        `, [batchId]);
        
        if (result.rows.length === 0) {
            console.log(`❌ Batch ${batchId} not found`);
            return;
        }
        
        const batch = result.rows[0];
        
        console.log('📊 Batch Details:');
        console.log(`   ID: ${batch.id}`);
        console.log(`   Name: ${batch.batch_name}`);
        console.log(`   METRC Item: ${batch.metrc_item_name}`);
        console.log(`   Status: ${batch.status}`);
        console.log(`   Quantity: ${batch.quantity}`);
        console.log(`   Allocated: ${batch.allocated_quantity}\n`);
        
        console.log('⚠️  Missing Data Flags:');
        console.log(`   items_table_missing: ${batch.items_table_missing}`);
        console.log(`   unit_weight_grams_missing: ${batch.unit_weight_grams_missing}`);
        console.log(`   unit_count_missing: ${batch.unit_count_missing}`);
        console.log(`   thc_percentage: ${batch.thc_percentage || 'NULL'}`);
        console.log(`   thc_override: ${batch.thc_override || 'NULL'}\n`);
        
        const issues = [];
        
        if (batch.items_table_missing) {
            issues.push('❌ items_table_missing = TRUE (critical)');
        }
        if (batch.unit_weight_grams_missing) {
            issues.push('❌ unit_weight_grams_missing = TRUE (critical)');
        }
        if (batch.unit_count_missing) {
            issues.push('❌ unit_count_missing = TRUE (critical)');
        }
        if (!batch.thc_percentage && !batch.thc_override) {
            issues.push('⚠️  No THC data (warning only, not blocking)');
        }
        
        if (issues.length > 0) {
            console.log('🚫 Why it cannot be marked as Sellable:');
            issues.forEach(issue => console.log(`   ${issue}`));
            console.log('\n💡 Solution:');
            if (batch.items_table_missing || batch.unit_weight_grams_missing || batch.unit_count_missing) {
                console.log('   - The batch is missing critical Items table data');
                console.log('   - This needs to be fixed by the batch sync process');
                console.log('   - Or manually update the missing data flags to FALSE\n');
            }
        } else {
            console.log('✅ This batch CAN be marked as Sellable!');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        client.release();
    }
}

const batchId = process.argv[2];
if (!batchId) {
    console.log('Usage: node scripts/check-batch-sellable.js <batchId>');
    process.exit(1);
}

checkBatch(batchId).then(() => process.exit(0));

