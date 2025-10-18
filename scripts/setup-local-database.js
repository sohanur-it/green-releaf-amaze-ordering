#!/usr/bin/env node

/**
 * Complete Local Database Setup Script
 * 
 * This script creates an exact replica of the production database locally:
 * 1. Backs up complete production schema (all tables, indexes, constraints, etc.)
 * 2. Applies it to local Docker database
 * 3. Creates superuser account
 * 4. Populates all roles and permissions from production
 * 5. Optionally backs up and restores production data
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Load production environment variables for this script
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });

// Also load local environment for local database connection
const localEnv = require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });

// For local database operations, we'll use a separate connection
const { Pool } = require('pg');

// Configuration
const PROD_CONFIG = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
};

const LOCAL_CONFIG = {
    container: 'green-releaf-postgres',
    user: 'postgres',
    database: 'green_releaf_dev'
};

// Create local database connection
const localPool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'green_releaf_dev',
    password: 'dev_password_123',
    port: 5432,
});

// Local database query function
async function localQuery(sql, params = []) {
    const client = await localPool.connect();
    try {
        const result = await client.query(sql, params);
        return result;
    } finally {
        client.release();
    }
}

const BACKUP_DIR = './backups/complete-setup';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// Utility functions
function logInfo(message) {
    console.log(`ℹ️  ${message}`);
}

function logSuccess(message) {
    console.log(`✅ ${message}`);
}

function logError(message) {
    console.error(`❌ ${message}`);
}

function logStep(step, message) {
    console.log(`\n🔧 Step ${step}: ${message}`);
    console.log('='.repeat(50));
}

// Step 1: Backup complete production schema
async function backupProductionSchema() {
    logStep(1, 'Backing up complete production schema');
    
    // Create backup directory
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    
    const schemaFile = path.join(BACKUP_DIR, `complete_schema_${TIMESTAMP}.sql`);
    
    logInfo('Extracting complete schema from production database...');
    
    try {
        // Use Docker to avoid pg_dump version mismatch
        const pgDumpCmd = `docker run --rm \
            -e PGPASSWORD="${PROD_CONFIG.password}" \
            -v "$(pwd)/${BACKUP_DIR}":/backup \
            postgres:16-alpine \
            pg_dump \
            --host="${PROD_CONFIG.host}" \
            --port="${PROD_CONFIG.port}" \
            --username="${PROD_CONFIG.user}" \
            --dbname="${PROD_CONFIG.database}" \
            --schema-only \
            --no-owner \
            --no-privileges \
            --clean \
            --if-exists \
            --create \
            --format=plain \
            --file="/backup/complete_schema_${TIMESTAMP}.sql"`;
        
        execSync(pgDumpCmd, { stdio: 'inherit' });
        
        logSuccess(`Complete schema backed up to: ${schemaFile}`);
        return schemaFile;
    } catch (error) {
        logError(`Failed to backup production schema: ${error.message}`);
        throw error;
    }
}

// Step 2: Apply schema to local database
async function applySchemaToLocal(schemaFile) {
    logStep(2, 'Applying complete schema to local database');
    
    logInfo('Dropping and recreating local database...');
    
    try {
        // Drop and recreate database
        execSync(`docker exec ${LOCAL_CONFIG.container} psql -U ${LOCAL_CONFIG.user} -c "DROP DATABASE IF EXISTS \\"${LOCAL_CONFIG.database}\\" WITH (FORCE);"`, { stdio: 'inherit' });
        execSync(`docker exec ${LOCAL_CONFIG.container} psql -U ${LOCAL_CONFIG.user} -c "CREATE DATABASE \\"${LOCAL_CONFIG.database}\\" WITH ENCODING 'UTF8' LC_COLLATE='C' LC_CTYPE='C' TEMPLATE=template0;"`, { stdio: 'inherit' });
        
        logInfo('Applying complete schema...');
        
        // Apply the schema file
        execSync(`docker exec -i ${LOCAL_CONFIG.container} psql -U ${LOCAL_CONFIG.user} -d ${LOCAL_CONFIG.database} < ${schemaFile}`, { stdio: 'inherit' });
        
        logSuccess('Complete schema applied successfully to local database');
    } catch (error) {
        logError(`Failed to apply schema to local database: ${error.message}`);
        throw error;
    }
}

// Step 3: Create superuser
async function createSuperuser() {
    logStep(3, 'Creating superuser account');
    
    try {
        logInfo('Creating admin superuser...');
        
        const bcrypt = require('bcrypt');
        const password_hash = await bcrypt.hash('admin123', 10);
        const email_hash = await bcrypt.hash('admin@greenreleaf.com', 10);
        
        await localQuery(`
            INSERT INTO users (username, first_name, last_name, email, email_hash, password_hash, is_active, is_admin, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (username) DO NOTHING
        `, ['admin', 'Admin', 'User', 'admin@greenreleaf.com', email_hash, password_hash, true, true]);
        
        logSuccess('Superuser created successfully');
        logInfo('Login credentials:');
        logInfo('  Username: admin');
        logInfo('  Email: admin@greenreleaf.com');
        logInfo('  Password: admin123');
    } catch (error) {
        logError(`Failed to create superuser: ${error.message}`);
        throw error;
    }
}

// Step 4: Populate roles and permissions from production
async function populateRolesAndPermissions() {
    logStep(4, 'Populating roles and permissions from production');
    
    try {
        // Connect to production database to get roles and permissions
        const prodQuery = require('pg').Pool({
            user: PROD_CONFIG.user,
            host: PROD_CONFIG.host,
            database: PROD_CONFIG.database,
            password: PROD_CONFIG.password,
            port: PROD_CONFIG.port,
        });
        
        logInfo('Fetching roles from production...');
        const rolesResult = await prodQuery.query('SELECT id, name FROM roles ORDER BY id');
        const productionRoles = rolesResult.rows;
        
        logInfo('Fetching permissions from production...');
        const permissionsResult = await prodQuery.query('SELECT id, action, resource FROM permissions ORDER BY id');
        const productionPermissions = permissionsResult.rows;
        
        logInfo('Fetching role-permission mappings from production...');
        const rolePermsResult = await prodQuery.query('SELECT role_id, permission_id FROM role_permissions ORDER BY role_id, permission_id');
        const productionRolePermissions = rolePermsResult.rows;
        
        await prodQuery.end();
        
        // Insert roles into local database
        logInfo(`Inserting ${productionRoles.length} roles...`);
        for (const role of productionRoles) {
            await localQuery(`
                INSERT INTO roles (id, name) 
                VALUES ($1, $2) 
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
            `, [role.id, role.name]);
        }
        
        // Insert permissions into local database
        logInfo(`Inserting ${productionPermissions.length} permissions...`);
        for (const perm of productionPermissions) {
            await localQuery(`
                INSERT INTO permissions (id, action, resource) 
                VALUES ($1, $2, $3) 
                ON CONFLICT (id) DO UPDATE SET action = EXCLUDED.action, resource = EXCLUDED.resource
            `, [perm.id, perm.action, perm.resource]);
        }
        
        // Insert role-permission mappings into local database
        logInfo(`Inserting ${productionRolePermissions.length} role-permission mappings...`);
        for (const rolePerm of productionRolePermissions) {
            await localQuery(`
                INSERT INTO role_permissions (role_id, permission_id) 
                VALUES ($1, $2) 
                ON CONFLICT (role_id, permission_id) DO NOTHING
            `, [rolePerm.role_id, rolePerm.permission_id]);
        }
        
        logSuccess('Roles and permissions populated successfully');
        logInfo(`  Roles: ${productionRoles.length}`);
        logInfo(`  Permissions: ${productionPermissions.length}`);
        logInfo(`  Role-Permission mappings: ${productionRolePermissions.length}`);
    } catch (error) {
        logError(`Failed to populate roles and permissions: ${error.message}`);
        throw error;
    }
}

// Step 5: Verify setup
async function verifySetup() {
    logStep(5, 'Verifying local database setup');
    
    try {
        // Check tables
        const tablesResult = await localQuery(`
            SELECT COUNT(*) as table_count 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        
        // Check users
        const usersResult = await localQuery('SELECT COUNT(*) as user_count FROM users');
        
        // Check roles
        const rolesResult = await localQuery('SELECT COUNT(*) as role_count FROM roles');
        
        // Check permissions
        const permissionsResult = await localQuery('SELECT COUNT(*) as permission_count FROM permissions');
        
        // Check admin user
        const adminResult = await localQuery(`
            SELECT username, first_name, last_name, email, is_active, is_admin 
            FROM users WHERE username = 'admin'
        `);
        
        logSuccess('Setup verification completed:');
        logInfo(`  Tables: ${tablesResult.rows[0].table_count}`);
        logInfo(`  Users: ${usersResult.rows[0].user_count}`);
        logInfo(`  Roles: ${rolesResult.rows[0].role_count}`);
        logInfo(`  Permissions: ${permissionsResult.rows[0].permission_count}`);
        
        if (adminResult.rows.length > 0) {
            const admin = adminResult.rows[0];
            logSuccess('Admin user verified:');
            logInfo(`  Username: ${admin.username}`);
            logInfo(`  Name: ${admin.first_name} ${admin.last_name}`);
            logInfo(`  Email: ${admin.email}`);
            logInfo(`  Active: ${admin.is_active}`);
            logInfo(`  Admin: ${admin.is_admin}`);
        }
        
    } catch (error) {
        logError(`Verification failed: ${error.message}`);
        throw error;
    }
}

// Optional: Backup and restore production data
async function backupAndRestoreData() {
    logStep(6, 'Backing up and restoring production data (optional)');
    
    const includeData = process.argv.includes('--with-data');
    
    if (!includeData) {
        logInfo('Skipping data backup (use --with-data flag to include production data)');
        return;
    }
    
    try {
        logInfo('Backing up production data...');
        
        const dataFile = path.join(BACKUP_DIR, `production_data_${TIMESTAMP}.sql`);
        
        const pgDumpCmd = `docker run --rm \
            -e PGPASSWORD="${PROD_CONFIG.password}" \
            -v "$(pwd)/${BACKUP_DIR}":/backup \
            postgres:16-alpine \
            pg_dump \
            --host="${PROD_CONFIG.host}" \
            --port="${PROD_CONFIG.port}" \
            --username="${PROD_CONFIG.user}" \
            --dbname="${PROD_CONFIG.database}" \
            --data-only \
            --no-owner \
            --no-privileges \
            --format=plain \
            --file="/backup/production_data_${TIMESTAMP}.sql"`;
        
        execSync(pgDumpCmd, { stdio: 'inherit' });
        
        logInfo('Restoring production data to local database...');
        execSync(`docker exec -i ${LOCAL_CONFIG.container} psql -U ${LOCAL_CONFIG.user} -d ${LOCAL_CONFIG.database} < ${dataFile}`, { stdio: 'inherit' });
        
        logSuccess('Production data restored successfully');
    } catch (error) {
        logError(`Failed to backup/restore data: ${error.message}`);
        throw error;
    }
}

// Main execution
async function main() {
    try {
        console.log('🚀 Starting Complete Local Database Setup');
        console.log('='.repeat(60));
        console.log(`📅 Timestamp: ${TIMESTAMP}`);
        console.log(`🎯 Target: ${LOCAL_CONFIG.database} (local Docker)`);
        console.log(`📡 Source: ${PROD_CONFIG.database} (production)`);
        console.log('='.repeat(60));
        
        // Check if Docker database is running
        try {
            execSync(`docker exec ${LOCAL_CONFIG.container} psql -U ${LOCAL_CONFIG.user} -c "SELECT 1;"`, { stdio: 'pipe' });
        } catch (error) {
            logError('Local Docker database is not running. Please start it with: docker-compose up -d postgres');
            process.exit(1);
        }
        
        // Execute steps
        const schemaFile = await backupProductionSchema();
        await applySchemaToLocal(schemaFile);
        await createSuperuser();
        await populateRolesAndPermissions();
        await verifySetup();
        await backupAndRestoreData();
        
        console.log('\n🎉 Complete Local Database Setup Finished Successfully!');
        console.log('='.repeat(60));
        console.log('🌐 Your local database now has:');
        console.log('   ✅ Exact production schema (all tables, indexes, constraints)');
        console.log('   ✅ Complete RBAC system (roles, permissions, mappings)');
        console.log('   ✅ Admin superuser account');
        console.log('   ✅ All METRC sync tables');
        console.log('   ✅ All CRM tables');
        console.log('   ✅ All audit log tables');
        console.log('');
        console.log('🔑 Login Credentials:');
        console.log('   Username: admin');
        console.log('   Email: admin@greenreleaf.com');
        console.log('   Password: admin123');
        console.log('');
        console.log('🚀 Start your development server:');
        console.log('   npm run dev');
        console.log('');
        console.log('📊 Access admin panel:');
        console.log('   http://localhost:3000/admin');
        
    } catch (error) {
        logError(`Setup failed: ${error.message}`);
        console.error(error);
        process.exit(1);
    } finally {
        // Clean up database connections
        await localPool.end();
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = { main };
