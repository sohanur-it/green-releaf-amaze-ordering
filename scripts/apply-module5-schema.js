#!/usr/bin/env node

/**
 * Migration Script: Apply Module 5 Fulfillment Schema
 * 
 * Creates all tables, columns, and indexes for Module 5 (Fulfillment & Manifesting)
 * 
 * Run with: 
 *   node scripts/apply-module5-schema.js
 * 
 * For production:
 *   NODE_ENV=production node scripts/apply-module5-schema.js
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// Load environment variables based on NODE_ENV
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const isDevelopment = process.env.NODE_ENV !== 'production';

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    ...(isDevelopment ? {} : {
        ssl: { rejectUnauthorized: false }
    })
});

async function applyModule5Schema() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Applying Module 5 Fulfillment Schema...');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 Database: ${process.env.DB_DATABASE || 'green_releaf_dev'}`);
        console.log('');
        
        // Read the SQL file
        const sqlPath = path.join(__dirname, '../docker/postgres/init/15-module5-fulfillment-schema.sql');
        
        if (!fs.existsSync(sqlPath)) {
            throw new Error(`SQL file not found: ${sqlPath}`);
        }
        
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        // Check what already exists
        console.log('🔍 Checking existing schema...');
        
        const tablesCheck = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN (
                'ORDERS-scanning-sessions',
                'ORDERS-cancelled-shipment-packages',
                'ORDERS-manifest-packages'
            )
            ORDER BY table_name;
        `);
        
        if (tablesCheck.rows.length > 0) {
            console.log(`⚠️  Found ${tablesCheck.rows.length} existing table(s):`);
            tablesCheck.rows.forEach(row => {
                console.log(`   - ${row.table_name}`);
            });
            console.log('   (Migration will skip existing objects)');
        }
        
        // Check for invoice columns
        const columnsCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'ORDERS-invoices'
            AND column_name IN (
                'voided_manifest_number',
                'metrc_manifest_numbers',
                'transportation_details',
                'inventory_finalized'
            )
            ORDER BY column_name;
        `);
        
        if (columnsCheck.rows.length > 0) {
            console.log(`⚠️  Found ${columnsCheck.rows.length} existing column(s) on ORDERS-invoices:`);
            columnsCheck.rows.forEach(row => {
                console.log(`   - ${row.column_name}`);
            });
        }
        
        console.log('');
        console.log('📝 Executing migration SQL...');
        
        await client.query('BEGIN');
        
        // Execute the SQL
        await client.query(sql);
        
        await client.query('COMMIT');
        
        console.log('');
        console.log('✅ Module 5 schema applied successfully!');
        console.log('');
        console.log('   ✓ Invoice status enum extended');
        console.log('   ✓ Invoice table extended with Module 5 fields');
        console.log('   ✓ Scanning sessions table created');
        console.log('   ✓ Cancelled shipment packages table created');
        console.log('   ✓ Manifest packages table created');
        console.log('   ✓ Indexes created');
        console.log('   ✓ Modification types extended');
        console.log('');
        
        // Verify tables were created
        const verifyTables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN (
                'ORDERS-scanning-sessions',
                'ORDERS-cancelled-shipment-packages',
                'ORDERS-manifest-packages'
            )
            ORDER BY table_name;
        `);
        
        if (verifyTables.rows.length === 3) {
            console.log('✅ All Module 5 tables verified:');
            verifyTables.rows.forEach(row => {
                console.log(`   ✓ ${row.table_name}`);
            });
        } else {
            console.log(`⚠️  Warning: Expected 3 tables, found ${verifyTables.rows.length}`);
        }
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('');
        console.error('❌ Failed to apply Module 5 schema:', error.message);
        console.error('');
        if (error.stack) {
            console.error('Stack trace:');
            console.error(error.stack);
        }
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    applyModule5Schema()
        .then(() => {
            console.log('');
            console.log('🎉 Migration completed successfully!');
            console.log('');
            process.exit(0);
        })
        .catch((error) => {
            console.error('');
            console.error('💥 Migration failed:', error.message);
            console.error('');
            process.exit(1);
        });
}

module.exports = { applyModule5Schema };

