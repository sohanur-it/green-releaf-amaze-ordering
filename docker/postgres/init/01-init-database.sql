-- Database initialization script for Docker PostgreSQL
-- This script runs when the PostgreSQL container starts for the first time

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create schemas
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS orders;
CREATE SCHEMA IF NOT EXISTS metrc;

-- Set search path
SET search_path TO public, crm, orders, metrc;

-- Create user_status enum
DO $$ BEGIN
    CREATE TYPE user_status AS ENUM ('active', 'pending', 'suspended', 'deleted');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create roles table
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    resource VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    status user_status DEFAULT 'pending',
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create user_roles table
CREATE TABLE IF NOT EXISTS user_roles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by INTEGER REFERENCES users(id),
    UNIQUE(user_id, role_id)
);

-- Create role_permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
    id SERIAL PRIMARY KEY,
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    granted_by INTEGER REFERENCES users(id),
    UNIQUE(role_id, permission_id)
);

-- Create user_sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- Insert default roles
INSERT INTO roles (name, description) VALUES
    ('superuser', 'Full system access with all permissions'),
    ('admin', 'Administrative access to most system features'),
    ('manager', 'Management access to CRM and order features'),
    ('sales_rep', 'Sales representative with limited access'),
    ('viewer', 'Read-only access to system data')
ON CONFLICT (name) DO NOTHING;

-- Insert default permissions
INSERT INTO permissions (name, description, resource, action) VALUES
    -- User management permissions
    ('users.create', 'Create new users', 'users', 'create'),
    ('users.read', 'View user information', 'users', 'read'),
    ('users.update', 'Update user information', 'users', 'update'),
    ('users.delete', 'Delete users', 'users', 'delete'),
    ('users.approve', 'Approve pending users', 'users', 'approve'),
    
    -- CRM permissions
    ('crm.buyers.create', 'Create new buyers', 'crm', 'buyers.create'),
    ('crm.buyers.read', 'View buyer information', 'crm', 'buyers.read'),
    ('crm.buyers.update', 'Update buyer information', 'crm', 'buyers.update'),
    ('crm.buyers.delete', 'Delete buyers', 'crm', 'buyers.delete'),
    
    ('crm.contacts.create', 'Create new contacts', 'crm', 'contacts.create'),
    ('crm.contacts.read', 'View contact information', 'crm', 'contacts.read'),
    ('crm.contacts.update', 'Update contact information', 'crm', 'contacts.update'),
    ('crm.contacts.delete', 'Delete contacts', 'crm', 'contacts.delete'),
    
    ('crm.sales_reps.create', 'Create new sales reps', 'crm', 'sales_reps.create'),
    ('crm.sales_reps.read', 'View sales rep information', 'crm', 'sales_reps.read'),
    ('crm.sales_reps.update', 'Update sales rep information', 'crm', 'sales_reps.update'),
    ('crm.sales_reps.delete', 'Delete sales reps', 'crm', 'sales_reps.delete'),
    
    -- Order management permissions
    ('orders.create', 'Create new orders', 'orders', 'create'),
    ('orders.read', 'View order information', 'orders', 'read'),
    ('orders.update', 'Update order information', 'orders', 'update'),
    ('orders.delete', 'Delete orders', 'orders', 'delete'),
    ('orders.process', 'Process orders', 'orders', 'process'),
    
    -- METRC sync permissions
    ('metrc.sync.read', 'View METRC sync data', 'metrc', 'sync.read'),
    ('metrc.sync.trigger', 'Trigger METRC sync operations', 'metrc', 'sync.trigger'),
    ('metrc.sync.manage', 'Manage METRC sync configuration', 'metrc', 'sync.manage'),
    
    -- System administration permissions
    ('system.settings.read', 'View system settings', 'system', 'settings.read'),
    ('system.settings.update', 'Update system settings', 'system', 'settings.update'),
    ('system.audit.read', 'View audit logs', 'system', 'audit.read'),
    ('system.health.read', 'View system health', 'system', 'health.read')
ON CONFLICT (name) DO NOTHING;

-- Assign permissions to roles
-- Superuser gets all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'superuser'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Admin gets most permissions except superuser-specific ones
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin' 
AND p.name NOT IN ('users.delete', 'system.settings.update')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Manager gets CRM and order permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'manager' 
AND (p.resource = 'crm' OR p.resource = 'orders' OR p.name = 'metrc.sync.read')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Sales rep gets limited CRM permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'sales_rep' 
AND (p.name LIKE 'crm.%' OR p.name = 'orders.read')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Viewer gets read-only permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'viewer' 
AND p.action = 'read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Create audit log table
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(50) NOT NULL,
    resource_id INTEGER,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for audit log
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- Create METRC sync tables
CREATE TABLE IF NOT EXISTS metrc.sync_status (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(50) UNIQUE NOT NULL,
    last_sync TIMESTAMP,
    last_success TIMESTAMP,
    last_error TEXT,
    sync_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'idle',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS metrc.sync_log (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    records_processed INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_deleted INTEGER DEFAULT 0,
    error_message TEXT,
    duration_ms INTEGER,
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP
);

-- Create indexes for METRC sync tables
CREATE INDEX IF NOT EXISTS idx_sync_status_service ON metrc.sync_status(service_name);
CREATE INDEX IF NOT EXISTS idx_sync_log_service ON metrc.sync_log(service_name);
CREATE INDEX IF NOT EXISTS idx_sync_log_started_at ON metrc.sync_log(started_at);

-- Insert initial sync status records
INSERT INTO metrc.sync_status (service_name, status) VALUES
    ('active-packages', 'idle'),
    ('transferred-packages', 'idle'),
    ('intransit-packages', 'idle'),
    ('outgoing-transfers', 'idle'),
    ('items', 'idle'),
    ('strains', 'idle')
ON CONFLICT (service_name) DO NOTHING;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_permissions_updated_at BEFORE UPDATE ON permissions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sync_status_updated_at BEFORE UPDATE ON metrc.sync_status FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions to postgres user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA crm TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA orders TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA metrc TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA crm TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA orders TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA metrc TO postgres;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA orders GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA metrc GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA orders GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA metrc GRANT ALL ON SEQUENCES TO postgres;

-- Log successful initialization
INSERT INTO audit_log (action, resource, details) VALUES
    ('system.initialize', 'database', '{"message": "Database initialized successfully", "version": "1.0.0"}');
