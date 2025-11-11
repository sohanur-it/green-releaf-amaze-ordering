/**
 * Test script to verify batch_status_update audit logging
 * This creates a test batch promotion and verifies the audit log is created
 */

require('dotenv').config({ path: './config/production.env' });
const { pool } = require('../Server/config/database');
const batchStatusService = require('../Server/Services/batchStatusService');
const auditLogger = require('../Server/Services/auditLogger');

async function testBatchAuditLog() {
    const client = await pool.connect();
    
    try {
        console.log('🧪 Testing batch_status_update audit logging...\n');
        
        // Step 1: Find a product with On Deck batches
        console.log('📋 Step 1: Finding products with On Deck batches...');
        const onDeckQuery = `
            SELECT DISTINCT 
                b.fk_master_product_id as product_id,
                p.name as product_name,
                COUNT(*) as on_deck_count
            FROM "ORDERS-batches" b
            INNER JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
            WHERE b.status = 'On Deck'
              AND (b.quantity - b.allocated_quantity) > 0
              AND (b.full_package_count IS NULL OR b.full_package_count > 0)
            GROUP BY b.fk_master_product_id, p.name
            ORDER BY on_deck_count DESC
            LIMIT 5
        `;
        
        const onDeckResult = await client.query(onDeckQuery);
        
        if (onDeckResult.rows.length === 0) {
            console.log('❌ No On Deck batches found. Creating a test scenario...');
            
            // Find a product with Sellable batches
            const sellableQuery = `
                SELECT DISTINCT 
                    b.fk_master_product_id as product_id,
                    p.name as product_name,
                    b.id as batch_id,
                    b.batch_name
                FROM "ORDERS-batches" b
                INNER JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
                WHERE b.status = 'Sellable'
                  AND (b.quantity - b.allocated_quantity) > 0
                LIMIT 1
            `;
            
            const sellableResult = await client.query(sellableQuery);
            
            if (sellableResult.rows.length === 0) {
                console.log('❌ No batches found at all. Cannot create test scenario.');
                return;
            }
            
            const testBatch = sellableResult.rows[0];
            console.log(`📦 Found batch to test with: ${testBatch.batch_name} (ID: ${testBatch.batch_id})`);
            console.log(`   Product: ${testBatch.product_name} (ID: ${testBatch.product_id})`);
            
            // Check if batch has full_package_count > 0
            const batchCheck = await client.query(`
                SELECT full_package_count, quantity, allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [testBatch.batch_id]);
            
            const batchInfo = batchCheck.rows[0];
            console.log(`   Batch details:`, {
                full_package_count: batchInfo.full_package_count,
                quantity: batchInfo.quantity,
                allocated_quantity: batchInfo.allocated_quantity,
                available: batchInfo.quantity - batchInfo.allocated_quantity
            });
            
            // Ensure batch meets promotion criteria
            if (!batchInfo.full_package_count || batchInfo.full_package_count === 0) {
                console.log(`   ⚠️ Batch doesn't have full_package_count > 0, setting it to 1 for test...`);
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET status = 'On Deck', full_package_count = 1
                    WHERE id = $1
                `, [testBatch.batch_id]);
            } else {
                // Change it to On Deck temporarily
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET status = 'On Deck'
                    WHERE id = $1
                `, [testBatch.batch_id]);
            }
            
            console.log(`✅ Changed batch ${testBatch.batch_id} to On Deck status`);
            
            // Now promote it
            console.log('\n📋 Step 2: Promoting batch to trigger audit log...');
            const promoteResult = await batchStatusService.promoteBatchesToSellable(testBatch.product_id, null);
            
            if (promoteResult.success && promoteResult.updatedBatches.length > 0) {
                console.log(`✅ Successfully promoted ${promoteResult.updatedBatches.length} batch(es)`);
            } else {
                console.log(`⚠️ Promotion result:`, promoteResult);
            }
        } else {
            const testProduct = onDeckResult.rows[0];
            console.log(`✅ Found product: ${testProduct.product_name} (ID: ${testProduct.product_id})`);
            console.log(`   On Deck batches: ${testProduct.on_deck_count}`);
            
            // Step 2: Promote batches
            console.log('\n📋 Step 2: Promoting batches to trigger audit log...');
            const promoteResult = await batchStatusService.promoteBatchesToSellable(testProduct.product_id, null);
            
            if (promoteResult.success && promoteResult.updatedBatches.length > 0) {
                console.log(`✅ Successfully promoted ${promoteResult.updatedBatches.length} batch(es)`);
            } else {
                console.log(`⚠️ Promotion result:`, promoteResult);
            }
        }
        
        // Step 3: Check audit logs
        console.log('\n📋 Step 3: Checking audit logs for batch_status_update...');
        const auditQuery = `
            SELECT 
                id,
                action,
                resource_type,
                resource_id,
                status,
                timestamp,
                details
            FROM "ORDERS-audit_log"
            WHERE action = 'batch_status_update'
            ORDER BY timestamp DESC
            LIMIT 10
        `;
        
        const auditResult = await client.query(auditQuery);
        
        console.log(`\n📊 Found ${auditResult.rows.length} batch_status_update log(s):`);
        auditResult.rows.forEach((log, index) => {
            console.log(`\n   Log ${index + 1}:`);
            console.log(`   - ID: ${log.id}`);
            console.log(`   - Action: ${log.action}`);
            console.log(`   - Resource Type: ${log.resource_type}`);
            console.log(`   - Resource ID: ${log.resource_id}`);
            console.log(`   - Status: ${log.status}`);
            console.log(`   - Timestamp: ${log.timestamp}`);
            if (log.details) {
                const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                console.log(`   - Batch Name: ${details.batch_name || 'N/A'}`);
                console.log(`   - Old Status: ${details.old_status || 'N/A'}`);
                console.log(`   - New Status: ${details.new_status || 'N/A'}`);
            }
        });
        
        if (auditResult.rows.length === 0) {
            console.log('\n❌ No batch_status_update logs found!');
            console.log('   This means either:');
            console.log('   1. No batches were promoted');
            console.log('   2. Audit logging failed');
            console.log('   3. The action name is incorrect');
        } else {
            console.log('\n✅ SUCCESS: batch_status_update logs are being created correctly!');
        }
        
    } catch (error) {
        console.error('❌ Error during test:', error);
        console.error('Stack:', error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the test
testBatchAuditLog().catch(console.error);

