#!/usr/bin/env node

/**
 * Reset all sync failure counts
 * This script resets consecutive_failures to 0 for all sync scripts
 * 
 * Usage: NODE_ENV=production node scripts/reset-sync-failures.js
 */

const path = require('path');
const { Pool } = require('pg');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const DB_CONFIG = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }
};

const pool = new Pool(DB_CONFIG);

const syncScripts = [
    'sync-active-packages',
    'sync-transferred-packages',
    'sync-intransit-packages',
    'sync-outgoing-transfers',
    'sync-items',
    'sync-strains',
    'sync-batches'
];

const licenseNumber = process.env.T3_LICENSE_NUMBER || 'CUL000063';

async function resetAllFailures() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🔄 Resetting failure counts for all sync scripts...\n');
        
        for (const scriptName of syncScripts) {
            await client.query(`
                INSERT INTO sync_failure_tracking (
                    script_name, license_number, consecutive_failures, 
                    created_at, updated_at
                ) VALUES ($1, $2, 0, NOW(), NOW())
                ON CONFLICT (script_name, license_number)
                DO UPDATE SET
                    consecutive_failures = 0,
                    updated_at = NOW()
            `, [scriptName, licenseNumber]);
            
            console.log(`✅ Reset failure count for ${scriptName}`);
        }
        
        await client.query('COMMIT');
        
        console.log('\n✅ All failure counts have been reset successfully!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error resetting failures:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the reset
resetAllFailures()
    .then(() => {
        console.log('\n✅ Reset complete. You can now run sync scripts.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Failed to reset failures:', error.message);
        process.exit(1);
    });

