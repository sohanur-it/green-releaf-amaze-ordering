#!/usr/bin/env node
/**
 * Test METRC Authentication
 * This script tests METRC T3 API authentication to diagnose issues
 */

require('dotenv').config({ path: './config/production.env' });
const axios = require('axios');

async function testAuth() {
    const apiBaseUrl = process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
    const username = process.env.T3_USERNAME;
    const password = process.env.T3_PASSWORD;
    const hostname = process.env.T3_HOSTNAME || 'mo.metrc.com';
    
    console.log('🔐 Testing METRC Authentication...');
    console.log(`📍 API Base URL: ${apiBaseUrl}`);
    console.log(`🏢 Hostname: ${hostname}`);
    console.log(`👤 Username: ${username}`);
    console.log(`🔑 Password: ${password ? '***' + password.slice(-2) : 'NOT SET'}`);
    console.log('');
    
    if (!username || !password) {
        console.error('❌ Missing credentials! Please check your production.env file.');
        process.exit(1);
    }
    
    try {
        console.log('📤 Sending authentication request...');
        const response = await axios.post(`${apiBaseUrl}/auth/credentials`, {
            username: username,
            password: password,
            hostname: hostname
        }, {
            headers: {
                'Content-Type': 'application/json',
                'accept': 'application/json'
            },
            timeout: 30000
        });
        
        console.log(`✅ Response Status: ${response.status}`);
        console.log(`✅ Response Headers:`, JSON.stringify(response.headers, null, 2));
        
        if (response.data && response.data.accessToken) {
            console.log('✅ Authentication SUCCESSFUL!');
            console.log(`📝 Access Token: ${response.data.accessToken.substring(0, 50)}...`);
            console.log(`📝 Refresh Token: ${response.data.refreshToken ? response.data.refreshToken.substring(0, 50) + '...' : 'None'}`);
            
            // Decode JWT to check expiry
            try {
                const parts = response.data.accessToken.split('.');
                if (parts.length === 3) {
                    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                    if (payload.exp) {
                        const expiry = new Date(payload.exp * 1000);
                        console.log(`⏰ Token Expires: ${expiry.toISOString()}`);
                        console.log(`⏰ Current Time: ${new Date().toISOString()}`);
                        console.log(`⏰ Valid for: ${Math.round((expiry - Date.now()) / 1000 / 60)} minutes`);
                    }
                }
            } catch (e) {
                console.log('⚠️  Could not decode token');
            }
            
            process.exit(0);
        } else {
            console.error('❌ Authentication failed: No access token in response');
            console.error('Response data:', JSON.stringify(response.data, null, 2));
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Authentication ERROR:');
        
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Status Text: ${error.response.statusText}`);
            console.error(`   Response Data:`, JSON.stringify(error.response.data, null, 2));
            console.error(`   Response Headers:`, JSON.stringify(error.response.headers, null, 2));
        } else if (error.request) {
            console.error(`   Request Error: No response received`);
            console.error(`   Request Details:`, error.request);
        } else {
            console.error(`   Error: ${error.message}`);
            console.error(`   Stack:`, error.stack);
        }
        
        process.exit(1);
    }
}

testAuth();

