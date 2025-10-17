/**
 * Create RBAC Tables Script
 * 
 * Creates all RBAC tables if they don't exist
 */

const { pool } = require('../Server/config/database');

async function createRBACTables() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Checking RBAC tables...');
        
        // Create user_status enum if it doesn't exist
        await client.query(`
            DO $$ BEGIN
                CREATE TYPE user_status AS ENUM ('pending', 'active', 'revoked');
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
        `);
        
        // Create roles table
        await client.query(`
            CREATE TABLE IF NOT EXISTS roles (
                id SERIAL PRIMARY KEY,
                name VARCHAR(50) UNIQUE NOT NULL,
                description TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        
        // Create users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                firstname VARCHAR(100) NOT NULL,
                lastname VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                status user_status NOT NULL DEFAULT 'pending',
                is_superuser BOOLEAN NOT NULL DEFAULT FALSE,
                last_login TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                created_by INTEGER REFERENCES users(id)
            );
        `);
        
        // Create user_roles table
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_roles (
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
                assigned_at TIMESTAMPTZ DEFAULT NOW(),
                assigned_by INTEGER REFERENCES users(id),
                PRIMARY KEY (user_id, role_id)
            );
        `);
        
        // Create permissions table
        await client.query(`
            CREATE TABLE IF NOT EXISTS permissions (
                id SERIAL PRIMARY KEY,
                action VARCHAR(50) NOT NULL,
                resource VARCHAR(50) NOT NULL,
                description TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(action, resource)
            );
        `);
        
        // Create role_permissions table
        await client.query(`
            CREATE TABLE IF NOT EXISTS role_permissions (
                role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
                permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
                granted_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (role_id, permission_id)
            );
        `);
        
        // Create user_sessions table
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                session_token VARCHAR(255) UNIQUE NOT NULL,
                ip_address INET,
                user_agent TEXT,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        
        // Create indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_is_superuser ON users(is_superuser);
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);
        `);
        
        console.log('✅ All RBAC tables created successfully');
        
        // Check if we need to insert default roles
        const roleCount = await client.query('SELECT COUNT(*) FROM roles');
        if (parseInt(roleCount.rows[0].count) === 0) {
            console.log('📝 Inserting default roles...');
            
            const defaultRoles = [
                { name: 'Sales Representative', description: 'Can create and manage orders for assigned clients' },
                { name: 'Sales Admin', description: 'Can approve discounts and manage sales team' },
                { name: 'Fulfillment Team', description: 'Can process orders and create manifests' },
                { name: 'Inventory Manager', description: 'Can manage inventory and batch statuses' },
                { name: 'Accounting/Finance', description: 'Can manage invoices and financial data' },
                { name: 'Administrator', description: 'Full system access and user management' }
            ];
            
            for (const role of defaultRoles) {
                await client.query(`
                    INSERT INTO roles (name, description) 
                    VALUES ($1, $2) 
                    ON CONFLICT (name) DO NOTHING
                `, [role.name, role.description]);
            }
            
            console.log('✅ Default roles inserted successfully');
        }
        
    } catch (error) {
        console.error('❌ Error creating RBAC tables:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// Run the script
if (require.main === module) {
    createRBACTables()
        .then(() => {
            console.log('🎉 RBAC tables setup complete!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Failed to setup RBAC tables:', error.message);
            process.exit(1);
        });
}

module.exports = createRBACTables;
