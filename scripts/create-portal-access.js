#!/usr/bin/env node

/**
 * Create Portal Access for Testing
 * Generates UUID access tokens for external buyer portal
 */

const { Pool } = require('pg');
const path = require('path');

// Force production environment
process.env.NODE_ENV = 'production';

// Load production environment variables
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });

const DB_CONFIG = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 60000,
    ssl: { rejectUnauthorized: false }
};

const pool = new Pool(DB_CONFIG);

async function createPortalAccess() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Checking existing buyers...');
        
        // First, get buyers
        const buyers = await client.query(`
            SELECT entry_id, name 
            FROM "ORDERS-buyers" 
            LIMIT 5
        `);
        
        if (buyers.rows.length === 0) {
            console.log('❌ No buyers found. Please add buyers first through the CRM.');
            process.exit(1);
        }
        
        console.log('\nAvailable Buyers:');
        buyers.rows.forEach((buyer, idx) => {
            console.log(`   ${idx + 1}. ${buyer.name} (ID: ${buyer.entry_id})`);
        });
        
        // For now, use the first buyer
        const buyer = buyers.rows[0];
        
        console.log(`\n📝 Creating portal access for: ${buyer.name}`);
        
        // Check if portal access already exists for this buyer
        const existing = await client.query(`
            SELECT access_uuid, fk_location_id, is_active
            FROM "ORDERS-portal-access"
            WHERE fk_buyer_id = $1
            LIMIT 1
        `, [buyer.entry_id]);
        
        if (existing.rows.length > 0) {
            console.log('\n✅ Portal access already exists:');
            console.log(`   UUID: ${existing.rows[0].access_uuid}`);
            console.log(`   Active: ${existing.rows[0].is_active}`);
            
            const testUrl = `http://localhost:3000/external/store/${existing.rows[0].access_uuid}`;
            console.log(`   Test URL: ${testUrl}`);
            console.log('\n💡 To use in production, replace localhost with your domain.');
        } else {
            // Create new portal access
            const result = await client.query(`
                INSERT INTO "ORDERS-portal-access" (
                    fk_buyer_id,
                    fk_location_id,
                    is_active,
                    created_by
                ) VALUES ($1, $1, true, 1)
                RETURNING access_uuid
            `, [buyer.entry_id]);
            
            console.log('\n✅ Portal access created successfully!');
            console.log(`   UUID: ${result.rows[0].access_uuid}`);
            
            const testUrl = `http://localhost:3000/external/store/${result.rows[0].access_uuid}`;
            console.log(`   Test URL: ${testUrl}`);
            console.log('\n💡 To use in production, replace localhost with your domain.');
        }
        
    } catch (error) {
        console.error('\n❌ Error creating portal access:');
        console.error(error.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

createPortalAccess().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});

