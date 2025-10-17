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

async function listProductionTables() {
    console.log('📋 Listing All Production Database Tables');
    console.log('📊 Environment: production');
    console.log('🏢 Database:', PROD_DB_CONFIG.host);
    
    const pool = new Pool(PROD_DB_CONFIG);
    const client = await pool.connect();
    
    try {
        console.log('✅ Connected to production RDS database');
        
        // List all tables
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        
        console.log('\n📋 All Tables in Production Database:');
        tablesResult.rows.forEach(row => {
            console.log(`  - ${row.table_name}`);
        });
        
    } catch (error) {
        console.error('❌ Error listing production tables:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the table listing
listProductionTables()
    .then(() => {
        console.log('✅ Production table listing completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Production table listing failed:', error.message);
        process.exit(1);
    });
