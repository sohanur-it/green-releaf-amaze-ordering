#!/usr/bin/env node
/**
 * Diagnose why batches aren't showing for a product
 * 
 * Usage: NODE_ENV=production node scripts/diagnose-product-batches.js <product_name_or_id> [metrc_item_name]
 * 
 * Example: NODE_ENV=production node scripts/diagnose-product-batches.js "Blue Burger 3.5g" "M00002207839"
 */

const path = require('path');
const { pool } = require('../Server/config/database');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

async function diagnoseProductBatches(productIdentifier, metrcItemName = null) {
    const client = await pool.connect();
    
    try {
        console.log(`\n🔍 Diagnosing batches for product: ${productIdentifier}`);
        if (metrcItemName) {
            console.log(`   METRC Item: ${metrcItemName}\n`);
        } else {
            console.log(``);
        }
        
        // Find the product
        const productId = isNaN(productIdentifier) ? null : parseInt(productIdentifier, 10);
        const productQuery = productId 
            ? await client.query(`SELECT * FROM "ORDERS-products" WHERE entry_id = $1`, [productId])
            : await client.query(`SELECT * FROM "ORDERS-products" WHERE name ILIKE $1 OR name ILIKE $2 LIMIT 1`, 
                [`%${productIdentifier}%`, productIdentifier]);
        
        if (productQuery.rows.length === 0) {
            console.error(`❌ Product not found: ${productIdentifier}`);
            return;
        }
        
        const product = productQuery.rows[0];
        console.log(`📋 Product Information:`);
        console.log(`   ID: ${product.entry_id}`);
        console.log(`   Name: ${product.name}`);
        console.log(`   Brand: ${product.brand_name}`);
        console.log(`   METRC Linked Items: ${JSON.stringify(product.metrc_linked_items || [])}\n`);
        
        // Get METRC item name if not provided
        const linkedItems = Array.isArray(product.metrc_linked_items) 
            ? product.metrc_linked_items 
            : (product.metrc_linked_items ? JSON.parse(product.metrc_linked_items) : []);
        
        if (linkedItems.length === 0) {
            console.log(`❌ Product has no METRC items linked`);
            return;
        }
        
        const targetMetrcItem = metrcItemName || linkedItems[0];
        console.log(`📦 Checking METRC Item: ${targetMetrcItem}\n`);
        
        // Check which license column exists
        const licenseColumnCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'activepackages' 
            AND column_name IN ('sync_license', 'synclicense')
            LIMIT 1
        `);
        const activepackagesLicenseColumn = licenseColumnCheck.rows[0]?.column_name || 'sync_license';
        
        // Find ALL batches for this METRC item (regardless of product link)
        const allBatchesQuery = `
            SELECT 
                b.id,
                b.batch_name,
                b.metrc_item_name,
                b.fk_master_product_id,
                b.status,
                b.quantity,
                b.allocated_quantity,
                (b.quantity - b.allocated_quantity) as available_quantity,
                b.full_package_count,
                b.partial_package_count,
                b.first_sourcepackage_label,
                b.synclicense,
                -- Check if source package exists
                EXISTS (
                    SELECT 1 FROM activepackages 
                    WHERE label = b.first_sourcepackage_label
                    AND ${activepackagesLicenseColumn} = b.synclicense
                    AND isarchived = false
                    AND isfinished = false
                ) as source_package_exists,
                p.name as linked_product_name
            FROM "ORDERS-batches" b
            LEFT JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
            WHERE b.metrc_item_name = $1
            ORDER BY b.id DESC
        `;
        
        const batchesResult = await client.query(allBatchesQuery, [targetMetrcItem]);
        console.log(`📦 Found ${batchesResult.rows.length} batch(es) for METRC item "${targetMetrcItem}":\n`);
        
        if (batchesResult.rows.length === 0) {
            console.log(`❌ No batches found in database for this METRC item`);
            console.log(`\n💡 Possible reasons:`);
            console.log(`   1. Batch sync hasn't run yet`);
            console.log(`   2. Packages don't exist in activepackages`);
            console.log(`   3. Packages don't match batch extraction query criteria`);
            console.log(`\n🔧 Next steps:`);
            console.log(`   1. Run batch sync: NODE_ENV=production node scripts/sync/sync-batches-prod.js`);
            console.log(`   2. Check if packages exist in activepackages for this METRC item\n`);
            return;
        }
        
        // Analyze each batch
        let linkedCount = 0;
        let unlinkedCount = 0;
        let sellableCount = 0;
        let onHoldCount = 0;
        let orphanedCount = 0;
        
        for (const batch of batchesResult.rows) {
            const isLinked = batch.fk_master_product_id !== null;
            const isLinkedToThisProduct = batch.fk_master_product_id === product.entry_id;
            const isSellable = batch.status === 'Sellable';
            const isOnHold = batch.status === 'On Hold';
            const hasQuantity = batch.quantity > 0;
            const hasAvailable = batch.available_quantity > 0;
            const isOrphaned = !batch.source_package_exists;
            
            if (isLinked) linkedCount++;
            else unlinkedCount++;
            if (isSellable) sellableCount++;
            if (isOnHold) onHoldCount++;
            if (isOrphaned) orphanedCount++;
            
            console.log(`   Batch ${batch.id}: ${batch.batch_name}`);
            console.log(`      Status: ${batch.status}`);
            console.log(`      Quantity: ${batch.quantity}, Allocated: ${batch.allocated_quantity}, Available: ${batch.available_quantity}`);
            console.log(`      Full Packages: ${batch.full_package_count}, Partial: ${batch.partial_package_count}`);
            console.log(`      Linked to Product: ${isLinked ? `Yes (${batch.linked_product_name || 'Unknown'})` : 'NO'}`);
            console.log(`      Linked to THIS Product: ${isLinkedToThisProduct ? 'YES ✓' : 'NO ✗'}`);
            console.log(`      Source Package Exists: ${batch.source_package_exists ? 'YES ✓' : 'NO ✗ (ORPHANED)'}`);
            console.log(`      License: ${batch.synclicense}`);
            console.log(`      Source Package: ${batch.first_sourcepackage_label}`);
            
            // Check why it might not show up
            const reasons = [];
            if (!isLinkedToThisProduct) {
                reasons.push('Not linked to this product');
            }
            if (!isSellable && !isOnHold) {
                reasons.push(`Status is "${batch.status}" (not Sellable/On Hold)`);
            }
            if (!hasAvailable) {
                reasons.push('No available quantity');
            }
            if (isOrphaned) {
                reasons.push('Source package missing (orphaned)');
            }
            
            if (reasons.length > 0) {
                console.log(`      ⚠️  Won't show because: ${reasons.join(', ')}`);
            } else if (isLinkedToThisProduct && isSellable && hasAvailable) {
                console.log(`      ✅ Should be visible`);
            }
            console.log(``);
        }
        
        // Summary
        console.log(`📊 Summary:`);
        console.log(`   Total Batches: ${batchesResult.rows.length}`);
        console.log(`   Linked to Products: ${linkedCount}`);
        console.log(`   Unlinked: ${unlinkedCount}`);
        console.log(`   Sellable: ${sellableCount}`);
        console.log(`   On Hold: ${onHoldCount}`);
        console.log(`   Orphaned: ${orphanedCount}`);
        
        // Check how many are linked to THIS product
        const linkedToThisProduct = batchesResult.rows.filter(b => b.fk_master_product_id === product.entry_id);
        const visibleBatches = linkedToThisProduct.filter(b => 
            b.status === 'Sellable' && b.available_quantity > 0 && b.source_package_exists
        );
        
        console.log(`\n🔍 For THIS Product (${product.name}):`);
        console.log(`   Batches Linked: ${linkedToThisProduct.length}`);
        console.log(`   Visible Batches (Sellable + Available + Valid): ${visibleBatches.length}`);
        
        if (visibleBatches.length === 0) {
            console.log(`\n❌ No batches are visible for this product`);
            console.log(`\n💡 Possible fixes:`);
            
            if (unlinkedCount > 0) {
                console.log(`   1. ${unlinkedCount} batch(es) need to be linked to this product`);
                console.log(`      - Check if metrc_item_name matches product's metrc_linked_items`);
                console.log(`      - Run recovery script if batches were incorrectly unlinked`);
            }
            
            if (onHoldCount > 0) {
                console.log(`   2. ${onHoldCount} batch(es) are "On Hold" - may need status update`);
            }
            
            if (orphanedCount > 0) {
                console.log(`   3. ${orphanedCount} batch(es) are orphaned - source packages missing`);
                console.log(`      - Verify packages exist in activepackages`);
                console.log(`      - Check license matching`);
            }
            
            if (linkedToThisProduct.length > 0 && visibleBatches.length === 0) {
                console.log(`   4. Batches are linked but filtered out by status/quantity`);
                console.log(`      - Check batch status and available quantity`);
            }
        } else {
            console.log(`\n✅ ${visibleBatches.length} batch(es) should be visible`);
        }
        
        // Check packages in activepackages
        console.log(`\n📦 Checking packages in activepackages for METRC item "${targetMetrcItem}":`);
        const packagesQuery = `
            SELECT 
                COUNT(*) as total_packages,
                COUNT(CASE WHEN isarchived = false AND isfinished = false THEN 1 END) as active_packages,
                COUNT(CASE WHEN ${activepackagesLicenseColumn} = 'CUL000063' THEN 1 END) as cul_packages,
                COUNT(CASE WHEN ${activepackagesLicenseColumn} = 'MAN000072' THEN 1 END) as man_packages
            FROM activepackages
            WHERE item_name = $1
        `;
        
        const packagesResult = await client.query(packagesQuery, [targetMetrcItem]);
        if (packagesResult.rows.length > 0) {
            const pkg = packagesResult.rows[0];
            console.log(`   Total Packages: ${pkg.total_packages}`);
            console.log(`   Active Packages: ${pkg.active_packages}`);
            console.log(`   CUL000063: ${pkg.cul_packages}`);
            console.log(`   MAN000072: ${pkg.man_packages}`);
        }
        
    } catch (error) {
        console.error(`\n❌ Error: ${error.message}\n`);
        console.error(error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

// Get arguments
const productIdentifier = process.argv[2];
const metrcItemName = process.argv[3] || null;

if (!productIdentifier) {
    console.error('Usage: NODE_ENV=production node scripts/diagnose-product-batches.js <product_name_or_id> [metrc_item_name]');
    console.error('Example: NODE_ENV=production node scripts/diagnose-product-batches.js "Blue Burger 3.5g" "M00002207839"');
    process.exit(1);
}

diagnoseProductBatches(productIdentifier, metrcItemName).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});



