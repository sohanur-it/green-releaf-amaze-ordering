#!/usr/bin/env node

/**
 * Migration: Add new invoice status values
 * 
 * Adds 'Manifest_Voided' and 'Voided' status values to invoice_status enum
 */

const path = require('path');
const { Pool } = require('pg');

// Load environment configuration
const envFile = process.env.NODE_ENV === 'production'
    ? path.join(__dirname, '../config/production.env')
    : path.join(__dirname, '../config/local.env');
require('dotenv').config({ path: envFile });

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

async function addStatusValues() {
    const client = await pool.connect();
    
    try {
        console.log('➕ Adding new invoice status values...');
        
        await client.query('BEGIN');
        
        // Add Manifest_Voided status
        try {
            await client.query(`
                ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Manifest_Voided'
            `);
            console.log('✅ Added Manifest_Voided status');
        } catch (error) {
            if (error.code === '42710' || error.message.includes('already exists')) {
                console.log('⚠️  Manifest_Voided status already exists');
            } else {
                throw error;
            }
        }
        
        // Add Voided status
        try {
            await client.query(`
                ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Voided'
            `);
            console.log('✅ Added Voided status');
        } catch (error) {
            if (error.code === '42710' || error.message.includes('already exists')) {
                console.log('⚠️  Voided status already exists');
            } else {
                throw error;
            }
        }
        
        await client.query('COMMIT');
        console.log('✅ All status values added successfully');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Failed to add status values:', error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

addStatusValues().catch((err) => {
    console.error('❌ Unexpected error:', err);
    process.exitCode = 1;
});

