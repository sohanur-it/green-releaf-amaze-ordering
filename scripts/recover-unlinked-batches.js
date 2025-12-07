#!/usr/bin/env node
/**
 * Recovery Script: Re-link batches that were incorrectly unlinked from products
 * 
 * This script finds batches that:
 * 1. Have fk_master_product_id = NULL (were unlinked)
 * 2. Have a valid metrc_item_name
 * 3. Have a product that links to that metrc_item_name
 * 4. Have valid source packages in activepackages
 * 
 * It then re-links them to their products and restores their status if valid.
 * 
 * Usage: NODE_ENV=production node scripts/recover-unlinked-batches.js [--dry-run]
 */

const path = require('path');
const { pool } = require('../Server/config/database');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('--dryrun');

async function recoverUnlinkedBatches() {
    const client = await pool.connect();
    
    try {
        console.log(`\n🔍 Recovering unlinked batches...`);
        console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (will update database)'}\n`);
        
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
        
        // Find batches that are unlinked but should be linked
        const unlinkedBatchesQuery = `
            SELECT 
                b.id,
                b.batch_name,
                b.metrc_item_name,
                b.first_sourcepackage_label,
                b.synclicense,
                b.status,
                b.quantity,
                b.allocated_quantity,
                -- Check if source package exists for this license
                EXISTS (
                    SELECT 1 FROM activepackages 
                    WHERE label = b.first_sourcepackage_label
                    AND ${activepackagesLicenseColumn} = b.synclicense
                    AND isarchived = false
                    AND isfinished = false
                ) as source_package_exists,
                -- Find matching product
                (
                    SELECT p.entry_id
                    FROM "ORDERS-products" p
                    WHERE p.metrc_linked_items @> jsonb_build_array(b.metrc_item_name)
                    AND p.is_archived = false
                    LIMIT 1
                ) as matching_product_id,
                (
                    SELECT p.name
                    FROM "ORDERS-products" p
                    WHERE p.metrc_linked_items @> jsonb_build_array(b.metrc_item_name)
                    AND p.is_archived = false
                    LIMIT 1
                ) as matching_product_name
            FROM "ORDERS-batches" b
            WHERE b.fk_master_product_id IS NULL
            AND b.metrc_item_name IS NOT NULL
            AND b.metrc_item_name != ''
            AND b.first_sourcepackage_label IS NOT NULL
            AND b.first_sourcepackage_label != ''
            AND b.synclicense IS NOT NULL
        `;
        
        const result = await client.query(unlinkedBatchesQuery);
        console.log(`📊 Found ${result.rows.length} unlinked batch(es)\n`);
        
        // Filter to only batches that:
        // 1. Have valid source packages
        // 2. Have matching products
        const recoverableBatches = result.rows.filter(b => 
            b.source_package_exists && b.matching_product_id
        );
        
        console.log(`✅ Found ${recoverableBatches.length} recoverable batch(es):\n`);
        
        if (recoverableBatches.length === 0) {
            console.log(`No batches to recover. All unlinked batches are either:`);
            console.log(`  - Missing source packages (truly orphaned)`);
            console.log(`  - Not linked to any product (no matching metrc_item_name)`);
            return;
        }
        
        // Display recoverable batches
        for (const batch of recoverableBatches) {
            console.log(`   Batch ${batch.id}: ${batch.batch_name}`);
            console.log(`      METRC Item: ${batch.metrc_item_name}`);
            console.log(`      License: ${batch.synclicense}`);
            console.log(`      Current Status: ${batch.status}`);
            console.log(`      Quantity: ${batch.quantity}, Allocated: ${batch.allocated_quantity}`);
            console.log(`      Source Package: ${batch.first_sourcepackage_label} (exists: ${batch.source_package_exists})`);
            console.log(`      Matching Product: ${batch.matching_product_id} - ${batch.matching_product_name}`);
            console.log(``);
        }
        
        if (isDryRun) {
            console.log(`\n🔍 DRY RUN: Would re-link ${recoverableBatches.length} batch(es) to their products`);
            console.log(`   Run without --dry-run to apply changes\n`);
            return;
        }
        
        // Re-link batches
        console.log(`\n🔧 Re-linking batches to products...\n`);
        await client.query('BEGIN');
        
        let recoveredCount = 0;
        let errorCount = 0;
        
        for (const batch of recoverableBatches) {
            try {
                // Determine new status based on current status and quantity
                let newStatus = batch.status;
                if (batch.status === 'On Hold' && batch.quantity > 0) {
                    // If batch was marked "On Hold" but has quantity, restore to "Sellable" or "On Deck"
                    // Use "Sellable" if quantity > 0, otherwise keep "On Hold"
                    newStatus = batch.quantity > 0 ? 'Sellable' : 'On Hold';
                }
                
                // Update batch
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET 
                        fk_master_product_id = $1,
                        status = $2,
                        last_synced = NOW()
                    WHERE id = $3
                `, [batch.matching_product_id, newStatus, batch.id]);
                
                // Log to batch history
                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id, change_type, field_name, old_value, new_value,
                        reason, change_details, changed_by_system
                    ) VALUES ($1, 'product_linked', 'fk_master_product_id', NULL, $2::text,
                              'Batch re-linked to product after orphaned batch fix',
                              $3::jsonb, true)
                `, [batch.id, batch.matching_product_id, JSON.stringify({
                    action: 'recovered_unlinked_batch',
                    metrc_item_name: batch.metrc_item_name,
                    product_id: batch.matching_product_id,
                    product_name: batch.matching_product_name,
                    old_status: batch.status,
                    new_status: newStatus,
                    source_package_exists: batch.source_package_exists
                })]);
                
                if (newStatus !== batch.status) {
                    await client.query(`
                        INSERT INTO "ORDERS-batch-history" (
                            batch_id, change_type, field_name, old_value, new_value,
                            reason, changed_by_system
                        ) VALUES ($1, 'status_changed', 'status', $2, $3,
                                  'Status restored after batch recovery',
                                  true)
                    `, [batch.id, batch.status, newStatus]);
                }
                
                console.log(`   ✓ Re-linked batch ${batch.id} to product ${batch.matching_product_id} (${batch.matching_product_name})`);
                if (newStatus !== batch.status) {
                    console.log(`     Status changed: ${batch.status} → ${newStatus}`);
                }
                recoveredCount++;
                
            } catch (error) {
                console.error(`   ✗ Error recovering batch ${batch.id}: ${error.message}`);
                errorCount++;
            }
        }
        
        await client.query('COMMIT');
        
        console.log(`\n✅ Recovery complete:`);
        console.log(`   Recovered: ${recoveredCount} batch(es)`);
        console.log(`   Errors: ${errorCount} batch(es)`);
        console.log(`\n💡 Next steps:`);
        console.log(`   1. Run batch sync to verify batches are correct`);
        console.log(`   2. Check product pages to verify batches show up`);
        console.log(`   3. Test order creation with recovered products\n`);
        
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            // Ignore rollback errors
        }
        console.error(`\n❌ Error during recovery: ${error.message}\n`);
        console.error(error.stack);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the recovery
recoverUnlinkedBatches().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});



