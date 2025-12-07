#!/usr/bin/env node
/**
 * Test manifest update service directly (without HTTP)
 * Tests both getManifestDataForEdit and updateManifest service methods
 * 
 * Usage: NODE_ENV=production node scripts/test-manifest-update-service.js <invoiceId>
 */

const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const { query } = require('../Server/config/database');
const manifestVoidingService = require('../Server/Services/manifestVoidingService');

const INVOICE_ID = process.argv[2] || '241';
const TEST_USER_ID = process.argv[3] || '1'; // Default to user ID 1

async function getInvoiceInfo(invoiceId) {
    try {
        const result = await query(`
            SELECT 
                id,
                invoice_number,
                status,
                metrc_manifest_numbers,
                manifest_metrc_ids,
                transportation_details
            FROM "ORDERS-invoices"
            WHERE id = $1
        `, [invoiceId]);
        
        if (result.rows.length === 0) {
            throw new Error(`Invoice ${invoiceId} not found`);
        }
        
        return result.rows[0];
    } catch (error) {
        console.error('❌ Failed to get invoice info:', error.message);
        throw error;
    }
}

async function main() {
    console.log('='.repeat(80));
    console.log('🧪 Testing Manifest Update Service');
    console.log('='.repeat(80));
    console.log(`📋 Invoice ID: ${INVOICE_ID}`);
    console.log(`👤 User ID: ${TEST_USER_ID}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
    
    try {
        // Get invoice info
        console.log('\n📄 Getting invoice information...');
        const invoice = await getInvoiceInfo(INVOICE_ID);
        console.log(`✅ Invoice found: ${invoice.invoice_number}`);
        console.log(`   Status: ${invoice.status}`);
        console.log(`   Manifest Numbers: ${JSON.stringify(invoice.metrc_manifest_numbers)}`);
        
        // Test 1: Get manifest data for edit
        console.log('\n' + '='.repeat(80));
        console.log('📋 TEST 1: Get Manifest Data for Edit');
        console.log('='.repeat(80));
        
        const getResult = await manifestVoidingService.getManifestDataForEdit(parseInt(INVOICE_ID), parseInt(TEST_USER_ID));
        
        if (getResult.success) {
            console.log('✅ Successfully retrieved manifest data');
            console.log('\n📦 Current Manifest Data:');
            console.log(JSON.stringify(getResult.data, null, 2));
            
            const manifestData = getResult.data;
            
            // Test 2: Update manifest with test data
            console.log('\n' + '='.repeat(80));
            console.log('🔄 TEST 2: Update Manifest');
            console.log('='.repeat(80));
            
            // Prepare test updates (only update transport details)
            // Only update fields that have valid values - skip invalid dates
            const updates = {
                driverName: manifestData.driverName ? `${manifestData.driverName} (Updated)` : 'Test Driver Updated',
                driverLicense: manifestData.driverLicense || 'DL12345678',
                driverOccupationalLicense: manifestData.driverOccupationalLicense || 'OCC12345',
                vehicleMake: manifestData.vehicleMake || 'Ford',
                vehicleModel: manifestData.vehicleModel || 'Transit',
                vehiclePlate: manifestData.vehiclePlate || 'TEST123'
            };
            
            // Only add dates if they're valid (not null/default dates)
            const isValidDate = (dateStr) => {
                if (!dateStr) return false;
                const date = new Date(dateStr);
                // Check if date is valid and not a default/null date (like 0001-01-01)
                return !isNaN(date.getTime()) && date.getFullYear() > 1900;
            };
            
            if (isValidDate(manifestData.estimatedDeparture)) {
                updates.estimatedDeparture = new Date(new Date(manifestData.estimatedDeparture).getTime() + 60 * 60 * 1000).toISOString();
            } else {
                // Use current time + 1 hour if no valid departure date
                updates.estimatedDeparture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
            }
            
            if (isValidDate(manifestData.estimatedArrival)) {
                updates.estimatedArrival = new Date(new Date(manifestData.estimatedArrival).getTime() + 60 * 60 * 1000).toISOString();
            } else {
                // Use current time + 7 hours if no valid arrival date
                updates.estimatedArrival = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
            }
            
            console.log('📝 Updates to apply:');
            console.log(JSON.stringify(updates, null, 2));
            
            console.log('\n⚠️  NOTE: This will update the manifest in METRC!');
            console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const updateResult = await manifestVoidingService.updateManifest(
                parseInt(INVOICE_ID),
                parseInt(TEST_USER_ID),
                updates
            );
            
            if (updateResult.success) {
                console.log('✅ Manifest updated successfully!');
                console.log('\n📦 Update Response:');
                console.log(JSON.stringify(updateResult, null, 2));
            } else {
                console.error('❌ Update failed:', updateResult.error);
                throw new Error(updateResult.error);
            }
            
        } else {
            console.error('❌ Failed to get manifest data:', getResult.error);
            throw new Error(getResult.error);
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('✅ All tests completed successfully!');
        console.log('='.repeat(80));
        
    } catch (error) {
        console.error('\n' + '='.repeat(80));
        console.error('❌ Test failed!');
        console.error('='.repeat(80));
        console.error('Error:', error.message);
        if (error.stack) {
            console.error('\nStack trace:');
            console.error(error.stack);
        }
        process.exit(1);
    } finally {
        // Close database connection
        process.exit(0);
    }
}

// Run the test
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

