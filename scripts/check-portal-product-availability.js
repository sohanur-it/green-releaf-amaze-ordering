/**
 * Check Portal Product Availability Script
 * 
 * This script diagnoses why products are not showing in the external portal
 * and provides recommendations on how to make them available
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    password: process.env.DB_PASSWORD || 'postgres',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
});

async function checkPortalAvailability() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Checking product availability for external portal...\n');
        
        // Get all non-archived products
        // Check which column exists (archived vs is_archived)
        const columnCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'ORDERS-products' 
            AND column_name IN ('archived', 'is_archived')
        `);
        
        const hasIsArchived = columnCheck.rows.some(r => r.column_name === 'is_archived');
        const archivedColumn = hasIsArchived ? 'is_archived' : 'archived';
        const archivedCondition = hasIsArchived 
            ? `(p.is_archived = false OR p.is_archived IS NULL)`
            : `(p.archived = false OR p.archived IS NULL)`;
        
        const allProducts = await client.query(`
            SELECT 
                p.entry_id,
                p.name,
                p.${archivedColumn} as is_archived,
                COUNT(b.id) as total_batches
            FROM "ORDERS-products" p
            LEFT JOIN "ORDERS-batches" b ON p.entry_id = b.fk_master_product_id
            WHERE ${archivedCondition}
            GROUP BY p.entry_id, p.name, p.${archivedColumn}
            ORDER BY p.name
        `);
        
        console.log(`📦 Found ${allProducts.rows.length} non-archived products\n`);
        
        let availableCount = 0;
        let unavailableCount = 0;
        const unavailableProducts = [];
        
        for (const product of allProducts.rows) {
            // Check if this product would appear in portal
            const portalCheck = await client.query(`
                SELECT 
                    b.id as batch_id,
                    b.batch_name,
                    b.status,
                    b.quantity,
                    b.allocated_quantity,
                    b.full_package_count,
                    (b.quantity - b.allocated_quantity) as available_qty,
                    CASE 
                        WHEN b.status = 'Sellable' THEN '✅ Sellable'
                        WHEN b.status = 'On Deck' THEN '⚠️ On Deck'
                        ELSE '❌ ' || b.status
                    END as status_display
                FROM "ORDERS-batches" b
                WHERE b.fk_master_product_id = $1
                ORDER BY 
                    CASE WHEN b.status = 'Sellable' THEN 1 ELSE 2 END,
                    b.id
            `, [product.entry_id]);
            
            // Check if product meets portal requirements
            const hasSellableBatch = portalCheck.rows.some(b => 
                b.status === 'Sellable' && 
                (b.quantity - b.allocated_quantity) > 0 && 
                b.full_package_count > 0
            );
            
            const hasOnDeckBatch = portalCheck.rows.some(b => 
                b.status === 'On Deck' && 
                (b.quantity - b.allocated_quantity) > 0 && 
                b.full_package_count > 0
            );
            
            const wouldShowInPortal = hasSellableBatch || (hasOnDeckBatch && !hasSellableBatch);
            
            if (wouldShowInPortal) {
                availableCount++;
            } else {
                unavailableCount++;
                unavailableProducts.push({
                    product: product,
                    batches: portalCheck.rows,
                    hasSellableBatch,
                    hasOnDeckBatch
                });
            }
        }
        
        console.log(`✅ Products available in portal: ${availableCount}`);
        console.log(`❌ Products NOT available in portal: ${unavailableCount}\n`);
        
        if (unavailableProducts.length > 0) {
            console.log('📋 Products NOT showing in portal:\n');
            console.log('='.repeat(80));
            
            for (const item of unavailableProducts) {
                const p = item.product;
                console.log(`\n🔴 ${p.name} (ID: ${p.entry_id})`);
                console.log(`   Total batches: ${p.total_batches || 0}`);
                
                if (item.batches.length === 0) {
                    console.log(`   ❌ No batches found for this product`);
                    console.log(`   💡 Solution: Create batches for this product`);
                } else {
                    console.log(`   Batches:`);
                    for (const batch of item.batches) {
                        const issues = [];
                        
                        if (batch.status !== 'Sellable' && batch.status !== 'On Deck') {
                            issues.push(`Status: ${batch.status} (needs to be 'Sellable' or 'On Deck')`);
                        }
                        
                        if ((batch.quantity - batch.allocated_quantity) <= 0) {
                            issues.push(`No available inventory (qty: ${batch.quantity}, allocated: ${batch.allocated_quantity})`);
                        }
                        
                        if (batch.full_package_count <= 0) {
                            issues.push(`No full packages (full_package_count: ${batch.full_package_count})`);
                        }
                        
                        if (batch.status === 'On Deck' && item.hasSellableBatch) {
                            issues.push(`On Deck batch hidden because Sellable batches exist`);
                        }
                        
                        const statusIcon = batch.status === 'Sellable' ? '✅' : 
                                         batch.status === 'On Deck' ? '⚠️' : '❌';
                        
                        console.log(`      ${statusIcon} ${batch.batch_name || 'N/A'} (ID: ${batch.batch_id})`);
                        console.log(`         Status: ${batch.status}`);
                        console.log(`         Available: ${batch.available_qty} (qty: ${batch.quantity}, allocated: ${batch.allocated_quantity})`);
                        console.log(`         Full packages: ${batch.full_package_count}`);
                        
                        if (issues.length > 0) {
                            console.log(`         Issues:`);
                            issues.forEach(issue => console.log(`            - ${issue}`));
                        }
                        
                        // Provide solutions
                        const solutions = [];
                        if (batch.status !== 'Sellable' && batch.status === 'On Deck' && !item.hasSellableBatch) {
                            solutions.push(`Promote batch to 'Sellable' status`);
                        }
                        if ((batch.quantity - batch.allocated_quantity) <= 0) {
                            solutions.push(`Increase batch quantity or reduce allocated_quantity`);
                        }
                        if (batch.full_package_count <= 0) {
                            solutions.push(`Add packages to batch (full_package_count must be > 0)`);
                        }
                        
                        if (solutions.length > 0) {
                            console.log(`         💡 Solutions:`);
                            solutions.forEach(sol => console.log(`            - ${sol}`));
                        }
                    }
                }
                console.log('-'.repeat(80));
            }
        }
        
        // Summary of requirements
        console.log('\n📖 Requirements for products to show in external portal:');
        console.log('   1. Product must NOT be archived');
        console.log('   2. Product must have at least one batch with:');
        console.log('      - Status = "Sellable" (or "On Deck" if no Sellable batches exist)');
        console.log('      - Available quantity > 0 (quantity - allocated_quantity > 0)');
        console.log('      - full_package_count > 0 (external portal only shows full packages)');
        console.log('\n💡 How to make products available:');
        console.log('   1. Ensure batches have full_package_count > 0 (add packages to batches)');
        console.log('   2. Promote batches from "On Deck" to "Sellable" status');
        console.log('   3. Ensure quantity > allocated_quantity (available inventory > 0)');
        
    } catch (error) {
        console.error('❌ Error checking portal availability:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Run the check
checkPortalAvailability()
    .then(() => {
        console.log('\nDone.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });

