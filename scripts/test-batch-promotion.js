#!/usr/bin/env node

/**
 * Test Batch Promotion System
 * 
 * This script tests the batch promotion logic and audit logging
 * Run with: node scripts/test-batch-promotion.js
 */

// Load environment variables
const path = require('path');
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const batchStatusService = require('../Server/Services/batchStatusService');
const inventoryMonitorService = require('../Server/Services/inventoryMonitorService');
const auditLogger = require('../Server/Services/auditLogger');

async function testBatchPromotion() {
    console.log('🧪 Testing Batch Promotion System');
    console.log('='.repeat(50));
    
    try {
        // Test 1: Check inventory monitoring status
        console.log('\n📊 1. Checking inventory monitoring status...');
        const monitoringStatus = inventoryMonitorService.getStatus();
        console.log('Monitoring Status:', JSON.stringify(monitoringStatus, null, 2));
        
        // Test 2: Force inventory check
        console.log('\n🔄 2. Running force inventory check...');
        const checkResult = await batchStatusService.checkAndPromoteAllProducts();
        console.log('Check Result:', JSON.stringify(checkResult, null, 2));
        
        // Test 3: Test batch status summary for a specific product
        console.log('\n📦 3. Testing batch status summary...');
        const summary = await batchStatusService.getBatchStatusSummary(1); // Assuming product ID 1
        console.log('Batch Summary:', JSON.stringify(summary, null, 2));
        
        // Test 4: Test inventory depletion check
        console.log('\n⚠️ 4. Testing inventory depletion check...');
        const isDepleted = await batchStatusService.isInventoryDepleted(1);
        console.log(`Product 1 inventory depleted: ${isDepleted}`);
        
        // Test 5: Test On Deck batches retrieval
        console.log('\n📋 5. Testing On Deck batches retrieval...');
        const onDeckBatches = await batchStatusService.getOnDeckBatches(1);
        console.log(`Found ${onDeckBatches.length} On Deck batches for product 1`);
        console.log('On Deck Batches:', JSON.stringify(onDeckBatches, null, 2));
        
        // Test 6: Test manual batch status update
        console.log('\n✏️ 6. Testing manual batch status update...');
        if (onDeckBatches.length > 0) {
            const batchId = onDeckBatches[0].id;
            const updateResult = await batchStatusService.updateBatchStatus(batchId, 'Sellable', 'SYSTEM');
            console.log('Update Result:', JSON.stringify(updateResult, null, 2));
        } else {
            console.log('No On Deck batches available for testing manual update');
        }
        
        console.log('\n✅ Batch promotion system test completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
if (require.main === module) {
    testBatchPromotion()
        .then(() => {
            console.log('\n🎯 Test completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Test failed:', error.message);
            process.exit(1);
        });
}

module.exports = { testBatchPromotion };
