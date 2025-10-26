#!/usr/bin/env node

/**
 * Production Sync Test Script
 * 
 * Tests METRC sync functionality against production RDS database
 * Ensures schemas are consistent and sync works properly
 */

const { Pool } = require('pg');
const path = require('path');
const metrcAuth = require('../../Server/Services/metrcAuth');

// Load production environment variables first
require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });

// Production database configuration (after loading env vars)
const PROD_DB_CONFIG = {
    user: process.env.DB_USER || 'master',
    host: process.env.DB_HOST || 'n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com',
    database: process.env.DB_DATABASE || 'postgres',
    password: process.env.DB_PASSWORD || 'GreenReleaf123!',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

const pool = new Pool(PROD_DB_CONFIG);

// Logging function
function logFun(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    
    const logTypes = {
        'STEP': '🚀',
        'INFO': '📊',
        'AUTH': '🔐',
        'FETCH': '📥',
        'DONE': '✅',
        'FAIL': '❌',
        'WARN': '⚠️',
        'DEBUG': '🐛',
        'DB': '🗄️'
    };
    
    const emoji = logTypes[type] || '📝';
    console.log(`[${timestamp}] ${type}: ${emoji} ${message}`);
}

/**
 * Test database connection
 */
async function testDatabaseConnection() {
    try {
        logFun('Testing production database connection...', 'DB');
        
        const client = await pool.connect();
        const result = await client.query('SELECT NOW() as current_time, version() as postgres_version');
        
        logFun(`✅ Connected to production database`, 'DB');
        logFun(`   Database: ${PROD_DB_CONFIG.database}`, 'DB');
        logFun(`   Host: ${PROD_DB_CONFIG.host}`, 'DB');
        logFun(`   PostgreSQL Version: ${result.rows[0].postgres_version}`, 'DB');
        logFun(`   Current Time: ${result.rows[0].current_time}`, 'DB');
        
        client.release();
        return true;
    } catch (error) {
        logFun(`❌ Database connection failed: ${error.message}`, 'FAIL');
        return false;
    }
}

/**
 * Check if required tables exist
 */
async function checkRequiredTables() {
    try {
        logFun('Checking required METRC tables in production database...', 'DB');
        
        const client = await pool.connect();
        
        const requiredTables = [
            'activepackages',
            'activeoutgoingtransfers', 
            'strains',
            'items',
            'transferredpackages',
            'intransitpackages'
        ];
        
        const missingTables = [];
        
        for (const tableName of requiredTables) {
            const result = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = $1
                );
            `, [tableName]);
            
            if (!result.rows[0].exists) {
                missingTables.push(tableName);
                logFun(`❌ Missing table: ${tableName}`, 'FAIL');
            } else {
                logFun(`✅ Table exists: ${tableName}`, 'DB');
            }
        }
        
        client.release();
        
        if (missingTables.length > 0) {
            logFun(`❌ Missing tables: ${missingTables.join(', ')}`, 'FAIL');
            logFun('Please run the production-schema-consistency.sql script first', 'WARN');
            return false;
        }
        
        logFun('✅ All required tables exist', 'DONE');
        return true;
        
    } catch (error) {
        logFun(`❌ Error checking tables: ${error.message}`, 'FAIL');
        return false;
    }
}

/**
 * Test METRC authentication
 */
async function testMetrcAuthentication() {
    try {
        logFun('Testing METRC authentication...', 'AUTH');
        logFun(`T3_USERNAME: ${process.env.T3_USERNAME}`, 'DEBUG');
        logFun(`T3_PASSWORD: ${process.env.T3_PASSWORD ? '***SET***' : 'NOT SET'}`, 'DEBUG');
        logFun(`T3_HOSTNAME: ${process.env.T3_HOSTNAME}`, 'DEBUG');
        
        const token = await metrcAuth.ensureValidToken();
        
        if (token) {
            logFun('✅ METRC authentication successful', 'AUTH');
            return true;
        } else {
            logFun('❌ METRC authentication failed', 'FAIL');
            return false;
        }
    } catch (error) {
        logFun(`❌ METRC authentication error: ${error.message}`, 'FAIL');
        return false;
    }
}

/**
 * Test a simple sync operation
 */
async function testSimpleSync() {
    try {
        logFun('Testing simple sync operation (strains)...', 'SYNC');
        
        // Import the strains sync script
        const { syncStrains } = require('../../scripts/sync/sync-strains');
        
        // Run the sync
        const result = await syncStrains();
        
        if (result.success) {
            logFun('✅ Simple sync test successful', 'DONE');
            logFun(`   Records processed: ${result.upserts || 0}`, 'INFO');
            return true;
        } else {
            logFun('❌ Simple sync test failed', 'FAIL');
            return false;
        }
    } catch (error) {
        logFun(`❌ Sync test error: ${error.message}`, 'FAIL');
        return false;
    }
}

/**
 * Check schema consistency
 */
async function checkSchemaConsistency() {
    try {
        logFun('Checking schema consistency...', 'DB');
        
        const client = await pool.connect();
        
        // Check activepackages table structure
        const result = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'activepackages' 
            AND table_schema = 'public'
            ORDER BY ordinal_position;
        `);
        
        logFun(`✅ Active packages table has ${result.rows.length} columns`, 'DB');
        
        // Check for key columns
        const keyColumns = ['metrcid', 'label', 'lastmodified', 'sync_license'];
        const existingColumns = result.rows.map(row => row.column_name);
        
        for (const column of keyColumns) {
            if (existingColumns.includes(column)) {
                logFun(`✅ Key column exists: ${column}`, 'DB');
            } else {
                logFun(`❌ Missing key column: ${column}`, 'FAIL');
                return false;
            }
        }
        
        client.release();
        logFun('✅ Schema consistency check passed', 'DONE');
        return true;
        
    } catch (error) {
        logFun(`❌ Schema consistency check failed: ${error.message}`, 'FAIL');
        return false;
    }
}

/**
 * Main test function
 */
async function runProductionTests() {
    logFun('🚀 STARTING PRODUCTION SYNC TESTS 🚀', 'STEP');
    
    const tests = [
        { name: 'Database Connection', fn: testDatabaseConnection },
        { name: 'Required Tables', fn: checkRequiredTables },
        { name: 'Schema Consistency', fn: checkSchemaConsistency },
        { name: 'METRC Authentication', fn: testMetrcAuthentication },
        { name: 'Simple Sync Test', fn: testSimpleSync }
    ];
    
    let passedTests = 0;
    let totalTests = tests.length;
    
    for (const test of tests) {
        logFun(`\n--- Running ${test.name} Test ---`, 'STEP');
        
        try {
            const result = await test.fn();
            if (result) {
                passedTests++;
                logFun(`✅ ${test.name} test PASSED`, 'DONE');
            } else {
                logFun(`❌ ${test.name} test FAILED`, 'FAIL');
            }
        } catch (error) {
            logFun(`❌ ${test.name} test ERROR: ${error.message}`, 'FAIL');
        }
    }
    
    logFun('\n📊 PRODUCTION TEST RESULTS:', 'INFO');
    logFun(`   Passed: ${passedTests}/${totalTests}`, 'INFO');
    logFun(`   Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`, 'INFO');
    
    if (passedTests === totalTests) {
        logFun('🎉 ALL PRODUCTION TESTS PASSED!', 'DONE');
        logFun('✅ Production environment is ready for sync operations', 'DONE');
    } else {
        logFun('❌ SOME TESTS FAILED', 'FAIL');
        logFun('Please fix the issues before running production sync', 'WARN');
    }
    
    return passedTests === totalTests;
}

// Main execution
async function main() {
    try {
        logFun('=== PRODUCTION SYNC TEST SCRIPT ===', 'STEP');
        logFun(`Environment: ${process.env.NODE_ENV || 'production'}`, 'INFO');
        logFun(`Database: ${process.env.DB_DATABASE || 'postgres'}`, 'INFO');
        logFun(`Host: ${process.env.DB_HOST || 'n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com'}`, 'INFO');
        
        const success = await runProductionTests();
        
        if (success) {
            logFun('✅ Production tests completed successfully', 'DONE');
            process.exit(0);
        } else {
            logFun('❌ Production tests failed', 'FAIL');
            process.exit(1);
        }
        
    } catch (error) {
        logFun(`❌ Test script failed: ${error.message}`, 'FAIL');
        process.exit(1);
    } finally {
        await pool.end();
        logFun('Database connection closed.', 'INFO');
    }
}

// Run if this script is executed directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { runProductionTests };
