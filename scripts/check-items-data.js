/**
 * Check items table data for a specific batch
 * Usage: node scripts/check-items-data.js <batchId>
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });

const { pool } = require('../Server/config/database');

async function checkItemsData(batchId) {
    const client = await pool.connect();
    
    try {
        console.log(`🔍 Checking Items table data for batch ${batchId}...\n`);
        
        // Get batch info
        const batch = await client.query(`
            SELECT id, batch_name, metrc_item_name
            FROM "ORDERS-batches"
            WHERE id = $1
        `, [batchId]);
        
        if (batch.rows.length === 0) {
            console.log(`❌ Batch ${batchId} not found`);
            return;
        }
        
        const metrcItemName = batch.rows[0].metrc_item_name;
        console.log(`📦 Batch: ${batch.rows[0].batch_name}`);
        console.log(`🏷️  METRC Item Name: ${metrcItemName}\n`);
        
        // Check items table
        console.log('🔍 Checking Items table...\n');
        
        const items = await client.query(`
            SELECT 
                name,
                unit_weight_grams,
                unit_count,
                historical
            FROM items
            WHERE name = $1
            ORDER BY historical
        `, [metrcItemName]);
        
        if (items.rows.length === 0) {
            console.log('❌ NO MATCH IN ITEMS TABLE!');
            console.log(`   Looking for: "${metrcItemName}"`);
            console.log('\n💡 This is why the batch has missing data flags\n');
            
            // Check for similar items
            const similar = await client.query(`
                SELECT name 
                FROM items 
                WHERE name ILIKE '%' || split_part($1, ':', 1) || '%'
                LIMIT 10
            `, [metrcItemName]);
            
            if (similar.rows.length > 0) {
                console.log('🔍 Similar items found:');
                similar.rows.forEach(row => {
                    console.log(`   - ${row.name}`);
                });
            }
            
        } else {
            console.log(`✅ Found ${items.rows.length} item(s):\n`);
            items.rows.forEach((row, idx) => {
                console.log(`   Item ${idx + 1}:`);
                console.log(`     Name: ${row.name}`);
                console.log(`     Unit Weight: ${row.unit_weight_grams || 'NULL'}`);
                console.log(`     Unit Count: ${row.unit_count || 'NULL'}`);
                console.log(`     Historical: ${row.historical}`);
                console.log('');
            });
            
            // Check if sync is using the right one
            const activeItem = items.rows.find(r => r.historical === false);
            if (!activeItem) {
                console.log('⚠️  No active (historical=false) item found!');
                console.log('   The batch sync only uses non-historical items.');
                console.log('   This is why the missing flags are set.');
            }
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        client.release();
    }
}

const batchId = process.argv[2];
if (!batchId) {
    console.log('Usage: node scripts/check-items-data.js <batchId>');
    process.exit(1);
}

checkItemsData(batchId).then(() => process.exit(0));

