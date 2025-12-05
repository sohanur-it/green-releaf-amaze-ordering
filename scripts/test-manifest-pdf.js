#!/usr/bin/env node

/**
 * Test Manifest PDF Retrieval
 * 
 * Tests the METRC API endpoint for retrieving manifest PDFs
 */

const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const { pool } = require('../Server/config/database');
const metrcAuth = require('../Server/Services/metrcAuth');

async function testManifestPDF() {
    console.log('🧪 Testing Manifest PDF Retrieval');
    console.log('='.repeat(60));
    
    const client = await pool.connect();
    
    try {
        // Find an invoice with a real manifest number
        const invoiceQuery = await client.query(`
            SELECT 
                i.id,
                i.invoice_number,
                i.metrc_manifest_numbers,
                i.manifest_metrc_ids,
                i.location_license_number
            FROM "ORDERS-invoices" i
            WHERE i.metrc_manifest_numbers IS NOT NULL
                AND jsonb_array_length(i.metrc_manifest_numbers::jsonb) > 0
                AND i.status = 'Manifested'
            ORDER BY i.id DESC
            LIMIT 1
        `);
        
        if (invoiceQuery.rows.length === 0) {
            console.error('❌ No manifested invoice found');
            return;
        }
        
        const invoice = invoiceQuery.rows[0];
        console.log(`\n✅ Found invoice: ${invoice.invoice_number} (ID: ${invoice.id})`);
        
        // Parse manifest numbers
        const manifestNumbers = Array.isArray(invoice.metrc_manifest_numbers)
            ? invoice.metrc_manifest_numbers
            : JSON.parse(invoice.metrc_manifest_numbers || '[]');
        
        // Parse manifest METRC IDs
        const manifestMetrcIds = Array.isArray(invoice.manifest_metrc_ids)
            ? invoice.manifest_metrc_ids
            : JSON.parse(invoice.manifest_metrc_ids || '[]');
        
        if (manifestNumbers.length === 0) {
            console.error('❌ No manifest numbers found');
            return;
        }
        
        const manifestNumber = manifestNumbers[0];
        const manifestInfo = manifestMetrcIds.find(m => m.number === manifestNumber);
        const manifestMetrcId = manifestInfo?.id;
        const license = manifestInfo?.license || process.env.T3_LICENSE_NUMBER || 'CUL000063';
        
        console.log(`\n📋 Manifest Details:`);
        console.log(`   Manifest Number: ${manifestNumber}`);
        console.log(`   METRC ID: ${manifestMetrcId || 'NOT SET'}`);
        console.log(`   License: ${license}`);
        
        // Ensure we have a valid token
        console.log(`\n📋 Step 1: Ensuring METRC authentication...`);
        const hasToken = await metrcAuth.ensureValidToken();
        if (!hasToken) {
            console.error('❌ Failed to obtain METRC authentication token');
            return;
        }
        console.log('✅ METRC authentication successful');
        
        const accessToken = metrcAuth.accessToken;
        const apiBaseUrl = metrcAuth.apiBaseUrl;
        
        // Test different PDF endpoints
        const endpoints = [
            {
                name: 'Endpoint 1: /transfers/manifest (with manifestNumber)',
                url: `${apiBaseUrl}/transfers/manifest`,
                params: {
                    licenseNumber: license,
                    manifestNumber: manifestNumber
                }
            },
            {
                name: 'Endpoint 2: /transfers/{id}/pdf (with METRC ID)',
                url: manifestMetrcId ? `${apiBaseUrl}/transfers/${manifestMetrcId}/pdf` : null,
                params: {
                    licenseNumber: license
                }
            },
            {
                name: 'Endpoint 3: /transfers/outgoing/{id}/pdf (with METRC ID)',
                url: manifestMetrcId ? `${apiBaseUrl}/transfers/outgoing/${manifestMetrcId}/pdf` : null,
                params: {
                    licenseNumber: license
                }
            }
        ];
        
        console.log(`\n📋 Step 2: Testing PDF endpoints...`);
        
        for (const endpoint of endpoints) {
            if (!endpoint.url) {
                console.log(`\n⏭️  Skipping ${endpoint.name} - METRC ID not available`);
                continue;
            }
            
            console.log(`\n📋 Testing: ${endpoint.name}`);
            console.log(`   URL: ${endpoint.url}`);
            console.log(`   Params:`, JSON.stringify(endpoint.params, null, 2));
            
            try {
                const response = await metrcAuth.makeAuthenticatedRequest({
                    method: 'GET',
                    url: endpoint.url,
                    params: endpoint.params,
                    responseType: 'arraybuffer', // For PDF binary data
                    timeout: 30000
                });
                
                console.log(`   ✅ Success! Status: ${response.status}`);
                console.log(`   Content-Type: ${response.headers['content-type']}`);
                console.log(`   Content-Length: ${response.data?.length || 0} bytes`);
                
                if (response.headers['content-type']?.includes('application/pdf')) {
                    console.log(`   ✅ Valid PDF received!`);
                } else {
                    console.log(`   ⚠️  Response is not a PDF (Content-Type: ${response.headers['content-type']})`);
                    console.log(`   Response preview:`, response.data?.toString().substring(0, 200));
                }
                
                // Generate curl command for this endpoint
                const paramsStr = Object.entries(endpoint.params)
                    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                    .join('&');
                const fullUrl = `${endpoint.url}${paramsStr ? '?' + paramsStr : ''}`;
                
                console.log(`\n   📋 Curl command:`);
                console.log(`   curl -X GET "${fullUrl}" \\`);
                console.log(`     -H "accept: application/pdf" \\`);
                console.log(`     -H "Authorization: Bearer ${accessToken.substring(0, 50)}..."`);
                
                // This endpoint works!
                break;
                
            } catch (error) {
                console.log(`   ❌ Failed: ${error.message}`);
                if (error.response) {
                    console.log(`   Status: ${error.response.status}`);
                    console.log(`   Response:`, error.response.data?.toString().substring(0, 200));
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        console.error(error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the test
if (require.main === module) {
    testManifestPDF().catch(console.error);
}

module.exports = { testManifestPDF };

