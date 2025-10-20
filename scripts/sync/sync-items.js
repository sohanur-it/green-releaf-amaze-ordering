#!/usr/bin/env node

/**
 * Sync Items from METRC T3 API
 * 
 * This script synchronizes items data from the METRC T3 API
 * to the local PostgreSQL database using incremental sync strategy.
 * 
 * Usage: node scripts/sync/sync-items.js
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
 * Fetch items from METRC API
 */
async function fetchItems() {
    try {
        console.log('📡 Fetching items from METRC API...');
        
        let allItems = [];
        let page = 1;
        let hasMorePages = true;
        const pageSize = 500; // Maximum allowed by API
        
        while (hasMorePages) {
            console.log(`📄 Fetching items page ${page}...`);
            
            let retries = 3;
            let success = false;
            
            while (retries > 0 && !success) {
                try {
                    const response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: `${metrcAuth.apiBaseUrl}/items`,
                        params: {
                            licenseNumber: metrcAuth.licenseNumber,
                            page: page,
                            pageSize: pageSize
                        }
                    });

                    if (response.data && response.data.data) {
                        const items = response.data.data;
                        allItems = allItems.concat(items);
                        
                        console.log(`✅ Retrieved ${items.length} items from page ${page} (total: ${allItems.length})`);
                        
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
                        console.log('⚠️ No items data received for page', page);
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

        console.log(`✅ Retrieved ${allItems.length} total items across ${page - 1} pages`);
        return allItems;
        
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
    
    const fields = Object.keys(ITEM_FIELDS);
    const fieldList = fields.join(', ');
    
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
                values.push(metrcAuth.licenseNumber);
            } else {
                const apiField = ITEM_FIELDS[field];
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
    
    const fields = Object.keys(ITEM_FIELDS);
    const updateFields = fields.filter(field => field !== 'metrcid' && field !== 'sync_license');
    
    for (const record of records) {
        const updateQuery = `
            UPDATE items 
            SET ${updateFields.map((field, index) => `${field} = $${index + 1}`).join(', ')}
            WHERE metrcid = $${updateFields.length + 1} AND sync_license = $${updateFields.length + 2}
        `;
        
        const values = [];
        updateFields.forEach(field => {
            const apiField = ITEM_FIELDS[field];
            values.push(prepareValue(record[apiField], field));
        });
        values.push(record.id, metrcAuth.licenseNumber);
        
        await client.query(updateQuery, values);
    }
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
 * Sync items to database
 */
async function syncItems() {
    const client = await getDatabaseConnection();
    const startTime = Date.now();
    let jobId = null;
    let historyId = null;
    let batchId = null;
    let scriptOutput = '';
    let scriptError = '';
    
    try {
        console.log('🔄 Starting items sync...');
        
        // Create tracking entries
        const userId = process.env.SYNC_USER_ID ? parseInt(process.env.SYNC_USER_ID) : null;
        jobId = await createSyncJob(client, 'sync-items.js', metrcAuth.licenseNumber, userId);
        historyId = await createSyncHistory(client, 'items', metrcAuth.licenseNumber, userId, 'sync-items.js');
        batchId = await createSyncBatchHistory(client, 'items', userId);
        
        // Fetch data from API
        const items = await fetchItems();
        
        if (items.length === 0) {
            console.log('ℹ️ No items to sync');
            scriptOutput = 'No items to sync';
            
            // Update tracking entries for empty sync
            await updateSyncJob(client, jobId, 'completed', scriptOutput);
            await updateSyncHistory(client, historyId, 'completed', Date.now() - startTime, scriptOutput);
            await updateSyncBatchHistory(client, batchId, 'completed', Date.now() - startTime);
            await updateSyncProgress(client, 'items', metrcAuth.licenseNumber, new Date());
            
            return;
        }

        console.log(`📊 Processing ${items.length} items...`);
        
        // Get existing items for comparison
        const existingResult = await client.query(
            'SELECT metrcid, lastmodified FROM items WHERE sync_license = $1',
            [metrcAuth.licenseNumber]
        );
        
        const existingItems = new Map();
        existingResult.rows.forEach(row => {
            existingItems.set(row.metrcid, {
                lastmodified: row.lastmodified,
                exists: true
            });
        });
        
        console.log(`📊 Found ${existingItems.size} existing items in local database`);
        
        // Categorize items
        const itemsToInsert = [];
        const itemsToUpdate = [];
        const itemsToDelete = [];
        
        // Process API items
        for (const item of items) {
            // Convert API ID to string to match database format
            const existing = existingItems.get(String(item.id));
            
            if (!existing) {
                // New item - insert
                itemsToInsert.push(item);
            } else {
                // Existing item - check if needs update
                const apiLastModified = item.lastModified ? new Date(item.lastModified) : null;
                const localLastModified = existing.lastmodified;
                
                if (apiLastModified && localLastModified && apiLastModified > localLastModified) {
                    itemsToUpdate.push(item);
                }
                // If no update needed, item is already up to date - skip it
            }
        }
        
        // Find items to delete (exist locally but not in API)
        for (const [metrcid, existing] of existingItems) {
            if (!items.find(item => String(item.id) === metrcid)) {
                itemsToDelete.push(metrcid);
            }
        }
        
        console.log(`📊 Sync plan: ${itemsToInsert.length} insert, ${itemsToUpdate.length} update, ${itemsToDelete.length} delete`);
        
        // Execute operations
        if (itemsToInsert.length > 0) {
            console.log('📥 Inserting new items...');
            await processRecordsInChunks(client, itemsToInsert, 'INSERT');
        }
        
        if (itemsToUpdate.length > 0) {
            console.log('🔄 Updating existing items...');
            await processRecordsInChunks(client, itemsToUpdate, 'UPDATE');
        }
        
        if (itemsToDelete.length > 0) {
            console.log('🗑️ Deleting stale items...');
            const deleteQuery = `
                DELETE FROM items 
                WHERE metrcid = ANY($1) AND sync_license = $2
            `;
            await client.query(deleteQuery, [itemsToDelete, metrcAuth.licenseNumber]);
        }
        
        const duration = Date.now() - startTime;
        scriptOutput = `Items sync completed: ${itemsToInsert.length} inserted, ${itemsToUpdate.length} updated, ${itemsToDelete.length} deleted in ${duration}ms`;
        
        // Update all tracking entries
        await updateSyncJob(client, jobId, 'completed', scriptOutput);
        await updateSyncHistory(client, historyId, 'completed', duration, scriptOutput);
        await updateSyncBatchHistory(client, batchId, 'completed', duration);
        await updateSyncProgress(client, 'items', metrcAuth.licenseNumber, new Date());
        
        console.log(`✅ Items sync completed: ${itemsToInsert.length} inserted, ${itemsToUpdate.length} updated, ${itemsToDelete.length} deleted`);
        
    } catch (error) {
        const duration = Date.now() - startTime;
        scriptError = error.message;
        
        console.error('❌ Items sync failed:', error.message);
        
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
        console.log('🚀 Starting METRC Items Sync');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 License: ${metrcAuth.licenseNumber}`);
        
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
    fetchItems
};
