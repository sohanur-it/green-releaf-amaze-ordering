#!/usr/bin/env node
/**
 * Diagnose why manifest void is failing
 * Usage: NODE_ENV=production node scripts/diagnose-void-failure.js <invoice_id>
 */

const path = require('path');
const { pool } = require('../Server/config/database');
const manifestStatusService = require('../Server/Services/manifestStatusService');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

async function diagnoseVoidFailure(invoiceId) {
    const client = await pool.connect();
    
    try {
        console.log(`\n🔍 Diagnosing void failure for invoice ${invoiceId}...\n`);
        
        // Get invoice data
        const invoiceQuery = await client.query(`
            SELECT 
                i.id,
                i.invoice_number,
                i.status,
                i.metrc_manifest_numbers,
                i.manifest_metrc_ids
            FROM "ORDERS-invoices" i
            WHERE i.id = $1
        `, [invoiceId]);
        
        if (invoiceQuery.rows.length === 0) {
            throw new Error(`Invoice ${invoiceId} not found`);
        }
        
        const invoice = invoiceQuery.rows[0];
        
        console.log(`📋 Invoice Information:`);
        console.log(`   Invoice Number: ${invoice.invoice_number}`);
        console.log(`   Status: ${invoice.status}`);
        
        // Parse manifest data
        const manifestNumbers = Array.isArray(invoice.metrc_manifest_numbers) 
            ? invoice.metrc_manifest_numbers 
            : (invoice.metrc_manifest_numbers ? JSON.parse(invoice.metrc_manifest_numbers) : []);
        const manifestIds = Array.isArray(invoice.manifest_metrc_ids)
            ? invoice.manifest_metrc_ids
            : (invoice.manifest_metrc_ids ? JSON.parse(invoice.manifest_metrc_ids) : []);
        
        if (manifestIds.length === 0) {
            console.log(`\n❌ No manifests found for this invoice`);
            return;
        }
        
        console.log(`\n📦 Manifest Information:`);
        console.log(`   Number of Manifests: ${manifestIds.length}`);
        
        // Check each manifest
        for (const manifest of manifestIds) {
            console.log(`\n   Manifest ${manifest.number}:`);
            console.log(`      METRC ID: ${manifest.id}`);
            console.log(`      License: ${manifest.license}`);
            
            // Check manifest status
            try {
                console.log(`      Checking status in METRC...`);
                const statusCheck = await manifestStatusService.checkManifestStatus(manifest.number, manifest.license);
                
                if (statusCheck && statusCheck.status) {
                    console.log(`      Status: ${statusCheck.status}`);
                    
                    if (statusCheck.status === 'active') {
                        console.log(`      ✅ Manifest is active - can be voided`);
                    } else if (statusCheck.status === 'shipped') {
                        console.log(`      ❌ Manifest is shipped - CANNOT be voided`);
                    } else if (statusCheck.status === 'voided') {
                        console.log(`      ⚠️  Manifest is already voided`);
                    } else if (statusCheck.status === 'accepted') {
                        console.log(`      ❌ Manifest is accepted - CANNOT be voided`);
                    } else {
                        console.log(`      ⚠️  Manifest status is ${statusCheck.status} - may not be voidable`);
                    }
                } else {
                    console.log(`      ⚠️  Could not determine manifest status`);
                    console.log(`      Response:`, JSON.stringify(statusCheck, null, 2));
                }
            } catch (statusError) {
                console.log(`      ❌ Error checking status: ${statusError.message}`);
                if (statusError.response) {
                    console.log(`      Response status: ${statusError.response.status}`);
                    console.log(`      Response data:`, JSON.stringify(statusError.response.data).substring(0, 200));
                }
            }
            
            // Validate manifest ID
            if (!manifest.id || isNaN(parseInt(manifest.id, 10))) {
                console.log(`      ❌ Invalid manifest METRC ID: ${manifest.id}`);
            } else {
                console.log(`      ✅ Manifest ID is valid: ${manifest.id}`);
            }
            
            // Check if license is valid
            if (!manifest.license || manifest.license.length < 3) {
                console.log(`      ❌ Invalid license: ${manifest.license}`);
            } else {
                console.log(`      ✅ License is valid: ${manifest.license}`);
            }
        }
        
        // Check environment configuration
        console.log(`\n⚙️  Environment Configuration:`);
        const submitValue = process.env.METRC_SUBMIT_TRANSFERS;
        console.log(`   METRC_SUBMIT_TRANSFERS: ${submitValue || 'not set (defaults to true)'}`);
        if (submitValue === 'false' || submitValue === '0') {
            console.log(`   ⚠️  DRY RUN MODE: Void will only validate, not actually void`);
        }
        
        console.log(`\n💡 Common Void Failure Reasons:`);
        console.log(`   1. Manifest is not active (already shipped/accepted)`);
        console.log(`   2. Manifest not found in METRC (404 error)`);
        console.log(`   3. METRC API timeout (504 Gateway Timeout)`);
        console.log(`   4. Invalid manifest ID or license`);
        console.log(`   5. Manifest already voided`);
        console.log(`   6. METRC API validation error (400 Bad Request)`);
        console.log(`   7. Authentication/authorization issues`);
        
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
    console.error('Usage: NODE_ENV=production node scripts/diagnose-void-failure.js <invoice_id>');
    process.exit(1);
}

diagnoseVoidFailure(parseInt(invoiceId, 10)).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});



