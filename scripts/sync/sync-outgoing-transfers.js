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

// Load environment variables FIRST
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
}

// Import centralized METRC authentication service AFTER environment variables are loaded
const metrcAuth = require('../../Server/Services/metrcAuth');

// Import sync failure tracker
const syncFailureTracker = require('../../Server/Services/syncFailureTracker');

// Database configuration
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false }
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
    deliveryid: 'deliveryId',
    shipmenttypename: 'shipmentTypeName',
    estimateddeparturedatetime: 'estimatedDepartureDateTime',
    estimatedarrivaldatetime: 'estimatedArrivalDateTime',
    actualdeparturedatetime: 'actualDepartureDateTime',
    actualarrivaldatetime: 'actualArrivalDateTime',
    deliverycount: 'deliveryCount',
    packagecount: 'packageCount',
    createdbyusername: 'createdByUsername',
    createddatetime: 'createdDateTime',
    lastmodified: 'lastModified',  // Production uses lastmodified (one word)
    synclicense: 'license_number'
};

// Create database pool
const pool = new Pool(DB_CONFIG);

// Using centralized metrcAuth service - no local token cache needed

/**
 * Get the latest lastmodified timestamp from local database
 */
async function getLatestLastModified(client) {
    try {
        const query = `
            SELECT MAX(lastmodified) as latest_timestamp 
            FROM activeoutgoingtransfers 
            WHERE synclicense = $1
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
        // Ensure we have a valid token before starting
        const authSuccess = await metrcAuth.ensureValidToken();
        if (!authSuccess) {
            throw new Error('Failed to authenticate');
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
        
        let allTransfers = [];
        let page = 1;
        let hasMorePages = true;
        const pageSize = 500; // Maximum allowed by API
        
        while (hasMorePages) {
            console.log(`📄 Fetching outgoing transfers page ${page}...`);
            
            let retries = 3;
            let success = false;
            
            while (retries > 0 && !success) {
                try {
                    const pageParams = {
                        ...params,
                        page: page,
                        pageSize: pageSize
                    };
                    
                    // Use makeAuthenticatedRequest instead of getAccessToken
                    const response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: `${metrcAuth.apiBaseUrl}/transfers/outgoing/active`,
                        params: pageParams,
                        timeout: 30000
                    });

                    if (response.data && response.data.data) {
                        const transfers = response.data.data;
                        allTransfers = allTransfers.concat(transfers);
                        
                        console.log(`✅ Retrieved ${transfers.length} outgoing transfers from page ${page} (total: ${allTransfers.length})`);
                        
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
                        console.log('⚠️ No outgoing transfers data received for page', page);
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

        console.log(`✅ Retrieved ${allTransfers.length} total outgoing transfers across ${page - 1} pages`);
        return allTransfers;
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
 * Prepare value for database insertion with proper timezone handling
 */
function prepareValue(value, fieldName) {
    if (value === null || value === undefined) {
        return null;
    }
    
    // Handle date fields - ensure UTC storage
    if (fieldName.includes('date') || fieldName.includes('Date') || fieldName.includes('time') || fieldName.includes('Time') || fieldName.includes('datetime') || fieldName.includes('DateTime')) {
        if (value === '') return null;
        
        // Check for invalid dates (like "0000-12-31T17:58:20.000Z" or "0001-01-01T00:00:00.000")
        if (typeof value === 'string' && (value.includes('0000-') || value.includes('1900-') || value.includes('0001-01-01'))) {
            console.log(`⚠️ Invalid date detected: ${value} for field ${fieldName}, returning null`);
            return null; // Return null for invalid dates
        }
        
        const date = new Date(value);
        
        // Check if the date is valid
        if (isNaN(date.getTime())) {
            console.log(`⚠️ Invalid date detected: ${value} for field ${fieldName}, returning null`);
            return null; // Return null for invalid dates
        }
        
        // Return UTC timestamp for consistent storage
        return date.toISOString();
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
    const CHUNK_SIZE = 500;
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
    
    const updateFields = fields.filter(field => field !== 'metrcid' && field !== 'synclicense');
    const updateClause = updateFields.map(field => `${field} = EXCLUDED.${field}`).join(', ');
    
    const upsertQuery = `
        INSERT INTO activeoutgoingtransfers (${fieldList})
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
            if (field === 'synclicense') {
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
 * Enhanced sync outgoing transfers to database using incremental strategy
 */
async function syncOutgoingTransfersEnhanced() {
    const client = await pool.connect();
    const startTime = Date.now();
    let jobId = null;
    let historyId = null;
    let batchId = null;
    let scriptOutput = '';
    let scriptError = '';
    
    try {
        console.log('🔄 Starting enhanced outgoing transfers sync (incremental)...');
        
        // Create tracking entries
        jobId = await createSyncJob(client, 'sync-outgoing-transfers.js', METRC_CONFIG.licenseNumber);
        historyId = await createSyncHistory(client, 'outgoing_transfers', METRC_CONFIG.licenseNumber, null, 'sync-outgoing-transfers.js');
        batchId = await createSyncBatchHistory(client, 'outgoing_transfers');
        
        // Start transaction
        await client.query('BEGIN');
        
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
            scriptOutput = 'No new or updated outgoing transfers to sync';
            
            // Commit transaction
            await client.query('COMMIT');
            
            // Update tracking entries for empty sync
            await updateSyncJob(client, jobId, 'completed', scriptOutput);
            await updateSyncHistory(client, historyId, 'completed', Date.now() - startTime, scriptOutput);
            await updateSyncBatchHistory(client, batchId, 'completed', Date.now() - startTime);
            await updateSyncProgress(client, 'outgoing_transfers', METRC_CONFIG.licenseNumber, new Date());
            
            return;
        }

        console.log(`📊 Processing ${outgoingTransfers.length} outgoing transfers...`);
        
        // Get existing transfers for comparison
        const existingResult = await client.query(
            'SELECT metrcid, lastmodified FROM activeoutgoingtransfers WHERE synclicense = $1',
            [METRC_CONFIG.licenseNumber]
        );
        
        const existingTransfers = new Map();
        existingResult.rows.forEach(row => {
            existingTransfers.set(row.metrcid, {
                lastmodified: row.lastmodified,
                exists: true
            });
        });
        
        console.log(`📊 Found ${existingTransfers.size} existing outgoing transfers in local database`);
        
        // Categorize transfers based on actual changes
        const transfersToUpsert = [];
        const transfersToDelete = [];
        
        // Process API transfers - only upsert if they're new or have changed
        for (const transfer of outgoingTransfers) {
            const existing = existingTransfers.get(transfer.id);
            
            if (!existing) {
                // New transfer - upsert
                transfersToUpsert.push(transfer);
            } else {
                // Existing transfer - check if needs update
                const apiLastModified = transfer.lastModified ? new Date(transfer.lastModified) : null;
                const localLastModified = existing.lastmodified;
                
                // Normalize timestamps to UTC for accurate comparison (US deployment)
                const apiTimeUTC = apiLastModified ? new Date(apiLastModified) : null;
                const localTimeUTC = localLastModified ? new Date(localLastModified) : null;
                
                // Convert both to UTC timestamps for comparison
                const apiUTCTime = apiTimeUTC ? apiTimeUTC.getTime() : null;
                const localUTCTime = localTimeUTC ? localTimeUTC.getTime() : null;
                
                // Check if timestamps represent the same moment (within 1 minute tolerance)
                const timeDifference = apiUTCTime && localUTCTime ? Math.abs(apiUTCTime - localUTCTime) : Infinity;
                const isSameTime = timeDifference <= (60 * 1000); // 1 minute tolerance
                
                // Special case: if timestamps are exactly 6 hours apart, they're likely the same time in different timezones
                const isTimezoneDifference = timeDifference === (6 * 60 * 60 * 1000); // Exactly 6 hours
                
                // Only upsert if timestamps are significantly different (not the same time or timezone difference)
                if (!apiUTCTime || !localUTCTime || (!isSameTime && !isTimezoneDifference)) {
                    transfersToUpsert.push(transfer);
                }
            }
        }
        
        // Find transfers to delete (exist locally but not in API)
        for (const [metrcid, existing] of existingTransfers) {
            if (!outgoingTransfers.find(transfer => transfer.id === metrcid)) {
                transfersToDelete.push(metrcid);
            }
        }
        
        console.log(`📊 Sync plan: ${transfersToUpsert.length} upsert, ${transfersToDelete.length} delete`);
        
        // Execute UPSERT operation only for changed transfers
        if (transfersToUpsert.length > 0) {
            console.log('📥 Upserting changed transfers...');
            await processRecordsInChunks(client, transfersToUpsert, 'UPSERT');
        }
        
        if (transfersToDelete.length > 0) {
            console.log(`🗑️ Deleting ${transfersToDelete.length} stale transfers...`);
            const deleteQuery = `
                DELETE FROM activeoutgoingtransfers 
                WHERE metrcid = ANY($1) AND synclicense = $2
            `;
            await client.query(deleteQuery, [transfersToDelete, METRC_CONFIG.licenseNumber]);
        }
        
        const duration = Date.now() - startTime;
        scriptOutput = `Outgoing transfers sync completed: ${transfersToUpsert.length} upserted, ${transfersToDelete.length} deleted in ${duration}ms`;
        
        // Commit transaction
        await client.query('COMMIT');
        
        // Update all tracking entries
        await updateSyncJob(client, jobId, 'completed', scriptOutput);
        await updateSyncHistory(client, historyId, 'completed', duration, scriptOutput);
        await updateSyncBatchHistory(client, batchId, 'completed', duration);
        await updateSyncProgress(client, 'outgoing_transfers', METRC_CONFIG.licenseNumber, new Date());
        
        console.log(`✅ Enhanced sync completed: ${transfersToUpsert.length} upserted, ${transfersToDelete.length} deleted`);
        
        // Record successful sync
        await syncFailureTracker.recordSuccess('sync-outgoing-transfers', METRC_CONFIG.licenseNumber);
        
    } catch (error) {
        const duration = Date.now() - startTime;
        scriptError = error.message;
        
        console.error('❌ Enhanced sync failed:', error.message);
        await client.query('ROLLBACK');
        
        // Update tracking entries for failed sync
        if (jobId) await updateSyncJob(client, jobId, 'failed', scriptOutput, scriptError);
        if (historyId) await updateSyncHistory(client, historyId, 'failed', duration, scriptOutput, scriptError);
        if (batchId) await updateSyncBatchHistory(client, batchId, 'failed', duration, scriptError);
        
        // Record sync failure
        await syncFailureTracker.recordFailure('sync-outgoing-transfers', scriptError, METRC_CONFIG.licenseNumber);
        
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Main execution function
 */
async function main() {
    const scriptName = 'sync-outgoing-transfers';
    const licenseNumber = METRC_CONFIG.licenseNumber;
    
    try {
        console.log('🚀 Starting METRC Enhanced Outgoing Transfers Sync');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 License: ${licenseNumber}`);
        
        // HALT CHECK: Prevent operations if too many consecutive failures
        const alertLevel = await syncFailureTracker.getAlertLevel(scriptName, licenseNumber);
        if (alertLevel.level === 'critical') {
            console.error('🛑 HALTING SYNC: Too many consecutive failures detected');
            console.error(`❌ Script: ${scriptName}`);
            console.error(`❌ Consecutive Failures: ${alertLevel.count}`);
            console.error(`❌ Last Error: ${alertLevel.lastError}`);
            console.error('🛑 Preventing data inconsistency by halting sync operations');
            process.exit(1);
        } else if (alertLevel.level === 'warning') {
            console.warn(`⚠️ WARNING: ${scriptName} has ${alertLevel.count} consecutive failures`);
            console.warn('⚠️ Continuing sync but monitoring closely...');
        }
        
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
    fetchOutgoingTransfersIncremental
};
