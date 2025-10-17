/**
 * Test User Permissions Script
 * 
 * Tests what permissions the admin user has
 */

const UserModel = require('../Server/Models/userModel');

async function testUserPermissions() {
    try {
        console.log('🔍 Testing admin user permissions...');
        
        // Get admin user
        const user = await UserModel.findByUsername('admin');
        if (!user) {
            console.log('❌ Admin user not found');
            return;
        }
        
        console.log(`👤 Admin user: ${user.username} (ID: ${user.id})`);
        console.log(`   Status: ${user.status}`);
        console.log(`   Is Superuser: ${user.is_superuser}`);
        
        // Get user with permissions
        const userWithPermissions = await UserModel.getUserWithPermissions(user.id);
        
        console.log('\n📋 User roles:');
        userWithPermissions.roles.forEach(role => {
            console.log(`   - ${role.name}`);
        });
        
        console.log('\n📋 User permissions:');
        userWithPermissions.permissions.forEach(perm => {
            console.log(`   - ${perm}`);
        });
        
        // Test specific permissions
        const testPermissions = [
            'admin.user.read',
            'admin.user',
            'admin.audit.read',
            'admin.audit',
            'user.read',
            'user.approve'
        ];
        
        console.log('\n🧪 Testing specific permissions:');
        for (const perm of testPermissions) {
            const hasPermission = await UserModel.hasPermission(user.id, perm);
            console.log(`   ${perm}: ${hasPermission ? '✅' : '❌'}`);
        }
        
    } catch (error) {
        console.error('❌ Error testing permissions:', error.message);
        throw error;
    }
}

// Run the script
if (require.main === module) {
    testUserPermissions()
        .then(() => {
            console.log('\n🎉 Permission test complete!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Failed to test permissions:', error.message);
            process.exit(1);
        });
}

module.exports = testUserPermissions;
