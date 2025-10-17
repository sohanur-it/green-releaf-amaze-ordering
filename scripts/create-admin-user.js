/**
 * Create Admin User Script
 * 
 * Creates the admin superuser if it doesn't exist
 */

const UserModel = require('../Server/Models/userModel');
const bcrypt = require('bcrypt');

async function createAdminUser() {
    try {
        console.log('🔍 Checking if admin user exists...');
        
        // Check if admin user already exists
        const existingUser = await UserModel.findByUsername('admin');
        
        if (existingUser) {
            console.log('✅ Admin user already exists:');
            console.log(`   Username: ${existingUser.username}`);
            console.log(`   Status: ${existingUser.status}`);
            console.log(`   Is Superuser: ${existingUser.is_superuser}`);
            
            // Check if user is active
            if (existingUser.status !== 'active') {
                console.log('⚠️ Admin user exists but is not active. Activating...');
                await UserModel.approve(existingUser.id);
                console.log('✅ Admin user activated successfully');
            }
            
            return existingUser;
        }
        
        console.log('👤 Creating new admin user...');
        
        // Create admin user
        const adminUser = await UserModel.create({
            username: 'admin',
            firstname: 'Admin',
            lastname: 'User',
            email: 'admin@greenreleaf.com',
            password: 'admin123',
            status: 'active',
            is_superuser: true
        });
        
        console.log('✅ Admin user created successfully:');
        console.log(`   ID: ${adminUser.id}`);
        console.log(`   Username: ${adminUser.username}`);
        console.log(`   Status: ${adminUser.status}`);
        console.log(`   Is Superuser: ${adminUser.is_superuser}`);
        
        return adminUser;
        
    } catch (error) {
        console.error('❌ Error creating admin user:', error.message);
        throw error;
    }
}

// Run the script
if (require.main === module) {
    createAdminUser()
        .then(() => {
            console.log('🎉 Admin user setup complete!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Failed to setup admin user:', error.message);
            process.exit(1);
        });
}

module.exports = createAdminUser;
