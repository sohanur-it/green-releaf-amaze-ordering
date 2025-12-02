#!/usr/bin/env node

/**
 * Migration Script: Add zone column to ORDERS-buyers table
 *
 * This script adds the zone column to ORDERS-buyers table
 * to track geographic zone or territory assignment for buyers.
 *
 * Run with: node scripts/apply-zone-to-buyers.js
 * For production: NODE_ENV=production node scripts/apply-zone-to-buyers.js
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

async function applyZoneToBuyers() {
    const client = await pool.connect();

    try {
        console.log('🚀 Adding zone column to ORDERS-buyers table...');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 Database: ${process.env.DB_DATABASE || 'green_releaf_dev'}`);
        console.log(`🔗 Host: ${process.env.DB_HOST || 'localhost'}`);

        // Check if column already exists
        const checkColumn = await client.query(`
            SELECT column_name, data_type, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'ORDERS-buyers' 
            AND column_name = 'zone'
        `);

        if (checkColumn.rows.length > 0) {
            console.log('⚠️  Column "zone" already exists in ORDERS-buyers table');
            console.log(`   Type: ${checkColumn.rows[0].data_type}`);
            console.log(`   Max Length: ${checkColumn.rows[0].character_maximum_length || 'N/A'}`);
            console.log('   Skipping migration (safe to run multiple times)');
            return;
        }

        // Read the SQL file
        const sqlPath = path.join(__dirname, '../docker/postgres/init/17-add-zone-to-buyers.sql');
        
        if (!fs.existsSync(sqlPath)) {
            throw new Error(`SQL file not found: ${sqlPath}`);
        }

        const sql = fs.readFileSync(sqlPath, 'utf8');

        await client.query('BEGIN');

        // Execute the SQL
        console.log('📝 Executing migration SQL...');
        await client.query(sql);

        await client.query('COMMIT');

        console.log('✅ Zone column added successfully!');

        // Verification
        const verifyColumn = await client.query(`
            SELECT column_name, data_type, character_maximum_length, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'ORDERS-buyers' 
            AND column_name = 'zone'
        `);
        
        if (verifyColumn.rows.length > 0) {
            const col = verifyColumn.rows[0];
            console.log('\n📋 Verification Results:');
            console.log(`   ✓ Column 'zone' exists`);
            console.log(`   ✓ Type: ${col.data_type}(${col.character_maximum_length || 'N/A'})`);
            console.log(`   ✓ Nullable: ${col.is_nullable}`);
        } else {
            console.warn('\n   ❌ Column "zone" does NOT exist after migration.');
        }

        // Check for comment
        const checkComment = await client.query(`
            SELECT obj_description(
                (SELECT oid FROM pg_class WHERE relname = 'ORDERS-buyers'),
                'pg_class'
            ) as table_comment,
            col_description(
                (SELECT oid FROM pg_class WHERE relname = 'ORDERS-buyers'),
                (SELECT attnum FROM pg_attribute 
                 WHERE attrelid = (SELECT oid FROM pg_class WHERE relname = 'ORDERS-buyers')
                 AND attname = 'zone')
            ) as column_comment
        `);

        if (checkComment.rows[0]?.column_comment) {
            console.log(`   ✓ Column comment: ${checkComment.rows[0].column_comment}`);
        }

        // Count existing buyers
        const buyerCount = await client.query(`
            SELECT COUNT(*) as count FROM "ORDERS-buyers"
        `);
        console.log(`\n📊 Existing buyers: ${buyerCount.rows[0].count}`);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n💥 Failed to add zone column:', error.message);
        console.error('   Error code:', error.code);
        console.error('   Error detail:', error.detail);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    applyZoneToBuyers()
        .then(() => {
            console.log('\n🎉 Migration completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Migration failed:', error.message);
            if (error.stack) {
                console.error('\nStack trace:');
                console.error(error.stack);
            }
            process.exit(1);
        });
}

module.exports = { applyZoneToBuyers };


