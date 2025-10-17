/**
 * Check Database Schema Script
 * 
 * Checks the current database schema
 */

const { pool } = require('../Server/config/database');

async function checkSchema() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Checking database schema...');
        
        // Check users table structure
        const usersTable = await client.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'users' 
            ORDER BY ordinal_position;
        `);
        
        console.log('\n📋 Users table structure:');
        usersTable.rows.forEach(row => {
            console.log(`   ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
        });
        
        // Check if audit log table exists
        const auditTable = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'ORDERS-audit_log'
            );
        `);
        
        console.log(`\n📋 Audit log table exists: ${auditTable.rows[0].exists}`);
        
        // Check if roles table exists
        const rolesTable = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'roles'
            );
        `);
        
        console.log(`📋 Roles table exists: ${rolesTable.rows[0].exists}`);
        
        // Check admin user
        const adminUser = await client.query(`
            SELECT id, username, firstname, lastname, email, status, is_superuser
            FROM users 
            WHERE username = 'admin'
        `);
        
        if (adminUser.rows.length > 0) {
            console.log('\n👤 Admin user:');
            const user = adminUser.rows[0];
            console.log(`   ID: ${user.id}`);
            console.log(`   Username: ${user.username}`);
            console.log(`   Name: ${user.firstname} ${user.lastname}`);
            console.log(`   Email: ${user.email}`);
            console.log(`   Status: ${user.status}`);
            console.log(`   Is Superuser: ${user.is_superuser}`);
        } else {
            console.log('\n❌ Admin user not found');
        }
        
    } catch (error) {
        console.error('❌ Error checking schema:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// Run the script
if (require.main === module) {
    checkSchema()
        .then(() => {
            console.log('\n🎉 Schema check complete!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Failed to check schema:', error.message);
            process.exit(1);
        });
}

module.exports = checkSchema;
