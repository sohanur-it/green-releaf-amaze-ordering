/**
 * Fix Negative Inventory Script
 * 
 * This script fixes any batches that have negative quantities or allocated_quantity
 * It also adds database constraints to prevent future negative values
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

async function fixNegativeInventory() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🔍 Checking for batches with negative quantities...');
        
        // Find all batches with negative quantities
        const negativeBatches = await client.query(`
            SELECT 
                id, 
                batch_name, 
                quantity, 
                allocated_quantity,
                fk_master_product_id
            FROM "ORDERS-batches"
            WHERE quantity < 0 OR allocated_quantity < 0
            ORDER BY id
        `);
        
        if (negativeBatches.rows.length === 0) {
            console.log('✅ No batches with negative quantities found.');
        } else {
            console.log(`⚠️ Found ${negativeBatches.rows.length} batch(es) with negative quantities:`);
            
            for (const batch of negativeBatches.rows) {
                const oldQuantity = batch.quantity;
                const oldAllocated = batch.allocated_quantity;
                
                // Fix negative values to 0
                const newQuantity = Math.max(0, parseFloat(oldQuantity));
                const newAllocated = Math.max(0, parseFloat(oldAllocated));
                
                // Ensure allocated doesn't exceed quantity
                const finalAllocated = Math.min(newAllocated, newQuantity);
                
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET 
                        quantity = $1,
                        allocated_quantity = $2
                    WHERE id = $3
                `, [newQuantity, finalAllocated, batch.id]);
                
                console.log(`  ✓ Fixed batch ${batch.id} (${batch.batch_name}):`);
                console.log(`    quantity: ${oldQuantity} → ${newQuantity}`);
                console.log(`    allocated_quantity: ${oldAllocated} → ${finalAllocated}`);
                
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
                    ) VALUES ($1, 'inventory_correction', 'quantity', $2, $3, 'Fixed negative inventory values', true)
                `, [batch.id, oldQuantity.toString(), newQuantity.toString()]);
            }
        }
        
        // Add check constraints to prevent future negative values
        console.log('\n🔒 Adding database constraints to prevent negative quantities...');
        
        try {
            // Drop existing constraints if they exist
            await client.query(`
                ALTER TABLE "ORDERS-batches" 
                DROP CONSTRAINT IF EXISTS batches_quantity_non_negative
            `);
            
            await client.query(`
                ALTER TABLE "ORDERS-batches" 
                DROP CONSTRAINT IF EXISTS batches_allocated_quantity_non_negative
            `);
            
            // Add check constraints
            await client.query(`
                ALTER TABLE "ORDERS-batches" 
                ADD CONSTRAINT batches_quantity_non_negative 
                CHECK (quantity >= 0)
            `);
            
            await client.query(`
                ALTER TABLE "ORDERS-batches" 
                ADD CONSTRAINT batches_allocated_quantity_non_negative 
                CHECK (allocated_quantity >= 0)
            `);
            
            // Ensure allocated_quantity doesn't exceed quantity
            await client.query(`
                ALTER TABLE "ORDERS-batches" 
                DROP CONSTRAINT IF EXISTS batches_allocated_not_exceed_quantity
            `);
            
            await client.query(`
                ALTER TABLE "ORDERS-batches" 
                ADD CONSTRAINT batches_allocated_not_exceed_quantity 
                CHECK (allocated_quantity <= quantity)
            `);
            
            console.log('✅ Database constraints added successfully.');
        } catch (constraintError) {
            console.error('⚠️ Error adding constraints (may already exist):', constraintError.message);
            // Continue - constraints might already exist
        }
        
        await client.query('COMMIT');
        console.log('\n✅ Negative inventory fix completed successfully!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error fixing negative inventory:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Run the fix
fixNegativeInventory()
    .then(() => {
        console.log('Done.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });


