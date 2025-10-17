#!/usr/bin/env node

/**
 * Sync Items from METRC T3 API
 * 
 * This script synchronizes items data from the METRC T3 API
 * to the local PostgreSQL database using incremental sync strategy.
 * 
 * Usage: node scripts/sync/sync-items.js
 */

const axios = require('axios');
const { Pool } = require('pg');
const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
}

// Database configuration
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
};

// METRC API configuration
const METRC_CONFIG = {
    baseURL: process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2',
    hostname: process.env.T3_HOSTNAME || 'mo.metrc.com',
    username: process.env.T3_USERNAME,
    password: process.env.T3_PASSWORD,
    licenseNumber: process.env.T3_LICENSE_NUMBER || 'CUL000063'
};

// Field mapping for items (production schema - simplified)
const ITEM_FIELDS = {
    metrcid: 'id',
    name: 'name',
    productcategoryname: 'productCategoryName',
    productcategorytypename: 'productCategoryTypeName',
    quantitytypename: 'quantityTypeName',
    unitofmeasurename: 'unitOfMeasureName',
    approvalstatusname: 'approvalStatusName',
    strainid: 'strainId',
    strainname: 'strainName',
    isused: 'isUsed',
    approvalstatusdatetime: 'approvalStatusDateTime',
    lastmodified: 'lastModified',
    sync_license: 'license_number'
};

// Create database pool
const pool = new Pool(DB_CONFIG);

// Authentication token cache
let authToken = null;
let tokenExpiry = null;

/**
 * Authenticate with METRC T3 API
 */
async function authenticateWithMetrc() {
    try {
        console.log('🔐 Authenticating with METRC T3 API...');
        
        const response = await axios.post(`${METRC_CONFIG.baseURL}/auth/credentials`, {
            username: METRC_CONFIG.username,
            password: METRC_CONFIG.password,
            hostname: METRC_CONFIG.hostname
        });

        if (response.data && response.data.accessToken) {
            authToken = response.data.accessToken;
            tokenExpiry = new Date(Date.now() + (24 * 60 * 60 * 1000)); // 24 hours from now
            console.log('✅ Authentication successful');
            return true;
        } else {
            throw new Error('Invalid authentication response');
        }
    } catch (error) {
        console.error('❌ Authentication failed:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        return false;
    }
}

/**
 * Check if authentication token is valid
 */
function isTokenValid() {
    return authToken && tokenExpiry && new Date() < tokenExpiry;
}

/**
 * Fetch items from METRC API
 */
async function fetchItems() {
    try {
        if (!isTokenValid()) {
            const authSuccess = await authenticateWithMetrc();
            if (!authSuccess) {
                throw new Error('Failed to authenticate');
            }
        }

        console.log('📡 Fetching items from METRC API...');
        
        const response = await axios.get(`${METRC_CONFIG.baseURL}/items`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            params: {
                licenseNumber: METRC_CONFIG.licenseNumber
            }
        });

        if (response.data && response.data.data) {
            console.log(`✅ Retrieved ${response.data.data.length} items`);
            return response.data.data;
        } else {
            console.log('⚠️ No items data received');
            return [];
        }
    } catch (error) {
        console.error('❌ Error fetching items:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        throw error;
    }
}

/**
 * Prepare value for database insertion
 */
function prepareValue(value, fieldName) {
    if (value === null || value === undefined) {
        return null;
    }
    
    // Handle string fields
    return String(value);
}

/**
 * Process records in chunks to prevent database locks
 */
async function processRecordsInChunks(client, records, operation = 'UPSERT') {
    const CHUNK_SIZE = 50;
    const DELAY_BETWEEN_CHUNKS = 100; // milliseconds
    
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);
        
        try {
            if (operation === 'UPSERT') {
                await performBulkUpsert(client, chunk);
            }
            
            console.log(`✅ Processed chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(records.length / CHUNK_SIZE)} (${chunk.length} records)`);
            
            // Small delay to release database locks
            if (i + CHUNK_SIZE < records.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS));
            }
            
        } catch (error) {
            console.error(`❌ Error processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}:`, error.message);
            throw error;
        }
    }
}

/**
 * Perform bulk UPSERT operation
 */
async function performBulkUpsert(client, records) {
    if (records.length === 0) return;
    
    const fields = Object.keys(ITEM_FIELDS);
    const fieldList = fields.join(', ');
    const valuePlaceholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    
    const updateFields = fields.filter(field => field !== 'metrcid' && field !== 'sync_license');
    const updateClause = updateFields.map(field => `${field} = EXCLUDED.${field}`).join(', ');
    
    const insertQuery = `
        INSERT INTO items (${fieldList})
        VALUES ${records.map((_, recordIndex) => 
            `(${fields.map((_, fieldIndex) => 
                `$${recordIndex * fields.length + fieldIndex + 1}`
            ).join(', ')})`
        ).join(', ')}
        ON CONFLICT (metrcid) DO NOTHING
    `;
    
    const values = [];
    records.forEach(record => {
        fields.forEach(field => {
            if (field === 'sync_license') {
                values.push(METRC_CONFIG.licenseNumber);
            } else {
                const apiField = ITEM_FIELDS[field];
                values.push(prepareValue(record[apiField], field));
            }
        });
    });
    
    await client.query(insertQuery, values);
}

/**
 * Sync items to database
 */
async function syncItems() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Starting items sync...');
        
        // Fetch data from API
        const items = await fetchItems();
        
        if (items.length === 0) {
            console.log('ℹ️ No items to sync');
            return;
        }

        console.log(`📊 Processing ${items.length} items...`);
        
        // Process records in chunks to prevent database locks
        await processRecordsInChunks(client, items, 'UPSERT');
        
        console.log(`✅ Items sync completed: ${items.length} records processed`);
        
    } catch (error) {
        console.error('❌ Items sync failed:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Main execution function
 */
async function main() {
    try {
        console.log('🚀 Starting METRC Items Sync');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 License: ${METRC_CONFIG.licenseNumber}`);
        
        await syncItems();
        
        console.log('✅ Items sync completed successfully');
        
    } catch (error) {
        console.error('❌ Items sync failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = {
    syncItems,
    fetchItems,
    authenticateWithMetrc
};
