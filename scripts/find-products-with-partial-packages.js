#!/usr/bin/env node

/**
 * Script to find products that have batches with partial packages
 * Useful for testing the partial package selection feature
 */

const { query, pool } = require('../Server/config/database');

async function findProductsWithPartialPackages() {
    try {
        console.log('🔍 Searching for products with batches containing partial packages...\n');

        const result = await query(`
            SELECT 
                p.entry_id as product_id,
                p.name as product_name,
                p.brand_name,
                p.product_type_name,
                b.id as batch_id,
                b.batch_name,
                b.partial_package_count,
                b.quantity as batch_quantity,
                b.allocated_quantity,
                (b.quantity - b.allocated_quantity) as available_quantity,
                b.status as batch_status,
                CASE 
                    WHEN b.partial_package_details IS NULL THEN '[]'::jsonb
                    WHEN b.partial_package_details::text = 'null' THEN '[]'::jsonb
                    ELSE b.partial_package_details
                END as partial_package_details
            FROM "ORDERS-products" p
            INNER JOIN "ORDERS-batches" b ON p.entry_id = b.fk_master_product_id
            WHERE b.partial_package_count > 0
              AND b.status = 'Sellable'
              AND (b.quantity - b.allocated_quantity) > 0
            ORDER BY p.name, b.batch_name
        `);

        if (result.rows.length === 0) {
            console.log('❌ No products found with batches containing partial packages.');
            console.log('\n💡 Make sure:');
            console.log('   - Batches have partial_package_count > 0');
            console.log('   - Batch status is "Sellable"');
            console.log('   - Batches have available quantity');
            return;
        }

        // Group by product
        const productsMap = new Map();

        result.rows.forEach(row => {
            const productId = row.product_id;
            if (!productsMap.has(productId)) {
                productsMap.set(productId, {
                    product_id: productId,
                    product_name: row.product_name,
                    brand_name: row.brand_name,
                    product_type_name: row.product_type_name,
                    batches: []
                });
            }

            // Parse partial package details
            let partialPackages = [];
            try {
                const details = typeof row.partial_package_details === 'string' 
                    ? JSON.parse(row.partial_package_details) 
                    : row.partial_package_details;
                
                if (details && details.partial_packages) {
                    partialPackages = details.partial_packages;
                }
            } catch (e) {
                // Ignore parse errors
            }

            productsMap.get(productId).batches.push({
                batch_id: row.batch_id,
                batch_name: row.batch_name,
                partial_package_count: row.partial_package_count,
                batch_quantity: row.batch_quantity,
                available_quantity: row.available_quantity,
                batch_status: row.batch_status,
                partial_packages: partialPackages
            });
        });

        // Display results
        console.log(`✅ Found ${productsMap.size} product(s) with partial packages:\n`);
        console.log('='.repeat(80));

        let productIndex = 1;
        for (const [productId, product] of productsMap) {
            console.log(`\n${productIndex}. ${product.brand_name || 'AMAZE'} ${product.product_name}`);
            console.log(`   Product ID: ${product.product_id}`);
            if (product.product_type_name) {
                console.log(`   Type: ${product.product_type_name}`);
            }
            console.log(`   Batches with partials: ${product.batches.length}`);

            product.batches.forEach((batch, idx) => {
                console.log(`\n   Batch ${idx + 1}:`);
                console.log(`     - Batch ID: ${batch.batch_id}`);
                console.log(`     - Batch Name: ${batch.batch_name}`);
                console.log(`     - Partial Packages: ${batch.partial_package_count}`);
                console.log(`     - Available Quantity: ${batch.available_quantity}`);
                console.log(`     - Status: ${batch.batch_status}`);

                if (batch.partial_packages && batch.partial_packages.length > 0) {
                    console.log(`     - Sample Partial Packages (first 3):`);
                    batch.partial_packages.slice(0, 3).forEach((pkg, pkgIdx) => {
                        console.log(`       ${pkgIdx + 1}. Label: ${pkg.label}, Qty: ${pkg.quantity || 'N/A'}`);
                    });
                    if (batch.partial_packages.length > 3) {
                        console.log(`       ... and ${batch.partial_packages.length - 3} more`);
                    }
                }
            });

            productIndex++;
            console.log('\n' + '-'.repeat(80));
        }

        // Summary
        console.log('\n📊 Summary:');
        console.log(`   Total Products: ${productsMap.size}`);
        const totalBatches = Array.from(productsMap.values()).reduce((sum, p) => sum + p.batches.length, 0);
        console.log(`   Total Batches with Partials: ${totalBatches}`);
        const totalPartials = Array.from(productsMap.values()).reduce(
            (sum, p) => sum + p.batches.reduce((bSum, b) => bSum + b.partial_package_count, 0), 
            0
        );
        console.log(`   Total Partial Packages: ${totalPartials}`);

        // Testing recommendations
        console.log('\n🧪 Testing Recommendations:');
        console.log('   1. Use one of the products listed above');
        console.log('   2. Go to: http://localhost:3000/admin/invoices/create');
        console.log('   3. Search for the product name');
        console.log('   4. Select a batch that shows partial packages');
        console.log('   5. Click "Select Partial Packages" button');
        console.log('   6. Verify you can see and select the partial packages');

    } catch (error) {
        console.error('❌ Error finding products with partial packages:', error.message);
        console.error(error.stack);
        throw error;
    }
}

async function run() {
    try {
        await findProductsWithPartialPackages();
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
    findProductsWithPartialPackages
};

