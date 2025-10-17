#!/usr/bin/env node

const http = require('http');

async function testAPIEndpoints() {
    console.log('🧪 Testing Production API Endpoints');
    console.log('📊 Environment: production');
    console.log('🌐 Server: http://localhost:3000');
    
    const baseURL = 'http://localhost:3000';
    
    // Test endpoints
    const endpoints = [
        { path: '/', method: 'GET', description: 'Root endpoint' },
        { path: '/admin', method: 'GET', description: 'Admin dashboard' },
        { path: '/auth/login', method: 'GET', description: 'Login page' },
        { path: '/api/v1/admin/sync/status', method: 'GET', description: 'Sync status API' },
        { path: '/api/v1/admin/sync/active-packages', method: 'POST', description: 'Active packages sync API' },
        { path: '/api/v1/admin/sync/outgoing-transfers', method: 'POST', description: 'Outgoing transfers sync API' },
        { path: '/api/v1/admin/sync/strains', method: 'POST', description: 'Strains sync API' },
        { path: '/api/v1/admin/sync/items', method: 'POST', description: 'Items sync API' },
        { path: '/api/v1/admin/sync/transferred-packages', method: 'POST', description: 'Transferred packages sync API' },
        { path: '/api/v1/admin/sync/intransit-packages', method: 'POST', description: 'In-transit packages sync API' }
    ];
    
    for (const endpoint of endpoints) {
        try {
            const result = await makeRequest(baseURL + endpoint.path, endpoint.method);
            console.log(`✅ ${endpoint.description}: ${result.status} - ${result.message}`);
        } catch (error) {
            console.log(`❌ ${endpoint.description}: ${error.message}`);
        }
    }
    
    console.log('\n✅ API endpoint testing completed!');
}

function makeRequest(url, method = 'GET') {
    return new Promise((resolve, reject) => {
        const options = {
            method: method,
            timeout: 5000
        };
        
        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                let message = '';
                if (res.statusCode === 200) {
                    message = 'OK';
                } else if (res.statusCode === 302) {
                    message = 'Redirect';
                } else if (res.statusCode === 401) {
                    message = 'Unauthorized (Expected)';
                } else if (res.statusCode === 404) {
                    message = 'Not Found';
                } else {
                    message = `Status ${res.statusCode}`;
                }
                
                resolve({
                    status: res.statusCode,
                    message: message,
                    data: data.substring(0, 100) // First 100 chars
                });
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

// Run the API test
testAPIEndpoints()
    .then(() => {
        console.log('✅ API testing completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ API testing failed:', error.message);
        process.exit(1);
    });
