/**
 * Diagnostic script to check why only 10 products are showing in external portal
 * 
 * This script checks:
 * 1. Total products in database
 * 2. Products with sellable batches
 * 3. Products with available inventory
 * 4. Products with full packages
 */

const path = require('path');

// Load production environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    // Default to production for diagnostic
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
}

const { query } = require('../Server/config/database');

async function diagnoseProducts() {
    try {
        console.log('🔍 Diagnosing Portal Product Visibility...\n');

        // 1. Total products
        const totalProducts = await query(`
            SELECT COUNT(*) as count
            FROM "ORDERS-products"
            WHERE is_archived = false
        `);
        console.log(`1. Total non-archived products: ${totalProducts.rows[0].count}`);

        // 2. Products with any batches
        const productsWithBatches = await query(`
            SELECT COUNT(DISTINCT p.entry_id) as count
            FROM "ORDERS-products" p
            WHERE p.is_archived = false
            AND EXISTS (
                SELECT 1 FROM "ORDERS-batches" b
                WHERE b.fk_master_product_id = p.entry_id
            )
        `);
        console.log(`2. Products with ANY batches: ${productsWithBatches.rows[0].count}`);

        // 3. Products with Sellable batches
        const productsWithSellable = await query(`
            SELECT COUNT(DISTINCT p.entry_id) as count
            FROM "ORDERS-products" p
            WHERE p.is_archived = false
            AND EXISTS (
                SELECT 1 FROM "ORDERS-batches" b
                WHERE b.fk_master_product_id = p.entry_id
                AND b.status = 'Sellable'
            )
        `);
        console.log(`3. Products with Sellable batches: ${productsWithSellable.rows[0].count}`);

        // 4. Products with Sellable batches AND available inventory
        const productsWithAvailable = await query(`
            SELECT COUNT(DISTINCT p.entry_id) as count
            FROM "ORDERS-products" p
            WHERE p.is_archived = false
            AND EXISTS (
                SELECT 1 FROM "ORDERS-batches" b
                WHERE b.fk_master_product_id = p.entry_id
                AND b.status = 'Sellable'
                AND (b.quantity - b.allocated_quantity) > 0
            )
        `);
        console.log(`4. Products with Sellable batches AND available inventory: ${productsWithAvailable.rows[0].count}`);

        // 5. Products with Sellable batches, available inventory, AND full packages
        const productsWithFullPackages = await query(`
            SELECT COUNT(DISTINCT p.entry_id) as count
            FROM "ORDERS-products" p
            WHERE p.is_archived = false
            AND EXISTS (
                SELECT 1 FROM "ORDERS-batches" b
                WHERE b.fk_master_product_id = p.entry_id
                AND b.status = 'Sellable'
                AND (b.quantity - b.allocated_quantity) > 0
                AND b.full_package_count > 0
            )
        `);
        console.log(`5. Products with Sellable batches, available inventory, AND full packages: ${productsWithFullPackages.rows[0].count}`);

        // 6. Batch status breakdown
        const batchStatusBreakdown = await query(`
            SELECT 
                status,
                COUNT(*) as batch_count,
                COUNT(DISTINCT fk_master_product_id) as product_count,
                SUM(quantity) as total_quantity,
                SUM(allocated_quantity) as total_allocated,
                SUM(quantity - allocated_quantity) as total_available
            FROM "ORDERS-batches"
            GROUP BY status
            ORDER BY batch_count DESC
        `);
        console.log('\n6. Batch Status Breakdown:');
        batchStatusBreakdown.rows.forEach(row => {
            console.log(`   ${row.status}: ${row.batch_count} batches, ${row.product_count} products, ${row.total_available} available`);
        });

        // 7. Full package count breakdown
        const fullPackageBreakdown = await query(`
            SELECT 
                CASE 
                    WHEN full_package_count = 0 THEN 'No Full Packages'
                    WHEN full_package_count > 0 AND full_package_count <= 5 THEN '1-5 Full Packages'
                    WHEN full_package_count > 5 AND full_package_count <= 10 THEN '6-10 Full Packages'
                    ELSE '10+ Full Packages'
                END as package_range,
                COUNT(*) as batch_count,
                COUNT(DISTINCT fk_master_product_id) as product_count
            FROM "ORDERS-batches"
            WHERE status = 'Sellable'
            AND (quantity - allocated_quantity) > 0
            GROUP BY package_range
            ORDER BY batch_count DESC
        `);
        console.log('\n7. Full Package Count Breakdown (Sellable batches with inventory):');
        fullPackageBreakdown.rows.forEach(row => {
            console.log(`   ${row.package_range}: ${row.batch_count} batches, ${row.product_count} products`);
        });

        // 8. Sample products that should show but don't
        const sampleProducts = await query(`
            SELECT 
                p.entry_id,
                p.name,
                COUNT(b.id) as batch_count,
                SUM(CASE WHEN b.status = 'Sellable' THEN 1 ELSE 0 END) as sellable_count,
                SUM(CASE WHEN b.status = 'Sellable' AND (b.quantity - b.allocated_quantity) > 0 THEN 1 ELSE 0 END) as available_count,
                SUM(CASE WHEN b.status = 'Sellable' AND (b.quantity - b.allocated_quantity) > 0 AND b.full_package_count > 0 THEN 1 ELSE 0 END) as full_package_count
            FROM "ORDERS-products" p
            LEFT JOIN "ORDERS-batches" b ON b.fk_master_product_id = p.entry_id
            WHERE p.is_archived = false
            GROUP BY p.entry_id, p.name
            HAVING COUNT(b.id) > 0
            ORDER BY batch_count DESC
            LIMIT 10
        `);
        console.log('\n8. Sample Products (first 10 with batches):');
        sampleProducts.rows.forEach(row => {
            console.log(`   ${row.name}: ${row.batch_count} total batches, ${row.sellable_count} sellable, ${row.available_count} available, ${row.full_package_count} with full packages`);
        });

        // 9. Check if batches exist but are not 'Sellable'
        const nonSellableBatches = await query(`
            SELECT 
                status,
                COUNT(*) as count,
                SUM(quantity - allocated_quantity) as total_available
            FROM "ORDERS-batches"
            WHERE status != 'Sellable'
            AND (quantity - allocated_quantity) > 0
            GROUP BY status
            ORDER BY count DESC
        `);
        console.log('\n9. Non-Sellable Batches with Available Inventory:');
        if (nonSellableBatches.rows.length > 0) {
            nonSellableBatches.rows.forEach(row => {
                console.log(`   ${row.status}: ${row.count} batches with ${row.total_available} available inventory`);
            });
        } else {
            console.log('   None');
        }

        // 10. Check products without batches
        const productsWithoutBatches = await query(`
            SELECT 
                p.entry_id,
                p.name,
                p.brand_name,
                p.category_name,
                p.metrc_linked_items
            FROM "ORDERS-products" p
            WHERE p.is_archived = false
            AND NOT EXISTS (
                SELECT 1 FROM "ORDERS-batches" b
                WHERE b.fk_master_product_id = p.entry_id
            )
            ORDER BY p.name
            LIMIT 20
        `);
        console.log('\n10. Sample Products WITHOUT any batches (first 20):');
        if (productsWithoutBatches.rows.length > 0) {
            productsWithoutBatches.rows.forEach(row => {
                let linkedItemsCount = 0;
                try {
                    if (row.metrc_linked_items) {
                        const parsed = typeof row.metrc_linked_items === 'string' 
                            ? JSON.parse(row.metrc_linked_items) 
                            : row.metrc_linked_items;
                        linkedItemsCount = Array.isArray(parsed) ? parsed.length : 0;
                    }
                } catch (e) {
                    linkedItemsCount = 0;
                }
                console.log(`   ${row.name} (${row.brand_name || 'N/A'}) - Linked METRC items: ${linkedItemsCount}`);
            });
            console.log(`   ... and ${393 - 6 - productsWithoutBatches.rows.length} more products without batches`);
        } else {
            console.log('   None (all products have batches)');
        }

        // 11. Check batches without products
        const batchesWithoutProducts = await query(`
            SELECT 
                COUNT(*) as count,
                COUNT(DISTINCT metrc_item_name) as item_count
            FROM "ORDERS-batches"
            WHERE fk_master_product_id IS NULL
        `);
        console.log('\n11. Batches NOT linked to products:');
        console.log(`   ${batchesWithoutProducts.rows[0].count} batches across ${batchesWithoutProducts.rows[0].item_count} METRC items`);

        // 12. Check products with metrc_linked_items but no batches
        const productsWithLinksButNoBatches = await query(`
            SELECT 
                COUNT(*) as count
            FROM "ORDERS-products" p
            WHERE p.is_archived = false
            AND p.metrc_linked_items IS NOT NULL
            AND p.metrc_linked_items != '[]'::jsonb
            AND NOT EXISTS (
                SELECT 1 FROM "ORDERS-batches" b
                WHERE b.fk_master_product_id = p.entry_id
            )
        `);
        console.log('\n12. Products with METRC links but NO batches:');
        console.log(`   ${productsWithLinksButNoBatches.rows[0].count} products`);

        console.log('\n✅ Diagnosis complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

diagnoseProducts();

