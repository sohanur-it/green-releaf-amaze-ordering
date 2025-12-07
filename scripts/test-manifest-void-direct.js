#!/usr/bin/env node
/**
 * Test METRC Manifest Void Directly
 * This script tests the manifest void endpoint directly with curl to diagnose timeout issues
 * 
 * Usage:
 *   node scripts/test-manifest-void-direct.js <invoice_id>
 *   NODE_ENV=production node scripts/test-manifest-void-direct.js <invoice_id>
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

async function testManifestVoid(invoiceId) {
    const client = await pool.connect();
    
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🔍 METRC Manifest Void Diagnostic Test');
        console.log('='.repeat(80));
        console.log(`Invoice ID: ${invoiceId}\n`);
        
        // Get invoice data
        const invoiceQuery = await client.query(`
            SELECT 
                i.id,
                i.invoice_number,
                i.status,
                i.manifest_metrc_ids
            FROM "ORDERS-invoices" i
            WHERE i.id = $1
        `, [invoiceId]);
        
        if (invoiceQuery.rows.length === 0) {
            throw new Error(`Invoice ${invoiceId} not found`);
        }
        
        const invoice = invoiceQuery.rows[0];
        
        console.log(`📋 Invoice Details:`);
        console.log(`   Invoice Number: ${invoice.invoice_number}`);
        console.log(`   Status: ${invoice.status}\n`);
        
        if (!invoice.manifest_metrc_ids || invoice.manifest_metrc_ids.length === 0) {
            throw new Error(`Invoice ${invoiceId} has no manifests. Cannot test void.`);
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
        
        // Get auth token
        console.log(`🔐 Getting METRC authentication token...`);
        const hasToken = await metrcAuth.ensureValidToken();
        
        if (!hasToken) {
            throw new Error('Failed to get METRC authentication token');
        }
        
        const token = metrcAuth.accessToken;
        if (!token) {
            throw new Error('Access token is null after authentication');
        }
        
        console.log(`✅ Token obtained\n`);
        
        // Generate curl command (matching METRC API format)
        const apiBaseUrl = process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
        const submitValue = process.env.METRC_SUBMIT_TRANSFERS !== 'false' ? 'true' : 'false';
        const payload = { id: parseInt(manifestMetrcId, 10) };
        const payloadJson = JSON.stringify(payload);
        
        console.log(`🧪 Testing METRC API void endpoint...`);
        console.log(`   Using submit=${submitValue}`);
        console.log(`   Timeout: 60 seconds\n`);
        
        console.log(`📋 Payload (matching METRC format):`);
        console.log(`   ${payloadJson}`);
        console.log(`   Manifest METRC ID: ${manifestMetrcId}\n`);
        
        // Test with different timeout values
        const timeouts = [30, 60, 90];
        
        for (const timeout of timeouts) {
            console.log(`\n${'─'.repeat(80)}`);
            console.log(`⏱️  Testing with ${timeout} second timeout...`);
            console.log(`${'─'.repeat(80)}\n`);
            
            // Format curl command matching METRC API documentation format
            // METRC void format: {"id":12345}
            const curlCommand = `curl -X POST "${apiBaseUrl}/transfers/void?licenseNumber=${license}&submit=${submitValue}" \\
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
            
            // Show the exact payload format
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
    console.error('Usage: node scripts/test-manifest-void-direct.js <invoice_id>');
    console.error('   or: NODE_ENV=production node scripts/test-manifest-void-direct.js <invoice_id>');
    process.exit(1);
}

testManifestVoid(parseInt(invoiceId, 10)).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

