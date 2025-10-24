#!/usr/bin/env node

/**
 * Rename outgoingtransfers table to activeoutgoingtransfers
 * and fix all references throughout the codebase
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

// Database configuration
const dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ...(process.env.NODE_ENV === 'production' ? {
        ssl: { rejectUnauthorized: false }
    } : {})
};

async function renameTableAndFixReferences() {
    console.log('🔄 Renaming outgoingtransfers table to activeoutgoingtransfers');
    console.log('📊 Environment:', process.env.NODE_ENV || 'development');
    console.log('🏢 Database:', dbConfig.host);
    
    const pool = new Pool(dbConfig);
    const client = await pool.connect();
    
    try {
        console.log('✅ Connected to database');
        
        // Step 1: Check if outgoingtransfers table exists
        console.log('\n🔍 Checking if outgoingtransfers table exists...');
        const tableExistsResult = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'outgoingtransfers'
            );
        `);
        
        if (!tableExistsResult.rows[0].exists) {
            console.log('❌ outgoingtransfers table does not exist. Nothing to rename.');
            return;
        }
        
        console.log('✅ outgoingtransfers table exists');
        
        // Step 2: Check if activeoutgoingtransfers already exists
        console.log('\n🔍 Checking if activeoutgoingtransfers table already exists...');
        const newTableExistsResult = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'activeoutgoingtransfers'
            );
        `);
        
        if (newTableExistsResult.rows[0].exists) {
            console.log('⚠️ activeoutgoingtransfers table already exists. Skipping rename.');
            return;
        }
        
        console.log('✅ activeoutgoingtransfers table does not exist. Proceeding with rename.');
        
        // Step 3: Rename the table
        console.log('\n🔄 Renaming table...');
        await client.query('ALTER TABLE outgoingtransfers RENAME TO activeoutgoingtransfers');
        console.log('✅ Table renamed successfully');
        
        // Step 4: Update indexes
        console.log('\n🔄 Updating indexes...');
        try {
            await client.query('ALTER INDEX idx_outgoingtransfers_lastmodified RENAME TO idx_activeoutgoingtransfers_lastmodified');
            console.log('✅ Renamed idx_outgoingtransfers_lastmodified');
        } catch (error) {
            console.log('ℹ️ Index idx_outgoingtransfers_lastmodified not found or already renamed');
        }
        
        try {
            await client.query('ALTER INDEX idx_outgoingtransfers_synclicense RENAME TO idx_activeoutgoingtransfers_synclicense');
            console.log('✅ Renamed idx_outgoingtransfers_synclicense');
        } catch (error) {
            console.log('ℹ️ Index idx_outgoingtransfers_synclicense not found or already renamed');
        }
        
        // Step 5: Update any foreign key constraints
        console.log('\n🔍 Checking for foreign key constraints...');
        const constraintsResult = await client.query(`
            SELECT 
                tc.constraint_name,
                tc.table_name,
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
            AND (tc.table_name = 'activeoutgoingtransfers' OR ccu.table_name = 'activeoutgoingtransfers')
        `);
        
        if (constraintsResult.rows.length > 0) {
            console.log('📋 Found foreign key constraints:');
            constraintsResult.rows.forEach(constraint => {
                console.log(`  - ${constraint.constraint_name}: ${constraint.table_name}.${constraint.column_name} -> ${constraint.foreign_table_name}.${constraint.foreign_column_name}`);
            });
        } else {
            console.log('ℹ️ No foreign key constraints found');
        }
        
        // Step 6: Verify the rename
        console.log('\n🔍 Verifying table rename...');
        const verifyResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('outgoingtransfers', 'activeoutgoingtransfers')
            ORDER BY table_name
        `);
        
        console.log('📋 Current tables:');
        verifyResult.rows.forEach(row => {
            console.log(`  - ${row.table_name}`);
        });
        
        // Step 7: Show column structure of renamed table
        console.log('\n📋 Active Outgoing Transfers Table Structure:');
        const columnsResult = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'activeoutgoingtransfers' 
            ORDER BY ordinal_position
        `);
        
        columnsResult.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type}`);
        });
        
        console.log('\n✅ Table rename completed successfully!');
        console.log('\n📝 Next steps:');
        console.log('1. Update manifestService.js with correct column names');
        console.log('2. Update sync scripts to use new table name');
        console.log('3. Update any other references in the codebase');
        
    } catch (error) {
        console.error('❌ Error renaming table:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the rename operation
renameTableAndFixReferences()
    .then(() => {
        console.log('\n🎉 Table rename operation completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Table rename operation failed:', error.message);
        process.exit(1);
    });
