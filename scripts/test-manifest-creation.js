#!/usr/bin/env node

/**
 * Test Script: Create Real Manifest in METRC
 * 
 * This script creates a real manifest in METRC to test the API response structure
 * and verify that manifest number extraction works correctly.
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

async function testManifestCreation() {
    console.log('🧪 Testing Real Manifest Creation in METRC');
    console.log('='.repeat(60));
    
    const client = await pool.connect();
    
    try {
        // Get a test invoice - try invoice 230 first, then find any suitable one
        console.log('\n📋 Step 1: Finding a test invoice...');
        let invoiceQuery;
        
        // Try invoice 230 first (user mentioned this one)
        invoiceQuery = await client.query(`
            SELECT 
                i.id,
                i.invoice_number,
                i.status,
                i.transportation_details,
                i.location_license_number,
                i.fk_location_id,
                COUNT(li.id) as line_item_count
            FROM "ORDERS-invoices" i
            LEFT JOIN "ORDERS-invoice-line-items" li ON i.id = li.fk_invoice_id
            WHERE i.id = 230
            GROUP BY i.id, i.invoice_number, i.status, i.transportation_details, i.location_license_number, i.fk_location_id
        `);
        
        // If invoice 230 not found or doesn't have transportation details, find another
        if (invoiceQuery.rows.length === 0 || !invoiceQuery.rows[0].transportation_details) {
            console.log('   Invoice 230 not found or missing transportation details, searching for another...');
            invoiceQuery = await client.query(`
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.status,
                    i.transportation_details,
                    i.location_license_number,
                    i.fk_location_id,
                    COUNT(li.id) as line_item_count
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-invoice-line-items" li ON i.id = li.fk_invoice_id
                WHERE i.status = 'Fulfillment_Accepted'
                    AND i.transportation_details IS NOT NULL
                GROUP BY i.id, i.invoice_number, i.status, i.transportation_details, i.location_license_number, i.fk_location_id
                HAVING COUNT(li.id) > 0
                ORDER BY i.id DESC
                LIMIT 1
            `);
        }
        
        if (invoiceQuery.rows.length === 0) {
            console.error('❌ No suitable test invoice found. Need an invoice with:');
            console.error('   - Status: Fulfillment_Accepted');
            console.error('   - Transportation details entered');
            console.error('   - At least one line item');
            return;
        }
        
        const testInvoice = invoiceQuery.rows[0];
        console.log(`✅ Found test invoice: ${testInvoice.invoice_number} (ID: ${testInvoice.id})`);
        console.log(`   Status: ${testInvoice.status}`);
        console.log(`   Line items: ${testInvoice.line_item_count}`);
        
        // Parse transportation details
        const transportDetails = typeof testInvoice.transportation_details === 'string'
            ? JSON.parse(testInvoice.transportation_details)
            : testInvoice.transportation_details;
        
        console.log(`\n📋 Step 2: Transportation Details:`);
        console.log(`   Recipient ID: ${transportDetails.recipientId || 'NOT SET'}`);
        console.log(`   Transporter ID: ${transportDetails.transporterId || 'NOT SET'}`);
        console.log(`   Destination License: ${testInvoice.location_license_number || 'NOT SET'}`);
        
        if (!transportDetails.recipientId) {
            console.error('❌ Transportation details missing recipientId. Please enter transportation details first.');
            return;
        }
        
        if (!transportDetails.transporterId) {
            console.error('❌ Transportation details missing transporterId. Please enter transportation details first.');
            return;
        }
        
        // Get packages for this invoice
        console.log(`\n📋 Step 3: Getting packages for invoice...`);
        const packagesQuery = await client.query(`
            SELECT 
                li.id,
                li.assigned_package_labels,
                li.quantity_ordered,
                li.unit_price,
                li.line_total
            FROM "ORDERS-invoice-line-items" li
            WHERE li.fk_invoice_id = $1
                AND li.assigned_package_labels IS NOT NULL
                AND jsonb_array_length(li.assigned_package_labels::jsonb) > 0
            LIMIT 5
        `, [testInvoice.id]);
        
        if (packagesQuery.rows.length === 0) {
            console.error('❌ No packages found for this invoice. Please scan packages first.');
            return;
        }
        
        console.log(`✅ Found ${packagesQuery.rows.length} line item(s) with packages`);
        
        // Get packages with their METRC IDs from activepackages
        console.log(`\n📋 Step 4: Getting package METRC IDs from activepackages...`);
        const packages = [];
        for (const li of packagesQuery.rows.slice(0, 2)) { // Use first 2 line items for testing
            const packageLabels = Array.isArray(li.assigned_package_labels)
                ? li.assigned_package_labels
                : JSON.parse(li.assigned_package_labels || '[]');
            
            for (const label of packageLabels.slice(0, 1)) { // Use first package from each line item
                // Get package METRC ID from activepackages
                const pkgQuery = await client.query(`
                    SELECT metrcid, label, quantity, item_name, item_unitofmeasurename
                    FROM activepackages
                    WHERE label = $1
                    LIMIT 1
                `, [label]);
                
                if (pkgQuery.rows.length > 0) {
                    const pkg = pkgQuery.rows[0];
                    const pricePerPackage = parseFloat(li.line_total || 0) / packageLabels.length;
                    packages.push({
                        label: label,
                        metrcId: pkg.metrcid,
                        quantity: parseFloat(pkg.quantity || 1),
                        unitPrice: pricePerPackage || 0,
                        itemName: pkg.item_name,
                        unitOfMeasure: pkg.item_unitofmeasurename
                    });
                    console.log(`   Package: ${label} -> METRC ID: ${pkg.metrcid || 'NOT FOUND'}`);
                } else {
                    console.warn(`   ⚠️  Package ${label} not found in activepackages`);
                }
            }
        }
        
        if (packages.length === 0) {
            console.error('❌ No valid packages found with METRC IDs');
            return;
        }
        
        const testPackage = packages[0];
        console.log(`   Using test package: ${testPackage.label} (METRC ID: ${testPackage.metrcId})`);
        
        // Get source license
        const sourceLicense = process.env.T3_LICENSE_NUMBER || 'CUL000063';
        const destinationLicense = testInvoice.location_license_number;
        
        console.log(`\n📋 Step 5: Building test manifest payload...`);
        console.log(`   Source License: ${sourceLicense}`);
        console.log(`   Destination License: ${destinationLicense}`);
        console.log(`   Recipient ID: ${transportDetails.recipientId}`);
        console.log(`   Transporter ID: ${transportDetails.transporterId}`);
        console.log(`   Packages to include: ${packages.length}`);
        
        // Calculate total gross weight (sum of all package quantities)
        const totalGrossWeight = packages.reduce((sum, pkg) => sum + (pkg.quantity || 1.0), 0);
        
        // Build packages array for payload
        const payloadPackages = packages.map(pkg => ({
            id: parseInt(pkg.metrcId, 10),
            wholesalePrice: parseFloat(pkg.unitPrice || 0),
            grossWeight: parseFloat(pkg.quantity || 1.0),
            grossUnitOfWeightId: 1
        }));
        
        // Build a minimal test payload
        const testPayload = [{
            destinations: [{
                plannedRoute: `Test delivery to ${destinationLicense}`,
                transferTypeId: 1,
                invoiceNumber: testInvoice.invoice_number,
                estimatedDepartureDateTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
                estimatedArrivalDateTime: new Date(Date.now() + 7200000).toISOString(), // 2 hours from now
                grossWeight: totalGrossWeight,
                grossUnitOfWeightId: 1,
                recipientId: parseInt(transportDetails.recipientId, 10),
                packages: payloadPackages,
                transporters: [{
                    transporterId: parseInt(transportDetails.transporterId, 10),
                    phoneNumberForQuestions: transportDetails.phoneNumber || '0000000000',
                    transporterDetails: [{
                        driverName: transportDetails.driverName || 'Test Driver',
                        driverOccupationalLicenseNumber: transportDetails.driverOccupationalLicense || '',
                        driverLicenseNumber: transportDetails.driverLicense || 'TEST123',
                        driverLayoverLeg: '',
                        vehicleMake: transportDetails.vehicleMake || 'Test',
                        vehicleModel: transportDetails.vehicleModel || 'Test',
                        vehicleLicensePlateNumber: transportDetails.vehiclePlate || 'TEST'
                    }]
                }]
            }]
        }];
        
        console.log(`\n📋 Step 6: Test Payload Structure:`);
        console.log(JSON.stringify(testPayload, null, 2));
        
        // Validate payload
        console.log(`\n📋 Step 7: Validating payload...`);
        if (!testPayload[0].destinations[0].recipientId) {
            console.error('❌ Missing recipientId in payload');
            return;
        }
        if (!testPayload[0].destinations[0].transporters[0].transporterId) {
            console.error('❌ Missing transporterId in payload');
            return;
        }
        if (testPayload[0].destinations[0].packages.length === 0) {
            console.error('❌ No packages in payload');
            return;
        }
        console.log('✅ Payload validation passed');
        
        // Ensure we have a valid token
        console.log(`\n📋 Step 8: Ensuring METRC authentication...`);
        const hasToken = await metrcAuth.ensureValidToken();
        if (!hasToken) {
            console.error('❌ Failed to obtain METRC authentication token');
            return;
        }
        console.log('✅ METRC authentication successful');
        
        // Create manifest in METRC
        console.log(`\n📋 Step 9: Creating manifest in METRC...`);
        console.log(`   API URL: ${metrcAuth.apiBaseUrl}/transfers/create`);
        console.log(`   License: ${sourceLicense}`);
        
        try {
            const response = await metrcAuth.makeAuthenticatedRequest({
                method: 'POST',
                url: `${metrcAuth.apiBaseUrl}/transfers/create`,
                data: testPayload,
                params: {
                    licenseNumber: sourceLicense
                },
                timeout: 60000
            });
            
            console.log(`\n✅ METRC API Response Received!`);
            console.log('='.repeat(60));
            console.log(`Response Status: ${response.status}`);
            console.log(`Response Status Text: ${response.statusText}`);
            console.log(`\n📦 Full Response Data:`);
            console.log(JSON.stringify(response.data, null, 2));
            console.log(`\n📦 Response Data Type: ${typeof response.data}`);
            console.log(`📦 Is Array: ${Array.isArray(response.data)}`);
            
            if (response.data) {
                console.log(`\n📦 Response Data Keys:`);
                if (Array.isArray(response.data)) {
                    console.log(`   Array with ${response.data.length} items`);
                    if (response.data.length > 0) {
                        console.log(`   First item keys:`, Object.keys(response.data[0] || {}));
                        console.log(`   First item:`, JSON.stringify(response.data[0], null, 2));
                    }
                } else {
                    console.log(`   Object keys:`, Object.keys(response.data));
                    if (response.data.data) {
                        console.log(`   Nested data keys:`, Object.keys(response.data.data));
                    }
                }
            }
            
            // Try to extract manifest number
            console.log(`\n🔍 Attempting to extract manifest number...`);
            let manifestNumber = null;
            let manifestId = null;
            
            if (Array.isArray(response.data) && response.data.length > 0) {
                const first = response.data[0];
                manifestNumber = first.manifestNumber || first.manifest_number || first.number || first.transferNumber;
                manifestId = first.id || first.Id;
                console.log(`   From array[0]: manifestNumber=${manifestNumber}, id=${manifestId}`);
            } else if (response.data) {
                manifestNumber = response.data.manifestNumber || response.data.manifest_number || response.data.number || response.data.transferNumber;
                manifestId = response.data.id || response.data.Id;
                console.log(`   From object: manifestNumber=${manifestNumber}, id=${manifestId}`);
                
                if (!manifestNumber && response.data.data) {
                    const nested = response.data.data;
                    if (Array.isArray(nested) && nested.length > 0) {
                        manifestNumber = nested[0].manifestNumber || nested[0].number;
                        manifestId = nested[0].id;
                        console.log(`   From nested array: manifestNumber=${manifestNumber}, id=${manifestId}`);
                    } else {
                        manifestNumber = nested.manifestNumber || nested.number;
                        manifestId = nested.id;
                        console.log(`   From nested object: manifestNumber=${manifestNumber}, id=${manifestId}`);
                    }
                }
            }
            
            if (manifestNumber) {
                console.log(`\n✅ SUCCESS! Manifest Number Found: ${manifestNumber}`);
                console.log(`   METRC ID: ${manifestId}`);
            } else {
                console.log(`\n❌ Manifest number not found in response`);
                console.log(`   Please check the response structure above to identify the correct field name`);
            }
            
        } catch (error) {
            console.error(`\n❌ Error creating manifest in METRC:`);
            console.error(`   Error: ${error.message}`);
            if (error.response) {
                console.error(`   Status: ${error.response.status}`);
                console.error(`   Response Data:`, JSON.stringify(error.response.data, null, 2));
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
    testManifestCreation().catch(console.error);
}

module.exports = { testManifestCreation };

