/**
 * Run Migration 19: Add metrc_license_number to buyer_locations
 * This script runs the migration against the production database
 */

const { Pool } = require('pg');
const fs = require('fs');
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

async function runMigration() {
    console.log('🚀 Starting Migration 19: Add metrc_license_number to buyer_locations');
    console.log('📊 Environment: production');
    console.log('🏢 Database:', PROD_DB_CONFIG.host);
    console.log('📦 Database Name:', PROD_DB_CONFIG.database);
    
    const pool = new Pool(PROD_DB_CONFIG);
    const client = await pool.connect();
    
    try {
        console.log('✅ Connected to production RDS database');
        
        // Read the migration script
        const migrationScript = fs.readFileSync(
            path.join(__dirname, '../docker/postgres/init/19-add-metrc-license-to-buyer-locations.sql'), 
            'utf8'
        );
        
        console.log('📄 Executing migration script...');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // Execute the migration script
        await client.query(migrationScript);
        
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ Migration completed successfully!');
        
        // Verify the migration
        console.log('\n🔍 Verifying migration...');
        const verifyResult = await client.query(`
            SELECT 
                column_name, 
                data_type, 
                is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'ORDERS-buyer_locations' 
            AND column_name = 'metrc_license_number'
        `);
        
        if (verifyResult.rows.length > 0) {
            console.log('✅ Column verified:', verifyResult.rows[0]);
        } else {
            console.warn('⚠️  Column not found - migration may have failed');
        }
        
        // Check index
        const indexResult = await client.query(`
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename = 'ORDERS-buyer_locations' 
            AND indexname = 'idx_buyer_locations_metrc_license'
        `);
        
        if (indexResult.rows.length > 0) {
            console.log('✅ Index verified:', indexResult.rows[0].indexname);
        } else {
            console.warn('⚠️  Index not found');
        }
        
        console.log('\n🎉 Migration 19 completed successfully!');
        console.log('📝 The metrc_license_number column has been added to ORDERS-buyer_locations');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
        console.log('\n🔌 Database connection closed');
    }
}

// Run the migration
if (require.main === module) {
    runMigration().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { runMigration };



