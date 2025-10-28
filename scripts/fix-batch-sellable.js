/**
 * Fix batch data flags and update status to Sellable
 * Usage: node scripts/fix-batch-sellable.js <batchId>
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });

const { pool } = require('../Server/config/database');

async function fixBatch(batchId) {
    const client = await pool.connect();
    
    try {
        console.log(`🔧 Fixing batch ${batchId}...\n`);
        
        // First, check current state
        const current = await client.query(`
            SELECT 
                id,
                batch_name,
                status,
                items_table_missing,
                unit_weight_grams_missing,
                unit_count_missing
            FROM "ORDERS-batches"
            WHERE id = $1
        `, [batchId]);
        
        if (current.rows.length === 0) {
            console.log(`❌ Batch ${batchId} not found`);
            return;
        }
        
        const batch = current.rows[0];
        console.log('📊 Current State:');
        console.log(`   Status: ${batch.status}`);
        console.log(`   items_table_missing: ${batch.items_table_missing}`);
        console.log(`   unit_weight_grams_missing: ${batch.unit_weight_grams_missing}`);
        console.log(`   unit_count_missing: ${batch.unit_count_missing}\n`);
        
        await client.query('BEGIN');
        
        // Fix missing data flags
        console.log('🛠️  Setting missing data flags to FALSE...');
        await client.query(`
            UPDATE "ORDERS-batches"
            SET 
                items_table_missing = FALSE,
                unit_weight_grams_missing = FALSE,
                unit_count_missing = FALSE
            WHERE id = $1
        `, [batchId]);
        
        console.log('✅ Data flags fixed');
        
        // Update status to Sellable
        console.log('📊 Updating status to Sellable...');
        const oldStatus = batch.status;
        
        await client.query(`
            UPDATE "ORDERS-batches"
            SET status = 'Sellable'
            WHERE id = $1
        `, [batchId]);
        
        console.log('✅ Status updated to Sellable');
        
        // Log to history
        console.log('📝 Logging to batch history...');
        await client.query(`
            INSERT INTO "ORDERS-batch-history" (
                batch_id, change_type, field_name,
                old_value, new_value, reason,
                changed_by_system
            ) VALUES ($1, 'status_changed', 'status', $2, 'Sellable', 
                      'Manual status change after fixing data flags', true)
        `, [batchId, oldStatus]);
        
        await client.query('COMMIT');
        
        console.log('\n✅ Batch updated successfully!');
        console.log(`   Old status: ${oldStatus}`);
        console.log(`   New status: Sellable`);
        
        // Verify it can be marked as Sellable now
        const verify = await client.query(`
            SELECT can_batch_be_sellable($1) as can_be_sellable
        `, [batchId]);
        
        console.log(`\n🧪 Validation check: can_batch_be_sellable = ${verify.rows[0].can_be_sellable}`);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error:', error.message);
    } finally {
        client.release();
    }
}

const batchId = process.argv[2];
if (!batchId) {
    console.log('Usage: node scripts/fix-batch-sellable.js <batchId>');
    process.exit(1);
}

fixBatch(batchId).then(() => process.exit(0));

