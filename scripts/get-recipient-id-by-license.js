#!/usr/bin/env node
/**
 * Get METRC Recipient ID by License Number
 * 
 * Usage:
 *   node scripts/get-recipient-id-by-license.js DIS000085
 *   node scripts/get-recipient-id-by-license.js CUL000027
 * 
 * This script queries METRC T3 API to find the recipient ID for a given license number.
 */

const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const metrcAuth = require('../Server/Services/metrcAuth');

async function getRecipientIdByLicense(searchLicense) {
    try {
        if (!searchLicense) {
            console.error('❌ Error: License number is required');
            console.log('\nUsage:');
            console.log('  node scripts/get-recipient-id-by-license.js <LICENSE_NUMBER>');
            console.log('\nExample:');
            console.log('  node scripts/get-recipient-id-by-license.js DIS000085');
            process.exit(1);
        }

        // Normalize the search license (uppercase, trim)
        const normalizedSearchLicense = searchLicense.toUpperCase().trim();
        console.log(`🔍 Searching for recipient with license: "${normalizedSearchLicense}"`);
        console.log(`📡 Querying METRC T3 API...\n`);

        const apiBaseUrl = metrcAuth.apiBaseUrl || process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
        const sourceLicense = process.env.T3_LICENSE_NUMBER || 'CUL000063';
        
        console.log(`📍 API Base URL: ${apiBaseUrl}`);
        console.log(`🏢 Source License: ${sourceLicense}`);
        console.log(`🔎 Search License: ${normalizedSearchLicense}\n`);

        // Try multiple endpoints to get recipients with pagination
        let allRecipients = [];
        let endpointUsed = null;
        let error = null;
        let endpointWorks = false;

        // Method 1: Try /transfers/create/destinations with pagination
        try {
            endpointUsed = `${apiBaseUrl}/transfers/create/destinations`;
            console.log(`📡 Attempting: GET ${endpointUsed}?licenseNumber=${sourceLicense}`);
            
            // Fetch all pages
            let page = 1;
            let hasMorePages = true;
            const pageSize = 500; // Maximum allowed by API
            
            while (hasMorePages) {
                console.log(`📄 Fetching page ${page}...`);
                
                const response = await metrcAuth.makeAuthenticatedRequest({
                    method: 'GET',
                    url: endpointUsed,
                    params: {
                        licenseNumber: sourceLicense,
                        page: page,
                        pageSize: pageSize
                    },
                    timeout: 15000
                });
                
                // Parse the response
                let pageRecipients = [];
                if (Array.isArray(response.data)) {
                    pageRecipients = response.data;
                } else if (response.data?.data && Array.isArray(response.data.data)) {
                    pageRecipients = response.data.data;
                } else if (response.data?.recipients && Array.isArray(response.data.recipients)) {
                    pageRecipients = response.data.recipients;
                } else if (response.data?.destinations && Array.isArray(response.data.destinations)) {
                    pageRecipients = response.data.destinations;
                } else if (response.data?.facilities && Array.isArray(response.data.facilities)) {
                    pageRecipients = response.data.facilities;
                }
                
                allRecipients = allRecipients.concat(pageRecipients);
                console.log(`   ✅ Retrieved ${pageRecipients.length} recipients from page ${page} (total: ${allRecipients.length})`);
                
                // Check if there are more pages
                if (response.data) {
                    const total = response.data.total || response.data.totalCount || 0;
                    const totalPages = response.data.totalPages || Math.ceil(total / pageSize);
                    const currentPageSize = pageRecipients.length;
                    
                    // If we got fewer results than pageSize, we're done
                    // Or if we've reached totalPages
                    hasMorePages = currentPageSize === pageSize && (totalPages === 0 || page < totalPages);
                } else {
                    // If no pagination info, stop if we got fewer than pageSize
                    hasMorePages = pageRecipients.length === pageSize;
                }
                
                page++;
                
                // Small delay to avoid rate limiting
                if (hasMorePages) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
            
            endpointWorks = true;
            console.log(`✅ Successfully fetched all recipients from ${endpointUsed}\n`);
        } catch (firstError) {
            console.warn(`⚠️  Endpoint ${endpointUsed} failed: ${firstError.message}`);
            error = firstError;
            
            // Method 2: Try /facilities endpoint with pagination
            try {
                endpointUsed = `${apiBaseUrl}/facilities`;
                console.log(`📡 Trying alternative: GET ${endpointUsed}?licenseNumber=${sourceLicense}`);
                
                // Fetch all pages
                let page = 1;
                let hasMorePages = true;
                const pageSize = 500;
                
                while (hasMorePages) {
                    console.log(`📄 Fetching page ${page}...`);
                    
                    const response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: endpointUsed,
                        params: {
                            licenseNumber: sourceLicense,
                            page: page,
                            pageSize: pageSize
                        },
                        timeout: 15000
                    });
                    
                    // Parse the response
                    let pageRecipients = [];
                    if (Array.isArray(response.data)) {
                        pageRecipients = response.data;
                    } else if (response.data?.data && Array.isArray(response.data.data)) {
                        pageRecipients = response.data.data;
                    } else if (response.data?.recipients && Array.isArray(response.data.recipients)) {
                        pageRecipients = response.data.recipients;
                    } else if (response.data?.destinations && Array.isArray(response.data.destinations)) {
                        pageRecipients = response.data.destinations;
                    } else if (response.data?.facilities && Array.isArray(response.data.facilities)) {
                        pageRecipients = response.data.facilities;
                    }
                    
                    allRecipients = allRecipients.concat(pageRecipients);
                    console.log(`   ✅ Retrieved ${pageRecipients.length} recipients from page ${page} (total: ${allRecipients.length})`);
                    
                    // Check if there are more pages
                    if (response.data) {
                        const total = response.data.total || response.data.totalCount || 0;
                        const totalPages = response.data.totalPages || Math.ceil(total / pageSize);
                        const currentPageSize = pageRecipients.length;
                        
                        hasMorePages = currentPageSize === pageSize && (totalPages === 0 || page < totalPages);
                    } else {
                        hasMorePages = pageRecipients.length === pageSize;
                    }
                    
                    page++;
                    
                    // Small delay to avoid rate limiting
                    if (hasMorePages) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }
                
                endpointWorks = true;
                error = null;
                console.log(`✅ Successfully fetched all recipients from ${endpointUsed}\n`);
            } catch (secondError) {
                console.error(`❌ Both endpoints failed. Last error: ${secondError.message}`);
                error = secondError;
            }
        }

        if (!endpointWorks || allRecipients.length === 0) {
            throw new Error(
                `Failed to fetch recipients from METRC API. ` +
                `Tried endpoints: ${apiBaseUrl}/transfers/create/destinations and ${apiBaseUrl}/facilities. ` +
                `Error: ${error?.message || 'Unknown error'}`
            );
        }

        console.log(`📋 Found ${allRecipients.length} total recipient(s) from METRC API (all pages)\n`);

        // Format and search for matching license
        const formattedRecipients = allRecipients.map(recipient => {
            const recipientId = recipient.id || 
                               recipient.recipientId || 
                               recipient.facilityId ||
                               recipient.FacilityId ||
                               (recipient.facility && recipient.facility.id);
            
            const licenseNumber = recipient.licenseNumber || 
                                 recipient.license || 
                                 recipient.LicenseNumber ||
                                 recipient.License ||
                                 (recipient.facility && (recipient.facility.licenseNumber || recipient.facility.license));
            
            const name = recipient.name || 
                        recipient.facilityName || 
                        recipient.FacilityName ||
                        (recipient.facility && recipient.facility.name);

            return {
                id: recipientId ? parseInt(recipientId, 10) : null,
                licenseNumber: licenseNumber || 'N/A',
                name: name || licenseNumber || 'Unknown Facility',
                displayName: name ? `${name} (${licenseNumber || 'N/A'})` : (licenseNumber || 'Unknown Facility')
            };
        }).filter(r => r.id !== null && r.id > 0);

        // Search for matching license (case-insensitive)
        const matchingRecipient = formattedRecipients.find(r => {
            const normalizedLicense = (r.licenseNumber || '').toUpperCase().trim();
            return normalizedLicense === normalizedSearchLicense;
        });

        console.log('='.repeat(60));
        if (matchingRecipient) {
            console.log('✅ MATCH FOUND!');
            console.log('='.repeat(60));
            console.log(`📋 Recipient ID: ${matchingRecipient.id}`);
            console.log(`📜 License Number: ${matchingRecipient.licenseNumber}`);
            console.log(`🏢 Facility Name: ${matchingRecipient.name}`);
            console.log(`📝 Display Name: ${matchingRecipient.displayName}`);
            console.log('='.repeat(60));
            console.log(`\n💡 Use recipientId: ${matchingRecipient.id} in your manifest payload`);
            process.exit(0);
        } else {
            console.log('❌ NO MATCH FOUND');
            console.log('='.repeat(60));
            console.log(`\n⚠️  License "${normalizedSearchLicense}" not found in available recipients.`);
            console.log(`\n📋 Available recipients (${formattedRecipients.length}):`);
            formattedRecipients.forEach((r, index) => {
                console.log(`   ${index + 1}. ID: ${r.id}, License: ${r.licenseNumber}, Name: ${r.name}`);
            });
            console.log('\n💡 Possible reasons:');
            console.log('   1. License is not in METRC\'s list of available recipients');
            console.log('   2. License is not authorized to receive transfers from your source license');
            console.log('   3. License number format mismatch (check for spaces, case differences)');
            console.log('   4. The recipient facility may need to be configured in METRC first');
            console.log('='.repeat(60));
            process.exit(1);
        }
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Response:`, JSON.stringify(error.response.data, null, 2).substring(0, 500));
        }
        process.exit(1);
    }
}

// Get license from command line arguments
const searchLicense = process.argv[2];
getRecipientIdByLicense(searchLicense);

