#!/usr/bin/env node
/**
 * Test manifest update with direct curl command
 * Generates and executes curl command to test METRC API directly
 * 
 * Usage: NODE_ENV=production node scripts/test-manifest-update-curl.js <invoiceId>
 */

const path = require('path');
const { pool } = require('../Server/config/database');
const { execSync } = require('child_process');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const metrcAuth = require('../Server/Services/metrcAuth');
const manifestVoidingService = require('../Server/Services/manifestVoidingService');

const INVOICE_ID = process.argv[2] || '241';

async function testManifestUpdateWithCurl(invoiceId) {
    const client = await pool.connect();
    
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🔍 Testing Manifest Update with Direct CURL');
        console.log('='.repeat(80));
        console.log(`Invoice ID: ${invoiceId}\n`);
        
        // Get invoice data
        const invoiceQuery = await client.query(`
            SELECT 
                i.id,
                i.invoice_number,
                i.status,
                i.transportation_details,
                i.manifest_metrc_ids
            FROM "ORDERS-invoices" i
            WHERE i.id = $1
        `, [invoiceId]);
        
        if (invoiceQuery.rows.length === 0) {
            throw new Error(`Invoice ${invoiceId} not found`);
        }
        
        const invoice = invoiceQuery.rows[0];
        
        if (!invoice.manifest_metrc_ids || invoice.manifest_metrc_ids.length === 0) {
            throw new Error(`Invoice ${invoiceId} has no manifests`);
        }
        
        const manifestIds = Array.isArray(invoice.manifest_metrc_ids)
            ? invoice.manifest_metrc_ids
            : JSON.parse(invoice.manifest_metrc_ids || '[]');
        
        if (manifestIds.length === 0) {
            throw new Error(`No manifest METRC IDs found`);
        }
        
        const firstManifest = manifestIds[0];
        const license = firstManifest.license || process.env.T3_LICENSE_NUMBER;
        const manifestMetrcId = firstManifest.id;
        
        console.log(`📦 Manifest Details:`);
        console.log(`   Manifest Number: ${firstManifest.number}`);
        console.log(`   Manifest METRC ID: ${manifestMetrcId}`);
        console.log(`   License: ${license}\n`);
        
        // Get current manifest data
        console.log(`📡 Fetching current manifest data from METRC...`);
        const currentManifest = await manifestVoidingService.getCurrentManifestData(manifestMetrcId, license);
        
        if (!currentManifest) {
            throw new Error('Could not fetch current manifest data from METRC');
        }
        
        console.log(`✅ Fetched current manifest data\n`);
        
        // Build update payload
        console.log(`🔨 Building update payload...`);
        const updates = {
            driverName: 'john doe (Updated)',
            driverLicense: 'DS00900',
            driverOccupationalLicense: 'URT-SRW-EWR',
            vehicleMake: 'LLM',
            vehicleModel: 'VI-OP',
            vehiclePlate: 'TS-276',
            estimatedDeparture: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            estimatedArrival: new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString()
        };
        
        const payload = await manifestVoidingService.buildManifestUpdatePayload(
            manifestMetrcId,
            license,
            currentManifest,
            updates
        );
        
        console.log(`✅ Payload built\n`);
        
        // Get access token
        console.log(`🔐 Getting access token...`);
        await metrcAuth.ensureValidToken();
        const accessToken = metrcAuth.accessToken;
        
        if (!accessToken) {
            throw new Error('Failed to get access token');
        }
        
        console.log(`✅ Access token obtained\n`);
        
        // Build curl command
        const apiBaseUrl = metrcAuth.apiBaseUrl || 'https://api.trackandtrace.tools/v2';
        const url = `${apiBaseUrl}/transfers/update?licenseNumber=${encodeURIComponent(license)}&submit=true`;
        const payloadJson = JSON.stringify(payload);
        
        // Escape the payload for curl
        const escapedPayload = payloadJson.replace(/'/g, "'\\''");
        
        console.log('='.repeat(80));
        console.log('📋 CURL COMMAND:');
        console.log('='.repeat(80));
        console.log(`curl -X POST "${url}" \\`);
        console.log(`  -H "accept: application/json" \\`);
        console.log(`  -H "Authorization: Bearer ${accessToken}" \\`);
        console.log(`  -H "Content-Type: application/json" \\`);
        console.log(`  -d '${payloadJson}'`);
        console.log('='.repeat(80));
        console.log('\n');
        
        // Ask user if they want to execute
        console.log('⚠️  This will update the manifest in METRC!');
        console.log('   Press Ctrl+C to cancel, or wait 5 seconds to execute...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Execute curl command
        console.log('🚀 Executing curl command...\n');
        
        try {
            const curlCommand = `curl -X POST "${url}" \\
  -H "accept: application/json" \\
  -H "Authorization: Bearer ${accessToken}" \\
  -H "Content-Type: application/json" \\
  -d '${payloadJson}' \\
  --max-time 120 \\
  --connect-timeout 30 \\
  -v`;
            
            console.log('Executing:', curlCommand.replace(accessToken, 'TOKEN_HIDDEN'));
            console.log('\n');
            
            const result = execSync(curlCommand, {
                encoding: 'utf8',
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                timeout: 120000 // 120 seconds
            });
            
            console.log('✅ CURL SUCCESS!');
            console.log('\n📦 Response:');
            console.log(result);
            
        } catch (error) {
            console.error('❌ CURL FAILED!');
            console.error('\nError:', error.message);
            if (error.stdout) {
                console.error('\nStdout:', error.stdout);
            }
            if (error.stderr) {
                console.error('\nStderr:', error.stderr);
            }
            throw error;
        }
        
    } catch (error) {
        console.error('\n' + '='.repeat(80));
        console.error('❌ Test failed!');
        console.error('='.repeat(80));
        console.error('Error:', error.message);
        if (error.stack) {
            console.error('\nStack:', error.stack);
        }
        process.exit(1);
    } finally {
        client.release();
    }
}

// Run the test
testManifestUpdateWithCurl(INVOICE_ID).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

