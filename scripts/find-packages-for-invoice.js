#!/usr/bin/env node

/**
 * Helper script to find package labels for an invoice
 * Usage: NODE_ENV=production node scripts/find-packages-for-invoice.js <invoice_id>
 */

// Force production environment
process.env.NODE_ENV = 'production';
const { query, pool } = require('../Server/config/database');

async function findPackagesForInvoice(invoiceId) {
    const client = await pool.connect();
    
    try {
        console.log(`\n=== Finding Packages for Invoice ${invoiceId} ===\n`);
        
        // 1. Get invoice info
        const invoice = await client.query(`
            SELECT id, invoice_number, status, fulfillment_accepted_by 
            FROM "ORDERS-invoices" 
            WHERE id = $1
        `, [invoiceId]);
        
        if (invoice.rows.length === 0) {
            console.log(`❌ Invoice ${invoiceId} not found`);
            return;
        }
        
        console.log('Invoice:', invoice.rows[0]);
        
        // 2. Get line items with batch info
        const lineItems = await client.query(`
            SELECT 
                li.id,
                li.quantity_ordered,
                li.assigned_package_labels,
                li.specific_package_labels,
                b.batch_name,
                b.available_labels,
                b.full_package_details,
                b.partial_package_details,
                b.first_sourcepackage_label
            FROM "ORDERS-invoice-line-items" li
            JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
            WHERE li.fk_invoice_id = $1
        `, [invoiceId]);
        
        if (lineItems.rows.length === 0) {
            console.log(`❌ No line items found for invoice ${invoiceId}`);
            return;
        }
        
        console.log('\n=== Line Items ===\n');
        
        // 3. Check which license column exists
        const colCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'activepackages' 
            AND column_name IN ('sync_license', 'synclicense')
            LIMIT 1
        `);
        const licenseCol = colCheck.rows[0]?.column_name || 'synclicense';
        console.log(`Using license column: ${licenseCol}\n`);
        
        for (let i = 0; i < lineItems.rows.length; i++) {
            const li = lineItems.rows[i];
            console.log(`--- Line Item ${i + 1} ---`);
            console.log(`Batch: ${li.batch_name}`);
            console.log(`Quantity Needed: ${li.quantity_ordered}`);
            
            // Get already scanned packages
            const scanned = li.assigned_package_labels 
                ? (Array.isArray(li.assigned_package_labels) 
                    ? li.assigned_package_labels 
                    : JSON.parse(li.assigned_package_labels || '[]'))
                : [];
            console.log(`Already Scanned: ${scanned.length}/${li.quantity_ordered}`);
            if (scanned.length > 0) {
                console.log(`  Scanned: ${scanned.join(', ')}`);
            }
            
            // Get available packages from batch
            let availableLabels = [];
            if (li.available_labels) {
                const labels = typeof li.available_labels === 'string' 
                    ? JSON.parse(li.available_labels) 
                    : li.available_labels;
                availableLabels = labels.labels || labels || [];
            }
            
            // Get full packages
            let fullPackages = [];
            if (li.full_package_details) {
                const fullDetails = typeof li.full_package_details === 'string'
                    ? JSON.parse(li.full_package_details)
                    : li.full_package_details;
                fullPackages = fullDetails.full_packages || [];
            }
            
            // Get partial packages
            let partialPackages = [];
            if (li.partial_package_details) {
                const partialDetails = typeof li.partial_package_details === 'string'
                    ? JSON.parse(li.partial_package_details)
                    : li.partial_package_details;
                partialPackages = partialDetails.partial_packages || [];
            }
            
            // Check if specific packages are required
            if (li.specific_package_labels) {
                const specificLabels = Array.isArray(li.specific_package_labels)
                    ? li.specific_package_labels
                    : JSON.parse(li.specific_package_labels || '[]');
                
                console.log(`\n⚠️  SPECIFIC PACKAGES REQUIRED (Partial Package Order):`);
                console.log(`   You MUST scan these exact packages:`);
                specificLabels.forEach((label, idx) => {
                    const isScanned = scanned.includes(label);
                    console.log(`   ${idx + 1}. ${label} ${isScanned ? '✅ SCANNED' : '⏳ PENDING'}`);
                });
            } else {
                // Full package order - show available packages
                console.log(`\n📦 Available Full Packages (scan any ${li.quantity_ordered - scanned.length} more):`);
                
                // Filter out already scanned
                const remainingFull = fullPackages
                    .filter(p => !scanned.includes(p.label))
                    .slice(0, 20);
                
                if (remainingFull.length > 0) {
                    remainingFull.forEach((pkg, idx) => {
                        console.log(`   ${idx + 1}. ${pkg.label} (qty: ${pkg.quantity})`);
                    });
                    if (fullPackages.length > 20) {
                        console.log(`   ... and ${fullPackages.length - 20} more`);
                    }
                } else {
                    console.log(`   ⚠️  No full packages available in batch`);
                }
            }
            
            console.log('');
        }
        
        // 4. Check if a specific package exists
        const testLabel = '1A40C03000049D5000093154';
        console.log(`\n=== Checking Package: ${testLabel} ===`);
        
        const pkgCheck = await client.query(`
            SELECT 
                label,
                item_name,
                quantity,
                ${licenseCol} as license,
                isarchived,
                isfinished
            FROM activepackages
            WHERE label = $1
        `, [testLabel]);
        
        if (pkgCheck.rows.length > 0) {
            const pkg = pkgCheck.rows[0];
            console.log('✅ Package Found:');
            console.log(`   Label: ${pkg.label}`);
            console.log(`   Item: ${pkg.item_name}`);
            console.log(`   Quantity: ${pkg.quantity}`);
            console.log(`   License: ${pkg.license}`);
            console.log(`   Archived: ${pkg.isarchived}`);
            console.log(`   Finished: ${pkg.isfinished}`);
            
            if (pkg.isarchived || pkg.isfinished) {
                console.log(`   ❌ Status: NOT ACTIVE (cannot be scanned)`);
            } else if (pkg.license && !['CUL000063', 'MAN000072'].includes(pkg.license)) {
                console.log(`   ❌ Status: WRONG LICENSE (${pkg.license})`);
            } else {
                console.log(`   ✅ Status: ACTIVE (can be scanned)`);
            }
        } else {
            console.log(`❌ Package NOT found in activepackages`);
            
            // Check similar
            const similar = await client.query(`
                SELECT label, item_name, isarchived, isfinished
                FROM activepackages
                WHERE label LIKE $1
                LIMIT 5
            `, [`${testLabel}%`]);
            
            if (similar.rows.length > 0) {
                console.log(`\nFound similar packages:`);
                similar.rows.forEach(p => {
                    console.log(`   - ${p.label} (archived: ${p.isarchived}, finished: ${p.isfinished})`);
                });
            }
        }
        
    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

// Get invoice ID from command line
const invoiceId = process.argv[2] ? parseInt(process.argv[2]) : 215;

if (!invoiceId || isNaN(invoiceId)) {
    console.error('Usage: node scripts/find-packages-for-invoice.js <invoice_id>');
    process.exit(1);
}

findPackagesForInvoice(invoiceId);

