#!/usr/bin/env node

/**
 * Enhanced Sync Outgoing Transfers from METRC T3 API
 * 
 * This script implements incremental/delta sync strategy for outgoing transfers.
 * It queries the local DB for the latest lastmodified timestamp and uses it
 * to filter API requests, performing bulk UPSERT operations.
 * 
 * Usage: node scripts/sync/sync-outgoing-transfers-enhanced.js
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

// Field mapping for outgoing transfers (production schema)
const OUTGOING_TRANSFER_FIELDS = {
    metrcid: 'id',
    transfer_type: 'transferType',
    state: 'state',
    estimated_departure_date_time: 'estimatedDepartureDateTime',
    estimated_arrival_date_time: 'estimatedArrivalDateTime',
    actual_departure_date_time: 'actualDepartureDateTime',
    actual_arrival_date_time: 'actualArrivalDateTime',
    delivery_count: 'deliveryCount',
    package_count: 'packageCount',
    created_by_user_id: 'createdByUserId',
    created_date_time: 'createdDateTime',
    lastmodified: 'lastModified',  // Production uses lastmodified (one word)
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
 * Get the latest lastmodified timestamp from local database
 */
async function getLatestLastModified(client) {
    try {
        const query = `
            SELECT MAX(lastmodified) as latest_timestamp 
            FROM outgoingtransfers 
            WHERE sync_license = $1
        `;
        
        const result = await client.query(query, [METRC_CONFIG.licenseNumber]);
        
        if (result.rows[0] && result.rows[0].latest_timestamp) {
            return new Date(result.rows[0].latest_timestamp);
        }
        
        return null;
    } catch (error) {
        console.error('❌ Error getting latest lastmodified:', error.message);
        return null;
    }
}

/**
 * Fetch outgoing transfers from METRC API with incremental filtering
 */
async function fetchOutgoingTransfersIncremental(lastModified = null) {
    try {
        if (!isTokenValid()) {
            const authSuccess = await authenticateWithMetrc();
            if (!authSuccess) {
                throw new Error('Failed to authenticate');
            }
        }

        console.log('📡 Fetching outgoing transfers from METRC API (incremental)...');
        
        const params = {
            licenseNumber: METRC_CONFIG.licenseNumber
        };
        
        // Add lastModified filter if available
        if (lastModified) {
            params.lastModifiedStart = lastModified.toISOString();
            console.log(`🔍 Filtering transfers modified after: ${lastModified.toISOString()}`);
        }
        
        const response = await axios.get(`${METRC_CONFIG.baseURL}/transfers/outgoing/active`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            params
        });

        if (response.data && response.data.data) {
            console.log(`✅ Retrieved ${response.data.data.length} outgoing transfers`);
            return response.data.data;
        } else {
            console.log('⚠️ No outgoing transfers data received');
            return [];
        }
    } catch (error) {
        console.error('❌ Error fetching outgoing transfers:', error.message);
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
    
    // Handle date fields
    if (fieldName.includes('date') || fieldName.includes('Date')) {
        if (value === '') return null;
        return new Date(value);
    }
    
    // Handle boolean fields
    if (typeof value === 'boolean') {
        return value;
    }
    
    // Handle numeric fields
    if (typeof value === 'number') {
        return value;
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
    
    const fields = Object.keys(OUTGOING_TRANSFER_FIELDS);
    const fieldList = fields.join(', ');
    const valuePlaceholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    
    const updateFields = fields.filter(field => field !== 'metrcid' && field !== 'sync_license');
    const updateClause = updateFields.map(field => `${field} = EXCLUDED.${field}`).join(', ');
    
    const upsertQuery = `
        INSERT INTO outgoingtransfers (${fieldList})
        VALUES ${records.map((_, recordIndex) => 
            `(${fields.map((_, fieldIndex) => 
                `$${recordIndex * fields.length + fieldIndex + 1}`
            ).join(', ')})`
        ).join(', ')}
        ON CONFLICT (metrcid) 
        DO UPDATE SET ${updateClause}
    `;
    
    const values = [];
    records.forEach(record => {
        fields.forEach(field => {
            if (field === 'sync_license') {
                values.push(METRC_CONFIG.licenseNumber);
            } else {
                const apiField = OUTGOING_TRANSFER_FIELDS[field];
                values.push(prepareValue(record[apiField], apiField));
            }
        });
    });
    
    await client.query(upsertQuery, values);
}

/**
 * Enhanced sync outgoing transfers to database using incremental strategy
 */
async function syncOutgoingTransfersEnhanced() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Starting enhanced outgoing transfers sync (incremental)...');
        
        // Get latest lastmodified timestamp from local database
        const latestLastModified = await getLatestLastModified(client);
        
        if (latestLastModified) {
            console.log(`📅 Last sync: ${latestLastModified.toISOString()}`);
        } else {
            console.log('📅 No previous sync found, fetching all records');
        }
        
        // Fetch data from API with incremental filtering
        const outgoingTransfers = await fetchOutgoingTransfersIncremental(latestLastModified);
        
        if (outgoingTransfers.length === 0) {
            console.log('ℹ️ No new or updated outgoing transfers to sync');
            return;
        }

        console.log(`📊 Processing ${outgoingTransfers.length} outgoing transfers...`);
        
        // Process records in chunks to prevent database locks
        await processRecordsInChunks(client, outgoingTransfers, 'UPSERT');
        
        console.log(`✅ Enhanced sync completed: ${outgoingTransfers.length} records processed`);
        
    } catch (error) {
        console.error('❌ Enhanced sync failed:', error.message);
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
        console.log('🚀 Starting METRC Enhanced Outgoing Transfers Sync');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 License: ${METRC_CONFIG.licenseNumber}`);
        
        await syncOutgoingTransfersEnhanced();
        
        console.log('✅ Enhanced outgoing transfers sync completed successfully');
        
    } catch (error) {
        console.error('❌ Enhanced outgoing transfers sync failed:', error.message);
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
    syncOutgoingTransfersEnhanced,
    fetchOutgoingTransfersIncremental,
    authenticateWithMetrc
};
