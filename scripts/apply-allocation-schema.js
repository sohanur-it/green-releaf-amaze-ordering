#!/usr/bin/env node

/**
 * Apply Allocation Schema
 * 
 * This script creates the order_items table and related structures
 * for Module 4 preview allocation functionality.
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

async function applyAllocationSchema() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Applying allocation schema...');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 Database: ${process.env.DB_DATABASE || 'green_releaf_dev'}`);
        
        // Read the SQL file
        const sqlPath = path.join(__dirname, '../docker/postgres/init/09-create-order-items.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        await client.query('BEGIN');
        
        // Execute the SQL
        await client.query(sql);
        
        await client.query('COMMIT');
        
        console.log('✅ Allocation schema applied successfully!');
        console.log('   ✓ order_items table created');
        console.log('   ✓ Indexes created');
        console.log('   ✓ Permissions granted');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('💥 Failed to apply schema:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    applyAllocationSchema()
        .then(() => {
            console.log('\n🎉 Done!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Migration failed:', error.message);
            process.exit(1);
        });
}

module.exports = { applyAllocationSchema };

