/**
 * Assign Admin Permissions Script
 * 
 * Assigns all necessary permissions to the admin user
 */

const { pool } = require('../Server/config/database');

async function assignAdminPermissions() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Setting up admin permissions...');
        
        // Get admin user
        const adminUser = await client.query(`
            SELECT id, username FROM users WHERE username = 'admin'
        `);
        
        if (adminUser.rows.length === 0) {
            console.log('❌ Admin user not found');
            return;
        }
        
        const userId = adminUser.rows[0].id;
        console.log(`👤 Found admin user: ${adminUser.rows[0].username} (ID: ${userId})`);
        
        // Get or create Administrator role
        let adminRole = await client.query(`
            SELECT id FROM roles WHERE name = 'Administrator'
        `);
        
        if (adminRole.rows.length === 0) {
            console.log('📝 Creating Administrator role...');
            const newRole = await client.query(`
                INSERT INTO roles (name, description) 
                VALUES ('Administrator', 'Full system access and user management')
                RETURNING id
            `);
            adminRole = newRole;
        }
        
        const roleId = adminRole.rows[0].id;
        console.log(`🔑 Administrator role ID: ${roleId}`);
        
        // Assign Administrator role to admin user
        await client.query(`
            INSERT INTO user_roles (user_id, role_id, assigned_by)
            VALUES ($1, $2, $1)
            ON CONFLICT (user_id, role_id) DO NOTHING
        `, [userId, roleId]);
        
        console.log('✅ Administrator role assigned to admin user');
        
        // Create all necessary permissions
        const permissions = [
            { action: 'admin', resource: 'dashboard' },
            { action: 'admin', resource: 'user' },
            { action: 'admin', resource: 'audit' },
            { action: 'admin', resource: 'sync' },
            { action: 'user', resource: 'read' },
            { action: 'user', resource: 'approve' },
            { action: 'user', resource: 'revoke' },
            { action: 'user', resource: 'assign_roles' },
            { action: 'audit', resource: 'read' },
            { action: 'sync', resource: 'manage' }
        ];
        
        console.log('📝 Creating permissions...');
        for (const perm of permissions) {
            await client.query(`
                INSERT INTO permissions (action, resource)
                VALUES ($1, $2)
                ON CONFLICT (action, resource) DO NOTHING
            `, [perm.action, perm.resource]);
        }
        
        console.log('✅ Permissions created');
        
        // Assign all permissions to Administrator role
        console.log('🔗 Assigning permissions to Administrator role...');
        for (const perm of permissions) {
            await client.query(`
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT $1, p.id FROM permissions p 
                WHERE p.action = $2 AND p.resource = $3
                ON CONFLICT (role_id, permission_id) DO NOTHING
            `, [roleId, perm.action, perm.resource]);
        }
        
        console.log('✅ All permissions assigned to Administrator role');
        
        // Verify the setup
        const userRoles = await client.query(`
            SELECT r.name FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1
        `, [userId]);
        
        const rolePermissions = await client.query(`
            SELECT p.action, p.resource FROM role_permissions rp
            JOIN permissions p ON rp.permission_id = p.id
            WHERE rp.role_id = $1
        `, [roleId]);
        
        console.log('\n📋 Admin user roles:');
        userRoles.rows.forEach(role => {
            console.log(`   - ${role.name}`);
        });
        
        console.log('\n📋 Administrator role permissions:');
        rolePermissions.rows.forEach(perm => {
            console.log(`   - ${perm.action}.${perm.resource}`);
        });
        
    } catch (error) {
        console.error('❌ Error setting up admin permissions:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// Run the script
if (require.main === module) {
    assignAdminPermissions()
        .then(() => {
            console.log('\n🎉 Admin permissions setup complete!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Failed to setup admin permissions:', error.message);
            process.exit(1);
        });
}

module.exports = assignAdminPermissions;
