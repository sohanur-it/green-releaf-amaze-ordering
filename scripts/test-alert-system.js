#!/usr/bin/env node

/**
 * Test Sync Failure Alert System
 * Simulates failures to test the alert functionality
 */

const syncFailureTracker = require('../Server/Services/syncFailureTracker');

async function testAlertSystem() {
    console.log('🧪 Testing Sync Failure Alert System');
    
    try {
        // Test 1: Record 3 failures (should trigger warning)
        console.log('\n📊 Test 1: Recording 3 failures for sync-outgoing-transfers...');
        for (let i = 1; i <= 3; i++) {
            await syncFailureTracker.recordFailure('sync-outgoing-transfers', `Test failure ${i}`, 'CUL000063');
            console.log(`   Recorded failure ${i}`);
        }
        
        // Check alert level
        const alert1 = await syncFailureTracker.getAlertLevel('sync-outgoing-transfers', 'CUL000063');
        console.log(`   Alert level: ${alert1.level} (${alert1.count} failures)`);
        
        // Test 2: Record 2 more failures (should trigger critical)
        console.log('\n📊 Test 2: Recording 2 more failures (total 5)...');
        for (let i = 4; i <= 5; i++) {
            await syncFailureTracker.recordFailure('sync-outgoing-transfers', `Test failure ${i}`, 'CUL000063');
            console.log(`   Recorded failure ${i}`);
        }
        
        // Check alert level
        const alert2 = await syncFailureTracker.getAlertLevel('sync-outgoing-transfers', 'CUL000063');
        console.log(`   Alert level: ${alert2.level} (${alert2.count} failures)`);
        
        // Test 3: Get all alerts
        console.log('\n📊 Test 3: Getting all alerts...');
        const allAlerts = await syncFailureTracker.getAllAlerts();
        console.log(`   Found ${allAlerts.length} alerts:`);
        allAlerts.forEach(alert => {
            console.log(`   - ${alert.scriptName}: ${alert.level} (${alert.count} failures)`);
        });
        
        // Test 4: Record success (should reset count)
        console.log('\n📊 Test 4: Recording success (should reset count)...');
        await syncFailureTracker.recordSuccess('sync-outgoing-transfers', 'CUL000063');
        
        // Check alert level after success
        const alert3 = await syncFailureTracker.getAlertLevel('sync-outgoing-transfers', 'CUL000063');
        console.log(`   Alert level after success: ${alert3.level} (${alert3.count} failures)`);
        
        // Test 5: Test another script
        console.log('\n📊 Test 5: Testing another script (sync-active-packages)...');
        await syncFailureTracker.recordFailure('sync-active-packages', 'Test failure', 'CUL000063');
        await syncFailureTracker.recordFailure('sync-active-packages', 'Test failure', 'CUL000063');
        await syncFailureTracker.recordFailure('sync-active-packages', 'Test failure', 'CUL000063');
        
        const alert4 = await syncFailureTracker.getAlertLevel('sync-active-packages', 'CUL000063');
        console.log(`   Alert level for sync-active-packages: ${alert4.level} (${alert4.count} failures)`);
        
        // Final stats
        console.log('\n📊 Final Statistics:');
        const stats = await syncFailureTracker.getFailureStats();
        console.log(`   Total scripts: ${stats.totalScripts}`);
        console.log(`   Warning alerts: ${stats.warningCount}`);
        console.log(`   Critical alerts: ${stats.criticalCount}`);
        console.log(`   Max failures: ${stats.maxFailures}`);
        
        console.log('\n✅ Alert system test completed successfully!');
        
    } catch (error) {
        console.error('❌ Error testing alert system:', error.message);
        throw error;
    }
}

// Run the test
testAlertSystem()
    .then(() => {
        console.log('🎉 Alert system test completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Alert system test failed:', error.message);
        process.exit(1);
    });
