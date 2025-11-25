#!/usr/bin/env node

/**
 * Migration Script: Add fulfillment_issue_modification flag to line items
 *
 * This script adds the fulfillment_issue_modification column to ORDERS-invoice-line-items
 * to track modifications made during Fulfillment_Issue status.
 *
 * Run with: node scripts/apply-fulfillment-issue-modification-flag.js
 * For production: NODE_ENV=production node scripts/apply-fulfillment-issue-modification-flag.js
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// Load environment variables
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

async function applyFulfillmentIssueModificationFlag() {
    const client = await pool.connect();

    try {
        console.log('🚀 Adding fulfillment_issue_modification flag to line items...');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 Database: ${process.env.DB_DATABASE || 'green_releaf_dev'}`);

        // Read the SQL file
        const sqlPath = path.join(__dirname, '../docker/postgres/init/16-add-fulfillment-issue-modification-flag.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        await client.query('BEGIN');

        // Execute the SQL
        console.log('📝 Executing migration SQL...');
        await client.query(sql);

        await client.query('COMMIT');

        console.log('✅ Fulfillment issue modification flag added successfully!');

        // Verification
        const checkColumn = await client.query(`
            SELECT column_name, data_type, column_default
            FROM information_schema.columns
            WHERE table_name = 'ORDERS-invoice-line-items' 
            AND column_name = 'fulfillment_issue_modification'
        `);
        
        if (checkColumn.rows.length > 0) {
            console.log(`   ✓ Column 'fulfillment_issue_modification' exists`);
            console.log(`   ✓ Type: ${checkColumn.rows[0].data_type}`);
            console.log(`   ✓ Default: ${checkColumn.rows[0].column_default}`);
        } else {
            console.warn(`   ❌ Column 'fulfillment_issue_modification' does NOT exist.`);
        }

        const checkIndex = await client.query(`
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename = 'ORDERS-invoice-line-items' 
            AND indexname = 'idx_line_items_fulfillment_issue_mod'
        `);
        
        if (checkIndex.rows.length > 0) {
            console.log(`   ✓ Index 'idx_line_items_fulfillment_issue_mod' exists`);
        } else {
            console.warn(`   ❌ Index 'idx_line_items_fulfillment_issue_mod' does NOT exist.`);
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('💥 Failed to add fulfillment issue modification flag:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    applyFulfillmentIssueModificationFlag()
        .then(() => {
            console.log('\n🎉 Done!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Migration failed:', error.message);
            process.exit(1);
        });
}

module.exports = { applyFulfillmentIssueModificationFlag };

