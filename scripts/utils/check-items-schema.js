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

async function checkItemsTableSchema() {
    console.log('🔍 Checking Production Items Table Schema');
    console.log('📊 Environment: production');
    console.log('🏢 Database:', PROD_DB_CONFIG.host);
    
    const pool = new Pool(PROD_DB_CONFIG);
    const client = await pool.connect();
    
    try {
        console.log('✅ Connected to production RDS database');
        
        // Check items table structure
        console.log('\n📋 Items Table Structure:');
        const itemsResult = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'items' 
            ORDER BY ordinal_position
        `);
        
        itemsResult.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type}`);
        });
        
    } catch (error) {
        console.error('❌ Error checking items table schema:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the schema check
checkItemsTableSchema()
    .then(() => {
        console.log('✅ Items table schema check completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Items table schema check failed:', error.message);
        process.exit(1);
    });
