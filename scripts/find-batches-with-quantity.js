#!/usr/bin/env node
/**
 * Find batches with quantity > 0 and show their product linkage status
 * 
 * This script helps identify batches that have inventory but may not be linked to products,
 * making it easier to link METRC items to products.
 * 
 * Usage:
 *   NODE_ENV=development node scripts/find-batches-with-quantity.js
 *   NODE_ENV=production  node scripts/find-batches-with-quantity.js
 * 
 * Optional filters:
 *   --unlinked-only          Show only batches not linked to products
 *   --linked-only            Show only batches linked to products
 *   --product-id=<id>        Filter by product ID
 *   --metrc-item=<name>      Filter by METRC item name
 *   --status=<status>        Filter by batch status (Sellable, On Hold, On Deck)
 *   --min-quantity=<n>       Minimum quantity threshold (default: 1)
 *   --show-available         Show available quantity (quantity - allocated)
 */

const path = require('path');

// Load environment configuration
const envFile =
  process.env.NODE_ENV === 'production'
    ? path.join(__dirname, '../config/production.env')
    : path.join(__dirname, '../config/local.env');

require('dotenv').config({ path: envFile });

const { pool } = require('../Server/config/database');

// Parse command line arguments
const args = process.argv.slice(2);
const filters = {
  unlinkedOnly: args.includes('--unlinked-only'),
  linkedOnly: args.includes('--linked-only'),
  productId: args.find(arg => arg.startsWith('--product-id='))?.split('=')[1],
  metrcItem: args.find(arg => arg.startsWith('--metrc-item='))?.split('=')[1],
  status: args.find(arg => arg.startsWith('--status='))?.split('=')[1],
  minQuantity: parseInt(args.find(arg => arg.startsWith('--min-quantity='))?.split('=')[1] || '1', 10),
  showAvailable: args.includes('--show-available')
};

async function findBatchesWithQuantity() {
  const client = await pool.connect();
  
  try {
    console.log(`\n🔍 Finding batches with quantity > 0...\n`);
    console.log(`Filters:`);
    if (filters.unlinkedOnly) console.log(`   - Unlinked batches only`);
    if (filters.linkedOnly) console.log(`   - Linked batches only`);
    if (filters.productId) console.log(`   - Product ID: ${filters.productId}`);
    if (filters.metrcItem) console.log(`   - METRC Item: ${filters.metrcItem}`);
    if (filters.status) console.log(`   - Status: ${filters.status}`);
    console.log(`   - Minimum quantity: ${filters.minQuantity}\n`);

    // Build query
    let query = `
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
        b.created_at,
        p.name as product_name,
        p.brand_name as product_brand,
        p.metrc_linked_items as product_metrc_items,
        -- Check if source package exists
        EXISTS (
          SELECT 1 FROM activepackages 
          WHERE label = b.first_sourcepackage_label
          AND (sync_license = b.synclicense OR synclicense = b.synclicense)
          AND isarchived = false
          AND isfinished = false
        ) as source_package_exists,
        -- Find potential matching products (if unlinked)
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'product_id', p2.entry_id,
              'product_name', p2.name,
              'brand_name', p2.brand_name
            )
          )
          FROM "ORDERS-products" p2
          WHERE p2.metrc_linked_items @> jsonb_build_array(b.metrc_item_name)
          AND p2.is_archived = false
          LIMIT 5
        ) as potential_products
      FROM "ORDERS-batches" b
      LEFT JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
      WHERE b.quantity >= $1
    `;

    const queryParams = [filters.minQuantity];
    let paramIndex = 2;

    // Apply filters
    if (filters.unlinkedOnly) {
      query += ` AND b.fk_master_product_id IS NULL`;
    }
    
    if (filters.linkedOnly) {
      query += ` AND b.fk_master_product_id IS NOT NULL`;
    }
    
    if (filters.productId) {
      query += ` AND b.fk_master_product_id = $${paramIndex}`;
      queryParams.push(parseInt(filters.productId, 10));
      paramIndex++;
    }
    
    if (filters.metrcItem) {
      query += ` AND b.metrc_item_name = $${paramIndex}`;
      queryParams.push(filters.metrcItem);
      paramIndex++;
    }
    
    if (filters.status) {
      query += ` AND b.status = $${paramIndex}`;
      queryParams.push(filters.status);
      paramIndex++;
    }

    query += ` ORDER BY b.quantity DESC, b.id DESC`;

    const result = await client.query(query, queryParams);
    
    console.log(`📊 Found ${result.rows.length} batch(es) with quantity >= ${filters.minQuantity}\n`);

    if (result.rows.length === 0) {
      console.log(`No batches found matching the criteria.`);
      return;
    }

    // Group by status
    const byStatus = {
      'Sellable': [],
      'On Hold': [],
      'On Deck': [],
      'Other': []
    };

    const byLinkage = {
      'Linked': [],
      'Unlinked': []
    };

    result.rows.forEach(batch => {
      const status = batch.status || 'Other';
      if (!byStatus[status]) byStatus[status] = [];
      byStatus[status].push(batch);

      if (batch.fk_master_product_id) {
        byLinkage['Linked'].push(batch);
      } else {
        byLinkage['Unlinked'].push(batch);
      }
    });

    // Display summary
    console.log(`📈 Summary:`);
    console.log(`   Total batches: ${result.rows.length}`);
    console.log(`   Linked to products: ${byLinkage['Linked'].length}`);
    console.log(`   Unlinked: ${byLinkage['Unlinked'].length}`);
    console.log(`   By status:`);
    Object.keys(byStatus).forEach(status => {
      if (byStatus[status].length > 0) {
        console.log(`      ${status}: ${byStatus[status].length}`);
      }
    });
    console.log(``);

    // Display batches
    console.log(`📦 Batch Details:\n`);
    
    for (const batch of result.rows) {
      const isLinked = batch.fk_master_product_id !== null;
      const linkageStatus = isLinked ? '✅ Linked' : '❌ Unlinked';
      const productInfo = isLinked 
        ? `${batch.product_brand || 'AMAZE'} ${batch.product_name} (ID: ${batch.fk_master_product_id})`
        : 'Not linked';
      
      console.log(`   Batch ${batch.id}: ${batch.batch_name}`);
      console.log(`      ${linkageStatus}`);
      console.log(`      Product: ${productInfo}`);
      console.log(`      METRC Item: ${batch.metrc_item_name}`);
      console.log(`      Status: ${batch.status}`);
      console.log(`      Quantity: ${batch.quantity} | Allocated: ${batch.allocated_quantity}`);
      
      if (filters.showAvailable) {
        console.log(`      Available: ${batch.available_quantity}`);
      }
      
      console.log(`      Packages: ${batch.full_package_count} full, ${batch.partial_package_count} partial`);
      console.log(`      License: ${batch.synclicense}`);
      console.log(`      Source Package: ${batch.first_sourcepackage_label}`);
      console.log(`      Source Exists: ${batch.source_package_exists ? '✅' : '❌'}`);
      
      // Show potential products if unlinked
      if (!isLinked && batch.potential_products && batch.potential_products.length > 0) {
        console.log(`      💡 Potential products to link:`);
        batch.potential_products.forEach(prod => {
          console.log(`         - ${prod.brand_name || 'AMAZE'} ${prod.product_name} (ID: ${prod.product_id})`);
        });
      }
      
      console.log(``);
    }

    // Show unlinked batches with potential products
    const unlinkedWithPotential = byLinkage['Unlinked'].filter(b => 
      b.potential_products && b.potential_products.length > 0
    );

    if (unlinkedWithPotential.length > 0) {
      console.log(`\n💡 ${unlinkedWithPotential.length} unlinked batch(es) have potential products to link:\n`);
      for (const batch of unlinkedWithPotential) {
        console.log(`   Batch ${batch.id} (${batch.metrc_item_name}):`);
        batch.potential_products.forEach(prod => {
          console.log(`      → ${prod.brand_name || 'AMAZE'} ${prod.product_name} (ID: ${prod.product_id})`);
        });
        console.log(``);
      }
    }

    // Show unlinked batches without potential products
    const unlinkedWithoutPotential = byLinkage['Unlinked'].filter(b => 
      !b.potential_products || b.potential_products.length === 0
    );

    if (unlinkedWithoutPotential.length > 0) {
      console.log(`\n⚠️  ${unlinkedWithoutPotential.length} unlinked batch(es) have no matching products:\n`);
      for (const batch of unlinkedWithoutPotential) {
        console.log(`   Batch ${batch.id}: ${batch.batch_name}`);
        console.log(`      METRC Item: ${batch.metrc_item_name}`);
        console.log(`      Quantity: ${batch.quantity}`);
        console.log(`      → Need to add "${batch.metrc_item_name}" to a product's metrc_linked_items`);
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

// Run the script
findBatchesWithQuantity().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});


