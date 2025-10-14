-- =====================================================
-- RBAC (Role-Based Access Control) Database Schema
-- =====================================================
-- This script creates all tables and data needed for
-- user authentication, roles, and permissions
-- =====================================================

-- Drop existing tables if they exist (in reverse dependency order)
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;

-- =====================================================
-- 1. Create ENUM types
-- =====================================================

CREATE TYPE user_status AS ENUM ('pending', 'active', 'revoked');

-- =====================================================
-- 2. Create ROLES table
-- =====================================================

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 3. Create USERS table
-- =====================================================

CREATE TABLE users (
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

-- =====================================================
-- 4. Create USER_ROLES junction table
-- =====================================================

CREATE TABLE user_roles (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by INTEGER REFERENCES users(id),
    PRIMARY KEY (user_id, role_id)
);

-- =====================================================
-- 5. Create PERMISSIONS table
-- =====================================================

CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    resource VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(action, resource)
);

-- =====================================================
-- 6. Create ROLE_PERMISSIONS junction table
-- =====================================================

CREATE TABLE role_permissions (
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_id)
);

-- =====================================================
-- 7. Create USER_SESSIONS table (for session management)
-- =====================================================

CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 8. Create indexes for performance
-- =====================================================

-- Users table indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_is_superuser ON users(is_superuser);

-- User roles indexes
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);

-- Permissions indexes
CREATE INDEX idx_permissions_resource ON permissions(resource);
CREATE INDEX idx_permissions_action ON permissions(action);

-- Role permissions indexes
CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);

-- User sessions indexes
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);

-- =====================================================
-- 9. Insert default ROLES
-- =====================================================

INSERT INTO roles (name, description) VALUES
('Sales Representative', 'Can create and manage their own orders, view assigned clients'),
('Sales Admin', 'All Sales Rep permissions plus invoice approval, client assignment'),
('Fulfillment Team', 'Can view approved orders, accept orders, create manifests'),
('Inventory Manager', 'Can link products to METRC, update batch statuses'),
('Accounting/Finance', 'Can view all invoices, mark as paid, override pricing'),
('Administrator', 'Full system access including user management and role assignment');

-- =====================================================
-- 10. Insert default PERMISSIONS
-- =====================================================

-- Order permissions
INSERT INTO permissions (action, resource, description) VALUES
('create', 'order', 'Create new orders'),
('read_own', 'order', 'Read own orders'),
('read_all', 'order', 'Read all orders'),
('update_draft', 'order', 'Update draft orders'),
('update_approved', 'order', 'Update approved orders'),
('delete', 'order', 'Delete orders'),
('approve', 'order', 'Approve orders for fulfillment');

-- Invoice permissions
INSERT INTO permissions (action, resource, description) VALUES
('read_all', 'invoice', 'View all invoices'),
('read_own', 'invoice', 'View own invoices'),
('create', 'invoice', 'Create invoices'),
('approve_discount', 'invoice', 'Approve discounts'),
('issue_credit', 'invoice', 'Issue credits'),
('mark_paid', 'invoice', 'Mark invoices as paid'),
('master_override', 'invoice', 'Master pricing override');

-- Client/Buyer permissions
INSERT INTO permissions (action, resource, description) VALUES
('read_assigned', 'client', 'Read assigned clients'),
('read_all', 'client', 'Read all clients'),
('create', 'client', 'Create new clients'),
('update', 'client', 'Update client information'),
('assign', 'client', 'Assign clients to sales reps');

-- Inventory permissions
INSERT INTO permissions (action, resource, description) VALUES
('read', 'inventory', 'View inventory'),
('update', 'inventory', 'Update inventory'),
('link_metrc', 'product', 'Link products to METRC'),
('update_status', 'batch', 'Update batch status (Sellable, On Deck, On Hold)');

-- Fulfillment permissions
INSERT INTO permissions (action, resource, description) VALUES
('read_approved', 'fulfillment', 'Read approved orders'),
('accept_order', 'fulfillment', 'Accept orders for fulfillment'),
('create', 'manifest', 'Create manifests'),
('read', 'manifest', 'Read manifests'),
('update', 'manifest', 'Update manifests');

-- User management permissions
INSERT INTO permissions (action, resource, description) VALUES
('read', 'user', 'View users'),
('create', 'user', 'Create users'),
('update', 'user', 'Update users'),
('approve', 'user', 'Approve pending users'),
('revoke', 'user', 'Revoke user access'),
('assign_roles', 'user', 'Assign roles to users');

-- Audit permissions
INSERT INTO permissions (action, resource, description) VALUES
('read', 'audit', 'View audit logs'),
('export', 'audit', 'Export audit logs');

-- Sync permissions
INSERT INTO permissions (action, resource, description) VALUES
('trigger', 'sync', 'Trigger manual sync operations'),
('view_status', 'sync', 'View sync status');

-- =====================================================
-- 11. Assign permissions to roles
-- =====================================================

-- Sales Representative permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Sales Representative'
AND p.resource = 'order' AND p.action IN ('create', 'read_own', 'update_draft')
UNION
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Sales Representative'
AND p.resource = 'inventory' AND p.action = 'read'
UNION
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Sales Representative'
AND p.resource = 'client' AND p.action = 'read_assigned';

-- Sales Admin permissions (includes all Sales Rep permissions)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Sales Admin'
AND p.resource = 'order' AND p.action IN ('create', 'read_own', 'read_all', 'update_draft', 'update_approved', 'approve')
UNION
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Sales Admin'
AND p.resource = 'invoice' AND p.action IN ('read_all', 'create', 'approve_discount', 'issue_credit')
UNION
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Sales Admin'
AND p.resource = 'client' AND p.action IN ('read_all', 'create', 'update', 'assign')
UNION
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Sales Admin'
AND p.resource = 'inventory' AND p.action = 'read';

-- Fulfillment Team permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Fulfillment Team'
AND p.resource = 'fulfillment' AND p.action IN ('read_approved', 'accept_order')
UNION
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Fulfillment Team'
AND p.resource = 'manifest' AND p.action IN ('create', 'read', 'update')
UNION
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Fulfillment Team'
AND p.resource = 'order' AND p.action = 'read_all';

-- Inventory Manager permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Inventory Manager'
AND p.resource = 'inventory' AND p.action IN ('read', 'update')
UNION
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Inventory Manager'
AND p.resource = 'product' AND p.action = 'link_metrc'
UNION
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Inventory Manager'
AND p.resource = 'batch' AND p.action = 'update_status';

-- Accounting/Finance permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Accounting/Finance'
AND p.resource = 'invoice' AND p.action IN ('read_all', 'mark_paid', 'master_override')
UNION
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Accounting/Finance'
AND p.resource = 'order' AND p.action = 'read_all';

-- Administrator permissions (all permissions)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Administrator';

-- =====================================================
-- 12. Create triggers for updated_at timestamps
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 13. Create view for user permissions (helper view)
-- =====================================================

CREATE OR REPLACE VIEW user_permissions AS
SELECT 
    u.id AS user_id,
    u.username,
    u.email,
    u.status,
    r.name AS role_name,
    p.action,
    p.resource,
    CONCAT(p.action, ':', p.resource) AS permission
FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE u.status = 'active';

-- =====================================================
-- 14. Verification queries (for testing)
-- =====================================================

-- View all roles and their permissions
-- SELECT r.name, p.action, p.resource, p.description
-- FROM roles r
-- JOIN role_permissions rp ON r.id = rp.role_id
-- JOIN permissions p ON rp.permission_id = p.id
-- ORDER BY r.name, p.resource, p.action;

-- =====================================================
-- End of RBAC Schema
-- =====================================================

