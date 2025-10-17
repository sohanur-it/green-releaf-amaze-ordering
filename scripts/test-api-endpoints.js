#!/usr/bin/env node

/**
 * Test script to verify API endpoints work with proper authentication
 */

const axios = require('axios');

async function testAPIEndpoints() {
    console.log('🧪 Testing API endpoints...');
    
    try {
        // First, login to get a session
        console.log('\n🔐 Logging in...');
        const loginResponse = await axios.post('http://localhost:3000/auth/login', {
            username: 'admin',
            password: 'admin123'
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            withCredentials: true
        });
        
        console.log('Login status:', loginResponse.status);
        
        // Extract cookies from the response
        const cookies = loginResponse.headers['set-cookie'];
        console.log('Cookies received:', cookies ? 'Yes' : 'No');
        
        // Test the users API endpoint
        console.log('\n👥 Testing users API...');
        const usersResponse = await axios.get('http://localhost:3000/api/v1/admin/users', {
            headers: {
                'Cookie': cookies ? cookies.join('; ') : ''
            },
            withCredentials: true
        });
        
        console.log('Users API status:', usersResponse.status);
        console.log('Users found:', usersResponse.data.users ? usersResponse.data.users.length : 'No users data');
        
        // Test the roles API endpoint
        console.log('\n🎭 Testing roles API...');
        const rolesResponse = await axios.get('http://localhost:3000/api/v1/admin/users/roles', {
            headers: {
                'Cookie': cookies ? cookies.join('; ') : ''
            },
            withCredentials: true
        });
        
        console.log('Roles API status:', rolesResponse.status);
        console.log('Roles found:', rolesResponse.data.roles ? rolesResponse.data.roles.length : 'No roles data');
        
        // Test the audit logs API endpoint
        console.log('\n📝 Testing audit logs API...');
        const auditResponse = await axios.get('http://localhost:3000/api/v1/admin/audit-logs/stats', {
            headers: {
                'Cookie': cookies ? cookies.join('; ') : ''
            },
            withCredentials: true
        });
        
        console.log('Audit logs API status:', auditResponse.status);
        console.log('Audit stats:', auditResponse.data.stats ? 'Received' : 'No stats data');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
    }
}

// Run the test
if (require.main === module) {
    testAPIEndpoints()
        .then(() => {
            console.log('\n✅ API tests completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ API tests failed:', error);
            process.exit(1);
        });
}

module.exports = { testAPIEndpoints };
