#!/usr/bin/env node

/**
 * Module 4 Schema Verification Script
 * 
 * This script verifies that all Module 4 tables were created successfully in production.
 */

const { Pool } = require('pg');
const path = require('path');

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
    connectionTimeoutMillis: 60000,
    ssl: { rejectUnauthorized: false }
};

const pool = new Pool(DB_CONFIG);

async function verifyModule4Schema() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Verifying Module 4 Schema in Production...');
        console.log(`📊 Database: ${DB_CONFIG.database}@${DB_CONFIG.host}\n`);
        
        // List of tables that should exist
        const expectedTables = [
            'ORDERS-invoices',
            'ORDERS-invoice-line-items',
            'orders-standing-discounts',
            'ORDERS-account-credits',
            'orders-credit-applications',
            'orders-purchase-limits',
            'orders-invoice-history',
            'ORDERS-portal-access'
        ];
        
        const results = await client.query(`
            SELECT table_name, 
                   (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
            FROM information_schema.tables t
            WHERE table_schema = 'public' 
            AND table_name IN ($1, $2, $3, $4, $5, $6, $7, $8)
            ORDER BY table_name
        `, expectedTables);
        
        const foundTables = results.rows.map(r => r.table_name);
        const missingTables = expectedTables.filter(t => !foundTables.includes(t));
        
        if (missingTables.length === 0) {
            console.log('✅ All Module 4 tables created successfully!\n');
            results.rows.forEach(row => {
                console.log(`   ✅ ${row.table_name} (${row.column_count} columns)`);
            });
        } else {
            console.log('❌ Some tables are missing!\n');
            console.log('Found:');
            foundTables.forEach(t => console.log(`   ✅ ${t}`));
            console.log('\nMissing:');
            missingTables.forEach(t => console.log(`   ❌ ${t}`));
        }
        
        // Check ENUM types
        console.log('\n📋 Checking ENUM types...');
        const enumTypes = await client.query(`
            SELECT typname, 
                   (SELECT COUNT(*) FROM pg_enum WHERE enumtypid = t.oid) as enum_count
            FROM pg_type t
            WHERE t.typtype = 'e'
            AND typname IN ('invoice_status', 'invoice_source', 'discount_type', 'modification_type')
            ORDER BY typname
        `);
        
        if (enumTypes.rows.length > 0) {
            enumTypes.rows.forEach(row => {
                console.log(`   ✅ ${row.typname} (${row.enum_count} values)`);
            });
        } else {
            console.log('   ❌ No ENUM types found');
        }
        
        // Check indexes
        console.log('\n📋 Checking indexes...');
        const indexes = await client.query(`
            SELECT indexname, tablename
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND (indexname LIKE '%invoice%' OR indexname LIKE '%credit%' OR indexname LIKE '%portal%')
            ORDER BY tablename, indexname
            LIMIT 20
        `);
        
        console.log(`   Found ${indexes.rows.length} Module 4 related indexes`);
        if (indexes.rows.length > 0) {
            indexes.rows.slice(0, 5).forEach(row => {
                console.log(`   ✅ ${row.indexname} on ${row.tablename}`);
            });
            if (indexes.rows.length > 5) {
                console.log(`   ... and ${indexes.rows.length - 5} more`);
            }
        }
        
        // Check triggers
        console.log('\n📋 Checking triggers...');
        const triggers = await client.query(`
            SELECT trigger_name, event_object_table
            FROM information_schema.triggers
            WHERE trigger_schema = 'public'
            AND event_object_table IN ($1, $2, $3, $4, $5, $6, $7, $8)
            ORDER BY event_object_table, trigger_name
        `, expectedTables);
        
        console.log(`   Found ${triggers.rows.length} triggers`);
        if (triggers.rows.length > 0) {
            triggers.rows.forEach(row => {
                console.log(`   ✅ ${row.trigger_name} on ${row.event_object_table}`);
            });
        }
        
        console.log('\n🎉 Verification complete!');
        
    } catch (error) {
        console.error('\n❌ Error during verification:');
        console.error(error.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run verification
verifyModule4Schema().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});

