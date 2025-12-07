#!/usr/bin/env node
/**
 * Generate real curl command for manifest update
 * Usage: NODE_ENV=production node scripts/get-real-manifest-update-curl.js <invoice_id>
 */

const path = require('path');
const { pool } = require('../Server/config/database');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const metrcAuth = require('../Server/Services/metrcAuth');

async function generateUpdateCurl(invoiceId) {
    const client = await pool.connect();
    
    try {
        console.log(`\n🔍 Generating manifest update curl for invoice ${invoiceId}...\n`);
        
        // Get invoice data
        const invoiceQuery = await client.query(`
            SELECT 
                i.id,
                i.invoice_number,
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
        
        if (!invoice.manifest_metrc_ids || invoice.manifest_metrc_ids.length === 0) {
            throw new Error(`Invoice ${invoiceId} has no manifests`);
        }
        
        const manifestIds = Array.isArray(invoice.manifest_metrc_ids)
            ? invoice.manifest_metrc_ids
            : JSON.parse(invoice.manifest_metrc_ids || '[]');
        
        if (manifestIds.length === 0) {
            throw new Error(`No manifest METRC IDs found for invoice ${invoiceId}`);
        }
        
        const firstManifest = manifestIds[0];
        const license = firstManifest.license || process.env.T3_LICENSE_NUMBER || process.env.SYNC_LICENSE;
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
        
        // Get all line items first to check status
        const allLineItemsQuery = await client.query(`
            SELECT 
                li.id,
                li.quantity_ordered,
                li.unit_price,
                li.assigned_package_labels,
                p.name as product_name
            FROM "ORDERS-invoice-line-items" li
            LEFT JOIN "ORDERS-products" p ON li.fk_master_product_id = p.entry_id
            WHERE li.fk_invoice_id = $1
            ORDER BY li.line_item_order
        `, [invoiceId]);
        
        console.log(`\n📋 Line Items Status:`);
        for (const li of allLineItemsQuery.rows) {
            const hasLabels = li.assigned_package_labels !== null && li.assigned_package_labels !== undefined;
            const labelCount = hasLabels 
                ? (Array.isArray(li.assigned_package_labels) 
                    ? li.assigned_package_labels.length 
                    : (typeof li.assigned_package_labels === 'string' 
                        ? JSON.parse(li.assigned_package_labels || '[]').length 
                        : 0))
                : 0;
            console.log(`   Line Item ${li.id}: ${li.quantity_ordered}x ${li.product_name || 'Unknown'} - assigned_package_labels: ${hasLabels ? `${labelCount} labels` : 'NULL'}`);
        }
        
        // Get packages from assigned_package_labels
        const packagesQuery = await client.query(`
            SELECT 
                li.quantity_ordered,
                li.unit_price,
                li.assigned_package_labels
            FROM "ORDERS-invoice-line-items" li
            WHERE li.fk_invoice_id = $1
                AND li.assigned_package_labels IS NOT NULL
            ORDER BY li.line_item_order
        `, [invoiceId]);
        
        console.log(`\n📦 Processing ${packagesQuery.rows.length} line item(s) with assigned_package_labels...`);
        
        const packages = [];
        const seenPackageIds = new Set();
        const missingPackages = [];
        
        for (const lineItem of packagesQuery.rows) {
            const assignedLabels = lineItem.assigned_package_labels 
                ? (Array.isArray(lineItem.assigned_package_labels)
                    ? lineItem.assigned_package_labels
                    : JSON.parse(lineItem.assigned_package_labels || '[]'))
                : [];
            
            console.log(`   Processing ${assignedLabels.length} package label(s)...`);
            
            for (const label of assignedLabels) {
                // Check which license column exists
                const licenseColumnCheck = await client.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'activepackages' 
                    AND column_name IN ('sync_license', 'synclicense')
                    LIMIT 1
                `);
                const licenseColumn = licenseColumnCheck.rows[0]?.column_name || 'sync_license';
                
                const packageDetails = await client.query(`
                    SELECT 
                        metrcid,
                        label,
                        quantity,
                        item_productcategoryname,
                        item_name
                    FROM activepackages
                    WHERE label = $1 AND ${licenseColumn} = $2
                    LIMIT 1
                `, [label, license]);
                
                if (packageDetails.rows.length > 0) {
                    const pkgData = packageDetails.rows[0];
                    
                    if (seenPackageIds.has(pkgData.metrcid)) {
                        continue;
                    }
                    seenPackageIds.add(pkgData.metrcid);
                    
                    // Calculate gross weight (simple calculation)
                    const grossWeight = parseFloat(pkgData.quantity) || 0;
                    
                    packages.push({
                        id: parseInt(pkgData.metrcid, 10),
                        wholesalePrice: parseFloat(lineItem.unit_price) || 0,
                        grossWeight: grossWeight,
                        grossUnitOfWeightId: 1
                    });
                    console.log(`   ✓ Found package ${label} -> METRC ID: ${pkgData.metrcid}`);
                } else {
                    missingPackages.push(label);
                    console.log(`   ✗ Package ${label} NOT FOUND in activepackages for license ${license}`);
                }
            }
        }
        
        // If no packages from assigned_package_labels, try manifest-packages table
        if (packages.length === 0) {
            console.log(`\n⚠️  No packages from assigned_package_labels, checking ORDERS-manifest-packages table...`);
            const manifestNumber = firstManifest.number;
            const manifestPackagesQuery = await client.query(`
                SELECT 
                    mp.package_label,
                    mp.package_metrc_id,
                    mp.quantity,
                    mp.wholesale_price,
                    mp.gross_weight
                FROM "ORDERS-manifest-packages" mp
                WHERE mp.fk_invoice_id = $1
                    AND mp.manifest_number = $2
                    AND mp.package_status != 'voided'
                ORDER BY mp.id
            `, [invoiceId, manifestNumber]);
            
            console.log(`   Found ${manifestPackagesQuery.rows.length} package(s) in manifest-packages table`);
            
            if (manifestPackagesQuery.rows.length > 0) {
                for (const mp of manifestPackagesQuery.rows) {
                    if (!seenPackageIds.has(mp.package_metrc_id)) {
                        packages.push({
                            id: parseInt(mp.package_metrc_id, 10),
                            wholesalePrice: parseFloat(mp.wholesale_price) || 0,
                            grossWeight: parseFloat(mp.gross_weight) || 0,
                            grossUnitOfWeightId: 1
                        });
                        seenPackageIds.add(mp.package_metrc_id);
                        console.log(`   ✓ Using package from manifest-packages: ${mp.package_label} -> METRC ID: ${mp.package_metrc_id}`);
                    }
                }
            }
        }
        
        if (packages.length === 0) {
            console.log(`\n❌ Diagnostic Information:`);
            console.log(`   Invoice ID: ${invoiceId}`);
            console.log(`   Invoice Number: ${invoice.invoice_number}`);
            console.log(`   Total Line Items: ${allLineItemsQuery.rows.length}`);
            console.log(`   Line Items with assigned_package_labels: ${packagesQuery.rows.length}`);
            console.log(`   Missing Packages: ${missingPackages.length > 0 ? missingPackages.join(', ') : 'N/A'}`);
            console.log(`   Manifest Number: ${firstManifest.number || 'N/A'}`);
            console.log(`   Manifest METRC ID: ${manifestMetrcId}`);
            console.log(`\n💡 Possible reasons:`);
            console.log(`   1. Invoice hasn't been scanned yet (no assigned_package_labels)`);
            console.log(`   2. Packages were scanned but no longer exist in activepackages`);
            console.log(`   3. Packages exist but under a different license`);
            console.log(`   4. Manifest was created but packages weren't recorded in manifest-packages table`);
            throw new Error(`No packages found for invoice ${invoiceId}. Packages must be assigned during fulfillment scanning.`);
        }
        
        console.log(`📦 Found ${packages.length} package(s) for manifest update\n`);
        
        // Get destination license
        const destinationLicense = invoice.state_license || invoice.location_license_number;
        
        // Build update payload
        const destination = {
            recipientId: transportationDetails.recipientId || null,
            plannedRoute: transportationDetails.plannedRoute || `Delivery to ${destinationLicense}`,
            transferTypeId: 1, // Default transfer type
            invoiceNumber: invoice.invoice_number,
            estimatedDepartureDateTime: transportationDetails.estimatedDeparture || new Date().toISOString(),
            estimatedArrivalDateTime: transportationDetails.estimatedArrival || new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
            grossWeight: packages.reduce((sum, pkg) => sum + (pkg.grossWeight || 0), 0),
            grossUnitOfWeightId: 1,
            transporters: [{
                transporterId: transportationDetails.transporterId || null,
                phoneNumberForQuestions: transportationDetails.phoneNumber || '0000000000',
                transporterDetails: [{
                    driverName: transportationDetails.driverName || 'John Doe',
                    driverOccupationalLicenseNumber: transportationDetails.driverOccupationalLicense || '',
                    driverLicenseNumber: transportationDetails.driverLicense || '',
                    driverLayoverLeg: '',
                    vehicleMake: transportationDetails.vehicleMake || 'Ford',
                    vehicleModel: transportationDetails.vehicleModel || 'Transit',
                    vehicleLicensePlateNumber: transportationDetails.vehiclePlate || ''
                }]
            }],
            packages: packages
        };
        
        const payload = [{
            id: parseInt(manifestMetrcId, 10),
            destinations: [destination]
        }];
        
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
        
        // Generate curl command
        const apiBaseUrl = process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
        const submitValue = process.env.METRC_SUBMIT_TRANSFERS !== 'false' ? 'true' : 'false';
        
        const curlCommand = `curl -X POST "${apiBaseUrl}/transfers/update?licenseNumber=${license}&submit=${submitValue}" \\
  -H "accept: application/json" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${token}" \\
  -d '${JSON.stringify(payload)}'`;
        
        console.log(`\n📋 Manifest Update cURL Command:\n`);
        console.log(curlCommand);
        console.log(`\n`);
        console.log(`📝 Payload Summary:`);
        console.log(`   Manifest ID: ${manifestMetrcId}`);
        console.log(`   Invoice Number: ${invoice.invoice_number}`);
        console.log(`   Recipient ID: ${destination.recipientId || 'NOT SET (required)'}`);
        console.log(`   Transporter ID: ${destination.transporters[0].transporterId || 'NOT SET (required)'}`);
        console.log(`   Packages: ${packages.length}`);
        console.log(`   Total Gross Weight: ${destination.grossWeight} grams`);
        console.log(`   Submit: ${submitValue}`);
        console.log(`\n`);
        
        if (!destination.recipientId || !destination.transporters[0].transporterId) {
            console.log(`⚠️  WARNING: Missing required fields:`);
            if (!destination.recipientId) {
                console.log(`   - recipientId is required`);
            }
            if (!destination.transporters[0].transporterId) {
                console.log(`   - transporterId is required`);
            }
            console.log(`\n`);
        }
        
    } catch (error) {
        console.error(`\n❌ Error: ${error.message}\n`);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

// Get invoice ID from command line
const invoiceId = process.argv[2];

if (!invoiceId) {
    console.error('Usage: NODE_ENV=production node scripts/get-real-manifest-update-curl.js <invoice_id>');
    process.exit(1);
}

generateUpdateCurl(parseInt(invoiceId, 10)).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

