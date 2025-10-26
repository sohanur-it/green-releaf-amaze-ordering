#!/usr/bin/env node

/**
 * Test script to link METRC items to a master product
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
    ...(isDevelopment ? {} : {
        ssl: { rejectUnauthorized: false }
    })
});

async function linkItems() {
    const client = await pool.connect();
    const productId = 394;
    const metrcItemNames = [
        'M00002313117: V2 Amaze 3.5g - Amaze Orange',
        'M00001245007: Amaze 3.5g - Amaze Orange'
    ];
    
    try {
        console.log('🔗 Linking METRC items to product 394...');
        console.log(`   Items: ${metrcItemNames.join(', ')}`);
        
        await client.query('BEGIN');
        
        // Get product info
        const productInfo = await client.query(`
            SELECT name FROM "ORDERS-products" WHERE entry_id = $1
        `, [productId]);
        
        if (productInfo.rows.length === 0) {
            console.error('❌ Product not found');
            return;
        }
        
        console.log(`   Product: ${productInfo.rows[0].name}`);
        
        // Update metrc_linked_items
        await client.query(`
            UPDATE "ORDERS-products"
            SET metrc_linked_items = $1::jsonb
            WHERE entry_id = $2
        `, [JSON.stringify(metrcItemNames), productId]);
        
        console.log('   ✓ Updated metrc_linked_items');
        
        // Update batches
        const batchResult = await client.query(`
            UPDATE "ORDERS-batches"
            SET fk_master_product_id = $1
            WHERE metrc_item_name = ANY($2)
            RETURNING id, batch_name, metrc_item_name
        `, [productId, metrcItemNames]);
        
        console.log(`   ✓ Updated ${batchResult.rowCount} batches`);
        
        // Log to batch history
        for (const row of batchResult.rows) {
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id, change_type, reason, changed_by_system
                ) VALUES ($1, 'master_product_linked', 'Linked to Master Product (Test)', true)
            `, [row.id]);
        }
        
        await client.query('COMMIT');
        
        console.log('\n✅ Successfully linked items!');
        console.log('\n📊 Updated batches:');
        batchResult.rows.forEach((row, i) => {
            console.log(`   ${i+1}. Batch ID ${row.id}: ${row.metrc_item_name}`);
        });
        
        // Verify in database
        const verify = await client.query(`
            SELECT entry_id, name, metrc_linked_items FROM "ORDERS-products" WHERE entry_id = $1
        `, [productId]);
        
        console.log('\n📋 Current metrc_linked_items:');
        console.log(JSON.stringify(verify.rows[0].metrc_linked_items, null, 2));
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    linkItems()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('💥 Failed:', error.message);
            process.exit(1);
        });
}

module.exports = { linkItems };

