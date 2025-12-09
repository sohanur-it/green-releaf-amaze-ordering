#!/usr/bin/env node

/**
 * Check METRC activepackages table for packages that would be classified as partial packages
 * This helps identify if there's data in METRC that would create partial packages after sync
 */

const { query, pool } = require('../Server/config/database');

async function checkForPartialPackagesInMetrc() {
    try {
        console.log('🔍 Checking METRC activepackages for potential partial packages...\n');

        // First, detect which license column exists
        const columnCheck = await query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'activepackages' 
            AND column_name IN ('sync_license', 'synclicense')
            LIMIT 1
        `);
        
        const licenseColumn = columnCheck.rows.length > 0 
            ? columnCheck.rows[0].column_name 
            : 'sync_license'; // Default to production column name
        
        console.log(`📋 Using license column: ${licenseColumn}\n`);

        // This query mimics the logic from metrc-batch-extractor-query.sql
        const result = await query(`
            WITH filtered_packages AS (
                SELECT *,
                       trim(split_part(sourcepackagelabels, ',', 1)) AS first_sourcepackage_label
                FROM activepackages
                WHERE ${licenseColumn} IN ('CUL000063', 'MAN000072')
                  AND isarchived = false
                  AND isfinished = false
                  AND quantity > 0
                  AND item_productcategoryname ilike '%final packaging%'
                  AND item_name IS NOT NULL
                  AND item_name != ''
                  AND sourcepackagelabels IS NOT NULL
                  AND sourcepackagelabels != ''
                  AND item_name ~ 'M\\d{8,}'
            ),
            packages_with_items AS (
                SELECT fp.*,
                       i.unit_weight_grams,
                       i.unit_count,
                       CASE
                           WHEN fp.item_productcategoryname ilike ANY (array[
                               '%Bud/Flower%(Final Packaging)%', 
                               '%Shake/Trim%(Final Packaging)%',
                               '%Ground%Bud/Flower%(Final Packaging)%', 
                               '%Ground%Shake/Trim%(Final Packaging)%'
                           ]) THEN 'weight_based'
                           ELSE 'unit_based'
                       END AS package_type,
                       CASE
                           WHEN fp.item_productcategoryname ilike ANY (array[
                               '%Bud/Flower%(Final Packaging)%',
                               '%Shake/Trim%(Final Packaging)%', 
                               '%Ground%Bud/Flower%(Final Packaging)%', 
                               '%Ground%Shake/Trim%(Final Packaging)%'
                           ]) THEN i.unit_weight_grams * i.unit_count
                           ELSE i.unit_count::numeric
                       END AS expected_full_package_size,
                       CASE WHEN i.name IS NULL THEN true ELSE false END AS items_table_missing,
                       CASE WHEN i.unit_weight_grams IS NULL THEN true ELSE false END AS unit_weight_grams_missing,
                       CASE WHEN i.unit_count IS NULL THEN true ELSE false END AS unit_count_missing
                FROM filtered_packages fp
                LEFT JOIN items i ON fp.item_name = i.name AND i.historical = false
            ),
            packages_classified AS (
                SELECT *,
                       CASE
                           WHEN items_table_missing = true
                                OR unit_weight_grams_missing = true
                                OR unit_count_missing = true THEN true
                           WHEN package_type = 'weight_based'
                                AND quantity = expected_full_package_size THEN true
                           WHEN package_type = 'unit_based'
                                AND quantity = expected_full_package_size THEN true
                           ELSE false
                       END AS is_full_package
                FROM packages_with_items
            )
            SELECT 
                pc.item_name,
                pc.label,
                pc.quantity,
                pc.expected_full_package_size,
                pc.package_type,
                pc.is_full_package,
                pc.unit_weight_grams,
                pc.unit_count,
                pc.items_table_missing,
                pc.unit_weight_grams_missing,
                pc.unit_count_missing
            FROM packages_classified pc
            WHERE pc.is_full_package = false
            ORDER BY pc.item_name, pc.label
            LIMIT 50
        `);

        if (result.rows.length === 0) {
            console.log('❌ No partial packages found in METRC activepackages table.\n');
            console.log('💡 To create partial packages:');
            console.log('   1. Partial packages are created automatically during batch sync');
            console.log('   2. They occur when a package quantity ≠ expected full package size');
            console.log('   3. Run batch sync: POST /api/v1/admin/sync/batches');
            console.log('   4. Or wait for automatic sync (runs periodically)');
            console.log('\n📝 Note: Partial packages come from METRC data.');
            console.log('   They cannot be manually created in the UI.');
            console.log('   They must exist in METRC with quantities different from expected full size.');
            return;
        }

        console.log(`✅ Found ${result.rows.length} potential partial package(s) in METRC:\n`);
        console.log('='.repeat(80));

        // Group by item_name
        const grouped = {};
        result.rows.forEach(row => {
            if (!grouped[row.item_name]) {
                grouped[row.item_name] = [];
            }
            grouped[row.item_name].push(row);
        });

        for (const [itemName, packages] of Object.entries(grouped)) {
            console.log(`\n📦 ${itemName}`);
            console.log(`   Packages: ${packages.length}`);
            
            packages.forEach((pkg, idx) => {
                console.log(`\n   ${idx + 1}. Package: ${pkg.label}`);
                console.log(`      - Quantity: ${pkg.quantity}`);
                console.log(`      - Expected Full Size: ${pkg.expected_full_package_size || 'N/A'}`);
                console.log(`      - Package Type: ${pkg.package_type}`);
                console.log(`      - Difference: ${pkg.expected_full_package_size ? (pkg.quantity - pkg.expected_full_package_size) : 'N/A'}`);
                
                if (pkg.items_table_missing || pkg.unit_weight_grams_missing || pkg.unit_count_missing) {
                    console.log(`      ⚠️  Missing items data - will be treated as full package`);
                }
            });
        }

        console.log('\n' + '='.repeat(80));
        console.log('\n💡 Next Steps:');
        console.log('   1. Run batch sync to process these packages:');
        console.log('      POST /api/v1/admin/sync/batches');
        console.log('   2. After sync, check for products with partial packages:');
        console.log('      node scripts/find-products-with-partial-packages.js');
        console.log('   3. Then test the invoice creation flow');

    } catch (error) {
        console.error('❌ Error checking METRC for partial packages:', error.message);
        console.error(error.stack);
        throw error;
    }
}

async function run() {
    try {
        await checkForPartialPackagesInMetrc();
    } catch (error) {
        console.error('❌ Script failed:', error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    run();
}

module.exports = {
    checkForPartialPackagesInMetrc
};

