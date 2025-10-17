/**
 * Populate Production RBAC Script
 * 
 * Populates the production database with all required roles and permissions
 * according to the Module 2 specification
 */

const { query } = require('../Server/config/database');

async function populateProductionRBAC() {
    try {
        console.log('🔧 Populating production database with complete RBAC...');
        
        // 1. Insert all 6 required roles
        console.log('📝 Creating all required roles...');
        const roles = [
            { name: 'Sales Representative', description: 'Can create and manage their own orders, view assigned clients' },
            { name: 'Sales Admin', description: 'All Sales Rep permissions plus invoice approval, client assignment' },
            { name: 'Fulfillment Team', description: 'Can view approved orders, accept orders, create manifests' },
            { name: 'Inventory Manager', description: 'Can link products to METRC, update batch statuses' },
            { name: 'Accounting/Finance', description: 'Can view all invoices, mark as paid, override pricing' },
            { name: 'Administrator', description: 'Full system access including user management and role assignment' }
        ];
        
        for (const role of roles) {
            await query(`
                INSERT INTO roles (name, description) 
                VALUES ($1, $2) 
                ON CONFLICT (name) DO NOTHING
            `, [role.name, role.description]);
            console.log(`   ✅ ${role.name}`);
        }
        
        // 2. Insert all required permissions
        console.log('\n📝 Creating all required permissions...');
        const permissions = [
            // Order permissions
            { action: 'create', resource: 'order', description: 'Create new orders' },
            { action: 'read_own', resource: 'order', description: 'Read own orders' },
            { action: 'read_all', resource: 'order', description: 'Read all orders' },
            { action: 'update_draft', resource: 'order', description: 'Update draft orders' },
            { action: 'update_approved', resource: 'order', description: 'Update approved orders' },
            { action: 'delete', resource: 'order', description: 'Delete orders' },
            { action: 'approve', resource: 'order', description: 'Approve orders for fulfillment' },
            
            // Invoice permissions
            { action: 'read_all', resource: 'invoice', description: 'View all invoices' },
            { action: 'read_own', resource: 'invoice', description: 'View own invoices' },
            { action: 'create', resource: 'invoice', description: 'Create invoices' },
            { action: 'approve_discount', resource: 'invoice', description: 'Approve discounts' },
            { action: 'issue_credit', resource: 'invoice', description: 'Issue credits' },
            { action: 'mark_paid', resource: 'invoice', description: 'Mark invoices as paid' },
            { action: 'master_override', resource: 'invoice', description: 'Master pricing override' },
            
            // Client/Buyer permissions
            { action: 'read_assigned', resource: 'client', description: 'Read assigned clients' },
            { action: 'read_all', resource: 'client', description: 'Read all clients' },
            { action: 'create', resource: 'client', description: 'Create new clients' },
            { action: 'update', resource: 'client', description: 'Update client information' },
            { action: 'assign', resource: 'client', description: 'Assign clients to sales reps' },
            
            // Inventory permissions
            { action: 'read', resource: 'inventory', description: 'View inventory' },
            { action: 'update', resource: 'inventory', description: 'Update inventory' },
            { action: 'link_metrc', resource: 'product', description: 'Link products to METRC' },
            { action: 'update_status', resource: 'batch', description: 'Update batch status (Sellable, On Deck, On Hold)' },
            
            // Fulfillment permissions
            { action: 'read_approved', resource: 'fulfillment', description: 'Read approved orders' },
            { action: 'accept_order', resource: 'fulfillment', description: 'Accept orders for fulfillment' },
            { action: 'create', resource: 'manifest', description: 'Create manifests' },
            { action: 'read', resource: 'manifest', description: 'Read manifests' },
            { action: 'update', resource: 'manifest', description: 'Update manifests' },
            
            // User management permissions
            { action: 'read', resource: 'user', description: 'View users' },
            { action: 'create', resource: 'user', description: 'Create users' },
            { action: 'update', resource: 'user', description: 'Update users' },
            { action: 'approve', resource: 'user', description: 'Approve pending users' },
            { action: 'revoke', resource: 'user', description: 'Revoke user access' },
            { action: 'assign_roles', resource: 'user', description: 'Assign roles to users' },
            
            // Audit permissions
            { action: 'read', resource: 'audit', description: 'View audit logs' },
            { action: 'export', resource: 'audit', description: 'Export audit logs' },
            
            // Sync permissions
            { action: 'trigger', resource: 'sync', description: 'Trigger manual sync operations' },
            { action: 'view_status', resource: 'sync', description: 'View sync status' }
        ];
        
        for (const perm of permissions) {
            await query(`
                INSERT INTO permissions (action, resource) 
                VALUES ($1, $2) 
                ON CONFLICT (action, resource) DO NOTHING
            `, [perm.action, perm.resource]);
        }
        console.log(`   ✅ ${permissions.length} permissions created`);
        
        // 3. Assign permissions to roles according to specification
        console.log('\n📝 Assigning permissions to roles...');
        
        // Sales Representative permissions
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Sales Representative'
            AND p.resource = 'order' AND p.action IN ('create', 'read_own', 'update_draft')
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Sales Representative'
            AND p.resource = 'inventory' AND p.action = 'read'
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Sales Representative'
            AND p.resource = 'client' AND p.action = 'read_assigned'
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        // Sales Admin permissions (includes all Sales Rep permissions)
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Sales Admin'
            AND p.resource = 'order' AND p.action IN ('create', 'read_own', 'read_all', 'update_draft', 'update_approved', 'approve')
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Sales Admin'
            AND p.resource = 'invoice' AND p.action IN ('read_all', 'create', 'approve_discount', 'issue_credit')
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Sales Admin'
            AND p.resource = 'client' AND p.action IN ('read_all', 'create', 'update', 'assign')
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Sales Admin'
            AND p.resource = 'inventory' AND p.action = 'read'
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        // Fulfillment Team permissions
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Fulfillment Team'
            AND p.resource = 'fulfillment' AND p.action IN ('read_approved', 'accept_order')
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Fulfillment Team'
            AND p.resource = 'manifest' AND p.action IN ('create', 'read', 'update')
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        // Inventory Manager permissions
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Inventory Manager'
            AND p.resource = 'product' AND p.action = 'link_metrc'
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Inventory Manager'
            AND p.resource = 'batch' AND p.action = 'update_status'
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Inventory Manager'
            AND p.resource = 'inventory' AND p.action IN ('read', 'update')
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        // Accounting/Finance permissions
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Accounting/Finance'
            AND p.resource = 'invoice' AND p.action IN ('read_all', 'mark_paid', 'master_override')
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        // Administrator permissions (all permissions)
        await query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.name = 'Administrator'
            ON CONFLICT (role_id, permission_id) DO NOTHING
        `);
        
        console.log('✅ All role-permission assignments completed');
        
        // 4. Verify the setup
        console.log('\n🔍 Verifying RBAC setup...');
        
        const roleCount = await query('SELECT COUNT(*) FROM roles');
        const permissionCount = await query('SELECT COUNT(*) FROM permissions');
        const rolePermissionCount = await query('SELECT COUNT(*) FROM role_permissions');
        
        console.log(`📊 Final counts:`);
        console.log(`   Roles: ${roleCount.rows[0].count}`);
        console.log(`   Permissions: ${permissionCount.rows[0].count}`);
        console.log(`   Role-Permission assignments: ${rolePermissionCount.rows[0].count}`);
        
        // Show roles with their permission counts
        const rolePermissions = await query(`
            SELECT r.name, COUNT(rp.permission_id) as permission_count
            FROM roles r
            LEFT JOIN role_permissions rp ON r.id = rp.role_id
            GROUP BY r.id, r.name
            ORDER BY r.name
        `);
        
        console.log('\n📋 Roles and their permission counts:');
        rolePermissions.rows.forEach(row => {
            console.log(`   ${row.name}: ${row.permission_count} permissions`);
        });
        
        console.log('\n🎉 Production RBAC population completed successfully!');
        
    } catch (error) {
        console.error('❌ Error populating RBAC:', error.message);
        throw error;
    }
}

// Run the script
if (require.main === module) {
    populateProductionRBAC().catch(error => {
        console.error('💥 Script failed:', error);
        process.exit(1);
    });
}

module.exports = { populateProductionRBAC };
