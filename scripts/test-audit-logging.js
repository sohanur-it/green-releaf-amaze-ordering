#!/usr/bin/env node

/**
 * Test Audit Logging Script
 * 
 * This script tests the audit logging system to ensure user information
 * is properly captured and displayed.
 */

const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const auditLogger = require('../Server/Services/auditLogger');

async function testAuditLogging() {
    console.log('🧪 Testing Audit Logging System...\n');
    
    try {
        // Test 1: Log an action with a test user ID
        console.log('📝 Test 1: Logging action with user ID 1...');
        await auditLogger.logUserAction(
            1, // Test user ID
            'test_action',
            'TestResource',
            'test-123',
            { message: 'This is a test audit log entry' },
            'success'
        );
        console.log('✅ Test 1 completed\n');
        
        // Test 2: Log an action with null user ID
        console.log('📝 Test 2: Logging action with null user ID...');
        await auditLogger.logUserAction(
            null,
            'test_action_null_user',
            'TestResource',
            'test-456',
            { message: 'This is a test audit log entry with null user' },
            'success'
        );
        console.log('✅ Test 2 completed\n');
        
        // Test 3: Retrieve recent audit logs
        console.log('📝 Test 3: Retrieving recent audit logs...');
        const logs = await auditLogger.getLogs({ limit: 5 });
        
        console.log('📊 Recent Audit Logs:');
        logs.forEach((log, index) => {
            console.log(`\n${index + 1}. Log ID: ${log.id}`);
            console.log(`   User ID: ${log.userId}`);
            console.log(`   Username: ${log.username}`);
            console.log(`   User Full Name: ${log.userFullName || 'NULL'}`);
            console.log(`   Action: ${log.action}`);
            console.log(`   Status: ${log.status}`);
            console.log(`   Timestamp: ${log.timestamp}`);
            if (log.details && log.details.userInfo) {
                console.log(`   Details UserInfo: ${JSON.stringify(log.details.userInfo)}`);
            }
        });
        
        console.log('\n✅ Test 3 completed');
        
        // Test 4: Check user table
        console.log('\n📝 Test 4: Checking user table...');
        const { Pool } = require('pg');
        const pool = new Pool({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_DATABASE,
            password: process.env.DB_PASSWORD,
            port: process.env.DB_PORT,
            ssl: { rejectUnauthorized: false }
        });
        
        const client = await pool.connect();
        try {
            const userResult = await client.query(`
                SELECT id, username, first_name, last_name, email 
                FROM users 
                WHERE id = 1
            `);
            
            console.log('👤 User with ID 1:');
            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                console.log(`   ID: ${user.id}`);
                console.log(`   Username: ${user.username}`);
                console.log(`   First Name: ${user.first_name}`);
                console.log(`   Last Name: ${user.last_name}`);
                console.log(`   Email: ${user.email}`);
            } else {
                console.log('   ❌ No user found with ID 1');
            }
        } finally {
            client.release();
            await pool.end();
        }
        
        console.log('\n✅ All tests completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
testAuditLogging().then(() => {
    console.log('\n🏁 Test script completed');
    process.exit(0);
}).catch(error => {
    console.error('💥 Test script failed:', error);
    process.exit(1);
});
