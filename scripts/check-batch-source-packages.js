#!/usr/bin/env node
/**
 * Check if batch source packages exist in activepackages
 * 
 * Usage:
 *   NODE_ENV=production node scripts/check-batch-source-packages.js 304
 */

const path = require('path');

// Load environment configuration
const envFile =
  process.env.NODE_ENV === 'production'
    ? path.join(__dirname, '../config/production.env')
    : path.join(__dirname, '../config/local.env');

require('dotenv').config({ path: envFile });

const { pool } = require('../Server/config/database');

async function checkBatchSourcePackages(productId) {
  const client = await pool.connect();
  
  try {
    console.log(`\n🔍 Checking batch source packages for product ID: ${productId}\n`);

    // Get product METRC items
    const productResult = await client.query(`
      SELECT entry_id, name, brand_name, metrc_linked_items
      FROM "ORDERS-products"
      WHERE entry_id = $1
    `, [productId]);

    if (productResult.rows.length === 0) {
      console.error(`❌ Product not found: ${productId}`);
      return;
    }

    const product = productResult.rows[0];
    const metrcItems = Array.isArray(product.metrc_linked_items) 
      ? product.metrc_linked_items 
      : (product.metrc_linked_items ? JSON.parse(product.metrc_linked_items) : []);

    // Check which license column exists
    const licenseColumnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'activepackages' 
      AND column_name IN ('sync_license', 'synclicense')
      LIMIT 1
    `);
    const activepackagesLicenseColumn = licenseColumnCheck.rows[0]?.column_name || 'sync_license';

    // Get all batches for this product
    const batchesResult = await client.query(`
      SELECT 
        b.id,
        b.batch_name,
        b.metrc_item_name,
        b.first_sourcepackage_label,
        b.sourcepackagelabels,
        b.synclicense,
        b.status,
        b.quantity,
        b.fk_master_product_id
      FROM "ORDERS-batches" b
      WHERE b.metrc_item_name = ANY($1::text[])
      ORDER BY b.id DESC
    `, [metrcItems]);

    console.log(`📦 Found ${batchesResult.rows.length} batch(es)\n`);

    let orphanedCount = 0;
    let linkedCount = 0;
    let unlinkedCount = 0;

    for (const batch of batchesResult.rows) {
      const isLinked = batch.fk_master_product_id === productId;
      
      // Check if source package exists
      const packageCheck = await client.query(`
        SELECT 
          label,
          ${activepackagesLicenseColumn} as license,
          isarchived,
          isfinished,
          quantity,
          item_name
        FROM activepackages
        WHERE label = $1
        LIMIT 1
      `, [batch.first_sourcepackage_label]);

      const packageExists = packageCheck.rows.length > 0;
      const package = packageExists ? packageCheck.rows[0] : null;
      const isActive = package && !package.isarchived && !package.isfinished;
      const licenseMatch = package && package.license === batch.synclicense;

      if (!packageExists || !isActive || !licenseMatch) {
        orphanedCount++;
        console.log(`❌ Batch ${batch.id}: ${batch.batch_name}`);
        console.log(`   Linked: ${isLinked ? '✅' : '❌'}`);
        console.log(`   Source Package: ${batch.first_sourcepackage_label}`);
        console.log(`   Batch License: ${batch.synclicense}`);
        
        if (!packageExists) {
          console.log(`   ⚠️  Source package NOT FOUND in activepackages`);
        } else {
          console.log(`   Package License: ${package.license}`);
          console.log(`   Archived: ${package.isarchived}, Finished: ${package.isfinished}`);
          if (!licenseMatch) {
            console.log(`   ⚠️  LICENSE MISMATCH! Batch: ${batch.synclicense}, Package: ${package.license}`);
          }
          if (!isActive) {
            console.log(`   ⚠️  Package is archived or finished`);
          }
        }
        console.log(``);
      } else {
        if (isLinked) linkedCount++;
        else unlinkedCount++;
      }
    }

    console.log(`\n📊 Summary:\n`);
    console.log(`   Total batches: ${batchesResult.rows.length}`);
    console.log(`   Valid batches (source package exists): ${batchesResult.rows.length - orphanedCount}`);
    console.log(`   Orphaned batches: ${orphanedCount}`);
    console.log(`   Linked to product: ${linkedCount}`);
    console.log(`   Unlinked: ${unlinkedCount}\n`);

    if (orphanedCount > 0) {
      console.log(`⚠️  ISSUE: ${orphanedCount} batch(es) are being incorrectly marked as orphaned\n`);
      console.log(`   This is causing them to be unlinked from the product during batch sync.\n`);
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
const productId = process.argv[2];

if (!productId) {
  console.error('Usage: NODE_ENV=production node scripts/check-batch-source-packages.js <product_id>');
  console.error('Example: NODE_ENV=production node scripts/check-batch-source-packages.js 304');
  process.exit(1);
}

checkBatchSourcePackages(parseInt(productId, 10)).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});


