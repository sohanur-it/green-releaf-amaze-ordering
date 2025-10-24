#!/usr/bin/env node

/**
 * Setup Sync Failure Tracking Table
 * Creates the table and initial records for tracking sync failures
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

async function setupFailureTracking() {
    const pool = new Pool(DB_CONFIG);
    const client = await pool.connect();
    
    try {
        console.log('🔧 Setting up sync failure tracking table...');
        
        // Create table
        await client.query(`
            CREATE TABLE IF NOT EXISTS sync_failure_tracking (
                id SERIAL PRIMARY KEY,
                script_name VARCHAR(255) NOT NULL,
                license_number VARCHAR(50) NOT NULL,
                consecutive_failures INTEGER NOT NULL DEFAULT 0,
                last_failure_time TIMESTAMP WITH TIME ZONE,
                last_success_time TIMESTAMP WITH TIME ZONE,
                last_error_message TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                
                -- Ensure one record per script per license
                UNIQUE(script_name, license_number)
            )
        `);
        console.log('✅ Created sync_failure_tracking table');

        // Create indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_sync_failure_tracking_script ON sync_failure_tracking(script_name)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_sync_failure_tracking_license ON sync_failure_tracking(license_number)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_sync_failure_tracking_failures ON sync_failure_tracking(consecutive_failures)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_sync_failure_tracking_last_failure ON sync_failure_tracking(last_failure_time)
        `);
        console.log('✅ Created indexes');

        // Create trigger function
        await client.query(`
            CREATE OR REPLACE FUNCTION update_sync_failure_tracking_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);

        // Create trigger
        await client.query(`
            DROP TRIGGER IF EXISTS update_sync_failure_tracking_updated_at ON sync_failure_tracking
        `);
        await client.query(`
            CREATE TRIGGER update_sync_failure_tracking_updated_at
                BEFORE UPDATE ON sync_failure_tracking
                FOR EACH ROW
                EXECUTE FUNCTION update_sync_failure_tracking_updated_at()
        `);
        console.log('✅ Created trigger');

        // Insert initial tracking records
        const scripts = [
            'sync-outgoing-transfers',
            'sync-active-packages', 
            'sync-transferred-packages',
            'sync-intransit-packages',
            'sync-items',
            'sync-strains'
        ];

        for (const script of scripts) {
            await client.query(`
                INSERT INTO sync_failure_tracking (script_name, license_number, consecutive_failures)
                VALUES ($1, 'CUL000063', 0)
                ON CONFLICT (script_name, license_number) DO NOTHING
            `, [script]);
        }
        console.log('✅ Inserted initial tracking records');

        // Verify setup
        const result = await client.query(`
            SELECT COUNT(*) as count FROM sync_failure_tracking
        `);
        console.log(`✅ Setup complete. Tracking ${result.rows[0].count} sync scripts.`);

    } catch (error) {
        console.error('❌ Error setting up failure tracking:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the setup
setupFailureTracking()
    .then(() => {
        console.log('🎉 Sync failure tracking setup completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Sync failure tracking setup failed:', error.message);
        process.exit(1);
    });
