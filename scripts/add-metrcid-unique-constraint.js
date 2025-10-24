#!/usr/bin/env node

/**
 * Add unique constraint on metrcid column for activeoutgoingtransfers table
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../config/production.env') });

const DB_CONFIG = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }
};

async function addUniqueConstraint() {
    const pool = new Pool(DB_CONFIG);
    const client = await pool.connect();
    
    try {
        console.log('🔧 Adding unique constraint on metrcid column...');
        
        // Check if constraint already exists
        const existingConstraint = await client.query(`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'activeoutgoingtransfers' 
            AND constraint_type = 'UNIQUE'
            AND constraint_name LIKE '%metrcid%'
        `);
        
        if (existingConstraint.rows.length > 0) {
            console.log('✅ Unique constraint on metrcid already exists');
            return;
        }
        
        // Add unique constraint
        await client.query(`
            ALTER TABLE activeoutgoingtransfers 
            ADD CONSTRAINT activeoutgoingtransfers_metrcid_unique UNIQUE (metrcid)
        `);
        
        console.log('✅ Unique constraint added on metrcid column');
        
    } catch (error) {
        console.error('❌ Error adding unique constraint:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the script
addUniqueConstraint()
    .then(() => {
        console.log('🎉 Unique constraint setup completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Unique constraint setup failed:', error.message);
        process.exit(1);
    });
