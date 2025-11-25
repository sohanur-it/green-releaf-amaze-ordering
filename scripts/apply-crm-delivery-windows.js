#!/usr/bin/env node

/**
 * Migration Script: Apply CRM Delivery Windows & Zones Schema
 * 
 * Adds delivery_zone column to buyer locations and creates delivery windows table
 * 
 * Run with: 
 *   node scripts/apply-crm-delivery-windows.js
 * 
 * For production:
 *   NODE_ENV=production node scripts/apply-crm-delivery-windows.js
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

async function applyCrmDeliveryWindowsSchema() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Applying CRM Delivery Windows & Zones Schema...');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 Database: ${process.env.DB_DATABASE || 'green_releaf_dev'}`);
        console.log('');
        
        // Read the SQL file
        const sqlPath = path.join(__dirname, '../docker/postgres/init/16-crm-delivery-windows.sql');
        
        if (!fs.existsSync(sqlPath)) {
            throw new Error(`SQL file not found: ${sqlPath}`);
        }
        
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        // Check what already exists
        console.log('🔍 Checking existing schema...');
        
        // Check for delivery_zone column
        const columnCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'ORDERS-buyer_locations'
            AND column_name = 'delivery_zone'
        `);
        
        if (columnCheck.rows.length > 0) {
            console.log('⚠️  Found existing delivery_zone column on ORDERS-buyer_locations');
        }
        
        // Check for delivery windows table
        const tableCheck = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'ORDERS-location_delivery_windows'
        `);
        
        if (tableCheck.rows.length > 0) {
            console.log('⚠️  Found existing ORDERS-location_delivery_windows table');
            console.log('   (Migration will skip existing objects)');
        }
        
        // Check for helper functions
        const functionCheck = await client.query(`
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_schema = 'public' 
            AND routine_name IN ('check_delivery_window', 'get_location_delivery_windows')
        `);
        
        if (functionCheck.rows.length > 0) {
            console.log(`⚠️  Found ${functionCheck.rows.length} existing function(s):`);
            functionCheck.rows.forEach(row => {
                console.log(`   - ${row.routine_name}`);
            });
        }
        
        console.log('');
        console.log('📝 Executing migration SQL...');
        
        await client.query('BEGIN');
        
        // Execute the SQL
        await client.query(sql);
        
        await client.query('COMMIT');
        
        console.log('');
        console.log('✅ CRM Delivery Windows schema applied successfully!');
        console.log('');
        console.log('   ✓ delivery_zone column added to ORDERS-buyer_locations');
        console.log('   ✓ ORDERS-location_delivery_windows table created');
        console.log('   ✓ Indexes created');
        console.log('   ✓ Helper functions created');
        console.log('');
        
        // Verify column was added
        const verifyColumn = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'ORDERS-buyer_locations'
            AND column_name = 'delivery_zone'
        `);
        
        if (verifyColumn.rows.length > 0) {
            console.log('✅ delivery_zone column verified:');
            console.log(`   ✓ Column: ${verifyColumn.rows[0].column_name} (${verifyColumn.rows[0].data_type})`);
        } else {
            console.log('⚠️  Warning: delivery_zone column not found after migration');
        }
        
        // Verify table was created
        const verifyTable = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'ORDERS-location_delivery_windows'
        `);
        
        if (verifyTable.rows.length > 0) {
            console.log('✅ ORDERS-location_delivery_windows table verified');
            
            // Check table structure
            const columns = await client.query(`
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns 
                WHERE table_name = 'ORDERS-location_delivery_windows'
                ORDER BY ordinal_position
            `);
            
            console.log('   Table columns:');
            columns.rows.forEach(col => {
                console.log(`     - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
            });
        } else {
            console.log('⚠️  Warning: ORDERS-location_delivery_windows table not found after migration');
        }
        
        // Verify functions
        const verifyFunctions = await client.query(`
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_schema = 'public' 
            AND routine_name IN ('check_delivery_window', 'get_location_delivery_windows')
            ORDER BY routine_name
        `);
        
        if (verifyFunctions.rows.length === 2) {
            console.log('✅ Helper functions verified:');
            verifyFunctions.rows.forEach(row => {
                console.log(`   ✓ ${row.routine_name}`);
            });
        } else {
            console.log(`⚠️  Warning: Expected 2 functions, found ${verifyFunctions.rows.length}`);
        }
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('');
        console.error('❌ Failed to apply CRM Delivery Windows schema:', error.message);
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
    applyCrmDeliveryWindowsSchema()
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

module.exports = { applyCrmDeliveryWindowsSchema };


