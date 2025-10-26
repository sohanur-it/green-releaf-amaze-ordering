#!/usr/bin/env node

/**
 * Sync In-Transit Packages from METRC T3 API
 * 
 * This script synchronizes in-transit packages data from the METRC T3 API
 * to the local PostgreSQL database using full mirror sync strategy.
 * 
 * Usage: node scripts/sync/sync-intransit-packages.js
 */

const { Pool } = require('pg');
const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
}

// Import sync failure tracker for halt mechanism
const syncFailureTracker = require('../../Server/Services/syncFailureTracker');

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
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false }
};

// Field mapping for intransit packages (production schema)
const INTRANSIT_PACKAGE_FIELDS = {
    metrcid: 'id',
    label: 'label',
    item_name: 'item.name',
    item_productcategoryname: 'item.productCategoryName',
    quantity: 'quantity',
    item_unitofmeasurename: 'item.unitOfMeasureName',
    lastmodified: 'lastModified',
    sync_license: 'license_number'
};

// Create database pool
const pool = new Pool(DB_CONFIG);

/**
 * Fetch in-transit packages from METRC API
 */
async function fetchIntransitPackages() {
    try {
        console.log('🔐 Authenticating with METRC T3 API...');
        const success = await metrcAuth.ensureValidToken();
        if (!success) {
            throw new Error('Failed to obtain valid METRC authentication token');
        }

        console.log('📡 Fetching in-transit packages from METRC API...');
        
        let allPackages = [];
        let page = 1;
        let hasMorePages = true;
        const pageSize = 500; // Maximum allowed by API
        
        while (hasMorePages) {
            console.log(`📄 Fetching in-transit packages page ${page}...`);
            
            let retries = 3;
            let success = false;
            
            while (retries > 0 && !success) {
                try {
                    const response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: `${metrcAuth.apiBaseUrl}/packages/intransit`,
                        params: {
                            licenseNumber: metrcAuth.licenseNumber,
                            page: page,
                            pageSize: pageSize
                        }
                    });

                    if (response.data && response.data.data) {
                        const packages = response.data.data;
                        allPackages = allPackages.concat(packages);
                        
                        console.log(`✅ Retrieved ${packages.length} in-transit packages from page ${page} (total: ${allPackages.length})`);
                        
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
                        console.log('⚠️ No in-transit packages data received for page', page);
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

        console.log(`✅ Retrieved ${allPackages.length} total in-transit packages across ${page - 1} pages`);
        return allPackages;
    } catch (error) {
        console.error('❌ Error fetching in-transit packages:', error.message);
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
        // Handle NOT NULL constraints for required fields
        if (fieldName === 'label') {
            return 'UNKNOWN_LABEL'; // Provide default for required label field
        }
        return null;
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
            } else if (operation === 'INSERT') {
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
    
    const fields = Object.keys(INTRANSIT_PACKAGE_FIELDS);
    const fieldList = fields.join(', ');
    
    const insertQuery = `
        INSERT INTO intransitpackages (${fieldList})
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
                const apiField = INTRANSIT_PACKAGE_FIELDS[field];
                values.push(prepareValue(record[apiField], field));
            }
        });
    });
    
    try {
        await client.query(insertQuery, values);
        console.log(`✅ Successfully inserted ${records.length} packages`);
    } catch (error) {
        console.error(`❌ Error inserting packages:`, error.message);
        console.error(`❌ Insert query:`, insertQuery);
        console.error(`❌ Values count:`, values.length);
        throw error;
    }
}

/**
 * Perform bulk UPDATE operation
 */
async function performBulkUpdate(client, records) {
    if (records.length === 0) return;
    
    const fields = Object.keys(INTRANSIT_PACKAGE_FIELDS);
    const updateFields = fields.filter(field => field !== 'metrcid' && field !== 'sync_license');
    
    for (const record of records) {
        const updateQuery = `
            UPDATE intransitpackages 
            SET ${updateFields.map((field, index) => `${field} = $${index + 1}`).join(', ')}
            WHERE metrcid = $${updateFields.length + 1} AND sync_license = $${updateFields.length + 2}
        `;
        
        const values = [];
        updateFields.forEach(field => {
            const apiField = INTRANSIT_PACKAGE_FIELDS[field];
            values.push(prepareValue(record[apiField], field));
        });
        values.push(record.id, metrcAuth.licenseNumber);
        
        await client.query(updateQuery, values);
    }
}

/**
 * Perform bulk UPSERT operation
 */
async function performBulkUpsert(client, records) {
    if (records.length === 0) return;
    
    const fields = Object.keys(INTRANSIT_PACKAGE_FIELDS);
    const fieldList = fields.join(', ');
    const valuePlaceholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    
    const updateFields = fields.filter(field => field !== 'metrcid' && field !== 'sync_license');
    const updateClause = updateFields.map(field => `${field} = EXCLUDED.${field}`).join(', ');
    
    const insertQuery = `
        INSERT INTO intransitpackages (${fieldList})
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
                const apiField = INTRANSIT_PACKAGE_FIELDS[field];
                values.push(prepareValue(record[apiField], field));
            }
        });
    });
    
    try {
        await client.query(insertQuery, values);
        console.log(`✅ Successfully inserted ${records.length} packages`);
    } catch (error) {
        console.error(`❌ Error inserting packages:`, error.message);
        console.error(`❌ Insert query:`, insertQuery);
        console.error(`❌ Values count:`, values.length);
        throw error;
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
 * Sync in-transit packages to database
 */
async function syncIntransitPackages() {
    const client = await pool.connect();
    const startTime = Date.now();
    let jobId = null;
    let historyId = null;
    let batchId = null;
    let scriptOutput = '';
    let scriptError = '';
    
    try {
        console.log('🔄 Starting in-transit packages sync...');
        
        // Create tracking entries
        jobId = await createSyncJob(client, 'sync-intransit-packages.js', metrcAuth.licenseNumber);
        historyId = await createSyncHistory(client, 'intransit_packages', metrcAuth.licenseNumber, null, 'sync-intransit-packages.js');
        batchId = await createSyncBatchHistory(client, 'intransit_packages');
        
        // Fetch data from API
        const intransitPackages = await fetchIntransitPackages();
        
        if (intransitPackages.length === 0) {
            console.log('ℹ️ No in-transit packages to sync');
            scriptOutput = 'No in-transit packages to sync';
            
            // Update tracking entries for empty sync
            await updateSyncJob(client, jobId, 'completed', scriptOutput);
            await updateSyncHistory(client, historyId, 'completed', Date.now() - startTime, scriptOutput);
            await updateSyncBatchHistory(client, batchId, 'completed', Date.now() - startTime);
            await updateSyncProgress(client, 'intransit_packages', metrcAuth.licenseNumber, new Date());
            
            return;
        }

        console.log(`📊 Processing ${intransitPackages.length} in-transit packages...`);
        
        // Get existing packages for comparison
        const existingResult = await client.query(
            'SELECT metrcid, lastmodified FROM intransitpackages WHERE sync_license = $1',
            [metrcAuth.licenseNumber]
        );
        
        const existingPackages = new Map();
        existingResult.rows.forEach(row => {
            existingPackages.set(row.metrcid, {
                lastmodified: row.lastmodified,
                exists: true
            });
        });
        
        console.log(`📊 Found ${existingPackages.size} existing in-transit packages in local database`);
        
        // Categorize packages
        const packagesToInsert = [];
        const packagesToUpdate = [];
        const packagesToDelete = [];
        
        // Process API packages
        for (const pkg of intransitPackages) {
            // Both API and DB IDs are numbers, no conversion needed
            const existing = existingPackages.get(pkg.id);
            
            if (!existing) {
                // New package - insert
                packagesToInsert.push(pkg);
            } else {
                // Existing package - check if needs update
                const apiLastModified = pkg.lastModified ? new Date(pkg.lastModified) : null;
                const localLastModified = existing.lastmodified;
                
                // Skip updates for now - just keep existing packages
                // if (apiLastModified && localLastModified && apiLastModified > localLastModified) {
                //     packagesToUpdate.push(pkg);
                // }
            }
        }
        
        // Find packages to delete (exist locally but not in API)
        for (const [metrcid, existing] of existingPackages) {
            if (!intransitPackages.find(pkg => pkg.id === metrcid)) {
                packagesToDelete.push(metrcid);
            }
        }
        
        console.log(`📊 Sync plan: ${packagesToInsert.length} insert, ${packagesToUpdate.length} update, ${packagesToDelete.length} delete`);
        
        // Execute operations
        if (packagesToInsert.length > 0) {
            console.log('📥 Inserting new packages...');
            console.log(`🔍 Sample package to insert: ${JSON.stringify(packagesToInsert[0])}`);
            await processRecordsInChunks(client, packagesToInsert, 'INSERT');
        }
        
        if (packagesToUpdate.length > 0) {
            console.log('🔄 Updating existing packages...');
            await processRecordsInChunks(client, packagesToUpdate, 'UPDATE');
        }
        
        if (packagesToDelete.length > 0) {
            console.log('🗑️ Deleting stale packages...');
            const deleteQuery = `
                DELETE FROM intransitpackages 
                WHERE metrcid = ANY($1) AND sync_license = $2
            `;
            await client.query(deleteQuery, [packagesToDelete, metrcAuth.licenseNumber]);
        }
        
        const duration = Date.now() - startTime;
        scriptOutput = `In-transit packages sync completed: ${packagesToInsert.length} inserted, ${packagesToUpdate.length} updated, ${packagesToDelete.length} deleted in ${duration}ms`;
        
        // Update all tracking entries
        await updateSyncJob(client, jobId, 'completed', scriptOutput);
        await updateSyncHistory(client, historyId, 'completed', duration, scriptOutput);
        await updateSyncBatchHistory(client, batchId, 'completed', duration);
        await updateSyncProgress(client, 'intransit_packages', metrcAuth.licenseNumber, new Date());
        
        console.log(`✅ In-transit packages sync completed: ${packagesToInsert.length} inserted, ${packagesToUpdate.length} updated, ${packagesToDelete.length} deleted`);
        
    } catch (error) {
        const duration = Date.now() - startTime;
        scriptError = error.message;
        
        console.error('❌ In-transit packages sync failed:', error.message);
        
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
    const scriptName = 'sync-intransit-packages';
    const licenseNumber = metrcAuth.licenseNumber;
    
    try {
        console.log('🚀 Starting METRC In-Transit Packages Sync');
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
        
        await syncIntransitPackages();
        
        // Record successful sync
        await syncFailureTracker.recordSuccess(scriptName, licenseNumber);
        console.log('✅ In-transit packages sync completed successfully');
        
    } catch (error) {
        console.error('❌ In-transit packages sync failed:', error.message);
        
        // Record sync failure
        await syncFailureTracker.recordFailure(scriptName, error.message, licenseNumber);
        
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
    syncIntransitPackages,
    fetchIntransitPackages
};
