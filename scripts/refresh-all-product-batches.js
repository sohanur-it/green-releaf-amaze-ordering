#!/usr/bin/env node

/**
 * Refresh Batches for All Products
 * 
 * This script refreshes batches from METRC for all products that have linked METRC items.
 * It ensures all product batches are up-to-date without requiring manual refresh per product.
 * 
 * Usage: node scripts/refresh-all-product-batches.js
 */

const path = require('path');
const { Pool } = require('pg');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const BatchSyncService = require('../Server/Services/BatchSyncService');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function refreshAllProductBatches() {
    const batchSyncService = new BatchSyncService();
    const client = await pool.connect();
    const startTime = Date.now();
    
    try {
        console.log('🚀 Starting batch refresh for all products with linked METRC items...\n');
        
        // Get all products with linked METRC items
        const productsResult = await client.query(`
            SELECT entry_id, name, metrc_linked_items
            FROM "ORDERS-products"
            WHERE metrc_linked_items IS NOT NULL
              AND metrc_linked_items::text != '[]'
              AND (is_archived = FALSE OR is_archived IS NULL)
            ORDER BY entry_id
        `);
        
        if (productsResult.rows.length === 0) {
            console.log('✅ No products with linked METRC items found');
            return;
        }
        
        console.log(`📊 Found ${productsResult.rows.length} products with linked METRC items\n`);
        
        let totalBatchesRefreshed = 0;
        const results = [];
        
        // Process products in batches to avoid overwhelming the system
        const batchSize = 10;
        for (let i = 0; i < productsResult.rows.length; i += batchSize) {
            const productBatch = productsResult.rows.slice(i, i + batchSize);
            
            for (const product of productBatch) {
                try {
                    const linkedItems = Array.isArray(product.metrc_linked_items) 
                        ? product.metrc_linked_items 
                        : JSON.parse(product.metrc_linked_items || '[]');
                    
                    if (linkedItems.length > 0) {
                        console.log(`🔄 Refreshing batches for product ${product.entry_id} (${product.name})...`);
                        const result = await batchSyncService.refreshBatchesForItems(linkedItems, product.entry_id);
                        totalBatchesRefreshed += result.updated || 0;
                        results.push({
                            product_id: product.entry_id,
                            product_name: product.name,
                            batches_refreshed: result.updated || 0,
                            success: true
                        });
                        console.log(`   ✅ Refreshed ${result.updated || 0} batch(es)\n`);
                    }
                } catch (error) {
                    console.error(`   ❌ Failed: ${error.message}\n`);
                    results.push({
                        product_id: product.entry_id,
                        product_name: product.name,
                        batches_refreshed: 0,
                        success: false,
                        error: error.message
                    });
                }
            }
        }
        
        const duration = Date.now() - startTime;
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        console.log('\n' + '='.repeat(80));
        console.log('📊 SUMMARY');
        console.log('='.repeat(80));
        console.log(`Products processed: ${productsResult.rows.length}`);
        console.log(`Products successful: ${successful}`);
        console.log(`Products failed: ${failed}`);
        console.log(`Total batches refreshed: ${totalBatchesRefreshed}`);
        console.log(`Duration: ${Math.round(duration / 1000)}s`);
        console.log('='.repeat(80));
        
        if (failed > 0) {
            console.log('\n⚠️  Failed Products:');
            results.filter(r => !r.success).forEach(r => {
                console.log(`   - Product ${r.product_id} (${r.product_name}): ${r.error}`);
            });
        }
        
        console.log('\n✅ Batch refresh completed!');
        
    } catch (error) {
        console.error('❌ Error refreshing batches for all products:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        client.release();
        await batchSyncService.close();
        await pool.end();
    }
}

// Run the script
refreshAllProductBatches()
    .then(() => {
        console.log('\n🎉 Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Script failed:', error.message);
        process.exit(1);
    });

