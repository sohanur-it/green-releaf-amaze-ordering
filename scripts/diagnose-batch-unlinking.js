#!/usr/bin/env node
/**
 * Diagnose why batches are being unlinked from a product
 * 
 * This script investigates:
 * 1. Batch sync history to see when batches were unlinked
 * 2. Source package status in activepackages
 * 3. License matching issues
 * 4. Why batches are being marked as orphaned
 * 
 * Usage:
 *   NODE_ENV=production node scripts/diagnose-batch-unlinking.js "Blue Raspberry Cartridge 1g" "M00002313135"
 */

const path = require('path');

// Load environment configuration
const envFile =
  process.env.NODE_ENV === 'production'
    ? path.join(__dirname, '../config/production.env')
    : path.join(__dirname, '../config/local.env');

require('dotenv').config({ path: envFile });

const { pool } = require('../Server/config/database');

async function diagnoseBatchUnlinking(productName, metrcItemName) {
  const client = await pool.connect();
  
  try {
    console.log(`\n🔍 Diagnosing batch unlinking issue...\n`);
    console.log(`Product: ${productName}`);
    console.log(`METRC Item: ${metrcItemName}\n`);

    // Find the product
    const productResult = await client.query(`
      SELECT entry_id, name, brand_name, metrc_linked_items
      FROM "ORDERS-products"
      WHERE name ILIKE $1 OR (brand_name || ' ' || name) ILIKE $1
      LIMIT 1
    `, [`%${productName}%`]);

    if (productResult.rows.length === 0) {
      console.error(`❌ Product not found: ${productName}`);
      return;
    }

    const product = productResult.rows[0];
    console.log(`📋 Product Information:`);
    console.log(`   ID: ${product.entry_id}`);
    console.log(`   Name: ${product.name}`);
    console.log(`   Brand: ${product.brand_name}`);
    console.log(`   METRC Linked Items: ${JSON.stringify(product.metrc_linked_items || [])}\n`);

    // Check which license column exists in activepackages
    const licenseColumnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'activepackages' 
      AND column_name IN ('sync_license', 'synclicense')
      LIMIT 1
    `);
    const activepackagesLicenseColumn = licenseColumnCheck.rows[0]?.column_name || 'sync_license';
    console.log(`📋 Using license column: ${activepackagesLicenseColumn} in activepackages\n`);

    // Find all batches for this METRC item (current and historical)
    const batchesResult = await client.query(`
      SELECT 
        b.id,
        b.batch_name,
        b.metrc_item_name,
        b.fk_master_product_id,
        b.status,
        b.quantity,
        b.allocated_quantity,
        b.first_sourcepackage_label,
        b.sourcepackagelabels,
        b.synclicense,
        b.last_synced,
        b.created_at,
        -- Check if source package exists
        EXISTS (
          SELECT 1 FROM activepackages 
          WHERE label = b.first_sourcepackage_label
          AND ${activepackagesLicenseColumn} = b.synclicense
          AND isarchived = false
          AND isfinished = false
        ) as source_package_exists,
        -- Check package status
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'label', ap.label,
              'isarchived', ap.isarchived,
              'isfinished', ap.isfinished,
              'quantity', ap.quantity,
              'license', ap.${activepackagesLicenseColumn}
            )
          )
          FROM activepackages ap
          WHERE ap.label = b.first_sourcepackage_label
          LIMIT 1
        ) as package_status
      FROM "ORDERS-batches" b
      WHERE b.metrc_item_name = $1
      ORDER BY b.id DESC
    `, [metrcItemName]);

    console.log(`📦 Found ${batchesResult.rows.length} batch(es) for METRC item "${metrcItemName}":\n`);

    if (batchesResult.rows.length === 0) {
      console.log(`❌ No batches found for this METRC item`);
      return;
    }

    // Analyze each batch
    for (const batch of batchesResult.rows) {
      const isLinked = batch.fk_master_product_id === product.entry_id;
      const isLinkedToAny = batch.fk_master_product_id !== null;
      const linkedProduct = isLinkedToAny ? `Product ID: ${batch.fk_master_product_id}` : 'Not linked';
      
      console.log(`   Batch ${batch.id}: ${batch.batch_name}`);
      console.log(`      Status: ${batch.status}`);
      console.log(`      Quantity: ${batch.quantity}, Allocated: ${batch.allocated_quantity}`);
      console.log(`      Linked to THIS Product: ${isLinked ? '✅ YES' : '❌ NO'}`);
      console.log(`      Linked to ANY Product: ${linkedProduct}`);
      console.log(`      License: ${batch.synclicense}`);
      console.log(`      Source Package: ${batch.first_sourcepackage_label}`);
      console.log(`      Source Package Exists: ${batch.source_package_exists ? '✅ YES' : '❌ NO'}`);
      
      if (batch.package_status && batch.package_status.length > 0) {
        const pkg = batch.package_status[0];
        console.log(`      Package Details:`);
        console.log(`         Label: ${pkg.label}`);
        console.log(`         Archived: ${pkg.isarchived}`);
        console.log(`         Finished: ${pkg.isfinished}`);
        console.log(`         Quantity: ${pkg.quantity}`);
        console.log(`         License: ${pkg.license}`);
        
        if (pkg.license !== batch.synclicense) {
          console.log(`         ⚠️  LICENSE MISMATCH! Batch license: ${batch.synclicense}, Package license: ${pkg.license}`);
        }
        if (pkg.isarchived || pkg.isfinished) {
          console.log(`         ⚠️  Package is archived or finished - batch will be marked as orphaned!`);
        }
      } else {
        console.log(`      ⚠️  Package not found in activepackages at all!`);
      }
      
      console.log(`      Last Synced: ${batch.last_synced || 'Never'}`);
      console.log(``);
    }

    // Check batch history for unlinking events
    console.log(`📜 Checking batch history for unlinking events...\n`);
    
    const batchIds = batchesResult.rows.map(b => b.id);
    const historyResult = await client.query(`
      SELECT 
        bh.batch_id,
        bh.change_type,
        bh.field_name,
        bh.old_value,
        bh.new_value,
        bh.reason,
        bh.change_details,
        bh.timestamp,
        b.batch_name,
        b.metrc_item_name
      FROM "ORDERS-batch-history" bh
      INNER JOIN "ORDERS-batches" b ON bh.batch_id = b.id
      WHERE bh.batch_id = ANY($1)
        AND (
          bh.change_type = 'status_changed' 
          OR bh.reason ILIKE '%orphaned%'
          OR bh.reason ILIKE '%unlink%'
          OR bh.reason ILIKE '%source package missing%'
        )
      ORDER BY bh.timestamp DESC
      LIMIT 50
    `, [batchIds]);

    if (historyResult.rows.length > 0) {
      console.log(`   Found ${historyResult.rows.length} relevant history event(s):\n`);
      for (const event of historyResult.rows) {
        console.log(`   ${event.timestamp.toISOString()}: Batch ${event.batch_id} (${event.batch_name})`);
        console.log(`      Type: ${event.change_type}`);
        console.log(`      Reason: ${event.reason}`);
        if (event.change_details) {
          const details = typeof event.change_details === 'string' 
            ? JSON.parse(event.change_details) 
            : event.change_details;
          console.log(`      Details: ${JSON.stringify(details, null, 2)}`);
        }
        console.log(``);
      }
    } else {
      console.log(`   No unlinking events found in history\n`);
    }

    // Check for packages in activepackages
    console.log(`📦 Checking packages in activepackages for METRC item "${metrcItemName}":\n`);
    
    const packagesResult = await client.query(`
      SELECT 
        label,
        item_name,
        ${activepackagesLicenseColumn} as license,
        quantity,
        isarchived,
        isfinished,
        lastmodified
      FROM activepackages
      WHERE item_name = $1
        AND ${activepackagesLicenseColumn} IN ('CUL000063', 'MAN000072')
      ORDER BY lastmodified DESC
      LIMIT 20
    `, [metrcItemName]);

    console.log(`   Found ${packagesResult.rows.length} package(s) in activepackages:\n`);
    
    const activePackages = packagesResult.rows.filter(p => !p.isarchived && !p.isfinished);
    const archivedPackages = packagesResult.rows.filter(p => p.isarchived || p.isfinished);
    
    console.log(`   Active packages: ${activePackages.length}`);
    console.log(`   Archived/Finished packages: ${archivedPackages.length}\n`);
    
    if (activePackages.length > 0) {
      console.log(`   Active packages:`);
      for (const pkg of activePackages.slice(0, 10)) {
        console.log(`      ${pkg.label} - License: ${pkg.license}, Qty: ${pkg.quantity}`);
      }
      if (activePackages.length > 10) {
        console.log(`      ... and ${activePackages.length - 10} more`);
      }
      console.log(``);
    }

    // Summary and recommendations
    console.log(`\n📊 Summary:\n`);
    
    const linkedBatches = batchesResult.rows.filter(b => b.fk_master_product_id === product.entry_id);
    const unlinkedBatches = batchesResult.rows.filter(b => b.fk_master_product_id !== product.entry_id);
    const orphanedBatches = batchesResult.rows.filter(b => !b.source_package_exists);
    
    console.log(`   Total batches: ${batchesResult.rows.length}`);
    console.log(`   Linked to this product: ${linkedBatches.length}`);
    console.log(`   Unlinked: ${unlinkedBatches.length}`);
    console.log(`   Orphaned (missing source packages): ${orphanedBatches.length}\n`);

    if (orphanedBatches.length > 0) {
      console.log(`⚠️  ISSUE FOUND: ${orphanedBatches.length} batch(es) are marked as orphaned\n`);
      console.log(`   Root cause: Source packages are missing from activepackages or are archived/finished\n`);
      console.log(`   Possible reasons:`);
      console.log(`   1. Packages were archived/finished in METRC`);
      console.log(`   2. License mismatch between batch and package`);
      console.log(`   3. Package labels changed in METRC`);
      console.log(`   4. Batch sync is running and detecting packages as missing\n`);
      console.log(`   Solution:`);
      console.log(`   - Check if packages still exist in METRC`);
      console.log(`   - Verify license matching (batch.synclicense vs package.${activepackagesLicenseColumn})`);
      console.log(`   - If packages are valid, the batch sync may be incorrectly marking them as orphaned`);
    }

    if (unlinkedBatches.length > 0 && orphanedBatches.length === 0) {
      console.log(`⚠️  Batches are unlinked but packages exist - may have been manually unlinked or sync issue\n`);
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Get arguments
const productName = process.argv[2];
const metrcItemName = process.argv[3];

if (!productName || !metrcItemName) {
  console.error('Usage: NODE_ENV=production node scripts/diagnose-batch-unlinking.js <product_name> <metrc_item_name>');
  console.error('Example: NODE_ENV=production node scripts/diagnose-batch-unlinking.js "Blue Raspberry Cartridge 1g" "M00002313135"');
  process.exit(1);
}

diagnoseBatchUnlinking(productName, metrcItemName).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});


