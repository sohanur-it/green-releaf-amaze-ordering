#!/usr/bin/env node

/**
 * Script to test database queries and identify issues
 */

const { query, pool } = require('../Server/config/database');

async function testDatabaseQueries() {
    console.log('🔍 Testing database queries...');
    
    try {
        // Test 1: Check users table structure
        console.log('\n📋 Testing users table...');
        const usersResult = await query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'users' 
            ORDER BY ordinal_position;
        `);
        console.log('Users table columns:', usersResult.rows.map(r => `${r.column_name} (${r.data_type})`));
        
        // Test 2: Check if admin user exists
        console.log('\n👤 Testing admin user...');
        const adminUser = await query('SELECT id, username, first_name, last_name, is_active, is_admin FROM users WHERE username = $1', ['admin']);
        console.log('Admin user:', adminUser.rows[0] || 'Not found');
        
        // Test 3: Test UserModel.getAll() query
        console.log('\n📊 Testing UserModel.getAll() query...');
        const getAllResult = await query(`
            SELECT 
                id, 
                username, 
                first_name as firstname, 
                last_name as lastname, 
                email, 
                CASE WHEN is_active = true THEN 'active' ELSE 'inactive' END as status,
                is_admin as is_superuser, 
                created_at, 
                last_login 
            FROM users
            ORDER BY created_at DESC
        `);
        console.log('Users found:', getAllResult.rows.length);
        if (getAllResult.rows.length > 0) {
            console.log('First user:', getAllResult.rows[0]);
        }
        
        // Test 4: Check roles table
        console.log('\n🎭 Testing roles table...');
        const rolesResult = await query('SELECT id, name FROM roles ORDER BY name');
        console.log('Roles found:', rolesResult.rows.length);
        console.log('Roles:', rolesResult.rows);
        
        // Test 5: Check audit log table
        console.log('\n📝 Testing audit log table...');
        const auditLogResult = await query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'ORDERS-audit_log' 
            ORDER BY ordinal_position;
        `);
        console.log('Audit log table columns:', auditLogResult.rows.map(r => `${r.column_name} (${r.data_type})`));
        
        // Test 6: Test audit log query with user join
        console.log('\n🔍 Testing audit log with user join...');
        const auditWithUserResult = await query(`
            SELECT DISTINCT u.id, u.username, u.first_name as firstname, u.last_name as lastname
            FROM "ORDERS-audit_log" al
            JOIN users u ON al.user_id = u.id
            ORDER BY u.username
            LIMIT 5
        `);
        console.log('Audit log users found:', auditWithUserResult.rows.length);
        console.log('Audit log users:', auditWithUserResult.rows);
        
    } catch (error) {
        console.error('❌ Database test error:', error.message);
        console.error('Full error:', error);
    } finally {
        await pool.end();
    }
}

// Run the script
if (require.main === module) {
    testDatabaseQueries()
        .then(() => {
            console.log('\n✅ Database tests completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Database tests failed:', error);
            process.exit(1);
        });
}

module.exports = { testDatabaseQueries };
