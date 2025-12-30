#!/usr/bin/env node

/**
 * Module 5 Schema Migrations Runner
 * 
 * This script applies all Module 5 schema improvements to the production database.
 * It reads database credentials from config/production.env and runs migrations in order.
 * 
 * Usage:
 *   node scripts/apply-module5-migrations.js
 * 
 * Or with explicit environment:
 *   NODE_ENV=production node scripts/apply-module5-migrations.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });

// Migration scripts in order
const MIGRATION_SCRIPTS = [
    {
        name: '1.1 Invoice Table Constraints',
        file: 'add-module5-invoice-constraints.sql',
        description: 'Adds CHECK constraints, ON DELETE clauses, and status transition validation'
    },
    {
        name: '1.2 Scanning Sessions Improvements',
        file: 'add-scanning-sessions-improvements.sql',
        description: 'Adds enum type, abandoned_at field, and archive table'
    },
    {
        name: '1.3 Cancelled Shipments Improvements',
        file: 'add-cancelled-shipments-improvements.sql',
        description: 'Adds enum type, archive table, and bulk validation'
    },
    {
        name: '1.4 Manifest Packages Improvements',
        file: 'add-manifest-packages-improvements.sql',
        description: 'Adds enum type, system_config table, archive table, and index'
    },
    {
        name: '1.5 Rejected Packages Improvements',
        file: 'add-rejected-packages-improvements.sql',
        description: 'Adds missing fields, foreign keys, and validation constraints'
    },
    {
        name: '4.1 Line Item Issue Tracking',
        file: 'add-line-item-issue-fields.sql',
        description: 'Adds fulfillment_issue_type, has_fulfillment_issue, and issue_photo_urls to line items'
    },
    {
        name: '4.5 Resolution Tracking',
        file: 'add-resolution-tracking-fields.sql',
        description: 'Adds resolved_at, resolved_by, and resolution_actions to invoices'
    },
    {
        name: '17.3.1 Allocation Timestamp Tracking',
        file: 'add-allocation-timestamp-field.sql',
        description: 'Adds allocated_at field to ORDERS-invoice-line-items for allocation timestamp tracking'
    },
    {
        name: '11.5 Security Audit Log Table',
        file: 'add-security-audit-table.sql',
        description: 'Creates security audit log table for tracking failed admin override attempts'
    },
    {
        name: '22.0 Performance Considerations - Database Indexes',
        file: 'add-module22-performance-indexes.sql',
        description: 'Adds critical performance indexes for fulfillment queue, package lookups, and session cleanup'
    }
];

// Database configuration from environment
const dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 30000,
    query_timeout: 300000 // 5 minutes for long-running migrations
};

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(message) {
    console.log('\n' + '='.repeat(80));
    log(message, 'bright');
    console.log('='.repeat(80) + '\n');
}

function logSuccess(message) {
    log(`✅ ${message}`, 'green');
}

function logError(message) {
    log(`❌ ${message}`, 'red');
}

function logWarning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
    log(`ℹ️  ${message}`, 'cyan');
}

/**
 * Read and execute SQL file
 */
async function executeSqlFile(pool, filePath, scriptName) {
    try {
        logInfo(`Reading SQL file: ${path.basename(filePath)}`);
        const sql = fs.readFileSync(filePath, 'utf8');
        
        if (!sql || sql.trim().length === 0) {
            throw new Error('SQL file is empty');
        }
        
        logInfo(`Executing ${scriptName}...`);
        const startTime = Date.now();
        
        // Execute the SQL
        await pool.query(sql);
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        logSuccess(`${scriptName} completed in ${duration}s`);
        
        return { success: true, duration };
    } catch (error) {
        // Check if it's a "already exists" type error (which is OK for idempotent migrations)
        if (error.message.includes('already exists') || 
            error.message.includes('duplicate_object') ||
            error.message.includes('duplicate key')) {
            logWarning(`${scriptName} - Some objects already exist (this is OK): ${error.message}`);
            return { success: true, duration: 0, skipped: true };
        }
        
        throw error;
    }
}

/**
 * Verify database connection
 */
async function verifyConnection(pool) {
    try {
        const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
        logSuccess(`Connected to database: ${dbConfig.database}@${dbConfig.host}:${dbConfig.port}`);
        logInfo(`PostgreSQL version: ${result.rows[0].pg_version.split(' ')[0]} ${result.rows[0].pg_version.split(' ')[1]}`);
        logInfo(`Current time: ${result.rows[0].current_time}`);
        return true;
    } catch (error) {
        logError(`Failed to connect to database: ${error.message}`);
        return false;
    }
}

/**
 * Check if migration script exists
 */
function checkMigrationFiles() {
    const missingFiles = [];
    const scriptsDir = path.join(__dirname);
    
    for (const migration of MIGRATION_SCRIPTS) {
        const filePath = path.join(scriptsDir, migration.file);
        if (!fs.existsSync(filePath)) {
            missingFiles.push(migration.file);
        }
    }
    
    if (missingFiles.length > 0) {
        logError(`Missing migration files:\n  - ${missingFiles.join('\n  - ')}`);
        return false;
    }
    
    logSuccess(`All ${MIGRATION_SCRIPTS.length} migration files found`);
    return true;
}

/**
 * Main migration runner
 */
async function runMigrations() {
    logSection('Module 5 Schema Migrations - Production Database');
    
    // Validate environment
    if (!dbConfig.host || !dbConfig.database || !dbConfig.user) {
        logError('Missing required database configuration in production.env');
        logInfo('Required: DB_HOST, DB_DATABASE, DB_USER, DB_PASSWORD');
        process.exit(1);
    }
    
    logInfo(`Target database: ${dbConfig.database}@${dbConfig.host}:${dbConfig.port}`);
    logInfo(`User: ${dbConfig.user}`);
    logWarning('This will modify the production database. Make sure you have a backup!');
    
    // Check migration files exist
    if (!checkMigrationFiles()) {
        process.exit(1);
    }
    
    // Create database connection pool
    const pool = new Pool(dbConfig);
    
    // Handle pool errors
    pool.on('error', (err) => {
        logError(`Unexpected database pool error: ${err.message}`);
    });
    
    try {
        // Verify connection
        const connected = await verifyConnection(pool);
        if (!connected) {
            process.exit(1);
        }
        
        // Ask for confirmation (in production, this is important)
        logWarning('\n⚠️  WARNING: You are about to apply migrations to PRODUCTION database!');
        logInfo('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Run migrations
        const results = [];
        const startTime = Date.now();
        
        for (let i = 0; i < MIGRATION_SCRIPTS.length; i++) {
            const migration = MIGRATION_SCRIPTS[i];
            logSection(`Migration ${i + 1}/${MIGRATION_SCRIPTS.length}: ${migration.name}`);
            logInfo(migration.description);
            
            const scriptPath = path.join(__dirname, migration.file);
            
            try {
                const result = await executeSqlFile(pool, scriptPath, migration.name);
                results.push({
                    name: migration.name,
                    success: true,
                    duration: result.duration,
                    skipped: result.skipped || false
                });
            } catch (error) {
                logError(`Migration failed: ${error.message}`);
                logError(`Stack: ${error.stack}`);
                results.push({
                    name: migration.name,
                    success: false,
                    error: error.message
                });
                
                // Ask if we should continue
                logWarning('\nMigration failed. Do you want to continue with remaining migrations?');
                logInfo('Press Ctrl+C to stop, or wait 3 seconds to continue...\n');
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
        
        // Summary
        const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
        logSection('Migration Summary');
        
        let successCount = 0;
        let failedCount = 0;
        let skippedCount = 0;
        
        for (const result of results) {
            if (result.success) {
                if (result.skipped) {
                    logWarning(`${result.name}: Skipped (already applied)`);
                    skippedCount++;
                } else {
                    logSuccess(`${result.name}: Completed (${result.duration}s)`);
                    successCount++;
                }
            } else {
                logError(`${result.name}: Failed - ${result.error}`);
                failedCount++;
            }
        }
        
        console.log('\n');
        logInfo(`Total time: ${totalDuration}s`);
        logSuccess(`Successful: ${successCount}`);
        logWarning(`Skipped: ${skippedCount}`);
        if (failedCount > 0) {
            logError(`Failed: ${failedCount}`);
        }
        
        if (failedCount === 0) {
            logSuccess('\n🎉 All migrations completed successfully!');
        } else {
            logError(`\n⚠️  ${failedCount} migration(s) failed. Please review the errors above.`);
            process.exit(1);
        }
        
    } catch (error) {
        logError(`Fatal error: ${error.message}`);
        logError(`Stack: ${error.stack}`);
        process.exit(1);
    } finally {
        // Close pool
        await pool.end();
        logInfo('Database connection closed');
    }
}

// Run migrations
if (require.main === module) {
    runMigrations().catch(error => {
        logError(`Unhandled error: ${error.message}`);
        process.exit(1);
    });
}

module.exports = { runMigrations, MIGRATION_SCRIPTS };


