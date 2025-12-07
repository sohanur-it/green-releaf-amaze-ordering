// Check invoice license fields for debugging
const { query } = require('../Server/config/database');
const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

async function checkInvoiceLicense(invoiceId) {
    try {
        console.log(`\n🔍 Checking license fields for invoice ${invoiceId}...\n`);
        
        const result = await query(`
            SELECT 
                i.id as invoice_id,
                i.invoice_number,
                i.location_license_number as invoice_location_license,
                bl.entry_id as location_id,
                bl.name as location_name,
                bl.state_license as location_state_license,
                b.name as buyer_name
            FROM "ORDERS-invoices" i
            LEFT JOIN "ORDERS-buyer_locations" bl ON i.fk_location_id = bl.entry_id
            LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
            WHERE i.id = $1
        `, [invoiceId]);
        
        if (result.rows.length === 0) {
            console.log(`❌ Invoice ${invoiceId} not found`);
            return;
        }
        
        const invoice = result.rows[0];
        
        console.log(`📋 Invoice Details:`);
        console.log(`   Invoice ID: ${invoice.invoice_id}`);
        console.log(`   Invoice Number: ${invoice.invoice_number}`);
        console.log(`   Buyer: ${invoice.buyer_name}`);
        console.log(`   Location: ${invoice.location_name}`);
        console.log(`   Location ID: ${invoice.location_id}`);
        console.log(`\n🔑 License Fields:`);
        console.log(`   state_license (Store ID): ${invoice.location_state_license || 'NOT SET'}`);
        console.log(`   location_license_number (on invoice): ${invoice.invoice_location_license || 'NOT SET'}`);
        console.log(`\n💡 For recipientId lookup, you need the METRC license number (e.g., CUL000027)`);
        console.log(`   NOT the store ID (e.g., DIS000085)`);
        console.log(`\n📝 To fix:`);
        console.log(`   1. Update invoice.location_license_number to the METRC license (CUL000027)`);
        console.log(`   2. Or add a metrc_license field to buyer_locations table`);
        console.log(`\n`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

const invoiceId = process.argv[2] || 237;
checkInvoiceLicense(invoiceId);



