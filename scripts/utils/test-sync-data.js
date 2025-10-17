#!/usr/bin/env node

const { Pool } = require('pg');
const path = require('path');

// Load production environment variables
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });

// Production database configuration
const PROD_DB_CONFIG = {
    host: process.env.DB_HOST || 'n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'postgres',
    user: process.env.DB_USER || 'master',
    password: process.env.DB_PASSWORD || 'GreenReleaf123!',
    ssl: {
        rejectUnauthorized: false
    },
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 30000
};

async function testSyncData() {
    console.log('🧪 Testing Production Sync Data');
    console.log('📊 Environment: production');
    console.log('🏢 Database:', PROD_DB_CONFIG.host);
    
    const pool = new Pool(PROD_DB_CONFIG);
    const client = await pool.connect();
    
    try {
        console.log('✅ Connected to production RDS database');
        
        // Test Active Packages
        console.log('\n📦 Active Packages:');
        const activeResult = await client.query(`
            SELECT COUNT(*) as count, 
                   MAX(lastmodified) as latest_sync,
                   MIN(lastmodified) as earliest_sync
            FROM activepackages 
            WHERE sync_license = 'CUL000063'
        `);
        console.log(`  - Total Records: ${activeResult.rows[0].count}`);
        console.log(`  - Latest Sync: ${activeResult.rows[0].latest_sync}`);
        console.log(`  - Earliest Sync: ${activeResult.rows[0].earliest_sync}`);
        
        // Test Outgoing Transfers
        console.log('\n🚚 Outgoing Transfers:');
        const outgoingResult = await client.query(`
            SELECT COUNT(*) as count, 
                   MAX(lastmodified) as latest_sync,
                   MIN(lastmodified) as earliest_sync
            FROM outgoingtransfers 
            WHERE sync_license = 'CUL000063'
        `);
        console.log(`  - Total Records: ${outgoingResult.rows[0].count}`);
        console.log(`  - Latest Sync: ${outgoingResult.rows[0].latest_sync}`);
        console.log(`  - Earliest Sync: ${outgoingResult.rows[0].earliest_sync}`);
        
        // Test Strains
        console.log('\n🌿 Strains:');
        const strainsResult = await client.query(`
            SELECT COUNT(*) as count, 
                   MAX(created_at) as latest_sync,
                   MIN(created_at) as earliest_sync
            FROM strains 
            WHERE sync_license = 'CUL000063'
        `);
        console.log(`  - Total Records: ${strainsResult.rows[0].count}`);
        console.log(`  - Latest Sync: ${strainsResult.rows[0].latest_sync}`);
        console.log(`  - Earliest Sync: ${strainsResult.rows[0].earliest_sync}`);
        
        // Test Items
        console.log('\n📋 Items:');
        const itemsResult = await client.query(`
            SELECT COUNT(*) as count, 
                   MAX(lastmodified) as latest_sync,
                   MIN(lastmodified) as earliest_sync
            FROM items 
            WHERE sync_license = 'CUL000063'
        `);
        console.log(`  - Total Records: ${itemsResult.rows[0].count}`);
        console.log(`  - Latest Sync: ${itemsResult.rows[0].latest_sync}`);
        console.log(`  - Earliest Sync: ${itemsResult.rows[0].earliest_sync}`);
        
        // Test Transferred Packages
        console.log('\n📦 Transferred Packages:');
        const transferredResult = await client.query(`
            SELECT COUNT(*) as count, 
                   MAX(retrieved_at) as latest_sync,
                   MIN(retrieved_at) as earliest_sync
            FROM transferredpackages 
            WHERE sync_license = 'CUL000063'
        `);
        console.log(`  - Total Records: ${transferredResult.rows[0].count}`);
        console.log(`  - Latest Sync: ${transferredResult.rows[0].latest_sync}`);
        console.log(`  - Earliest Sync: ${transferredResult.rows[0].earliest_sync}`);
        
        // Test In-Transit Packages
        console.log('\n🚛 In-Transit Packages:');
        const intransitResult = await client.query(`
            SELECT COUNT(*) as count, 
                   MAX(lastmodified) as latest_sync,
                   MIN(lastmodified) as earliest_sync
            FROM intransitpackages 
            WHERE sync_license = 'CUL000063'
        `);
        console.log(`  - Total Records: ${intransitResult.rows[0].count}`);
        console.log(`  - Latest Sync: ${intransitResult.rows[0].latest_sync}`);
        console.log(`  - Earliest Sync: ${intransitResult.rows[0].earliest_sync}`);
        
        console.log('\n✅ Sync data test completed successfully!');
        
    } catch (error) {
        console.error('❌ Error testing sync data:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the sync data test
testSyncData()
    .then(() => {
        console.log('✅ Sync data testing completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Sync data testing failed:', error.message);
        process.exit(1);
    });
