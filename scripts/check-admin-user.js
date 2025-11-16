/**
 * Check Admin User Script
 * 
 * Checks and fixes the admin user status
 */

const { pool } = require('../Server/config/database');

async function checkAdminUser() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Checking admin user...');
        
        // Check admin user
        const adminUser = await client.query(`
            SELECT 
                id, 
                username, 
                first_name, 
                last_name, 
                email, 
                is_active, 
                COALESCE(is_superadmin, is_admin, false) as is_superadmin
            FROM users 
            WHERE username = 'admin'
        `);
        
        if (adminUser.rows.length === 0) {
            console.log('❌ Admin user not found');
            return;
        }
        
        const user = adminUser.rows[0];
        console.log('👤 Admin user found:');
        console.log(`   ID: ${user.id}`);
        console.log(`   Username: ${user.username}`);
        console.log(`   Name: ${user.first_name} ${user.last_name}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Is Active: ${user.is_active}`);
        console.log(`   Is Superadmin: ${user.is_superadmin}`);
        
        // Check if user is active
        if (!user.is_active) {
            console.log('⚠️ Admin user is not active. Activating...');
            await client.query(`
                UPDATE users 
                SET is_active = true, updated_at = NOW()
                WHERE id = $1
            `, [user.id]);
            console.log('✅ Admin user activated');
        }
        
        // Check if user is admin
        if (!user.is_superadmin) {
            console.log('⚠️ Admin user is not superadmin. Granting superadmin flag...');
            await client.query(`
                UPDATE users 
                SET is_admin = true, is_superadmin = true, updated_at = NOW()
                WHERE id = $1
            `, [user.id]);
            console.log('✅ Admin user made admin');
        }
        
        console.log('✅ Admin user is properly configured');
        
    } catch (error) {
        console.error('❌ Error checking admin user:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// Run the script
if (require.main === module) {
    checkAdminUser()
        .then(() => {
            console.log('🎉 Admin user check complete!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Failed to check admin user:', error.message);
            process.exit(1);
        });
}

module.exports = checkAdminUser;
