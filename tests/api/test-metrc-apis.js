#!/usr/bin/env node

/**
 * METRC T3 API Testing Script
 * 
 * This script tests all required METRC T3 API endpoints
 * Run with: node test-metrc-apis.js
 */

const https = require('https');
const fs = require('fs');

// Configuration from .ENV file
const config = {
    baseUrl: 'https://api.trackandtrace.tools/v2',
    hostname: 'mo.metrc.com',
    username: 'AGT007392',
    password: 'Metalhead4!',
    licenseNumber: 'CUL000063'
};

// Test results storage
const testResults = {
    authentication: { status: 'pending', details: null },
    endpoints: {}
};

/**
 * Make HTTPS request
 */
function makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const response = {
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: data ? JSON.parse(data) : null
                    };
                    resolve(response);
                } catch (error) {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: data
                    });
                }
            });
        });

        req.on('error', reject);
        
        if (postData) {
            req.write(postData);
        }
        
        req.end();
    });
}

/**
 * Test authentication
 */
async function testAuthentication() {
    console.log('🔐 Testing Authentication...');
    
    const options = {
        hostname: 'api.trackandtrace.tools',
        port: 443,
        path: '/v2/auth/credentials',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'accept': 'application/json'
        }
    };

    const postData = JSON.stringify({
        hostname: config.hostname,
        username: config.username,
        password: config.password
    });

    try {
        const response = await makeRequest(options, postData);
        
        if (response.statusCode === 200 && response.data.accessToken) {
            testResults.authentication = {
                status: 'success',
                details: {
                    accessToken: response.data.accessToken.substring(0, 20) + '...',
                    refreshToken: response.data.refreshToken ? response.data.refreshToken.substring(0, 20) + '...' : null
                }
            };
            console.log('✅ Authentication successful');
            return response.data.accessToken;
        } else {
            testResults.authentication = {
                status: 'failed',
                details: response.data
            };
            console.log('❌ Authentication failed:', response.data);
            return null;
        }
    } catch (error) {
        testResults.authentication = {
            status: 'error',
            details: error.message
        };
        console.log('❌ Authentication error:', error.message);
        return null;
    }
}

/**
 * Test API endpoint
 */
async function testEndpoint(endpointName, path, accessToken) {
    console.log(`🧪 Testing ${endpointName}...`);
    
    const options = {
        hostname: 'api.trackandtrace.tools',
        port: 443,
        path: `${path}?licenseNumber=${config.licenseNumber}&strictPagination=true&pageSize=10&page=1`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'accept': 'application/json'
        }
    };

    try {
        const response = await makeRequest(options);
        
        const result = {
            statusCode: response.statusCode,
            success: response.statusCode === 200,
            dataCount: response.data?.data?.length || 0,
            totalRecords: response.data?.total || 0,
            error: response.statusCode !== 200 ? response.data : null
        };

        testResults.endpoints[endpointName] = result;

        if (result.success) {
            console.log(`✅ ${endpointName}: ${result.dataCount} records (${result.totalRecords} total)`);
        } else {
            console.log(`❌ ${endpointName}: ${response.statusCode} - ${result.error}`);
        }

        return result;
    } catch (error) {
        const result = {
            statusCode: 0,
            success: false,
            error: error.message
        };
        
        testResults.endpoints[endpointName] = result;
        console.log(`❌ ${endpointName}: Error - ${error.message}`);
        return result;
    }
}

/**
 * Test all endpoints
 */
async function testAllEndpoints(accessToken) {
    const endpoints = [
        { name: 'Active Packages', path: '/v2/packages/active' },
        { name: 'Transferred Packages', path: '/v2/packages/transferred' },
        { name: 'In-Transit Packages', path: '/v2/packages/intransit' },
        { name: 'Outgoing Transfers', path: '/v2/transfers/outgoing/active' },
        { name: 'Items', path: '/v2/items' },
        { name: 'Strains', path: '/v2/strains' }
    ];

    console.log('\n📊 Testing All Endpoints...');
    
    for (const endpoint of endpoints) {
        await testEndpoint(endpoint.name, endpoint.path, accessToken);
        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

/**
 * Generate test report
 */
function generateReport() {
    console.log('\n📋 Test Report');
    console.log('='.repeat(50));
    
    // Authentication status
    console.log(`\n🔐 Authentication: ${testResults.authentication.status.toUpperCase()}`);
    if (testResults.authentication.details) {
        console.log(`   Details: ${JSON.stringify(testResults.authentication.details, null, 2)}`);
    }
    
    // Endpoint results
    console.log('\n📊 Endpoint Results:');
    Object.entries(testResults.endpoints).forEach(([name, result]) => {
        const status = result.success ? '✅' : '❌';
        const details = result.success 
            ? `${result.dataCount} records (${result.totalRecords} total)`
            : `Error: ${result.error}`;
        console.log(`   ${status} ${name}: ${details}`);
    });
    
    // Summary
    const totalEndpoints = Object.keys(testResults.endpoints).length;
    const successfulEndpoints = Object.values(testResults.endpoints).filter(r => r.success).length;
    const failedEndpoints = totalEndpoints - successfulEndpoints;
    
    console.log('\n📈 Summary:');
    console.log(`   Total Endpoints: ${totalEndpoints}`);
    console.log(`   Successful: ${successfulEndpoints}`);
    console.log(`   Failed: ${failedEndpoints}`);
    console.log(`   Success Rate: ${((successfulEndpoints / totalEndpoints) * 100).toFixed(1)}%`);
    
    // Save results to file
    const reportData = {
        timestamp: new Date().toISOString(),
        config: {
            hostname: config.hostname,
            username: config.username,
            licenseNumber: config.licenseNumber
        },
        results: testResults
    };
    
    fs.writeFileSync('metrc-api-test-results.json', JSON.stringify(reportData, null, 2));
    console.log('\n💾 Test results saved to: metrc-api-test-results.json');
}

/**
 * Main test function
 */
async function runTests() {
    console.log('🚀 Starting METRC T3 API Tests');
    console.log('='.repeat(50));
    console.log(`Hostname: ${config.hostname}`);
    console.log(`Username: ${config.username}`);
    console.log(`License: ${config.licenseNumber}`);
    console.log(`Base URL: ${config.baseUrl}`);
    
    // Test authentication first
    const accessToken = await testAuthentication();
    
    if (!accessToken) {
        console.log('\n❌ Cannot proceed without valid authentication token');
        generateReport();
        return;
    }
    
    // Test all endpoints
    await testAllEndpoints(accessToken);
    
    // Generate report
    generateReport();
    
    console.log('\n🎯 Next Steps:');
    console.log('   1. Review test results above');
    console.log('   2. Check metrc-api-test-results.json for detailed results');
    console.log('   3. Fix any failed endpoints before implementing sync services');
    console.log('   4. Use Postman collection for interactive testing');
}

// Run tests if this script is executed directly
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = { runTests, testAuthentication, testEndpoint };
