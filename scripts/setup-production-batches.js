#!/usr/bin/env node

/**
 * Setup Production Batches Table
 * 
 * Creates the batches table in production database
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

async function setupProductionBatches() {
    console.log('🚀 Setting up batches table in production database...');
    
    const pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT, 10) || 5432,
    });
    
    try {
        const client = await pool.connect();
        console.log('✅ Connected to production database');
        
        // Read the SQL file
        const sqlFile = path.join(__dirname, '../docker/postgres/init/05-create-batches-table.sql');
        const sql = fs.readFileSync(sqlFile, 'utf8');
        
        console.log('📄 Executing batches table creation SQL...');
        await client.query(sql);
        
        console.log('✅ Batches table created successfully in production database');
        
        // Verify the table was created
        const result = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name = 'batches'
        `);
        
        if (result.rows.length > 0) {
            console.log('✅ Verification: batches table exists');
        } else {
            console.log('❌ Verification failed: batches table not found');
        }
        
        client.release();
        
    } catch (error) {
        console.error('❌ Error setting up production batches table:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run the setup
if (require.main === module) {
    setupProductionBatches()
        .then(() => {
            console.log('🎯 Production batches setup completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Setup failed:', error.message);
            process.exit(1);
        });
}

module.exports = { setupProductionBatches };
