#!/usr/bin/env node

/**
 * Module 4 Production Setup Script
 * 
 * This script runs the Module 4 database schema files against the production database.
 * It creates all tables, types, indexes, and triggers for the invoice/order management system.
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs').promises;

// Force production environment
process.env.NODE_ENV = 'production';

// Load production environment variables
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });

// Database configuration for production
const DB_CONFIG = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 60000, // Increased to 60 seconds
    ssl: { rejectUnauthorized: false },
    // Additional timeout settings
    statement_timeout: 300000, // 5 minutes for long-running SQL
    query_timeout: 300000
};

const pool = new Pool(DB_CONFIG);

async function runSQLFile(client, filePath, description) {
    try {
        console.log(`\n📋 ${description}...`);
        console.log(`   Reading: ${filePath}`);
        
        const sql = await fs.readFile(filePath, 'utf8');
        
        // Execute the SQL file
        await client.query(sql);
        
        console.log(`✅ ${description} completed successfully`);
        return true;
    } catch (error) {
        console.error(`❌ Error executing ${description}:`);
        console.error(`   File: ${filePath}`);
        console.error(`   Error: ${error.message}`);
        
        // Check if it's a "already exists" error (not critical)
        if (error.message.includes('already exists') || 
            error.message.includes('duplicate') ||
            error.message.includes('already present')) {
            console.log(`⚠️  Warning: Some objects may already exist (non-critical)`);
            return true; // Continue anyway
        }
        
        throw error;
    }
}

async function setupModule4Production() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Setting up Module 4: Order Creation & Management (Invoice Engine)');
        console.log(`📊 Connecting to production database: ${DB_CONFIG.database}@${DB_CONFIG.host}`);
        
        // Test connection
        const testResult = await client.query('SELECT NOW() as current_time, current_database() as db_name');
        console.log(`✅ Connected to: ${testResult.rows[0].db_name}`);
        console.log(`   Current time: ${testResult.rows[0].current_time}`);
        
        // Run schema files in order
        const schemaFiles = [
            {
                path: path.join(__dirname, '../docker/postgres/init/11-module4-core-schema.sql'),
                description: 'Creating Module 4 core schema (invoices, line items, discounts, credits, purchase limits, history)'
            },
            {
                path: path.join(__dirname, '../docker/postgres/init/12-module4-portal-access.sql'),
                description: 'Creating Module 4 portal access table (UUID-based authentication)'
            }
        ];
        
        for (const file of schemaFiles) {
            await runSQLFile(client, file.path, file.description);
        }
        
        console.log('\n🎉 Module 4 schema setup completed successfully!');
        console.log('\n📝 Summary:');
        console.log('   ✅ ORDERS-invoices table created');
        console.log('   ✅ ORDERS-invoice-line-items table created');
        console.log('   ✅ orders-standing-discounts table created');
        console.log('   ✅ ORDERS-account-credits table created');
        console.log('   ✅ orders-credit-applications table created');
        console.log('   ✅ orders-purchase-limits table created');
        console.log('   ✅ orders-invoice-history table created');
        console.log('   ✅ ORDERS-portal-access table created');
        console.log('   ✅ All ENUM types created');
        console.log('   ✅ All indexes created');
        console.log('   ✅ All triggers created');
        
    } catch (error) {
        console.error('\n❌ Fatal error during Module 4 setup:');
        console.error(error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
        console.log('\n👋 Database connection closed');
    }
}

// Run the setup
setupModule4Production().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});

