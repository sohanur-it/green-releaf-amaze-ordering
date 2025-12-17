#!/usr/bin/env node
/**
 * Find all batches for a product, including unlinked ones
 * 
 * Usage:
 *   NODE_ENV=production node scripts/find-batches-by-product.js <product_id>
 */

const path = require('path');

// Load environment configuration
const envFile =
  process.env.NODE_ENV === 'production'
    ? path.join(__dirname, '../config/production.env')
    : path.join(__dirname, '../config/local.env');

require('dotenv').config({ path: envFile });

const { pool } = require('../Server/config/database');

async function findBatchesByProduct(productId) {
  const client = await pool.connect();
  
  try {
    console.log(`\n🔍 Finding batches for product ID: ${productId}\n`);

    // Get product info
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
    console.log(`📋 Product Information:`);
    console.log(`   ID: ${product.entry_id}`);
    console.log(`   Name: ${product.name}`);
    console.log(`   Brand: ${product.brand_name}`);
    console.log(`   METRC Linked Items: ${JSON.stringify(product.metrc_linked_items || [])}\n`);

    // Check which license column exists
    const licenseColumnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'activepackages' 
      AND column_name IN ('sync_license', 'synclicense')
      LIMIT 1
    `);
    const activepackagesLicenseColumn = licenseColumnCheck.rows[0]?.column_name || 'sync_license';

    // Find batches linked to this product
    const linkedBatches = await client.query(`
      SELECT 
        b.id,
        b.batch_name,
        b.metrc_item_name,
        b.status,
        b.quantity,
        b.allocated_quantity,
        b.first_sourcepackage_label,
        b.synclicense,
        b.last_synced,
        EXISTS (
          SELECT 1 FROM activepackages 
          WHERE label = b.first_sourcepackage_label
          AND ${activepackagesLicenseColumn} = b.synclicense
          AND isarchived = false
          AND isfinished = false
        ) as source_package_exists
      FROM "ORDERS-batches" b
      WHERE b.fk_master_product_id = $1
      ORDER BY b.id DESC
    `, [productId]);

    console.log(`📦 Linked Batches: ${linkedBatches.rows.length}\n`);
    for (const batch of linkedBatches.rows) {
      console.log(`   Batch ${batch.id}: ${batch.batch_name}`);
      console.log(`      METRC Item: ${batch.metrc_item_name}`);
      console.log(`      Status: ${batch.status}`);
      console.log(`      Quantity: ${batch.quantity}, Allocated: ${batch.allocated_quantity}`);
      console.log(`      Source Package Exists: ${batch.source_package_exists ? '✅' : '❌'}`);
      console.log(``);
    }

    // Find batches that match METRC items but aren't linked
    const metrcItems = Array.isArray(product.metrc_linked_items) 
      ? product.metrc_linked_items 
      : (product.metrc_linked_items ? JSON.parse(product.metrc_linked_items) : []);

    if (metrcItems.length > 0) {
      console.log(`🔍 Searching for unlinked batches matching METRC items...\n`);
      
      // Try exact match first
      for (const metrcItem of metrcItems) {
        // Extract just the item code if it has description
        const itemCode = metrcItem.split(':')[0].trim();
        const fullItem = metrcItem.includes(':') ? metrcItem : itemCode;
        
        console.log(`   Checking: "${fullItem}" (code: "${itemCode}")`);
        
        // Try exact match
        const exactMatch = await client.query(`
          SELECT 
            b.id,
            b.batch_name,
            b.metrc_item_name,
            b.fk_master_product_id,
            b.status,
            b.quantity,
            b.first_sourcepackage_label,
            b.synclicense
          FROM "ORDERS-batches" b
          WHERE b.metrc_item_name = $1
          ORDER BY b.id DESC
        `, [fullItem]);

        // Try partial match (just the code)
        const partialMatch = await client.query(`
          SELECT 
            b.id,
            b.batch_name,
            b.metrc_item_name,
            b.fk_master_product_id,
            b.status,
            b.quantity,
            b.first_sourcepackage_label,
            b.synclicense
          FROM "ORDERS-batches" b
          WHERE b.metrc_item_name LIKE $1
          ORDER BY b.id DESC
        `, [`${itemCode}%`]);

        const allMatches = [...exactMatch.rows, ...partialMatch.rows.filter(b => 
          !exactMatch.rows.find(e => e.id === b.id)
        )];

        if (allMatches.length > 0) {
          console.log(`      Found ${allMatches.length} batch(es):\n`);
          for (const batch of allMatches) {
            const isLinked = batch.fk_master_product_id === productId;
            console.log(`      Batch ${batch.id}: ${batch.batch_name}`);
            console.log(`         METRC Item: ${batch.metrc_item_name}`);
            console.log(`         Linked to Product ${productId}: ${isLinked ? '✅' : '❌'}`);
            console.log(`         Status: ${batch.status}`);
            console.log(`         Quantity: ${batch.quantity}`);
            console.log(``);
          }
        } else {
          console.log(`      No batches found\n`);
        }
      }
    }

    // Check batch history for this product
    console.log(`📜 Recent batch history for product ${productId}:\n`);
    const historyResult = await client.query(`
      SELECT 
        bh.batch_id,
        bh.change_type,
        bh.reason,
        bh.timestamp,
        b.batch_name,
        b.metrc_item_name,
        b.fk_master_product_id
      FROM "ORDERS-batch-history" bh
      INNER JOIN "ORDERS-batches" b ON bh.batch_id = b.id
      WHERE b.fk_master_product_id = $1
         OR b.metrc_item_name = ANY($2)
      ORDER BY bh.timestamp DESC
      LIMIT 20
    `, [productId, metrcItems]);

    if (historyResult.rows.length > 0) {
      console.log(`   Found ${historyResult.rows.length} history event(s):\n`);
      for (const event of historyResult.rows) {
        const isLinked = event.fk_master_product_id === productId;
        console.log(`   ${event.timestamp.toISOString()}: Batch ${event.batch_id} (${event.batch_name})`);
        console.log(`      Type: ${event.change_type}`);
        console.log(`      Reason: ${event.reason}`);
        console.log(`      Linked: ${isLinked ? '✅' : '❌'}`);
        console.log(``);
      }
    } else {
      console.log(`   No history found\n`);
    }

    // Check packages in activepackages
    console.log(`📦 Checking packages in activepackages:\n`);
    for (const metrcItem of metrcItems) {
      const itemCode = metrcItem.split(':')[0].trim();
      const fullItem = metrcItem.includes(':') ? metrcItem : itemCode;
      
      const packagesResult = await client.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN isarchived = false AND isfinished = false THEN 1 END) as active,
          COUNT(CASE WHEN isarchived = true OR isfinished = true THEN 1 END) as archived_finished
        FROM activepackages
        WHERE item_name = $1
          AND ${activepackagesLicenseColumn} IN ('CUL000063', 'MAN000072')
      `, [fullItem]);

      if (packagesResult.rows.length > 0) {
        const pkg = packagesResult.rows[0];
        console.log(`   "${fullItem}":`);
        console.log(`      Total packages: ${pkg.total}`);
        console.log(`      Active: ${pkg.active}`);
        console.log(`      Archived/Finished: ${pkg.archived_finished}`);
        console.log(``);
      }
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
  console.error('Usage: NODE_ENV=production node scripts/find-batches-by-product.js <product_id>');
  console.error('Example: NODE_ENV=production node scripts/find-batches-by-product.js 304');
  process.exit(1);
}

findBatchesByProduct(parseInt(productId, 10)).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});


