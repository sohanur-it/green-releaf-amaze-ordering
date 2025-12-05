/**
 * Fix Negative Available Quantities Script
 * 
 * This script fixes batches where allocated_quantity exceeds quantity,
 * which causes negative available quantities to show in the products dashboard
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

async function fixNegativeAvailableQuantities() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🔍 Finding batches where allocated_quantity exceeds quantity...');
        
        // Find all batches where allocated_quantity > quantity (causing negative available)
        const problematicBatches = await client.query(`
            SELECT 
                b.id,
                b.batch_name,
                b.quantity,
                b.allocated_quantity,
                b.status,
                p.name as product_name,
                p.entry_id as product_id
            FROM "ORDERS-batches" b
            LEFT JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
            WHERE b.allocated_quantity > b.quantity
            ORDER BY b.id
        `);
        
        if (problematicBatches.rows.length === 0) {
            console.log('✅ No batches with allocated_quantity exceeding quantity found.');
        } else {
            console.log(`⚠️ Found ${problematicBatches.rows.length} batch(es) with allocated_quantity > quantity:\n`);
            
            for (const batch of problematicBatches.rows) {
                const oldQuantity = parseFloat(batch.quantity || 0);
                const oldAllocated = parseFloat(batch.allocated_quantity || 0);
                
                // Fix: Set allocated_quantity to not exceed quantity
                const newAllocated = Math.min(oldAllocated, oldQuantity);
                
                // If quantity is also negative, fix that too
                const newQuantity = Math.max(0, oldQuantity);
                const finalAllocated = Math.min(newAllocated, newQuantity);
                
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET 
                        quantity = $1,
                        allocated_quantity = $2
                    WHERE id = $3
                `, [newQuantity, finalAllocated, batch.id]);
                
                console.log(`  ✓ Fixed batch ${batch.id} (${batch.batch_name || 'N/A'})`);
                console.log(`    Product: ${batch.product_name || 'N/A'} (ID: ${batch.product_id})`);
                console.log(`    Status: ${batch.status}`);
                console.log(`    quantity: ${oldQuantity} → ${newQuantity}`);
                console.log(`    allocated_quantity: ${oldAllocated} → ${finalAllocated}`);
                console.log(`    Available: ${oldQuantity - oldAllocated} → ${newQuantity - finalAllocated}\n`);
                
                // Log to batch history
                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id,
                        change_type,
                        field_name,
                        old_value,
                        new_value,
                        reason,
                        changed_by_system
                    ) VALUES ($1, 'inventory_correction', 'allocated_quantity', $2, $3, 'Fixed allocated_quantity exceeding quantity (negative available)', true)
                `, [batch.id, oldAllocated.toString(), finalAllocated.toString()]);
            }
            
            // Now check for products that still show negative
            console.log('\n🔍 Checking products with negative available quantities...\n');
            const productsWithNegative = await client.query(`
                SELECT 
                    p.entry_id,
                    p.name,
                    SUM(CASE WHEN b.status = 'Sellable' THEN b.quantity - b.allocated_quantity ELSE 0 END) as available_quantity
                FROM "ORDERS-products" p
                LEFT JOIN "ORDERS-batches" b ON p.entry_id = b.fk_master_product_id
                WHERE (p.is_archived = FALSE OR p.is_archived IS NULL)
                GROUP BY p.entry_id, p.name
                HAVING SUM(CASE WHEN b.status = 'Sellable' THEN b.quantity - b.allocated_quantity ELSE 0 END) < 0
                ORDER BY p.name
            `);
            
            if (productsWithNegative.rows.length > 0) {
                console.log(`⚠️ Found ${productsWithNegative.rows.length} product(s) still showing negative available:\n`);
                productsWithNegative.rows.forEach(product => {
                    console.log(`  - ${product.name} (ID: ${product.entry_id}): ${product.available_quantity} units`);
                });
                console.log('\nThese may have batches with status != "Sellable" that still have allocation issues.');
            } else {
                console.log('✅ No products showing negative available quantities.');
            }
        }
        
        await client.query('COMMIT');
        console.log('\n✅ Negative available quantities fix completed successfully!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error fixing negative available quantities:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Run the fix
fixNegativeAvailableQuantities()
    .then(() => {
        console.log('Done.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });




