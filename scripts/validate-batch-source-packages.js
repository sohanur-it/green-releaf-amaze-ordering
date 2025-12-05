#!/usr/bin/env node

/**
 * Validate Batch Source Packages
 * 
 * This script checks for batches with missing source packages and reports the issue
 */

const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const { pool } = require('../Server/config/database');

async function validateBatchSourcePackages() {
    console.log('🔍 Validating Batch Source Packages');
    console.log('='.repeat(60));
    
    const client = await pool.connect();
    
    try {
        // Check for batches with missing source packages
        const result = await client.query(`
            SELECT 
                b.id,
                b.batch_name,
                b.metrc_item_name,
                b.first_sourcepackage_label,
                b.sourcepackagelabels,
                b.quantity,
                b.status,
                b.fk_master_product_id,
                p.name as product_name,
                -- Check if source package exists
                CASE 
                    WHEN EXISTS (
                        SELECT 1 FROM activepackages 
                        WHERE label = b.first_sourcepackage_label
                        AND isarchived = false
                        AND isfinished = false
                    ) THEN 'EXISTS'
                    ELSE 'MISSING'
                END as source_package_status,
                -- Check if any packages from sourcepackagelabels exist
                (
                    SELECT COUNT(*) 
                    FROM activepackages 
                    WHERE label = ANY(string_to_array(b.sourcepackagelabels, ','))
                    AND isarchived = false
                    AND isfinished = false
                ) as existing_package_count,
                -- Check total packages in sourcepackagelabels
                array_length(string_to_array(b.sourcepackagelabels, ','), 1) as total_source_packages
            FROM "ORDERS-batches" b
            LEFT JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
            WHERE b.first_sourcepackage_label = '1A40C03000049D5000093082'
               OR b.batch_name LIKE '%1A40C03000049D5000093082%'
               OR b.sourcepackagelabels LIKE '%1A40C03000049D5000093082%'
            ORDER BY b.id DESC
        `);
        
        if (result.rows.length === 0) {
            console.log('❌ No batches found with source package label: 1A40C03000049D5000093082');
            console.log('\n🔍 Searching for "Pie Face" batches...');
            
            const pieFaceResult = await client.query(`
                SELECT 
                    b.id,
                    b.batch_name,
                    b.metrc_item_name,
                    b.first_sourcepackage_label,
                    b.quantity,
                    b.status,
                    p.name as product_name
                FROM "ORDERS-batches" b
                LEFT JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
                WHERE b.metrc_item_name ILIKE '%pie face%'
                   OR b.batch_name ILIKE '%pie face%'
                   OR p.name ILIKE '%pie face%'
                ORDER BY b.id DESC
                LIMIT 10
            `);
            
            if (pieFaceResult.rows.length > 0) {
                console.log(`\n✅ Found ${pieFaceResult.rows.length} "Pie Face" batches:`);
                pieFaceResult.rows.forEach(batch => {
                    console.log(`\n   Batch ID: ${batch.id}`);
                    console.log(`   Batch Name: ${batch.batch_name}`);
                    console.log(`   METRC Item: ${batch.metrc_item_name}`);
                    console.log(`   Source Package: ${batch.first_sourcepackage_label}`);
                    console.log(`   Product: ${batch.product_name || 'NOT LINKED'}`);
                    console.log(`   Status: ${batch.status}`);
                    console.log(`   Quantity: ${batch.quantity}`);
                });
            } else {
                console.log('❌ No "Pie Face" batches found');
            }
            
            return;
        }
        
        console.log(`\n✅ Found ${result.rows.length} batch(es) with source package label: 1A40C03000049D5000093082\n`);
        
        for (const batch of result.rows) {
            console.log(`📦 Batch ID: ${batch.id}`);
            console.log(`   Batch Name: ${batch.batch_name}`);
            console.log(`   METRC Item: ${batch.metrc_item_name}`);
            console.log(`   Source Package Label: ${batch.first_sourcepackage_label}`);
            console.log(`   Source Package Status: ${batch.source_package_status}`);
            console.log(`   Existing Packages: ${batch.existing_package_count}/${batch.total_source_packages}`);
            console.log(`   Product: ${batch.product_name || 'NOT LINKED'}`);
            console.log(`   Status: ${batch.status}`);
            console.log(`   Quantity: ${batch.quantity}`);
            
            // Check if source package exists in any state
            const sourcePackageCheck = await client.query(`
                SELECT 
                    label,
                    isarchived,
                    isfinished,
                    quantity,
                    item_name,
                    lastmodified
                FROM activepackages
                WHERE label = $1
                LIMIT 1
            `, [batch.first_sourcepackage_label]);
            
            if (sourcePackageCheck.rows.length > 0) {
                const pkg = sourcePackageCheck.rows[0];
                console.log(`\n   ⚠️  Source package EXISTS but is:`);
                console.log(`      Archived: ${pkg.isarchived}`);
                console.log(`      Finished: ${pkg.isfinished}`);
                console.log(`      Quantity: ${pkg.quantity}`);
                console.log(`      Item: ${pkg.item_name}`);
                console.log(`      Last Modified: ${pkg.lastmodified}`);
            } else {
                console.log(`\n   ❌ Source package DOES NOT EXIST in activepackages table`);
                console.log(`   This is an ORPHANED BATCH - source package was likely transferred or deleted`);
            }
            
            // Check what packages from sourcepackagelabels exist
            if (batch.sourcepackagelabels) {
                const sourceLabels = batch.sourcepackagelabels.split(',').map(l => l.trim());
                console.log(`\n   📋 Checking ${sourceLabels.length} source package labels...`);
                
                const existingLabels = [];
                const missingLabels = [];
                
                for (const label of sourceLabels.slice(0, 10)) { // Check first 10
                    const check = await client.query(`
                        SELECT label, isarchived, isfinished
                        FROM activepackages
                        WHERE label = $1
                        LIMIT 1
                    `, [label]);
                    
                    if (check.rows.length > 0) {
                        const pkg = check.rows[0];
                        if (!pkg.isarchived && !pkg.isfinished) {
                            existingLabels.push(label);
                        } else {
                            missingLabels.push(`${label} (archived: ${pkg.isarchived}, finished: ${pkg.isfinished})`);
                        }
                    } else {
                        missingLabels.push(`${label} (not found)`);
                    }
                }
                
                console.log(`      ✅ Existing: ${existingLabels.length}`);
                console.log(`      ❌ Missing/Archived: ${missingLabels.length}`);
            }
            
            console.log('\n' + '-'.repeat(60));
        }
        
        // Summary
        const missingCount = result.rows.filter(b => b.source_package_status === 'MISSING').length;
        if (missingCount > 0) {
            console.log(`\n⚠️  WARNING: ${missingCount} batch(es) have MISSING source packages!`);
            console.log(`   These batches are ORPHANED and should be marked as invalid or archived.`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
        console.error(error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the validation
if (require.main === module) {
    validateBatchSourcePackages().catch(console.error);
}

module.exports = { validateBatchSourcePackages };

