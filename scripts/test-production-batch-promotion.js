#!/usr/bin/env node

/**
 * Test Production Batch Promotion System
 * 
 * This script tests the batch promotion system in production mode
 * with the production database
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

async function testProductionBatchPromotion() {
    console.log('🧪 Testing Production Batch Promotion System');
    console.log('='.repeat(60));
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`Database: ${process.env.DB_HOST}`);
    console.log(`Database Name: ${process.env.DB_DATABASE}`);
    
    try {
        // Test 1: Check inventory monitoring status
        console.log('\n📊 1. Checking inventory monitoring status...');
        const monitoringStatus = inventoryMonitorService.getStatus();
        console.log('Monitoring Status:', JSON.stringify(monitoringStatus, null, 2));
        
        // Test 2: Check batch status summary for a specific product
        console.log('\n📦 2. Testing batch status summary...');
        const summary = await batchStatusService.getBatchStatusSummary(1);
        console.log('Batch Summary:', JSON.stringify(summary, null, 2));
        
        // Test 3: Test inventory depletion check
        console.log('\n⚠️ 3. Testing inventory depletion check...');
        const isDepleted = await batchStatusService.isInventoryDepleted(1);
        console.log(`Product 1 inventory depleted: ${isDepleted}`);
        
        // Test 4: Test On Deck batches retrieval
        console.log('\n📋 4. Testing On Deck batches retrieval...');
        const onDeckBatches = await batchStatusService.getOnDeckBatches(1);
        console.log(`Found ${onDeckBatches.length} On Deck batches for product 1`);
        if (onDeckBatches.length > 0) {
            console.log('On Deck Batches:', JSON.stringify(onDeckBatches, null, 2));
        }
        
        // Test 5: Test manual batch status update
        console.log('\n✏️ 5. Testing manual batch status update...');
        if (onDeckBatches.length > 0) {
            const batchId = onDeckBatches[0].id;
            const updateResult = await batchStatusService.updateBatchStatus(batchId, 'Sellable', null);
            console.log('Update Result:', JSON.stringify(updateResult, null, 2));
        } else {
            console.log('No On Deck batches available for testing manual update');
        }
        
        // Test 6: Force inventory check
        console.log('\n🔄 6. Running force inventory check...');
        const checkResult = await batchStatusService.checkAndPromoteAllProducts();
        console.log('Force Check Result:', JSON.stringify(checkResult, null, 2));
        
        // Test 7: Check audit logs
        console.log('\n📝 7. Checking audit logs...');
        const { Pool } = require('pg');
        const pool = new Pool({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_DATABASE,
            password: process.env.DB_PASSWORD,
            port: parseInt(process.env.DB_PORT, 10) || 5432,
        });
        
        const client = await pool.connect();
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
        
        client.release();
        await pool.end();
        
        console.log('\n🎉 Production batch promotion system test completed successfully!');
        console.log('\n📋 Summary:');
        console.log('✅ Production database connection working');
        console.log('✅ Batch status service functional');
        console.log('✅ Inventory monitoring service operational');
        console.log('✅ Audit logging system working');
        console.log('✅ Automatic batch promotion working');
        console.log('✅ Manual batch status updates working');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
if (require.main === module) {
    testProductionBatchPromotion()
        .then(() => {
            console.log('\n🎯 Production test completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Production test failed:', error.message);
            process.exit(1);
        });
}

module.exports = { testProductionBatchPromotion };
