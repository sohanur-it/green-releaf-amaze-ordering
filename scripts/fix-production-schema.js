#!/usr/bin/env node

/**
 * Script to fix production database schema issues
 * This script will create missing tables and fix column issues
 */

const { query, pool } = require('../Server/config/database');

async function fixProductionSchema() {
    console.log('🔧 Fixing production database schema...');
    
    try {
        // Check if audit log table exists
        const auditTableCheck = await query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'ORDERS-audit_log'
            );
        `);
        
        if (!auditTableCheck.rows[0].exists) {
            console.log('📝 Creating ORDERS-audit_log table...');
            await query(`
                CREATE TABLE "ORDERS-audit_log" (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    action VARCHAR(100) NOT NULL,
                    resource_type VARCHAR(50),
                    resource_id VARCHAR(100),
                    details JSONB,
                    status VARCHAR(20) NOT NULL DEFAULT 'success',
                    source_ip INET,
                    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `);
            
            // Create indexes
            await query(`CREATE INDEX idx_audit_log_user_id ON "ORDERS-audit_log" (user_id);`);
            await query(`CREATE INDEX idx_audit_log_timestamp ON "ORDERS-audit_log" (timestamp);`);
            await query(`CREATE INDEX idx_audit_log_action ON "ORDERS-audit_log" (action);`);
            await query(`CREATE INDEX idx_audit_log_resource ON "ORDERS-audit_log" (resource_type, resource_id);`);
            
            console.log('✅ ORDERS-audit_log table created successfully');
        } else {
            console.log('✅ ORDERS-audit_log table already exists');
        }
        
        // Check if roles table exists
        const rolesTableCheck = await query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'roles'
            );
        `);
        
        if (!rolesTableCheck.rows[0].exists) {
            console.log('📝 Creating roles table...');
            await query(`
                CREATE TABLE roles (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(50) UNIQUE NOT NULL
                );
            `);
            
            // Insert default roles
            await query(`
                INSERT INTO roles (name) VALUES 
                ('Administrator'),
                ('Sales Representative'),
                ('Fulfillment Team'),
                ('Viewer')
                ON CONFLICT (name) DO NOTHING;
            `);
            
            console.log('✅ Roles table created successfully');
        } else {
            console.log('✅ Roles table already exists');
        }
        
        // Check if permissions table exists
        const permissionsTableCheck = await query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'permissions'
            );
        `);
        
        if (!permissionsTableCheck.rows[0].exists) {
            console.log('📝 Creating permissions table...');
            await query(`
                CREATE TABLE permissions (
                    id SERIAL PRIMARY KEY,
                    action VARCHAR(50) NOT NULL,
                    resource VARCHAR(50) NOT NULL,
                    UNIQUE(action, resource)
                );
            `);
            
            // Insert default permissions
            await query(`
                INSERT INTO permissions (action, resource) VALUES 
                ('create', 'order'), ('read', 'order'), ('update', 'order'), ('delete', 'order'),
                ('create', 'invoice'), ('read', 'invoice'), ('update', 'invoice'), ('delete', 'invoice'),
                ('create', 'user'), ('read', 'user'), ('update', 'user'), ('delete', 'user'),
                ('read', 'audit'), ('read', 'dashboard'), ('read', 'admin')
                ON CONFLICT (action, resource) DO NOTHING;
            `);
            
            console.log('✅ Permissions table created successfully');
        } else {
            console.log('✅ Permissions table already exists');
        }
        
        // Check if user_roles table exists
        const userRolesTableCheck = await query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'user_roles'
            );
        `);
        
        if (!userRolesTableCheck.rows[0].exists) {
            console.log('📝 Creating user_roles table...');
            await query(`
                CREATE TABLE user_roles (
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
                    PRIMARY KEY (user_id, role_id)
                );
            `);
            
            console.log('✅ user_roles table created successfully');
        } else {
            console.log('✅ user_roles table already exists');
        }
        
        // Check if role_permissions table exists
        const rolePermissionsTableCheck = await query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'role_permissions'
            );
        `);
        
        if (!rolePermissionsTableCheck.rows[0].exists) {
            console.log('📝 Creating role_permissions table...');
            await query(`
                CREATE TABLE role_permissions (
                    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
                    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
                    PRIMARY KEY (role_id, permission_id)
                );
            `);
            
            console.log('✅ role_permissions table created successfully');
        } else {
            console.log('✅ role_permissions table already exists');
        }
        
        // Check if admin user exists and assign Administrator role
        const adminUser = await query('SELECT id FROM users WHERE username = $1', ['admin']);
        if (adminUser.rows.length > 0) {
            const adminUserId = adminUser.rows[0].id;
            const adminRole = await query('SELECT id FROM roles WHERE name = $1', ['Administrator']);
            
            if (adminRole.rows.length > 0) {
                const adminRoleId = adminRole.rows[0].id;
                
                // Assign Administrator role to admin user
                await query(`
                    INSERT INTO user_roles (user_id, role_id) 
                    VALUES ($1, $2) 
                    ON CONFLICT (user_id, role_id) DO NOTHING;
                `, [adminUserId, adminRoleId]);
                
                console.log('✅ Admin user assigned Administrator role');
            }
        }
        
        console.log('🎉 Production database schema fixed successfully!');
        
    } catch (error) {
        console.error('❌ Error fixing production schema:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run the script
if (require.main === module) {
    fixProductionSchema()
        .then(() => {
            console.log('✅ Schema fix completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Schema fix failed:', error);
            process.exit(1);
        });
}

module.exports = { fixProductionSchema };
