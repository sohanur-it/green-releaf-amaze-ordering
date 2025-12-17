#!/usr/bin/env node
/**
 * Investigate missing batches - search broadly and check history
 * 
 * Usage:
 *   NODE_ENV=production node scripts/investigate-missing-batches.js 304
 */

const path = require('path');

// Load environment configuration
const envFile =
  process.env.NODE_ENV === 'production'
    ? path.join(__dirname, '../config/production.env')
    : path.join(__dirname, '../config/local.env');

require('dotenv').config({ path: envFile });

const { pool } = require('../Server/config/database');

async function investigateMissingBatches(productId) {
  const client = await pool.connect();
  
  try {
    console.log(`\n🔍 Investigating missing batches for product ID: ${productId}\n`);

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
    const metrcItems = Array.isArray(product.metrc_linked_items) 
      ? product.metrc_linked_items 
      : (product.metrc_linked_items ? JSON.parse(product.metrc_linked_items) : []);

    console.log(`📋 Product: ${product.brand_name} ${product.name}`);
    console.log(`   METRC Items: ${JSON.stringify(metrcItems)}\n`);

    // Check which license column exists
    const licenseColumnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'activepackages' 
      AND column_name IN ('sync_license', 'synclicense')
      LIMIT 1
    `);
    const activepackagesLicenseColumn = licenseColumnCheck.rows[0]?.column_name || 'sync_license';

    // Search for batches with various METRC item name formats
    console.log(`🔍 Searching for batches with different METRC item name formats...\n`);
    
    for (const metrcItem of metrcItems) {
      // Extract different formats
      const fullItem = metrcItem; // "M00002313135: V2 Amaze 3.5g - Razzberry Mints"
      const itemCode = metrcItem.split(':')[0].trim(); // "M00002313135"
      const itemCodeWithColon = metrcItem.split(':')[0].trim() + ':'; // "M00002313135:"
      
      console.log(`   Searching for: "${fullItem}"`);
      console.log(`   Also trying: "${itemCode}"`);
      console.log(`   Also trying: "${itemCodeWithColon}"\n`);

      // Try exact match
      const exactMatch = await client.query(`
        SELECT 
          id, batch_name, metrc_item_name, fk_master_product_id, 
          status, quantity, first_sourcepackage_label, synclicense,
          last_synced, created_at
        FROM "ORDERS-batches"
        WHERE metrc_item_name = $1
        ORDER BY id DESC
      `, [fullItem]);

      // Try code only
      const codeMatch = await client.query(`
        SELECT 
          id, batch_name, metrc_item_name, fk_master_product_id, 
          status, quantity, first_sourcepackage_label, synclicense,
          last_synced, created_at
        FROM "ORDERS-batches"
        WHERE metrc_item_name = $1
        ORDER BY id DESC
      `, [itemCode]);

      // Try LIKE match
      const likeMatch = await client.query(`
        SELECT 
          id, batch_name, metrc_item_name, fk_master_product_id, 
          status, quantity, first_sourcepackage_label, synclicense,
          last_synced, created_at
        FROM "ORDERS-batches"
        WHERE metrc_item_name LIKE $1
        ORDER BY id DESC
      `, [`%${itemCode}%`]);

      // Combine results
      const allBatches = new Map();
      [...exactMatch.rows, ...codeMatch.rows, ...likeMatch.rows].forEach(b => {
        if (!allBatches.has(b.id)) {
          allBatches.set(b.id, b);
        }
      });

      if (allBatches.size > 0) {
        console.log(`   ✅ Found ${allBatches.size} batch(es):\n`);
        for (const batch of Array.from(allBatches.values())) {
          const isLinked = batch.fk_master_product_id === productId;
          console.log(`   Batch ${batch.id}: ${batch.batch_name}`);
          console.log(`      METRC Item: "${batch.metrc_item_name}"`);
          console.log(`      Linked to Product ${productId}: ${isLinked ? '✅ YES' : '❌ NO'}`);
          console.log(`      Status: ${batch.status}`);
          console.log(`      Quantity: ${batch.quantity}`);
          console.log(`      Created: ${batch.created_at}`);
          console.log(`      Last Synced: ${batch.last_synced || 'Never'}`);
          console.log(``);
        }
      } else {
        console.log(`   ❌ No batches found\n`);
      }
    }

    // Check batch history for any batches that were linked to this product
    console.log(`📜 Checking batch history for product ${productId}...\n`);
    
    const historyResult = await client.query(`
      SELECT DISTINCT
        bh.batch_id,
        b.batch_name,
        b.metrc_item_name,
        b.fk_master_product_id as current_product_id,
        MAX(bh.timestamp) as last_event_time,
        COUNT(*) as event_count
      FROM "ORDERS-batch-history" bh
      LEFT JOIN "ORDERS-batches" b ON bh.batch_id = b.id
      WHERE bh.reason ILIKE '%product%' 
         OR bh.change_type IN ('master_product_linked', 'product_linked', 'status_changed')
      GROUP BY bh.batch_id, b.batch_name, b.metrc_item_name, b.fk_master_product_id
      HAVING b.metrc_item_name = ANY($1::text[])
         OR b.fk_master_product_id = $2
      ORDER BY last_event_time DESC
      LIMIT 50
    `, [metrcItems.map(item => item.split(':')[0].trim()), productId]);

    if (historyResult.rows.length > 0) {
      console.log(`   Found ${historyResult.rows.length} batch(es) with relevant history:\n`);
      for (const batch of historyResult.rows) {
        const isLinked = batch.current_product_id === productId;
        console.log(`   Batch ${batch.batch_id}: ${batch.batch_name || 'DELETED'}`);
        console.log(`      METRC Item: ${batch.metrc_item_name || 'Unknown'}`);
        console.log(`      Currently Linked: ${isLinked ? `✅ Product ${batch.current_product_id}` : '❌ Not linked'}`);
        console.log(`      Last Event: ${batch.last_event_time}`);
        console.log(`      Event Count: ${batch.event_count}`);
        console.log(``);
      }
    } else {
      console.log(`   No relevant history found\n`);
    }

    // Check for batches that were recently unlinked or deleted
    console.log(`🔍 Checking for recently unlinked batches...\n`);
    
    const unlinkHistory = await client.query(`
      SELECT 
        bh.batch_id,
        bh.change_type,
        bh.reason,
        bh.timestamp,
        bh.change_details,
        b.batch_name,
        b.metrc_item_name,
        b.fk_master_product_id
      FROM "ORDERS-batch-history" bh
      LEFT JOIN "ORDERS-batches" b ON bh.batch_id = b.id
      WHERE (
        bh.reason ILIKE '%orphaned%'
        OR bh.reason ILIKE '%unlink%'
        OR bh.reason ILIKE '%source package missing%'
        OR bh.change_type = 'status_changed'
      )
      AND (
        b.metrc_item_name = ANY($1::text[])
        OR b.metrc_item_name LIKE ANY($2::text[])
        OR b.fk_master_product_id = $3
      )
      ORDER BY bh.timestamp DESC
      LIMIT 30
    `, [
      metrcItems,
      metrcItems.map(item => `%${item.split(':')[0].trim()}%`),
      productId
    ]);

    if (unlinkHistory.rows.length > 0) {
      console.log(`   Found ${unlinkHistory.rows.length} unlinking event(s):\n`);
      for (const event of unlinkHistory.rows) {
        console.log(`   ${event.timestamp.toISOString()}: Batch ${event.batch_id}`);
        console.log(`      Batch Name: ${event.batch_name || 'DELETED'}`);
        console.log(`      METRC Item: ${event.metrc_item_name || 'Unknown'}`);
        console.log(`      Type: ${event.change_type}`);
        console.log(`      Reason: ${event.reason}`);
        if (event.change_details) {
          const details = typeof event.change_details === 'string' 
            ? JSON.parse(event.change_details) 
            : event.change_details;
          if (details.product_unlinked || details.old_product_id) {
            console.log(`      Product Unlinked: ${details.old_product_id || 'Yes'}`);
          }
        }
        console.log(``);
      }
    } else {
      console.log(`   No unlinking events found\n`);
    }

    // Check packages in activepackages
    console.log(`📦 Checking packages in activepackages:\n`);
    for (const metrcItem of metrcItems) {
      const itemCode = metrcItem.split(':')[0].trim();
      const fullItem = metrcItem.includes(':') ? metrcItem : itemCode;
      
      // Try both formats
      for (const searchItem of [fullItem, itemCode]) {
        const packagesResult = await client.query(`
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN isarchived = false AND isfinished = false THEN 1 END) as active,
            COUNT(CASE WHEN isarchived = true OR isfinished = true THEN 1 END) as archived_finished,
            array_agg(label ORDER BY lastmodified DESC) FILTER (WHERE isarchived = false AND isfinished = false) as active_labels
          FROM activepackages
          WHERE item_name = $1
            AND ${activepackagesLicenseColumn} IN ('CUL000063', 'MAN000072')
        `, [searchItem]);

        if (packagesResult.rows.length > 0) {
          const pkg = packagesResult.rows[0];
          if (pkg.total > 0) {
            console.log(`   "${searchItem}":`);
            console.log(`      Total packages: ${pkg.total}`);
            console.log(`      Active: ${pkg.active}`);
            console.log(`      Archived/Finished: ${pkg.archived_finished}`);
            if (pkg.active_labels && pkg.active_labels.length > 0) {
              console.log(`      Sample active labels: ${pkg.active_labels.slice(0, 5).join(', ')}`);
            }
            console.log(``);
            break; // Found packages, no need to try other format
          }
        }
      }
    }

    console.log(`\n💡 Summary:\n`);
    console.log(`   If no batches are found, they may have been:`);
    console.log(`   1. Deleted by batch sync (if source packages are missing)`);
    console.log(`   2. Unlinked and then deleted`);
    console.log(`   3. Never created (if packages don't exist in METRC)`);
    console.log(`   4. Using a different METRC item name format\n`);

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
  console.error('Usage: NODE_ENV=production node scripts/investigate-missing-batches.js <product_id>');
  console.error('Example: NODE_ENV=production node scripts/investigate-missing-batches.js 304');
  process.exit(1);
}

investigateMissingBatches(parseInt(productId, 10)).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});


