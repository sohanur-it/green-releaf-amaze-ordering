/**
 * Fix Partial Package Allocation Issues
 * 
 * This script fixes batches where partial packages incorrectly affected allocated_quantity.
 * 
 * Problem:
 * - When partial packages were added to invoices, quantity_allocated was set to the partial package quantity
 * - When invoices were voided, this quantity was released from allocated_quantity, causing negative values
 * 
 * Solution:
 * - Set quantity_allocated = 0 for all line items that have specific_package_labels (partial packages)
 * - Recalculate batch allocated_quantity by summing only full package allocations
 */

require('dotenv').config({ path: process.env.NODE_ENV === 'production' ? 'config/production.env' : 'config/local.env' });
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixPartialPackageAllocations() {
    const client = await pool.connect();
    
    try {
        console.log('🔧 Fixing Partial Package Allocation Issues');
        console.log('==========================================\n');
        console.log(`📊 Connecting to database: ${process.env.DB_DATABASE || 'green_releaf_dev'}\n`);
        
        await client.query('BEGIN');
        
        // Step 1: Find all line items with partial packages that have quantity_allocated > 0
        const partialLineItems = await client.query(`
            SELECT 
                li.id,
                li.fk_batch_id,
                li.fk_invoice_id,
                li.quantity_allocated,
                li.specific_package_labels,
                b.batch_name,
                i.invoice_number,
                i.status
            FROM "ORDERS-invoice-line-items" li
            INNER JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
            INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
            WHERE li.specific_package_labels IS NOT NULL
              AND (
                  (jsonb_typeof(li.specific_package_labels) = 'array' AND jsonb_array_length(li.specific_package_labels) > 0)
                  OR (jsonb_typeof(li.specific_package_labels) = 'string' AND li.specific_package_labels != '')
              )
              AND li.quantity_allocated > 0
        `);
        
        console.log(`📋 Found ${partialLineItems.rows.length} line items with partial packages that have incorrect quantity_allocated\n`);
        
        if (partialLineItems.rows.length > 0) {
            // Step 2: Set quantity_allocated = 0 for all partial package line items
            const updateResult = await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET quantity_allocated = 0
                WHERE id = ANY($1)
            `, [partialLineItems.rows.map(item => item.id)]);
            
            console.log(`✅ Set quantity_allocated = 0 for ${updateResult.rowCount} partial package line items\n`);
            
            // Step 3: Recalculate allocated_quantity for all affected batches
            const affectedBatchIds = [...new Set(partialLineItems.rows.map(item => item.fk_batch_id))];
            console.log(`🔄 Recalculating allocated_quantity for ${affectedBatchIds.length} batches...\n`);
            
            for (const batchId of affectedBatchIds) {
                // Get current allocated_quantity
                const currentBatch = await client.query(`
                    SELECT allocated_quantity, batch_name
                    FROM "ORDERS-batches"
                    WHERE id = $1
                `, [batchId]);
                
                if (currentBatch.rows.length === 0) continue;
                
                const oldAllocated = parseInt(currentBatch.rows[0].allocated_quantity || 0);
                const batchName = currentBatch.rows[0].batch_name;
                
                // Calculate correct allocated_quantity (sum of only full package allocations)
                const correctAllocation = await client.query(`
                    SELECT COALESCE(SUM(li.quantity_allocated), 0) as total_allocated
                    FROM "ORDERS-invoice-line-items" li
                    INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                    WHERE li.fk_batch_id = $1
                      AND i.status NOT IN ('Cancelled', 'Voided', 'Paid', 'Fully_Rejected')
                      AND (li.specific_package_labels IS NULL 
                           OR (jsonb_typeof(li.specific_package_labels) = 'array' AND jsonb_array_length(li.specific_package_labels) = 0)
                           OR (jsonb_typeof(li.specific_package_labels) = 'string' AND li.specific_package_labels = ''))
                `, [batchId]);
                
                const newAllocated = parseInt(correctAllocation.rows[0].total_allocated || 0);
                
                if (oldAllocated !== newAllocated) {
                    await client.query(`
                        UPDATE "ORDERS-batches"
                        SET allocated_quantity = $1
                        WHERE id = $2
                    `, [newAllocated, batchId]);
                    
                    // Log the correction
                    await client.query(`
                        INSERT INTO "ORDERS-batch-history" (
                            batch_id, change_type, field_name,
                            old_value, new_value, reason,
                            changed_by_system
                        ) VALUES ($1, 'allocation_corrected', 'allocated_quantity',
                                  $2, $3, 'Fixed partial package allocation issue', true)
                    `, [batchId, oldAllocated.toString(), newAllocated.toString()]);
                    
                    console.log(`  ✅ Batch ${batchId} (${batchName}): ${oldAllocated} → ${newAllocated}`);
                }
            }
        }
        
        // Step 4: Find and fix any batches with negative allocated_quantity
        const negativeBatches = await client.query(`
            SELECT id, batch_name, quantity, allocated_quantity
            FROM "ORDERS-batches"
            WHERE allocated_quantity < 0
        `);
        
        if (negativeBatches.rows.length > 0) {
            console.log(`\n⚠️  Found ${negativeBatches.rows.length} batches with negative allocated_quantity\n`);
            
            for (const batch of negativeBatches.rows) {
                // Recalculate correct allocation
                const correctAllocation = await client.query(`
                    SELECT COALESCE(SUM(li.quantity_allocated), 0) as total_allocated
                    FROM "ORDERS-invoice-line-items" li
                    INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                    WHERE li.fk_batch_id = $1
                      AND i.status NOT IN ('Cancelled', 'Voided', 'Paid', 'Fully_Rejected')
                      AND (li.specific_package_labels IS NULL 
                           OR (jsonb_typeof(li.specific_package_labels) = 'array' AND jsonb_array_length(li.specific_package_labels) = 0)
                           OR (jsonb_typeof(li.specific_package_labels) = 'string' AND li.specific_package_labels = ''))
                `, [batch.id]);
                
                const newAllocated = parseInt(correctAllocation.rows[0].total_allocated || 0);
                const oldAllocated = parseInt(batch.allocated_quantity || 0);
                
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET allocated_quantity = $1
                    WHERE id = $2
                `, [newAllocated, batch.id]);
                
                // Log the correction
                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id, change_type, field_name,
                        old_value, new_value, reason,
                        changed_by_system
                    ) VALUES ($1, 'allocation_corrected', 'allocated_quantity',
                              $2, $3, 'Fixed negative allocation from partial package issue', true)
                `, [batch.id, oldAllocated.toString(), newAllocated.toString()]);
                
                console.log(`  ✅ Batch ${batch.id} (${batch.batch_name}): ${oldAllocated} → ${newAllocated}`);
            }
        }
        
        await client.query('COMMIT');
        
        console.log('\n✅ Fix completed successfully!');
        console.log(`   - Fixed ${partialLineItems.rows.length} partial package line items`);
        console.log(`   - Recalculated ${affectedBatchIds.length} batch allocations`);
        if (negativeBatches.rows.length > 0) {
            console.log(`   - Fixed ${negativeBatches.rows.length} batches with negative allocations`);
        }
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n❌ Script failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the script
fixPartialPackageAllocations().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

