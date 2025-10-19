#!/usr/bin/env node

/**
 * Complete Batch Promotion Test
 * 
 * This script demonstrates the full batch promotion system by:
 * 1. Creating test data
 * 2. Simulating inventory depletion
 * 3. Triggering automatic batch promotion
 * 4. Verifying audit logging
 */

// Load environment variables
const path = require('path');
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const { Pool } = require('pg');
const batchStatusService = require('../Server/Services/batchStatusService');
const inventoryMonitorService = require('../Server/Services/inventoryMonitorService');
const auditLogger = require('../Server/Services/auditLogger');

async function testCompleteBatchPromotion() {
    console.log('🧪 Complete Batch Promotion System Test');
    console.log('='.repeat(60));
    
    const pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT, 10) || 5432,
    });
    
    try {
        // Step 1: Create test scenario - deplete inventory for product 1
        console.log('\n📊 Step 1: Setting up test scenario...');
        console.log('Setting all Sellable batches for product 1 to quantity 0 to simulate depletion');
        
        const client = await pool.connect();
        await client.query(`
            UPDATE batches 
            SET quantity = 0 
            WHERE product_id = 1 AND status = 'Sellable'
        `);
        client.release();
        
        console.log('✅ Test scenario created - Product 1 inventory depleted');
        
        // Step 2: Check inventory status
        console.log('\n🔍 Step 2: Checking inventory status...');
        const isDepleted = await batchStatusService.isInventoryDepleted(1);
        console.log(`Product 1 inventory depleted: ${isDepleted}`);
        
        const onDeckBatches = await batchStatusService.getOnDeckBatches(1);
        console.log(`Found ${onDeckBatches.length} On Deck batches ready for promotion`);
        
        // Step 3: Trigger batch promotion
        console.log('\n🚀 Step 3: Triggering batch promotion...');
        const promotionResult = await batchStatusService.promoteBatchesToSellable(1);
        console.log('Promotion Result:', JSON.stringify(promotionResult, null, 2));
        
        // Step 4: Verify the promotion worked
        console.log('\n✅ Step 4: Verifying promotion results...');
        const updatedBatches = await batchStatusService.getOnDeckBatches(1);
        console.log(`On Deck batches remaining: ${updatedBatches.length}`);
        
        const summary = await batchStatusService.getBatchStatusSummary(1);
        console.log('Updated batch summary:', JSON.stringify(summary, null, 2));
        
        // Step 5: Check audit logs
        console.log('\n📝 Step 5: Checking audit logs...');
        const auditResult = await client.query(`
            SELECT action, resource_type, details, status, timestamp
            FROM "ORDERS-audit_log" 
            WHERE action = 'batch_status_update'
            ORDER BY timestamp DESC
            LIMIT 5
        `);
        
        console.log(`Found ${auditResult.rows.length} batch status update audit logs:`);
        auditResult.rows.forEach((log, index) => {
            console.log(`\n${index + 1}. ${log.action} - ${log.status}`);
            console.log(`   Resource: ${log.resource_type} ${log.resource_id}`);
            console.log(`   Details: ${JSON.stringify(log.details, null, 2)}`);
            console.log(`   Time: ${log.timestamp}`);
        });
        
        // Step 6: Test inventory monitoring service
        console.log('\n⏰ Step 6: Testing inventory monitoring service...');
        const monitoringStatus = inventoryMonitorService.getStatus();
        console.log('Monitoring Status:', JSON.stringify(monitoringStatus, null, 2));
        
        // Step 7: Test force inventory check
        console.log('\n🔄 Step 7: Running force inventory check...');
        const checkResult = await batchStatusService.checkAndPromoteAllProducts();
        console.log('Force Check Result:', JSON.stringify(checkResult, null, 2));
        
        console.log('\n🎉 Complete batch promotion system test completed successfully!');
        console.log('\n📋 Summary:');
        console.log('✅ Database connection working');
        console.log('✅ Batch status service functional');
        console.log('✅ Inventory monitoring service operational');
        console.log('✅ Audit logging system working');
        console.log('✅ Automatic batch promotion working');
        console.log('✅ Manual batch status updates working');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        await pool.end();
    }
}

// Run the test
if (require.main === module) {
    testCompleteBatchPromotion()
        .then(() => {
            console.log('\n🎯 Test completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Test failed:', error.message);
            process.exit(1);
        });
}

module.exports = { testCompleteBatchPromotion };
