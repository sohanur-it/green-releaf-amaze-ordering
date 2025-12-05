#!/usr/bin/env node

/**
 * Get Real Manifest Data for Testing
 * 
 * This script extracts real invoice data to build a test curl command
 */

const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const { pool } = require('../Server/config/database');

async function getRealManifestData() {
    console.log('🔍 Finding real invoice data for curl test...');
    console.log('='.repeat(60));
    
    const client = await pool.connect();
    
    try {
        // Find an invoice with transportation details and packages
        const invoiceQuery = await client.query(`
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
            WHERE i.transportation_details IS NOT NULL
                AND i.status IN ('Fulfillment_Accepted', 'Fulfillment_Issue', 'Manifested')
            GROUP BY i.id, i.invoice_number, i.status, i.transportation_details, i.location_license_number, i.fk_location_id
            HAVING COUNT(li.id) > 0
            ORDER BY i.id DESC
            LIMIT 1
        `);
        
        if (invoiceQuery.rows.length === 0) {
            console.error('❌ No invoice found with transportation details');
            return;
        }
        
        const invoice = invoiceQuery.rows[0];
        console.log(`\n✅ Found invoice: ${invoice.invoice_number} (ID: ${invoice.id})`);
        console.log(`   Status: ${invoice.status}`);
        console.log(`   Destination License: ${invoice.location_license_number}`);
        
        // Parse transportation details
        const transportDetails = typeof invoice.transportation_details === 'string'
            ? JSON.parse(invoice.transportation_details)
            : invoice.transportation_details;
        
        console.log(`\n📋 Transportation Details:`);
        console.log(`   Recipient ID: ${transportDetails.recipientId || 'NOT SET'}`);
        console.log(`   Transporter ID: ${transportDetails.transporterId || 'NOT SET'}`);
        console.log(`   Driver Name: ${transportDetails.driverName || 'NOT SET'}`);
        console.log(`   Vehicle: ${transportDetails.vehicleMake || ''} ${transportDetails.vehicleModel || ''}`);
        
        if (!transportDetails.recipientId || !transportDetails.transporterId) {
            console.error('❌ Transportation details missing recipientId or transporterId');
            return;
        }
        
        // Get packages for this invoice
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
            LIMIT 3
        `, [invoice.id]);
        
        if (packagesQuery.rows.length === 0) {
            console.error('❌ No packages found for this invoice');
            return;
        }
        
        console.log(`\n📦 Getting package METRC IDs...`);
        const packages = [];
        
        for (const li of packagesQuery.rows) {
            const packageLabels = Array.isArray(li.assigned_package_labels)
                ? li.assigned_package_labels
                : JSON.parse(li.assigned_package_labels || '[]');
            
            for (const label of packageLabels.slice(0, 1)) { // Get first package from each line item
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
                        itemName: pkg.item_name
                    });
                    console.log(`   Package: ${label} -> METRC ID: ${pkg.metrcid}`);
                }
            }
        }
        
        if (packages.length === 0) {
            console.error('❌ No valid packages found with METRC IDs');
            return;
        }
        
        // Get source license
        const sourceLicense = process.env.T3_LICENSE_NUMBER || 'CUL000063';
        
        // Calculate total gross weight (simplified - using package quantity)
        const totalGrossWeight = packages.reduce((sum, pkg) => sum + (pkg.quantity || 1.0), 0);
        
        // Build the payload
        const payload = [{
            destinations: [{
                plannedRoute: `Delivery to ${invoice.location_license_number}`,
                transferTypeId: 1, // Standard transfer
                invoiceNumber: invoice.invoice_number,
                estimatedDepartureDateTime: new Date(Date.now() + 3600000).toISOString().slice(0, 19), // 1 hour from now
                estimatedArrivalDateTime: new Date(Date.now() + 7200000).toISOString().slice(0, 19), // 2 hours from now
                grossWeight: totalGrossWeight,
                grossUnitOfWeightId: 1, // Grams
                recipientId: parseInt(transportDetails.recipientId, 10),
                packages: packages.map(pkg => ({
                    id: parseInt(pkg.metrcId, 10),
                    wholesalePrice: parseFloat(pkg.unitPrice || 0),
                    grossWeight: parseFloat(pkg.quantity || 1.0),
                    grossUnitOfWeightId: 1 // Grams
                })),
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
        
        // Get access token for the curl command
        const metrcAuth = require('../Server/Services/metrcAuth');
        const hasToken = await metrcAuth.ensureValidToken();
        if (!hasToken) {
            console.error('❌ Failed to obtain METRC authentication token');
            return;
        }
        
        const accessToken = metrcAuth.accessToken;
        
        // Build curl command
        const payloadJson = JSON.stringify(payload);
        const escapedPayload = payloadJson.replace(/"/g, '\\"');
        
        console.log(`\n📋 Real Curl Command:`);
        console.log('='.repeat(60));
        console.log(`curl -X POST "https://api.trackandtrace.tools/v2/transfers/create?licenseNumber=${sourceLicense}&submit=true" \\`);
        console.log(`  -H "accept: application/json" \\`);
        console.log(`  -H "Content-Type: application/json" \\`);
        console.log(`  -H "Authorization: Bearer ${accessToken}" \\`);
        console.log(`  -d '${payloadJson}'`);
        
        console.log(`\n📋 Alternative (with escaped quotes for shell):`);
        console.log('='.repeat(60));
        console.log(`curl -X POST "https://api.trackandtrace.tools/v2/transfers/create?licenseNumber=${sourceLicense}&submit=true" \\`);
        console.log(`  -H "accept: application/json" \\`);
        console.log(`  -H "Content-Type: application/json" \\`);
        console.log(`  -H "Authorization: Bearer ${accessToken}" \\`);
        console.log(`  -d "${escapedPayload}"`);
        
        console.log(`\n📋 Payload Details:`);
        console.log('='.repeat(60));
        console.log(JSON.stringify(payload, null, 2));
        
        console.log(`\n📋 Summary:`);
        console.log('='.repeat(60));
        console.log(`Invoice ID: ${invoice.id}`);
        console.log(`Invoice Number: ${invoice.invoice_number}`);
        console.log(`Source License: ${sourceLicense}`);
        console.log(`Recipient ID: ${transportDetails.recipientId}`);
        console.log(`Transporter ID: ${transportDetails.transporterId}`);
        console.log(`Packages: ${packages.length}`);
        console.log(`Total Gross Weight: ${totalGrossWeight}`);
        
    } catch (error) {
        console.error('❌ Error:', error);
        console.error(error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the script
if (require.main === module) {
    getRealManifestData().catch(console.error);
}

module.exports = { getRealManifestData };

