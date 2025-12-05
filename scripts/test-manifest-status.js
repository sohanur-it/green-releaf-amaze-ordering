/**
 * Test script to check manifest status for invoice 221
 * Usage: 
 *   - Development: node scripts/test-manifest-status.js
 *   - Production: NODE_ENV=production node scripts/test-manifest-status.js
 */

// Load environment variables based on NODE_ENV
const nodeEnv = process.env.NODE_ENV || 'development';
if (nodeEnv === 'production') {
    require('dotenv').config({ path: './config/production.env' });
    console.log('📦 Using PRODUCTION environment');
} else {
    require('dotenv').config({ path: './config/local.env' });
    console.log('🔧 Using DEVELOPMENT environment');
}

const { query, pool } = require('../Server/config/database');
const manifestStatusService = require('../Server/Services/manifestStatusService');

async function testManifestStatus() {
    const client = await pool.connect();
    
    try {
        console.log('📋 Testing Manifest Status for Invoice 221\n');
        
        // Get invoice data
        const invoice = await client.query(`
            SELECT 
                id,
                invoice_number,
                metrc_manifest_numbers,
                manifest_metrc_ids,
                status
            FROM "ORDERS-invoices"
            WHERE id = 221
        `);
        
        if (invoice.rows.length === 0) {
            console.log('❌ Invoice 221 not found');
            return;
        }
        
        const inv = invoice.rows[0];
        console.log(`Invoice: ${inv.invoice_number}`);
        console.log(`Status: ${inv.status}`);
        console.log(`Manifest Numbers:`, inv.metrc_manifest_numbers);
        console.log(`Manifest METRC IDs:`, inv.manifest_metrc_ids);
        console.log('');
        
        // Parse manifest numbers
        const manifestNumbers = Array.isArray(inv.metrc_manifest_numbers)
            ? inv.metrc_manifest_numbers
            : (inv.metrc_manifest_numbers ? JSON.parse(inv.metrc_manifest_numbers) : []);
        
        const manifestMetrcIds = Array.isArray(inv.manifest_metrc_ids)
            ? inv.manifest_metrc_ids
            : (inv.manifest_metrc_ids ? JSON.parse(inv.manifest_metrc_ids) : []);
        
        console.log(`Found ${manifestNumbers.length} manifest number(s):`, manifestNumbers);
        console.log(`Found ${manifestMetrcIds.length} METRC ID record(s):`, manifestMetrcIds);
        console.log('');
        
        // Check if METRC IDs are real or placeholder
        for (const manifestInfo of manifestMetrcIds) {
            if (manifestInfo.id && manifestInfo.id < 100000) {
                console.log(`⚠️  WARNING: Manifest ${manifestInfo.number} has METRC ID ${manifestInfo.id} which looks like a placeholder (random number < 100000)`);
            }
        }
        console.log('');
        
        // Test status check using the service
        console.log('🔍 Testing manifest status check...\n');
        const result = await manifestStatusService.getInvoiceManifestStatuses(221);
        
        console.log('Result:', JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

testManifestStatus()
    .then(() => {
        console.log('\n✅ Test complete');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });

