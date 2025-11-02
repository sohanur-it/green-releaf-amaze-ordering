/**
 * Script to check buyer locations in the database
 * Usage: node scripts/check-buyer-locations.js [production]
 * 
 * Without arguments: checks local database
 * With 'production': checks production database
 */

const path = require('path');
const { Pool } = require('pg');

// Determine which environment to use
const isProduction = process.argv[2] === 'production' || process.argv[2] === 'prod';

if (isProduction) {
    console.log('🌐 Connecting to PRODUCTION database...\n');
    require('dotenv').config({ path: 'config/production.env' });
} else {
    console.log('💻 Connecting to LOCAL database...\n');
    require('dotenv').config({ path: 'config/local.env' });
}

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || process.env.DB_NAME || 'metrc',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    connectionTimeoutMillis: 30000,
    ...(isProduction ? {
        ssl: {
            rejectUnauthorized: false
        }
    } : {})
});

async function checkBuyerLocations() {
    try {
        console.log('Checking buyer locations in database...\n');

        // Check total count
        const countResult = await pool.query(`
            SELECT COUNT(*) as total 
            FROM "ORDERS-buyer_locations"
        `);
        console.log(`Total locations in database: ${countResult.rows[0].total}\n`);

        // Get all locations with buyer info
        const locationsResult = await pool.query(`
            SELECT 
                l.entry_id,
                l.name as location_name,
                l.line_one,
                l.line_two,
                l.city,
                l.state,
                l.zip,
                l.state_license,
                b.entry_id as buyer_id,
                b.name as buyer_name
            FROM "ORDERS-buyer_locations" l
            INNER JOIN "ORDERS-buyers" b ON l.orders_buyer_id = b.entry_id
            ORDER BY b.name, l.name
            LIMIT 50
        `);

        if (locationsResult.rows.length === 0) {
            console.log('❌ No buyer locations found in database!');
            console.log('\nYou need to add locations through the CRM system:');
            console.log('1. Go to /admin/crm');
            console.log('2. Click on a buyer');
            console.log('3. Add locations to that buyer');
        } else {
            console.log(`✅ Found ${locationsResult.rows.length} location(s):\n`);
            locationsResult.rows.forEach((loc, index) => {
                console.log(`${index + 1}. ${loc.buyer_name} -> ${loc.location_name}`);
                console.log(`   Address: ${loc.line_one || 'N/A'} ${loc.line_two || ''}`);
                console.log(`   City/State/Zip: ${loc.city || 'N/A'}, ${loc.state || 'N/A'} ${loc.zip || 'N/A'}`);
                console.log(`   License: ${loc.state_license || 'N/A'}`);
                console.log(`   Location ID: ${loc.entry_id}, Buyer ID: ${loc.buyer_id}\n`);
            });
        }

        // Check buyers without locations
        const buyersWithoutLocations = await pool.query(`
            SELECT 
                b.entry_id,
                b.name
            FROM "ORDERS-buyers" b
            LEFT JOIN "ORDERS-buyer_locations" l ON b.entry_id = l.orders_buyer_id
            WHERE l.entry_id IS NULL
            ORDER BY b.name
            LIMIT 20
        `);

        if (buyersWithoutLocations.rows.length > 0) {
            console.log(`\n⚠️  ${buyersWithoutLocations.rows.length} buyer(s) without locations:`);
            buyersWithoutLocations.rows.forEach(buyer => {
                console.log(`   - ${buyer.name} (ID: ${buyer.entry_id})`);
            });
        }

        // Check portal access links and their locations
        console.log('\n--- Portal Access Links ---');
        const portalAccess = await pool.query(`
            SELECT 
                pa.id,
                pa.access_uuid,
                pa.fk_buyer_id,
                pa.fk_location_id,
                pa.is_active,
                b.name as buyer_name,
                l.name as location_name
            FROM "ORDERS-portal-access" pa
            INNER JOIN "ORDERS-buyers" b ON pa.fk_buyer_id = b.entry_id
            LEFT JOIN "ORDERS-buyer_locations" l ON pa.fk_location_id = l.entry_id
            ORDER BY pa.created_at DESC
            LIMIT 10
        `);

        if (portalAccess.rows.length === 0) {
            console.log('No portal access links found.');
        } else {
            console.log(`Found ${portalAccess.rows.length} portal access link(s):\n`);
            portalAccess.rows.forEach(pa => {
                console.log(`UUID: ${pa.access_uuid}`);
                console.log(`Buyer: ${pa.buyer_name} (ID: ${pa.fk_buyer_id})`);
                console.log(`Location: ${pa.location_name || '❌ NOT FOUND'} (ID: ${pa.fk_location_id})`);
                console.log(`Active: ${pa.is_active ? 'Yes' : 'No'}\n`);
            });
        }

    } catch (error) {
        console.error('Error checking buyer locations:', error);
    } finally {
        await pool.end();
    }
}

checkBuyerLocations();

