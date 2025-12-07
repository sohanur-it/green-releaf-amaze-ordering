#!/usr/bin/env node
/**
 * Test METRC Manifest Update Directly
 * This script tests the manifest update endpoint directly with curl to diagnose timeout issues
 * 
 * Usage:
 *   node scripts/test-manifest-update-direct.js <invoice_id>
 *   NODE_ENV=production node scripts/test-manifest-update-direct.js <invoice_id>
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

async function testManifestUpdate(invoiceId) {
    const client = await pool.connect();
    
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🔍 METRC Manifest Update Diagnostic Test');
        console.log('='.repeat(80));
        console.log(`Invoice ID: ${invoiceId}\n`);
        
        // Get invoice data
        const invoiceQuery = await client.query(`
            SELECT 
                i.id,
                i.invoice_number,
                i.status,
                i.transportation_details,
                i.manifest_metrc_ids,
                i.location_license_number,
                bl.state_license
            FROM "ORDERS-invoices" i
            LEFT JOIN "ORDERS-buyer_locations" bl ON i.fk_location_id = bl.entry_id
            WHERE i.id = $1
        `, [invoiceId]);
        
        if (invoiceQuery.rows.length === 0) {
            throw new Error(`Invoice ${invoiceId} not found`);
        }
        
        const invoice = invoiceQuery.rows[0];
        
        console.log(`📋 Invoice Details:`);
        console.log(`   Invoice Number: ${invoice.invoice_number}`);
        console.log(`   Status: ${invoice.status}`);
        console.log(`   Has Transportation Details: ${!!invoice.transportation_details}`);
        console.log(`   Has Manifest METRC IDs: ${!!invoice.manifest_metrc_ids}\n`);
        
        if (!invoice.manifest_metrc_ids || invoice.manifest_metrc_ids.length === 0) {
            throw new Error(`Invoice ${invoiceId} has no manifests. Cannot test update.`);
        }
        
        const manifestIds = Array.isArray(invoice.manifest_metrc_ids)
            ? invoice.manifest_metrc_ids
            : JSON.parse(invoice.manifest_metrc_ids || '[]');
        
        if (manifestIds.length === 0) {
            throw new Error(`No manifest METRC IDs found for invoice ${invoiceId}`);
        }
        
        const firstManifest = manifestIds[0];
        const license = firstManifest.license || process.env.T3_LICENSE_NUMBER;
        const manifestMetrcId = firstManifest.id;
        
        console.log(`📦 Manifest Details:`);
        console.log(`   Manifest Number: ${firstManifest.number}`);
        console.log(`   Manifest METRC ID: ${manifestMetrcId}`);
        console.log(`   License: ${license}\n`);
        
        // Get transportation details
        const transportationDetails = invoice.transportation_details 
            ? (typeof invoice.transportation_details === 'string' 
                ? JSON.parse(invoice.transportation_details) 
                : invoice.transportation_details)
            : {};
        
        console.log(`🚚 Transportation Details:`);
        console.log(`   Recipient ID: ${transportationDetails.recipientId || 'NOT SET'}`);
        console.log(`   Transporter ID: ${transportationDetails.transporterId || 'NOT SET'}`);
        console.log(`   Driver Name: ${transportationDetails.driverName || 'NOT SET'}`);
        console.log(`   Vehicle: ${transportationDetails.vehicleMake || ''} ${transportationDetails.vehicleModel || ''}\n`);
        
        if (!transportationDetails.recipientId || !transportationDetails.transporterId) {
            console.log(`⚠️  WARNING: Missing required IDs for update test\n`);
        }
        
        // Get current manifest data from METRC
        console.log(`📡 Step 1: Fetching current manifest data from METRC...`);
        console.log(`   This may take a while if METRC is slow...\n`);
        
        const startTime = Date.now();
        let currentManifest;
        
        try {
            currentManifest = await manifestVoidingService.getCurrentManifestData(manifestMetrcId, license);
            const fetchTime = Date.now() - startTime;
            console.log(`✅ Fetched manifest data in ${fetchTime}ms`);
            
            if (!currentManifest) {
                throw new Error('Could not retrieve current manifest data from METRC');
            }
            
            console.log(`   Manifest Status: ${currentManifest.status || 'N/A'}`);
            console.log(`   Planned Route: ${currentManifest.plannedRoute || 'N/A'}`);
            console.log(`   Packages Count: ${currentManifest.packages?.length || 0}\n`);
        } catch (error) {
            const fetchTime = Date.now() - startTime;
            console.log(`❌ Failed to fetch manifest data after ${fetchTime}ms`);
            console.log(`   Error: ${error.message}\n`);
            throw error;
        }
        
        // Build update payload with minimal changes (just update driver name for testing)
        console.log(`📝 Step 2: Building update payload...`);
        const testUpdates = {
            driverName: transportationDetails.driverName || 'Test Driver Update'
        };
        
        const payload = await manifestVoidingService.buildManifestUpdatePayload(
            manifestMetrcId, 
            license, 
            currentManifest, 
            testUpdates
        );
        
        console.log(`✅ Payload built`);
        console.log(`   Payload size: ${JSON.stringify(payload).length} bytes`);
        console.log(`   Destinations: ${payload[0]?.destinations?.length || 0}`);
        console.log(`   Packages: ${payload[0]?.destinations?.[0]?.packages?.length || 0}\n`);
        
        // Validate payload structure matches METRC format
        const destination = payload[0]?.destinations?.[0];
        if (destination) {
            console.log(`📋 Payload Validation:`);
            console.log(`   ✅ Has id: ${!!payload[0]?.id}`);
            console.log(`   ✅ Has destinations array: ${!!payload[0]?.destinations}`);
            console.log(`   ✅ Has recipientId: ${!!destination.recipientId} (${destination.recipientId || 'MISSING'})`);
            console.log(`   ✅ Has transporterId: ${!!destination.transporters?.[0]?.transporterId} (${destination.transporters?.[0]?.transporterId || 'MISSING'})`);
            console.log(`   ✅ Has packages: ${destination.packages?.length || 0} package(s)`);
            console.log(`   ✅ Has transferTypeId: ${destination.transferTypeId || 'MISSING'}`);
            console.log(`   ✅ Has invoiceNumber: ${destination.invoiceNumber || 'MISSING'}`);
            console.log(`   ✅ Has grossWeight: ${destination.grossWeight || 'MISSING'}`);
            console.log(`   ✅ Has grossUnitOfWeightId: ${destination.grossUnitOfWeightId || 'MISSING'}\n`);
            
            if (!destination.recipientId || !destination.transporters?.[0]?.transporterId) {
                console.log(`⚠️  WARNING: Missing required fields!`);
                if (!destination.recipientId) {
                    console.log(`   - recipientId is REQUIRED by METRC API`);
                }
                if (!destination.transporters?.[0]?.transporterId) {
                    console.log(`   - transporterId is REQUIRED by METRC API`);
                }
                console.log(`   Update will likely fail validation.\n`);
            }
        }
        
        // Get auth token
        console.log(`🔐 Step 3: Getting METRC authentication token...`);
        const hasToken = await metrcAuth.ensureValidToken();
        
        if (!hasToken) {
            throw new Error('Failed to get METRC authentication token');
        }
        
        const token = metrcAuth.accessToken;
        if (!token) {
            throw new Error('Access token is null after authentication');
        }
        
        console.log(`✅ Token obtained\n`);
        
        // Generate curl command
        const apiBaseUrl = process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
        const submitValue = process.env.METRC_SUBMIT_TRANSFERS !== 'false' ? 'true' : 'false';
        const payloadJson = JSON.stringify(payload);
        
        console.log(`🧪 Step 4: Testing METRC API update endpoint...`);
        console.log(`   Using submit=${submitValue}`);
        console.log(`   Timeout: 60 seconds\n`);
        
        // Test with different timeout values
        const timeouts = [30, 60, 90];
        
        for (const timeout of timeouts) {
            console.log(`\n${'─'.repeat(80)}`);
            console.log(`⏱️  Testing with ${timeout} second timeout...`);
            console.log(`${'─'.repeat(80)}\n`);
            
            // Format curl command matching METRC API documentation format
            const escapedPayload = payloadJson.replace(/'/g, "'\\''").replace(/"/g, '\\"');
            
            const curlCommand = `curl -X POST "${apiBaseUrl}/transfers/update?licenseNumber=${license}&submit=${submitValue}" \\
  -H "accept: application/json" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${token}" \\
  --max-time ${timeout} \\
  --connect-timeout 10 \\
  -w "\\n\\nHTTP Status: %{http_code}\\nTime Total: %{time_total}s\\nTime Connect: %{time_connect}s\\nTime Start Transfer: %{time_starttransfer}s\\n" \\
  -d '${payloadJson.replace(/'/g, "'\\''")}'`;
            
            console.log(`📋 Curl Command (matching METRC API format):`);
            console.log(curlCommand);
            console.log(`\n`);
            
            // Also show the payload structure for verification
            console.log(`📦 Payload Structure:`);
            console.log(JSON.stringify(payload, null, 2));
            console.log(`\n`);
            
            const requestStart = Date.now();
            try {
                const output = execSync(curlCommand, { 
                    encoding: 'utf8',
                    timeout: (timeout + 10) * 1000, // Add 10 seconds buffer
                    maxBuffer: 10 * 1024 * 1024 // 10MB buffer
                });
                const requestTime = Date.now() - requestStart;
                
                console.log(`✅ SUCCESS with ${timeout}s timeout!`);
                console.log(`   Request completed in ${requestTime}ms`);
                console.log(`\n📥 Response:`);
                console.log(output);
                console.log(`\n`);
                
                // Try to parse response
                try {
                    const lines = output.split('\n');
                    const jsonStart = lines.findIndex(line => line.trim().startsWith('{'));
                    if (jsonStart >= 0) {
                        const jsonResponse = lines.slice(jsonStart).join('\n');
                        const parsed = JSON.parse(jsonResponse);
                        console.log(`📊 Parsed Response:`);
                        console.log(JSON.stringify(parsed, null, 2));
                    }
                } catch (parseError) {
                    console.log(`⚠️  Could not parse response as JSON`);
                }
                
                // If successful, no need to test other timeouts
                break;
                
            } catch (error) {
                const requestTime = Date.now() - requestStart;
                console.log(`❌ FAILED with ${timeout}s timeout`);
                console.log(`   Request failed after ${requestTime}ms`);
                console.log(`   Error: ${error.message}`);
                
                if (error.stdout) {
                    console.log(`\n📥 Response (stdout):`);
                    console.log(error.stdout);
                }
                
                if (error.stderr) {
                    console.log(`\n📥 Error (stderr):`);
                    console.log(error.stderr);
                }
                
                // Check if it's a timeout
                if (error.message.includes('timeout') || error.message.includes('504') || requestTime >= timeout * 1000) {
                    console.log(`\n⚠️  This appears to be a timeout issue. METRC API is taking longer than ${timeout} seconds.`);
                    if (timeout < 90) {
                        console.log(`   Will try with longer timeout...\n`);
                    } else {
                        console.log(`   Maximum timeout reached. METRC API may be experiencing issues.\n`);
                    }
                } else {
                    console.log(`\n⚠️  This is not a timeout - it's a different error.`);
                    console.log(`   Check the response above for details.\n`);
                    break; // Don't retry for non-timeout errors
                }
            }
        }
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 Diagnostic Summary:`);
        console.log(`${'='.repeat(80)}`);
        console.log(`   Invoice ID: ${invoiceId}`);
        console.log(`   Manifest METRC ID: ${manifestMetrcId}`);
        console.log(`   License: ${license}`);
        console.log(`   Recipient ID: ${transportationDetails.recipientId || 'MISSING'}`);
        console.log(`   Transporter ID: ${transportationDetails.transporterId || 'MISSING'}`);
        console.log(`   Packages in payload: ${payload[0]?.destinations?.[0]?.packages?.length || 0}`);
        console.log(`   Payload size: ${JSON.stringify(payload).length} bytes`);
        console.log(`\n`);
        
    } catch (error) {
        console.error(`\n❌ Error: ${error.message}\n`);
        console.error(`Stack:`, error.stack);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

// Get invoice ID from command line
const invoiceId = process.argv[2];

if (!invoiceId) {
    console.error('Usage: node scripts/test-manifest-update-direct.js <invoice_id>');
    console.error('   or: NODE_ENV=production node scripts/test-manifest-update-direct.js <invoice_id>');
    process.exit(1);
}

testManifestUpdate(parseInt(invoiceId, 10)).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

