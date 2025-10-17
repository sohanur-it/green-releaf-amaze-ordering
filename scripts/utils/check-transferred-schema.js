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

async function checkTransferredPackagesTableSchema() {
    console.log('🔍 Checking Production Transferred Packages Table Schema');
    console.log('📊 Environment: production');
    console.log('🏢 Database:', PROD_DB_CONFIG.host);
    
    const pool = new Pool(PROD_DB_CONFIG);
    const client = await pool.connect();
    
    try {
        console.log('✅ Connected to production RDS database');
        
        // Check transferredpackages table structure
        console.log('\n📋 Transferred Packages Table Structure:');
        const transferredResult = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'transferredpackages' 
            ORDER BY ordinal_position
        `);
        
        transferredResult.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type}`);
        });
        
    } catch (error) {
        console.error('❌ Error checking transferred packages table schema:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the schema check
checkTransferredPackagesTableSchema()
    .then(() => {
        console.log('✅ Transferred packages table schema check completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Transferred packages table schema check failed:', error.message);
        process.exit(1);
    });
