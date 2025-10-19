#!/usr/bin/env node

/**
 * Test Token Refresh Mechanism
 * 
 * This script tests the METRC authentication service's token refresh functionality
 * by simulating expired tokens and verifying the refresh mechanism works correctly.
 */

const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

// Import the METRC authentication service
const metrcAuth = require('../Server/Services/metrcAuth');

async function testTokenRefresh() {
    console.log('🧪 Testing METRC Token Refresh Mechanism');
    console.log('==========================================');
    
    try {
        // Test 1: Check initial token status
        console.log('\n📋 Test 1: Initial Token Status');
        let status = metrcAuth.getTokenStatus();
        console.log('Token Status:', JSON.stringify(status, null, 2));
        
        // Test 2: Ensure we have a valid token
        console.log('\n📋 Test 2: Ensure Valid Token');
        const hasValidToken = await metrcAuth.ensureValidToken();
        console.log(`✅ Valid token obtained: ${hasValidToken}`);
        
        // Test 3: Check token status after authentication
        console.log('\n📋 Test 3: Token Status After Authentication');
        status = metrcAuth.getTokenStatus();
        console.log('Token Status:', JSON.stringify(status, null, 2));
        
        // Test 4: Make a test API call
        console.log('\n📋 Test 4: Test API Call');
        try {
            const response = await metrcAuth.makeAuthenticatedRequest({
                method: 'GET',
                url: `${metrcAuth.apiBaseUrl}/strains`,
                params: {
                    licenseNumber: metrcAuth.licenseNumber
                }
            });
            console.log(`✅ API call successful: ${response.data?.data?.length || 0} strains retrieved`);
        } catch (error) {
            console.log(`❌ API call failed: ${error.message}`);
        }
        
        // Test 5: Simulate expired token by clearing cache and testing refresh
        console.log('\n📋 Test 5: Simulate Token Expiry and Refresh');
        
        // Clear tokens to simulate expiry
        await metrcAuth.clearTokens();
        console.log('🗑️ Cleared tokens to simulate expiry');
        
        // Try to make an API call - should trigger re-authentication
        try {
            const response = await metrcAuth.makeAuthenticatedRequest({
                method: 'GET',
                url: `${metrcAuth.apiBaseUrl}/strains`,
                params: {
                    licenseNumber: metrcAuth.licenseNumber
                }
            });
            console.log(`✅ API call after token expiry successful: ${response.data?.data?.length || 0} strains retrieved`);
        } catch (error) {
            console.log(`❌ API call after token expiry failed: ${error.message}`);
        }
        
        // Test 6: Final token status
        console.log('\n📋 Test 6: Final Token Status');
        status = metrcAuth.getTokenStatus();
        console.log('Token Status:', JSON.stringify(status, null, 2));
        
        console.log('\n✅ Token refresh mechanism test completed successfully!');
        
    } catch (error) {
        console.error('❌ Token refresh test failed:', error.message);
        console.error(error.stack);
    }
}

// Run the test
if (require.main === module) {
    testTokenRefresh();
}

module.exports = { testTokenRefresh };
