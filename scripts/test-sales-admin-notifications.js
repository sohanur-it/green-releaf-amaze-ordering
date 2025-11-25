/**
 * Test script to check sales admin notifications
 * Run: node scripts/test-sales-admin-notifications.js
 */

const { query } = require('../Server/config/database');

async function testSalesAdminNotifications() {
    try {
        console.log('=== Testing Sales Admin Notifications ===\n');
        
        // 1. Check what roles exist
        console.log('1. Checking available roles...');
        const roles = await query(`
            SELECT DISTINCT 
                r.id,
                r.name as role_name,
                r.description
            FROM roles r
            WHERE LOWER(r.name) LIKE '%sales%'
               OR LOWER(r.name) LIKE '%admin%'
            ORDER BY role_name
        `);
        
        console.log(`Found ${roles.rows.length} roles:`);
        roles.rows.forEach(r => {
            console.log(`  - ID: ${r.id}, Name: "${r.role_name}", Description: ${r.description || 'N/A'}`);
        });
        
        // 2. Check sales admin users
        console.log('\n2. Checking sales admin users...');
        const salesAdmins = await query(`
            SELECT DISTINCT 
                u.id, 
                u.email, 
                u.first_name, 
                u.last_name,
                u.is_active,
                r.name as role_name
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            WHERE LOWER(TRIM(r.name)) IN (
                'sales admin', 
                'sales_admin', 
                'salesadmin',
                'sales admin ',
                ' sales admin'
            )
            ORDER BY u.id
        `);
        
        console.log(`Found ${salesAdmins.rows.length} sales admins:`);
        salesAdmins.rows.forEach(admin => {
            console.log(`  - ID: ${admin.id}, Email: ${admin.email}, Name: ${admin.first_name} ${admin.last_name}, Active: ${admin.is_active}, Role: "${admin.role_name}"`);
        });
        
        // 3. Check notifications for sales admins
        if (salesAdmins.rows.length > 0) {
            console.log('\n3. Checking notifications for sales admins...');
            for (const admin of salesAdmins.rows) {
                const notifications = await query(`
                    SELECT COUNT(*) as count
                    FROM user_notifications
                    WHERE user_id = $1
                `, [admin.id]);
                
                const unreadNotifications = await query(`
                    SELECT COUNT(*) as count
                    FROM user_notifications
                    WHERE user_id = $1 AND is_read = false
                `, [admin.id]);
                
                console.log(`  - User ${admin.id} (${admin.email}):`);
                console.log(`    Total notifications: ${notifications.rows[0].count}`);
                console.log(`    Unread notifications: ${unreadNotifications.rows[0].count}`);
            }
        }
        
        // 4. Check recent notifications
        console.log('\n4. Checking recent notifications (last 10)...');
        const recentNotifications = await query(`
            SELECT 
                un.id,
                un.user_id,
                u.email,
                un.notification_type,
                un.title,
                un.is_read,
                un.created_at
            FROM user_notifications un
            JOIN users u ON un.user_id = u.id
            ORDER BY un.created_at DESC
            LIMIT 10
        `);
        
        console.log(`Found ${recentNotifications.rows.length} recent notifications:`);
        recentNotifications.rows.forEach(notif => {
            console.log(`  - ID: ${notif.id}, User: ${notif.user_id} (${notif.email}), Type: ${notif.notification_type}, Read: ${notif.is_read}, Created: ${notif.created_at}`);
        });
        
        // 5. Check notification preferences
        if (salesAdmins.rows.length > 0) {
            console.log('\n5. Checking notification preferences for sales admins...');
            for (const admin of salesAdmins.rows) {
                const prefs = await query(`
                    SELECT notification_type, enabled, send_email
                    FROM user_notification_preferences
                    WHERE user_id = $1
                `, [admin.id]);
                
                console.log(`  - User ${admin.id} (${admin.email}):`);
                if (prefs.rows.length > 0) {
                    prefs.rows.forEach(p => {
                        console.log(`    ${p.notification_type}: enabled=${p.enabled}, email=${p.send_email}`);
                    });
                } else {
                    console.log(`    No preferences set (will use defaults)`);
                }
            }
        }
        
        console.log('\n=== Test Complete ===');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

testSalesAdminNotifications();

