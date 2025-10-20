#!/usr/bin/env node

/**
 * Sync Strains from METRC T3 API
 * 
 * This script synchronizes strains data from the METRC T3 API
 * to the local PostgreSQL database using incremental sync strategy.
 * 
 * Usage: node scripts/sync/sync-strains.js
 */

const { Pool } = require('pg');
const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
}

// Import centralized METRC authentication service
const metrcAuth = require('../../Server/Services/metrcAuth');

// Database configuration
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false }
};

// Field mapping for strains (production schema)
const STRAIN_FIELDS = {
    metrcid: 'id',
    name: 'name',
    testing_status: 'testingStatus',  // Production uses testing_status
    thc_level: 'thcPercent',
    cbd_level: 'cbdPercent',
    indica_percentage: 'indicasPercent',
    sativa_percentage: 'sativaPercent',
    sync_license: 'license_number'
};

// Create database pool
const pool = new Pool(DB_CONFIG);

/**
 * Get database connection with retry logic
 */
async function getDatabaseConnection(retries = 3, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`🔌 Attempting database connection (attempt ${i + 1}/${retries})...`);
            const client = await pool.connect();
            console.log('✅ Database connection established');
            return client;
        } catch (error) {
            console.error(`❌ Database connection attempt ${i + 1} failed:`, error.message);
            
            if (i === retries - 1) {
                throw new Error(`Failed to connect to database after ${retries} attempts: ${error.message}`);
            }
            
            console.log(`⏳ Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Fetch strains from METRC API
 */
async function fetchStrains() {
    try {
        console.log('📡 Fetching strains from METRC API...');
        
        let allStrains = [];
        let page = 1;
        let hasMorePages = true;
        const pageSize = 500; // Maximum allowed by API
        
        while (hasMorePages) {
            console.log(`📄 Fetching strains page ${page}...`);
            
            let retries = 3;
            let success = false;
            
            while (retries > 0 && !success) {
                try {
                    const response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: `${metrcAuth.apiBaseUrl}/strains`,
                        params: {
                            licenseNumber: metrcAuth.licenseNumber,
                            page: page,
                            pageSize: pageSize
                        }
                    });

                    if (response.data && response.data.data) {
                        const strains = response.data.data;
                        allStrains = allStrains.concat(strains);
                        
                        console.log(`✅ Retrieved ${strains.length} strains from page ${page} (total: ${allStrains.length})`);
                        
                        // Check if there are more pages
                        const totalPages = response.data.totalPages || Math.ceil(response.data.total / pageSize);
                        hasMorePages = page < totalPages;
                        page++;
                        success = true;
                        
                        // Small delay to avoid rate limiting
                        if (hasMorePages) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    } else {
                        console.log('⚠️ No strains data received for page', page);
                        hasMorePages = false;
                        success = true;
                    }
                } catch (error) {
                    retries--;
                    if (retries > 0) {
                        console.log(`⚠️ API error on page ${page}, retrying in 2 seconds... (${retries} retries left)`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
                        console.error(`❌ Failed to fetch page ${page} after 3 retries:`, error.message);
                        throw error;
                    }
                }
            }
        }

        console.log(`✅ Retrieved ${allStrains.length} total strains across ${page - 1} pages`);
        return allStrains;
        
    } catch (error) {
        console.error('❌ Error fetching strains:', error.message);
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
    
    // Handle testing_status conversion from string to integer
    if (fieldName === 'testing_status') {
        if (value === 'None') return 0;
        if (value === 'ThirdParty') return 1;
        if (value === 'InHouse') return 2;
        return parseInt(value) || 0;
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
async function processRecordsInChunks(client, records, operation = 'INSERT') {
    const CHUNK_SIZE = 500;
    const DELAY_BETWEEN_CHUNKS = 100; // milliseconds
    
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);
        
        try {
            if (operation === 'INSERT') {
                await performBulkInsert(client, chunk);
            } else if (operation === 'UPDATE') {
                await performBulkUpdate(client, chunk);
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
 * Perform bulk INSERT operation
 */
async function performBulkInsert(client, records) {
    if (records.length === 0) return;
    
    const fields = Object.keys(STRAIN_FIELDS);
    const fieldList = fields.join(', ');
    
    const insertQuery = `
        INSERT INTO strains (${fieldList})
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
                values.push(metrcAuth.licenseNumber);
            } else {
                const apiField = STRAIN_FIELDS[field];
                values.push(prepareValue(record[apiField], field));
            }
        });
    });
    
    await client.query(insertQuery, values);
}

/**
 * Perform bulk UPDATE operation
 */
async function performBulkUpdate(client, records) {
    if (records.length === 0) return;
    
    const fields = Object.keys(STRAIN_FIELDS);
    const updateFields = fields.filter(field => field !== 'metrcid' && field !== 'sync_license');
    
    // Create temporary table for bulk update
    const tempTableName = `temp_strains_update_${Date.now()}`;
    
    try {
        // Create temporary table
        const createTempTableQuery = `
            CREATE TEMP TABLE ${tempTableName} (
                metrcid INTEGER,
                ${updateFields.map(field => `${field} ${getFieldType(field)}`).join(', ')}
            )
        `;
        await client.query(createTempTableQuery);
        
        // Insert data into temporary table
        const insertTempQuery = `
            INSERT INTO ${tempTableName} (metrcid, ${updateFields.join(', ')})
            VALUES ${records.map((_, i) => 
                `($${i * (updateFields.length + 1) + 1}, ${updateFields.map((_, j) => 
                    `$${i * (updateFields.length + 1) + 2 + j}`
                ).join(', ')})`
            ).join(', ')}
        `;
        
        const values = [];
        records.forEach(record => {
            values.push(parseInt(record.id)); // Convert to integer
            updateFields.forEach(field => {
                const apiField = STRAIN_FIELDS[field];
                values.push(prepareValue(record[apiField], field));
            });
        });
        
        await client.query(insertTempQuery, values);
        
        // Perform bulk update using JOIN
        const updateQuery = `
            UPDATE strains 
            SET ${updateFields.map(field => `${field} = t.${field}`).join(', ')}
            FROM ${tempTableName} t
            WHERE strains.metrcid = t.metrcid 
            AND strains.sync_license = $1
        `;
        
        await client.query(updateQuery, [metrcAuth.licenseNumber]);
        
    } finally {
        // Clean up temporary table
        try {
            await client.query(`DROP TABLE IF EXISTS ${tempTableName}`);
        } catch (error) {
            // Ignore cleanup errors
        }
    }
}

/**
 * Check if strain content has changed by comparing key fields
 */
function hasStrainChanged(apiStrain, localStrain) {
    // Compare key fields that could change
    const fieldsToCompare = [
        'name',
        'testingStatus', 
        'thcPercent',
        'cbdPercent',
        'indicasPercent',
        'sativaPercent'
    ];
    
    for (const field of fieldsToCompare) {
        const apiValue = apiStrain[field];
        const localValue = getLocalFieldValue(localStrain, field);
        
        // Handle different data types and null values
        if (field === 'testingStatus') {
            // Convert API string to integer for comparison
            const apiInt = apiValue === 'None' ? 0 : apiValue === 'ThirdParty' ? 1 : apiValue === 'InHouse' ? 2 : parseInt(apiValue) || 0;
            if (apiInt !== localValue) {
                return true;
            }
        } else if (field === 'thcPercent' || field === 'cbdPercent' || field === 'indicasPercent' || field === 'sativaPercent') {
            // Compare decimal values
            const apiDecimal = parseFloat(apiValue) || 0;
            const localDecimal = parseFloat(localValue) || 0;
            if (Math.abs(apiDecimal - localDecimal) > 0.01) { // Allow small floating point differences
                return true;
            }
        } else {
            // Compare string values
            if (String(apiValue || '').trim() !== String(localValue || '').trim()) {
                return true;
            }
        }
    }
    
    return false;
}

/**
 * Get local field value based on database column name
 */
function getLocalFieldValue(localStrain, apiField) {
    const fieldMapping = {
        'name': 'name',
        'testingStatus': 'testing_status',
        'thcPercent': 'thc_level',
        'cbdPercent': 'cbd_level',
        'indicasPercent': 'indica_percentage',
        'sativaPercent': 'sativa_percentage'
    };
    
    const dbField = fieldMapping[apiField];
    return localStrain[dbField];
}

/**
 * Get field type for temporary table creation
 */
function getFieldType(field) {
    const typeMap = {
        'metrcid': 'INTEGER',
        'name': 'VARCHAR(255)',
        'testing_status': 'INTEGER',
        'thc_level': 'DECIMAL(5,2)',
        'cbd_level': 'DECIMAL(5,2)',
        'indica_percentage': 'DECIMAL(5,2)',
        'sativa_percentage': 'DECIMAL(5,2)',
        'createdby': 'VARCHAR(255)',
        'createdbyuserid': 'VARCHAR(255)',
        'createddatetime': 'TIMESTAMP',
        'last_modified': 'TIMESTAMP',
        'sync_license': 'VARCHAR(255)'
    };
    return typeMap[field] || 'TEXT';
}

/**
 * Update sync progress in the database
 */
async function updateSyncProgress(client, syncType, license, lastTimestamp = null) {
    try {
        const query = `
            INSERT INTO sync_progress (sync_type, license, last_timestamp, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (sync_type, license)
            DO UPDATE SET 
                last_timestamp = COALESCE($3, sync_progress.last_timestamp),
                updated_at = NOW()
        `;
        
        await client.query(query, [syncType, license, lastTimestamp]);
        console.log(`📊 Updated sync progress: ${syncType} for ${license}`);
    } catch (error) {
        console.error('❌ Error updating sync progress:', error.message);
    }
}

/**
 * Create sync job entry
 */
async function createSyncJob(client, scriptName, license, userId = null) {
    try {
        const jobId = require('crypto').randomUUID();
        const query = `
            INSERT INTO sync_jobs (job_id, license_number, script_name, status, start_time, triggered_by_user_id)
            VALUES ($1, $2, $3, 'running', NOW(), $4)
        `;
        
        await client.query(query, [jobId, license, scriptName, userId]);
        console.log(`📋 Created sync job: ${jobId} for ${scriptName}`);
        return jobId;
    } catch (error) {
        console.error('❌ Error creating sync job:', error.message);
        return null;
    }
}

/**
 * Update sync job status
 */
async function updateSyncJob(client, jobId, status, outputLog = null, errorLog = null) {
    try {
        const query = `
            UPDATE sync_jobs 
            SET status = $1, end_time = NOW(), output_log = $2, error_log = $3
            WHERE job_id = $4
        `;
        
        await client.query(query, [status, outputLog, errorLog, jobId]);
        console.log(`📋 Updated sync job: ${jobId} - ${status}`);
    } catch (error) {
        console.error('❌ Error updating sync job:', error.message);
    }
}

/**
 * Create sync history entry
 */
async function createSyncHistory(client, syncType, license, userId = null, scriptName = null) {
    try {
        const query = `
            INSERT INTO sync_history (license_number, sync_type, start_time, status, user_id, script_name)
            VALUES ($1, $2, NOW(), 'started', $3, $4)
            RETURNING id
        `;
        
        const result = await client.query(query, [license, syncType, userId, scriptName]);
        const historyId = result.rows[0].id;
        console.log(`📚 Created sync history: ${historyId} for ${syncType}`);
        return historyId;
    } catch (error) {
        console.error('❌ Error creating sync history:', error.message);
        return null;
    }
}

/**
 * Update sync history entry
 */
async function updateSyncHistory(client, historyId, status, durationMs = null, scriptOutput = null, scriptErrorOutput = null) {
    try {
        const query = `
            UPDATE sync_history 
            SET end_time = NOW(), status = $1, duration_ms = $2, script_output = $3, script_error_output = $4
            WHERE id = $5
        `;
        
        await client.query(query, [status, durationMs, scriptOutput, scriptErrorOutput, historyId]);
        console.log(`📚 Updated sync history: ${historyId} - ${status}`);
    } catch (error) {
        console.error('❌ Error updating sync history:', error.message);
    }
}

/**
 * Create sync batch history entry
 */
async function createSyncBatchHistory(client, syncType, userId = null) {
    try {
        const batchId = require('crypto').randomUUID();
        const query = `
            INSERT INTO sync_batch_history (batch_id, sync_type, overall_start_time, status, user_id)
            VALUES ($1, $2, NOW(), 'started', $3)
        `;
        
        await client.query(query, [batchId, syncType, userId]);
        console.log(`📦 Created sync batch: ${batchId} for ${syncType}`);
        return batchId;
    } catch (error) {
        console.error('❌ Error creating sync batch:', error.message);
        return null;
    }
}

/**
 * Update sync batch history entry
 */
async function updateSyncBatchHistory(client, batchId, status, durationMs = null, errorMessage = null) {
    try {
        const query = `
            UPDATE sync_batch_history 
            SET overall_end_time = NOW(), status = $1, overall_duration_ms = $2, error_message = $3
            WHERE batch_id = $4
        `;
        
        await client.query(query, [status, durationMs, errorMessage, batchId]);
        console.log(`📦 Updated sync batch: ${batchId} - ${status}`);
    } catch (error) {
        console.error('❌ Error updating sync batch:', error.message);
    }
}

/**
 * Sync strains to database
 */
async function syncStrains() {
    const client = await getDatabaseConnection();
    const startTime = Date.now();
    let jobId = null;
    let historyId = null;
    let batchId = null;
    let scriptOutput = '';
    let scriptError = '';
    
    try {
        console.log('🔄 Starting strains sync...');
        
        // Create tracking entries
        const userId = process.env.SYNC_USER_ID ? parseInt(process.env.SYNC_USER_ID) : null;
        jobId = await createSyncJob(client, 'sync-strains.js', metrcAuth.licenseNumber, userId);
        historyId = await createSyncHistory(client, 'strains', metrcAuth.licenseNumber, userId, 'sync-strains.js');
        batchId = await createSyncBatchHistory(client, 'strains', userId);
        
        // Fetch data from API
        const strains = await fetchStrains();
        
        if (strains.length === 0) {
            console.log('ℹ️ No strains to sync');
            scriptOutput = 'No strains to sync';
            
            // Update tracking entries for empty sync
            await updateSyncJob(client, jobId, 'completed', scriptOutput);
            await updateSyncHistory(client, historyId, 'completed', Date.now() - startTime, scriptOutput);
            await updateSyncBatchHistory(client, batchId, 'completed', Date.now() - startTime);
            await updateSyncProgress(client, 'strains', metrcAuth.licenseNumber, new Date());
            
            return;
        }

        console.log(`📊 Processing ${strains.length} strains...`);
        
        // Get existing strains for comparison
        const existingResult = await client.query(
            'SELECT metrcid, name, testing_status, thc_level, cbd_level, indica_percentage, sativa_percentage, updated_at FROM strains WHERE sync_license = $1',
            [metrcAuth.licenseNumber]
        );
        
        const existingStrains = new Map();
        existingResult.rows.forEach(row => {
            existingStrains.set(row.metrcid, row);
        });
        
        console.log(`📊 Found ${existingStrains.size} existing strains in local database`);
        
        // Categorize strains
        const strainsToInsert = [];
        const strainsToUpdate = [];
        const strainsToDelete = [];
        
        // Process API strains
        for (const strain of strains) {
            const existing = existingStrains.get(strain.id);
            
            if (!existing) {
                // New strain - insert
                strainsToInsert.push(strain);
            } else {
                // Existing strain - check if content has changed
                const hasChanged = hasStrainChanged(strain, existing);
                
                if (hasChanged) {
                    strainsToUpdate.push(strain);
                    console.log(`🔄 Strain ${strain.id} has changes, will update`);
                } else {
                    // Skip update - strain content is the same
                    console.log(`⏭️ Skipping strain ${strain.id} (no changes detected)`);
                }
            }
        }
        
        // Find strains to delete (exist locally but not in API)
        for (const [metrcid, existing] of existingStrains) {
            if (!strains.find(strain => strain.id === metrcid)) {
                strainsToDelete.push(metrcid);
            }
        }
        
        console.log(`📊 Sync plan: ${strainsToInsert.length} insert, ${strainsToUpdate.length} update, ${strainsToDelete.length} delete`);
        
        // Execute operations
        if (strainsToInsert.length > 0) {
            console.log('📥 Inserting new strains...');
            await processRecordsInChunks(client, strainsToInsert, 'INSERT');
        }
        
        if (strainsToUpdate.length > 0) {
            console.log('🔄 Updating existing strains...');
            await processRecordsInChunks(client, strainsToUpdate, 'UPDATE');
        }
        
        if (strainsToDelete.length > 0) {
            console.log('🗑️ Deleting stale strains...');
            const deleteQuery = `
                DELETE FROM strains 
                WHERE metrcid = ANY($1) AND sync_license = $2
            `;
            await client.query(deleteQuery, [strainsToDelete, metrcAuth.licenseNumber]);
        }
        
        const duration = Date.now() - startTime;
        scriptOutput = `Strains sync completed: ${strainsToInsert.length} inserted, ${strainsToUpdate.length} updated, ${strainsToDelete.length} deleted in ${duration}ms`;
        
        // Update all tracking entries
        await updateSyncJob(client, jobId, 'completed', scriptOutput);
        await updateSyncHistory(client, historyId, 'completed', duration, scriptOutput);
        await updateSyncBatchHistory(client, batchId, 'completed', duration);
        await updateSyncProgress(client, 'strains', metrcAuth.licenseNumber, new Date());
        
        console.log(`✅ Strains sync completed: ${strainsToInsert.length} inserted, ${strainsToUpdate.length} updated, ${strainsToDelete.length} deleted`);
        
    } catch (error) {
        const duration = Date.now() - startTime;
        scriptError = error.message;
        
        console.error('❌ Strains sync failed:', error.message);
        
        // Update tracking entries for failed sync
        if (jobId) await updateSyncJob(client, jobId, 'failed', scriptOutput, scriptError);
        if (historyId) await updateSyncHistory(client, historyId, 'failed', duration, scriptOutput, scriptError);
        if (batchId) await updateSyncBatchHistory(client, batchId, 'failed', duration, scriptError);
        
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
        console.log('🚀 Starting METRC Strains Sync');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 License: ${metrcAuth.licenseNumber}`);
        
        await syncStrains();
        
        console.log('✅ Strains sync completed successfully');
        
    } catch (error) {
        console.error('❌ Strains sync failed:', error.message);
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
    syncStrains,
    fetchStrains
};
