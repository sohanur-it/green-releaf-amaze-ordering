#!/usr/bin/env node
/**
 * Test script for manifest update endpoint
 * Tests both GET /api/v1/fulfillment/manifest/edit/:invoiceId and PATCH /api/v1/fulfillment/manifest/update
 * 
 * Usage: NODE_ENV=production node scripts/test-manifest-update-endpoint.js <invoiceId>
 */

require('dotenv').config({ path: `./config/${process.env.NODE_ENV || 'production'}.env` });

const axios = require('axios');
const { query } = require('../Server/config/database');

const INVOICE_ID = process.argv[2] || '241';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Test credentials (you may need to adjust these)
const TEST_USER = {
    email: process.env.TEST_USER_EMAIL || 'admin@example.com',
    password: process.env.TEST_USER_PASSWORD || 'password'
};

async function getAuthToken() {
    try {
        console.log('\n🔐 Authenticating...');
        const response = await axios.post(`${BASE_URL}/api/v1/auth/login`, {
            email: TEST_USER.email,
            password: TEST_USER.password
        });
        
        if (response.data.token) {
            console.log('✅ Authentication successful');
            return response.data.token;
        } else {
            throw new Error('No token in response');
        }
    } catch (error) {
        console.error('❌ Authentication failed:', error.response?.data || error.message);
        throw error;
    }
}

async function getManifestForEdit(invoiceId, token) {
    try {
        console.log(`\n📋 Fetching manifest data for edit (invoice ${invoiceId})...`);
        const response = await axios.get(`${BASE_URL}/api/v1/fulfillment/manifest/edit/${invoiceId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.data.success) {
            console.log('✅ Manifest data retrieved successfully');
            console.log('\n📦 Current Manifest Data:');
            console.log(JSON.stringify(response.data.data, null, 2));
            return response.data.data;
        } else {
            throw new Error(response.data.error || 'Failed to get manifest data');
        }
    } catch (error) {
        console.error('❌ Failed to get manifest data:', error.response?.data || error.message);
        throw error;
    }
}

async function updateManifest(invoiceId, updates, token) {
    try {
        console.log(`\n🔄 Updating manifest for invoice ${invoiceId}...`);
        console.log('📝 Updates to apply:');
        console.log(JSON.stringify(updates, null, 2));
        
        const response = await axios.patch(`${BASE_URL}/api/v1/fulfillment/manifest/update`, {
            invoice_id: parseInt(invoiceId),
            ...updates
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.data.success) {
            console.log('✅ Manifest updated successfully');
            console.log('\n📦 Update Response:');
            console.log(JSON.stringify(response.data, null, 2));
            return response.data;
        } else {
            throw new Error(response.data.error || 'Failed to update manifest');
        }
    } catch (error) {
        if (error.response) {
            console.error('❌ Update failed:', error.response.status, error.response.data);
        } else {
            console.error('❌ Update failed:', error.message);
        }
        throw error;
    }
}

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
    console.log('='.repeat(60));
    console.log('🧪 Testing Manifest Update Endpoint');
    console.log('='.repeat(60));
    console.log(`📋 Invoice ID: ${INVOICE_ID}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`🔗 Base URL: ${BASE_URL}`);
    
    try {
        // Get invoice info
        console.log('\n📄 Getting invoice information...');
        const invoice = await getInvoiceInfo(INVOICE_ID);
        console.log(`✅ Invoice found: ${invoice.invoice_number}`);
        console.log(`   Status: ${invoice.status}`);
        console.log(`   Manifest Numbers: ${JSON.stringify(invoice.metrc_manifest_numbers)}`);
        
        // Authenticate
        const token = await getAuthToken();
        
        // Get current manifest data
        const manifestData = await getManifestForEdit(INVOICE_ID, token);
        
        // Prepare test updates (only update transport details)
        const updates = {
            driverName: manifestData.driverName || 'Test Driver Updated',
            driverLicense: manifestData.driverLicense || 'DL12345678',
            driverOccupationalLicense: manifestData.driverOccupationalLicense || 'OCC12345',
            vehicleMake: manifestData.vehicleMake || 'Ford',
            vehicleModel: manifestData.vehicleModel || 'Transit',
            vehiclePlate: manifestData.vehiclePlate || 'TEST123',
            // Add 1 hour to departure and arrival times if they exist
            estimatedDeparture: manifestData.estimatedDeparture 
                ? new Date(new Date(manifestData.estimatedDeparture).getTime() + 60 * 60 * 1000).toISOString()
                : new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            estimatedArrival: manifestData.estimatedArrival
                ? new Date(new Date(manifestData.estimatedArrival).getTime() + 60 * 60 * 1000).toISOString()
                : new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString()
        };
        
        console.log('\n⚠️  NOTE: This will update the manifest in METRC!');
        console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Update manifest
        const updateResult = await updateManifest(INVOICE_ID, updates, token);
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ Test completed successfully!');
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('\n' + '='.repeat(60));
        console.error('❌ Test failed!');
        console.error('='.repeat(60));
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
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

