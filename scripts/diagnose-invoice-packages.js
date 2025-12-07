#!/usr/bin/env node
/**
 * Diagnose why packages aren't found for an invoice
 * Usage: NODE_ENV=production node scripts/diagnose-invoice-packages.js <invoice_id>
 */

const path = require('path');
const { pool } = require('../Server/config/database');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

async function diagnoseInvoice(invoiceId) {
    const client = await pool.connect();
    
    try {
        console.log(`\n🔍 Diagnosing invoice ${invoiceId}...\n`);
        
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
        
        console.log(`📋 Invoice Information:`);
        console.log(`   Invoice Number: ${invoice.invoice_number}`);
        console.log(`   Status: ${invoice.status}`);
        console.log(`   Destination License: ${invoice.state_license || invoice.location_license_number || 'NOT SET'}`);
        
        // Get manifest info
        if (invoice.manifest_metrc_ids) {
            const manifestIds = Array.isArray(invoice.manifest_metrc_ids)
                ? invoice.manifest_metrc_ids
                : JSON.parse(invoice.manifest_metrc_ids || '[]');
            
            console.log(`\n📦 Manifest Information:`);
            console.log(`   Number of Manifests: ${manifestIds.length}`);
            manifestIds.forEach((m, i) => {
                console.log(`   Manifest ${i + 1}: ${m.number} (ID: ${m.id}, License: ${m.license})`);
            });
        } else {
            console.log(`\n⚠️  No manifests found for this invoice`);
        }
        
        // Get all line items
        const lineItemsQuery = await client.query(`
            SELECT 
                li.id,
                li.quantity_ordered,
                li.unit_price,
                li.assigned_package_labels,
                p.name as product_name,
                b.batch_name
            FROM "ORDERS-invoice-line-items" li
            LEFT JOIN "ORDERS-products" p ON li.fk_master_product_id = p.entry_id
            LEFT JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
            WHERE li.fk_invoice_id = $1
            ORDER BY li.line_item_order
        `, [invoiceId]);
        
        console.log(`\n📋 Line Items (${lineItemsQuery.rows.length} total):`);
        let totalLabels = 0;
        let foundPackages = 0;
        let missingPackages = [];
        
        for (const li of lineItemsQuery.rows) {
            const hasLabels = li.assigned_package_labels !== null && li.assigned_package_labels !== undefined;
            const assignedLabels = hasLabels 
                ? (Array.isArray(li.assigned_package_labels)
                    ? li.assigned_package_labels
                    : JSON.parse(li.assigned_package_labels || '[]'))
                : [];
            
            const labelCount = assignedLabels.length;
            totalLabels += labelCount;
            
            console.log(`\n   Line Item ${li.id}:`);
            console.log(`      Product: ${li.product_name || 'Unknown'}`);
            console.log(`      Batch: ${li.batch_name || 'Unknown'}`);
            console.log(`      Quantity Ordered: ${li.quantity_ordered}`);
            console.log(`      Has assigned_package_labels: ${hasLabels ? 'YES' : 'NO'}`);
            console.log(`      Number of labels: ${labelCount}`);
            
            if (labelCount > 0) {
                console.log(`      Labels: ${assignedLabels.slice(0, 5).join(', ')}${labelCount > 5 ? ` ... (+${labelCount - 5} more)` : ''}`);
                
                // Check if packages exist in activepackages
                const license = invoice.manifest_metrc_ids && invoice.manifest_metrc_ids.length > 0
                    ? (Array.isArray(invoice.manifest_metrc_ids) ? invoice.manifest_metrc_ids[0] : JSON.parse(invoice.manifest_metrc_ids || '[]')[0])?.license
                    : process.env.T3_LICENSE_NUMBER || process.env.SYNC_LICENSE;
                
                // Check which license column exists
                const licenseColumnCheck = await client.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'activepackages' 
                    AND column_name IN ('sync_license', 'synclicense')
                    LIMIT 1
                `);
                const licenseColumn = licenseColumnCheck.rows[0]?.column_name || 'sync_license';
                
                for (const label of assignedLabels.slice(0, 10)) { // Check first 10
                    const pkgCheck = await client.query(`
                        SELECT metrcid, label, ${licenseColumn} as license
                        FROM activepackages
                        WHERE label = $1
                        LIMIT 1
                    `, [label]);
                    
                    if (pkgCheck.rows.length > 0) {
                        const pkg = pkgCheck.rows[0];
                        if (pkg.license === license) {
                            foundPackages++;
                            console.log(`         ✓ ${label} -> METRC ID: ${pkg.metrcid} (license: ${pkg.license})`);
                        } else {
                            missingPackages.push({ label, foundLicense: pkg.license, expectedLicense: license });
                            console.log(`         ✗ ${label} -> Found but wrong license (found: ${pkg.license}, expected: ${license})`);
                        }
                    } else {
                        missingPackages.push({ label, reason: 'not_found' });
                        console.log(`         ✗ ${label} -> NOT FOUND in activepackages`);
                    }
                }
            }
        }
        
        // Check manifest-packages table
        if (invoice.manifest_metrc_ids) {
            const manifestIds = Array.isArray(invoice.manifest_metrc_ids)
                ? invoice.manifest_metrc_ids
                : JSON.parse(invoice.manifest_metrc_ids || '[]');
            
            console.log(`\n📦 Checking ORDERS-manifest-packages table...`);
            for (const manifest of manifestIds) {
                const manifestPackagesQuery = await client.query(`
                    SELECT 
                        mp.package_label,
                        mp.package_metrc_id,
                        mp.package_status,
                        mp.quantity,
                        mp.gross_weight
                    FROM "ORDERS-manifest-packages" mp
                    WHERE mp.fk_invoice_id = $1
                        AND mp.manifest_number = $2
                    ORDER BY mp.id
                `, [invoiceId, manifest.number]);
                
                console.log(`   Manifest ${manifest.number}: ${manifestPackagesQuery.rows.length} package(s) in manifest-packages table`);
                if (manifestPackagesQuery.rows.length > 0) {
                    manifestPackagesQuery.rows.slice(0, 5).forEach(mp => {
                        console.log(`      ${mp.package_label} -> METRC ID: ${mp.package_metrc_id} (status: ${mp.package_status})`);
                    });
                }
            }
        }
        
        console.log(`\n📊 Summary:`);
        console.log(`   Total Line Items: ${lineItemsQuery.rows.length}`);
        console.log(`   Total Package Labels: ${totalLabels}`);
        console.log(`   Packages Found in activepackages: ${foundPackages}`);
        console.log(`   Packages Missing/Wrong License: ${missingPackages.length}`);
        
        if (foundPackages === 0 && totalLabels > 0) {
            console.log(`\n❌ Issue: Packages are assigned but not found in activepackages`);
            console.log(`   Possible reasons:`);
            console.log(`   1. Packages were transferred/archived in METRC`);
            console.log(`   2. Packages are under a different license`);
            console.log(`   3. Package sync hasn't run recently`);
        } else if (totalLabels === 0) {
            console.log(`\n❌ Issue: No packages have been assigned (invoice hasn't been scanned)`);
            console.log(`   Action: Invoice needs to go through fulfillment scanning first`);
        } else {
            console.log(`\n✅ Packages found - should be able to update manifest`);
        }
        
    } catch (error) {
        console.error(`\n❌ Error: ${error.message}\n`);
        console.error(error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

// Get invoice ID from command line
const invoiceId = process.argv[2];

if (!invoiceId) {
    console.error('Usage: NODE_ENV=production node scripts/diagnose-invoice-packages.js <invoice_id>');
    process.exit(1);
}

diagnoseInvoice(parseInt(invoiceId, 10)).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});



