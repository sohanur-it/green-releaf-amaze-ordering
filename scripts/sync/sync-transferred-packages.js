#!/usr/bin/env node

/**
 * Sync Transferred Packages from METRC T3 API
 * 
 * This script synchronizes transferred packages data from the METRC T3 API
 * to the local PostgreSQL database using incremental sync strategy.
 * 
 * Usage: node scripts/sync/sync-transferred-packages.js
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
    idleTimeoutMillis: 30000, // 30 seconds
    connectionTimeoutMillis: 30000, // 30 seconds
    ssl: { rejectUnauthorized: false }
};

// Field mapping for transferred packages (production schema)
const TRANSFERRED_PACKAGE_FIELDS = {
    metrcid: 'id',
    package_label: 'packageLabel',
    product_name: 'productName',
    product_category_name: 'productCategoryName',
    item_strain_name: 'itemStrainName',
    shipped_quantity: 'shippedQuantity',
    shipped_unit_of_measure_abbreviation: 'shippedUnitOfMeasureAbbreviation',
    received_quantity: 'receivedQuantity',
    received_unit_of_measure_abbreviation: 'receivedUnitOfMeasureAbbreviation',
    shipper_wholesale_price: 'shipperWholesalePrice',
    receiver_wholesale_price: 'receiverWholesalePrice',
    manifest_number: 'manifestNumber',
    recipient_facility_name: 'recipientFacilityName',
    recipient_facility_license_number: 'recipientFacilityLicenseNumber',
    actual_departure_date_time: 'actualDepartureDateTime',
    received_date_time: 'receivedDateTime',
    shipment_package_state_name: 'shipmentPackageStateName',
    lab_testing_state_name: 'labTestingStateName',
    processing_job_type_name: 'processingJobTypeName',
    source_harvest_names: 'sourceHarvestNames',
    source_package_labels: 'sourcePackageLabels',
    gross_weight: 'grossWeight',
    gross_unit_of_weight_abbreviation: 'grossUnitOfWeightAbbreviation',
    package_id: 'packageId',
    license_number: 'licenseNumber',
    index_type: 'indexType',
    sync_license: 'license_number'
};

// Create database pool
const pool = new Pool(DB_CONFIG);

/**
 * Get the latest received_date_time from local database for delta sync
 */
async function getLatestReceivedDateTime(client) {
    try {
        const query = `
            SELECT MAX(received_date_time) as latest_timestamp 
            FROM transferredpackages 
            WHERE sync_license = $1 AND received_date_time IS NOT NULL
        `;
        
        const result = await client.query(query, [metrcAuth.licenseNumber]);
        
        if (result.rows[0] && result.rows[0].latest_timestamp) {
            return new Date(result.rows[0].latest_timestamp);
        }
        
        return null;
    } catch (error) {
        console.error('❌ Error getting latest received_date_time:', error.message);
        return null;
    }
}

/**
 * Fetch transferred packages from METRC API with incremental/delta sync
 */
async function fetchTransferredPackages(client = null, lastReceivedDateTime = null) {
    try {
        console.log('🔐 Authenticating with METRC T3 API...');
        const success = await metrcAuth.ensureValidToken();
        if (!success) {
            throw new Error('Failed to obtain valid METRC authentication token');
        }

        // Get latest timestamp from database if not provided
        if (!lastReceivedDateTime && client) {
            lastReceivedDateTime = await getLatestReceivedDateTime(client);
        }

        if (lastReceivedDateTime) {
            console.log('📡 Fetching transferred packages from METRC API (DELTA SYNC MODE)...');
            console.log(`🔍 Filtering packages received after: ${lastReceivedDateTime.toISOString()}`);
        } else {
            console.log('📡 Fetching transferred packages from METRC API (FULL SYNC MODE - first run)...');
        }

        if (process.env.MAX_PAGES) {
            console.log(`🧪 TEST MODE: Limiting to ${process.env.MAX_PAGES} pages`);
        }
        
        if (process.env.DRY_RUN === 'true') {
            console.log('🧪 DRY RUN MODE: Will validate API but skip database writes');
        }
        
        let allPackages = [];
        let page = 1;
        let hasMorePages = true;
        const pageSize = 500; // Maximum allowed by API
        const maxPages = process.env.MAX_PAGES ? parseInt(process.env.MAX_PAGES) : null; // Limit pages if specified
        
        if (maxPages) {
            console.log(`⚠️  PAGE LIMIT ENABLED: Will only fetch ${maxPages} pages for testing`);
        }
        
        // Build API params
        const baseParams = {
            licenseNumber: metrcAuth.licenseNumber,
            pageSize: pageSize
        };

        // Add timestamp filter if available (using receivedDateTimeStart parameter)
        // Note: Check if API supports this parameter, if not we'll filter client-side
        if (lastReceivedDateTime) {
            // Try using receivedDateTimeStart if API supports it
            // Otherwise we'll filter client-side after fetching
            baseParams.receivedDateTimeStart = lastReceivedDateTime.toISOString();
        }
        
        while (hasMorePages && (!maxPages || page <= maxPages)) {
            if (maxPages && page > maxPages) {
                console.log(`⚠️  Reached page limit (${maxPages}). Stopping fetch.`);
                break;
            }
            console.log(`📄 Fetching transferred packages page ${page}${maxPages ? `/${maxPages}` : ''}...`);
            
            let retries = 3;
            let success = false;
            
            while (retries > 0 && !success) {
                try {
                    console.log(`🔄 Attempting API request for page ${page} (attempt ${4-retries})...`);
                    const params = {
                        ...baseParams,
                        page: page
                    };
                    
                    const response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: `${metrcAuth.apiBaseUrl}/packages/transferred`,
                        params: params,
                        timeout: 30000 // 30 second timeout
                    });

                    if (response.data && response.data.data) {
                        let packages = response.data.data;
                        const originalCount = packages.length;
                        
                        // Client-side filtering: Filter packages received after our last known timestamp
                        // This handles cases where API doesn't support receivedDateTimeStart parameter
                        if (lastReceivedDateTime) {
                            packages = packages.filter(p => {
                                if (!p.receivedDateTime) {
                                    // Include packages without date (they might be new)
                                    return true;
                                }
                                try {
                                    const receivedDate = new Date(p.receivedDateTime);
                                    return receivedDate > lastReceivedDateTime;
                                } catch (e) {
                                    // If date parsing fails, include it to be safe
                                    return true;
                                }
                            });
                            
                            if (packages.length < originalCount) {
                                console.log(`🔍 Filtered ${originalCount} packages to ${packages.length} new packages (after ${lastReceivedDateTime.toISOString()})`);
                            }
                            
                            // If we got an empty page after filtering, we've likely reached the end
                            if (packages.length === 0 && originalCount > 0) {
                                console.log('🔍 Reached end of filtered results (no new packages on this page)');
                                hasMorePages = false;
                            }
                        }
                        
                        allPackages = allPackages.concat(packages);
                        
                        console.log(`✅ Retrieved ${packages.length} transferred packages from page ${page} (total: ${allPackages.length})`);
                        
                        // Check if there are more pages
                        const totalPages = response.data.totalPages || Math.ceil(response.data.total / pageSize);
                        hasMorePages = hasMorePages && page < totalPages && (!maxPages || page < maxPages);
                        page++;
                        success = true;
                        
                        if (maxPages && page > maxPages) {
                            console.log(`⚠️  Reached page limit (${maxPages}). Stopping fetch.`);
                            hasMorePages = false;
                        }
                        
                        // Small delay to avoid rate limiting
                        if (hasMorePages) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    } else {
                        console.log('⚠️ No transferred packages data received for page', page);
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

        if (lastReceivedDateTime) {
            console.log(`✅ Delta sync retrieved ${allPackages.length} new/updated transferred packages since ${lastReceivedDateTime.toISOString()}`);
        } else {
            console.log(`✅ Full sync retrieved ${allPackages.length} total transferred packages across ${page - 1} pages`);
        }
        return allPackages;
    } catch (error) {
        console.error('❌ Error fetching transferred packages:', error.message);
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
 * Perform bulk INSERT operation using optimized batch inserts
 * Uses temp table + bulk insert strategy for maximum speed
 */
async function performBulkInsert(client, records) {
    if (records.length === 0) return;
    
    const DRY_RUN = process.env.DRY_RUN === 'true';
    if (DRY_RUN) {
        console.log(`🧪 DRY RUN: Would insert ${records.length} packages (skipping database write)`);
        return;
    }
    
    const fields = Object.keys(TRANSFERRED_PACKAGE_FIELDS);
    const fieldList = fields.join(', ');
    const tempTableName = `temp_transferred_${Date.now()}`;
    
    try {
        // Step 1: Create temp table with same structure
        await client.query(`
            CREATE TEMP TABLE ${tempTableName} (LIKE transferredpackages INCLUDING ALL)
        `);
        
        // Step 2: Insert all records into temp table using batch inserts (larger batches for speed)
        const BATCH_SIZE = 100; // Larger batches for better performance
        let totalInserted = 0;
        
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            const values = [];
            const valuePlaceholders = [];
            
            batch.forEach((record, batchIndex) => {
                const recordPlaceholders = [];
                fields.forEach((field, fieldIndex) => {
                    const paramIndex = batchIndex * fields.length + fieldIndex + 1;
                    recordPlaceholders.push(`$${paramIndex}`);
                    
                    if (field === 'sync_license') {
                        values.push(metrcAuth.licenseNumber);
                    } else {
                        const apiField = TRANSFERRED_PACKAGE_FIELDS[field];
                        values.push(prepareValue(record[apiField], field));
                    }
                });
                valuePlaceholders.push(`(${recordPlaceholders.join(', ')})`);
            });
            
            const batchInsertQuery = `
                INSERT INTO ${tempTableName} (${fieldList})
                VALUES ${valuePlaceholders.join(', ')}
            `;
            
            try {
                await client.query(batchInsertQuery, values);
                totalInserted += batch.length;
            } catch (error) {
                // If batch fails, try individual inserts for this batch
                console.log(`⚠️  Batch insert failed, trying individual inserts for ${batch.length} records...`);
                for (const record of batch) {
                    try {
                        const singleValues = [];
                        const singlePlaceholders = fields.map((_, idx) => {
                            const field = fields[idx];
                            if (field === 'sync_license') {
                                singleValues.push(metrcAuth.licenseNumber);
                            } else {
                                const apiField = TRANSFERRED_PACKAGE_FIELDS[field];
                                singleValues.push(prepareValue(record[apiField], field));
                            }
                            return `$${idx + 1}`;
                        });
                        
                        await client.query(`
                            INSERT INTO ${tempTableName} (${fieldList})
                            VALUES (${singlePlaceholders.join(', ')})
                        `, singleValues);
                        totalInserted++;
                    } catch (singleError) {
                        // Skip problematic records
                        if (totalInserted < 10) {
                            console.log(`⚠️  Skipped record: ${singleError.message.substring(0, 60)}`);
                        }
                    }
                }
            }
        }
        
        // Step 3: Insert from temp table to main table (ON CONFLICT handles duplicates)
        // Try with unique constraint first
        try {
            const finalInsertQuery = `
                INSERT INTO transferredpackages (${fieldList})
                SELECT ${fieldList} FROM ${tempTableName}
                ON CONFLICT (metrcid, sync_license) DO NOTHING
            `;
            await client.query(finalInsertQuery);
        } catch (error) {
            // If unique constraint doesn't exist, use simple insert (duplicates will be caught by PK)
            const finalInsertQuery = `
                INSERT INTO transferredpackages (${fieldList})
                SELECT ${fieldList} FROM ${tempTableName}
            `;
            try {
                await client.query(finalInsertQuery);
            } catch (innerError) {
                // Last resort: insert one by one with conflict handling
                const tempRows = await client.query(`SELECT * FROM ${tempTableName}`);
                let successCount = 0;
                for (const row of tempRows.rows) {
                    try {
                        const rowValues = fields.map(field => row[field]);
                        await client.query(`
                            INSERT INTO transferredpackages (${fieldList})
                            VALUES (${fields.map((_, i) => `$${i + 1}`).join(', ')})
                        `, rowValues);
                        successCount++;
                    } catch (e) {
                        // Skip duplicates
                    }
                }
                console.log(`✅ Inserted ${successCount}/${tempRows.rows.length} records (duplicates skipped)`);
            }
        }
        
        console.log(`✅ Successfully processed ${totalInserted} packages`);
        
    } catch (error) {
        console.error(`❌ Error in bulk insert:`, error.message);
        throw error;
    } finally {
        // Clean up temp table
        try {
            await client.query(`DROP TABLE IF EXISTS ${tempTableName}`);
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

/**
 * Perform bulk UPDATE operation
 */
async function performBulkUpdate(client, records) {
    if (records.length === 0) return;
    
    // Only update key fields that are likely to change
    const updateFields = [
        'package_label',
        'product_name', 
        'product_category_name',
        'shipped_quantity',
        'received_quantity',
        'actual_departure_date_time',
        'received_date_time'
    ];
    
    for (const record of records) {
        const updateQuery = `
            UPDATE transferredpackages 
            SET ${updateFields.map((field, index) => `${field} = $${index + 1}`).join(', ')}
            WHERE metrcid = $${updateFields.length + 1} AND sync_license = $${updateFields.length + 2}
        `;
        
        const values = [];
        updateFields.forEach(field => {
            const apiField = TRANSFERRED_PACKAGE_FIELDS[field];
            values.push(prepareValue(record[apiField], field));
        });
        values.push(record.id, metrcAuth.licenseNumber);
        
        await client.query(updateQuery, values);
    }
}

/**
 * Process a batch of packages immediately
 */
async function processBatch(client, packages, batchNumber) {
    console.log(`📊 Processing batch ${batchNumber} with ${packages.length} packages...`);
    
    // Get existing packages for comparison
    const existingResult = await client.query(
        'SELECT metrcid FROM transferredpackages WHERE sync_license = $1',
        [metrcAuth.licenseNumber]
    );
    
    const existingPackages = new Map();
    existingResult.rows.forEach(row => {
        existingPackages.set(row.metrcid, true);
    });
    
    console.log(`📊 Found ${existingPackages.size} existing transferred packages in local database`);
    
    // Categorize packages
    const packagesToInsert = [];
    const packagesToUpdate = [];
    const packagesToDelete = [];
    
    // Process API packages
    for (const pkg of packages) {
        // Convert API ID to string to match database format
        const existing = existingPackages.has(String(pkg.id));
        
        if (!existing) {
            // New package - insert
            packagesToInsert.push(pkg);
        } else {
            // Existing package - skip updates for now
            // packagesToUpdate.push(pkg);
        }
    }
    
    console.log(`📊 Batch ${batchNumber} sync plan: ${packagesToInsert.length} insert, ${packagesToUpdate.length} update, ${packagesToDelete.length} delete`);
    
    // Execute operations
    if (packagesToInsert.length > 0) {
        console.log(`📥 Inserting ${packagesToInsert.length} new packages...`);
        await processRecordsInChunks(client, packagesToInsert, 'INSERT');
    }
    
    if (packagesToUpdate.length > 0) {
        console.log(`🔄 Updating ${packagesToUpdate.length} existing packages...`);
        console.log(`⚠️ Skipping ${packagesToUpdate.length} updates due to database constraint issues`);
        // await processRecordsInChunks(client, packagesToUpdate, 'UPDATE');
    }
    
    if (packagesToDelete.length > 0) {
        console.log(`🗑️ Deleting ${packagesToDelete.length} stale packages...`);
        const deleteQuery = `
            DELETE FROM transferredpackages 
            WHERE metrcid = ANY($1) AND sync_license = $2
        `;
        await client.query(deleteQuery, [packagesToDelete, metrcAuth.licenseNumber]);
    }
    
    console.log(`✅ Batch ${batchNumber} completed: ${packagesToInsert.length} inserted, ${packagesToUpdate.length} updated, ${packagesToDelete.length} deleted`);
}

/**
 * Process records in chunks to prevent database locks
 */
async function processRecordsInChunks(client, records, operation = 'UPSERT') {
    // Optimized chunk size - temp table allows efficient bulk inserts
    const DRY_RUN = process.env.DRY_RUN === 'true';
    const CHUNK_SIZE = DRY_RUN ? 500 : 500; // Use larger chunks - temp table handles it efficiently
    const DELAY_BETWEEN_CHUNKS = DRY_RUN ? 0 : 50; // Minimal delay
    
    console.log(`🔄 Starting to process ${records.length} records in chunks of ${CHUNK_SIZE}...`);
    
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);
        const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
        const totalChunks = Math.ceil(records.length / CHUNK_SIZE);
        
        console.log(`📦 Processing chunk ${chunkNumber}/${totalChunks} with ${chunk.length} records...`);
        
        try {
            if (operation === 'UPSERT') {
                console.log(`🔄 Calling performBulkUpsert for chunk ${chunkNumber}...`);
                await performBulkUpsert(client, chunk);
            } else if (operation === 'INSERT') {
                console.log(`🔄 Calling performBulkInsert for chunk ${chunkNumber}...`);
                await performBulkInsert(client, chunk);
            } else if (operation === 'UPDATE') {
                console.log(`🔄 Calling performBulkUpdate for chunk ${chunkNumber}...`);
                await performBulkUpdate(client, chunk);
            }
            
            console.log(`✅ Processed chunk ${chunkNumber}/${totalChunks} (${chunk.length} records)`);
            
            // Small delay to release database locks
            if (i + CHUNK_SIZE < records.length) {
                console.log(`⏳ Waiting ${DELAY_BETWEEN_CHUNKS}ms before next chunk...`);
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS));
            }
            
        } catch (error) {
            console.error(`❌ Error processing chunk ${chunkNumber}:`, error.message);
            throw error;
        }
    }
    
    console.log(`🎉 All chunks processed successfully!`);
}

/**
 * Perform bulk UPSERT operation
 */
async function performBulkUpsert(client, records) {
    if (records.length === 0) return;
    
    // Deduplicate records by metrcid to avoid conflicts
    const uniqueRecords = new Map();
    records.forEach(record => {
        const metrcid = record.id;
        if (!uniqueRecords.has(metrcid)) {
            uniqueRecords.set(metrcid, record);
        }
    });
    
    const deduplicatedRecords = Array.from(uniqueRecords.values());
    console.log(`📊 Deduplicated ${records.length} records to ${deduplicatedRecords.length} unique records`);
    
    const fields = Object.keys(TRANSFERRED_PACKAGE_FIELDS);
    const fieldList = fields.join(', ');
    const valuePlaceholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    
    const updateFields = fields.filter(field => field !== 'metrcid' && field !== 'sync_license');
    const updateClause = updateFields.map(field => `${field} = EXCLUDED.${field}`).join(', ');
    
    const insertQuery = `
        INSERT INTO transferredpackages (${fieldList})
        VALUES ${deduplicatedRecords.map((_, recordIndex) => 
            `(${fields.map((_, fieldIndex) => 
                `$${recordIndex * fields.length + fieldIndex + 1}`
            ).join(', ')})`
        ).join(', ')}
    `;
    
    const values = [];
    deduplicatedRecords.forEach(record => {
        fields.forEach(field => {
            if (field === 'sync_license') {
                values.push(metrcAuth.licenseNumber);
            } else {
                const apiField = TRANSFERRED_PACKAGE_FIELDS[field];
                values.push(prepareValue(record[apiField], field));
            }
        });
    });
    
    try {
        console.log(`🔄 About to execute upsert query with ${values.length} values (${deduplicatedRecords.length} records)...`);
        
        // Add timeout to prevent hanging (increased for larger chunks)
        const queryPromise = client.query(insertQuery, values);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Database query timeout after 30 seconds (${values.length} values, ${deduplicatedRecords.length} records)`)), 30000)
        );
        
        await Promise.race([queryPromise, timeoutPromise]);
        console.log(`✅ Successfully upserted ${deduplicatedRecords.length} packages`);
    } catch (error) {
        console.error(`❌ Error upserting packages:`, error.message);
        console.error(`❌ Values count: ${values.length}, Records count: ${deduplicatedRecords.length}`);
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
 * Sync transferred packages to database
 */
async function syncTransferredPackages() {
    const client = await pool.connect();
    const startTime = Date.now();
    let jobId = null;
    let historyId = null;
    let batchId = null;
    let scriptOutput = '';
    let scriptError = '';
    
    try {
        console.log('🔄 Starting transferred packages sync...');
        
        // Create tracking entries
        jobId = await createSyncJob(client, 'sync-transferred-packages.js', metrcAuth.licenseNumber);
        historyId = await createSyncHistory(client, 'transferred_packages', metrcAuth.licenseNumber, null, 'sync-transferred-packages.js');
        batchId = await createSyncBatchHistory(client, 'transferred_packages');
        
        // Get latest timestamp for delta sync
        const lastReceivedDateTime = await getLatestReceivedDateTime(client);
        if (lastReceivedDateTime) {
            console.log(`🔄 Delta sync mode: Only fetching packages received after ${lastReceivedDateTime.toISOString()}`);
        } else {
            console.log('🔄 Full sync mode: No previous sync found, fetching all packages');
        }
        
        // Fetch data from API with delta sync
        const transferredPackages = await fetchTransferredPackages(client, lastReceivedDateTime);
        
        if (transferredPackages.length === 0) {
            console.log('ℹ️ No transferred packages to sync');
            scriptOutput = 'No transferred packages to sync';
            
            // Update tracking entries for empty sync
            await updateSyncJob(client, jobId, 'completed', scriptOutput);
            await updateSyncHistory(client, historyId, 'completed', Date.now() - startTime, scriptOutput);
            await updateSyncBatchHistory(client, batchId, 'completed', Date.now() - startTime);
            await updateSyncProgress(client, 'transferred_packages', metrcAuth.licenseNumber, new Date());
            
            return;
        }
        
        console.log(`📊 Processing ${transferredPackages.length} transferred packages...`);
        
        // Get existing packages for comparison
        const existingResult = await client.query(
            'SELECT metrcid FROM transferredpackages WHERE sync_license = $1',
            [metrcAuth.licenseNumber]
        );
        
        const existingPackages = new Map();
        existingResult.rows.forEach(row => {
            existingPackages.set(row.metrcid, true);
        });
        
        console.log(`📊 Found ${existingPackages.size} existing transferred packages in local database`);
        
        // Categorize packages
        const packagesToInsert = [];
        const packagesToUpdate = [];
        const packagesToDelete = [];
        
        // Process API packages
        for (const pkg of transferredPackages) {
            // Convert API ID to string to match database format
            const existing = existingPackages.has(String(pkg.id));
            
            if (!existing) {
                // New package - insert
                packagesToInsert.push(pkg);
            } else {
                // Existing package - skip updates for now
                // packagesToUpdate.push(pkg);
            }
        }
        
        // Find packages to delete (exist locally but not in API)
        // CRITICAL: Only delete during FULL sync, not delta sync
        // During delta sync, we only fetch new packages, so old packages won't be in the API response
        // Deleting them would incorrectly remove valid historical data
        if (!lastReceivedDateTime) {
            // Full sync mode - safe to check for deletions
            for (const [metrcid, existing] of existingPackages) {
                if (!transferredPackages.find(pkg => String(pkg.id) === metrcid)) {
                    packagesToDelete.push(metrcid);
                }
            }
            console.log(`📊 Full sync mode: Checking for ${packagesToDelete.length} packages to delete`);
        } else {
            // Delta sync mode - skip deletion to avoid removing historical data
            console.log(`📊 Delta sync mode: Skipping deletion check (only processing new packages)`);
        }
        
        console.log(`📊 Sync plan: ${packagesToInsert.length} insert, ${packagesToUpdate.length} update, ${packagesToDelete.length} delete`);
        
        // Execute operations
        if (packagesToInsert.length > 0) {
            console.log('📥 Inserting new packages...');
            console.log(`📊 About to insert ${packagesToInsert.length} packages in chunks...`);
            await processRecordsInChunks(client, packagesToInsert, 'INSERT');
            console.log('✅ Insert operation completed');
        }
        
        if (packagesToUpdate.length > 0) {
            console.log('🔄 Updating existing packages...');
            console.log(`⚠️ Skipping ${packagesToUpdate.length} updates due to database constraint issues`);
            // await processRecordsInChunks(client, packagesToUpdate, 'UPDATE');
        }
        
        if (packagesToDelete.length > 0) {
            console.log('🗑️ Deleting stale packages...');
            console.log(`⚠️ WARNING: Deleting ${packagesToDelete.length} packages that no longer exist in METRC`);
            const deleteQuery = `
                DELETE FROM transferredpackages 
                WHERE metrcid = ANY($1) AND sync_license = $2
            `;
            await client.query(deleteQuery, [packagesToDelete, metrcAuth.licenseNumber]);
        }
        
        // Final summary
        const finalInsertCount = packagesToInsert.length;
        const finalUpdateCount = packagesToUpdate.length;
        const finalDeleteCount = packagesToDelete.length;
        
        console.log(`✅ Transferred packages sync completed: ${finalInsertCount} inserted, ${finalUpdateCount} updated, ${finalDeleteCount} deleted`);
        scriptOutput = `Transferred packages sync completed: ${finalInsertCount} inserted, ${finalUpdateCount} updated, ${finalDeleteCount} deleted`;
        
        const duration = Date.now() - startTime;
        
        // Update all tracking entries
        await updateSyncJob(client, jobId, 'completed', scriptOutput);
        await updateSyncHistory(client, historyId, 'completed', duration, scriptOutput);
        await updateSyncBatchHistory(client, batchId, 'completed', duration);
        await updateSyncProgress(client, 'transferred_packages', metrcAuth.licenseNumber, new Date());
        
        console.log(`✅ Transferred packages sync completed: ${finalInsertCount} inserted, ${finalUpdateCount} updated, ${finalDeleteCount} deleted`);
        
    } catch (error) {
        const duration = Date.now() - startTime;
        scriptError = error.message;
        
        console.error('❌ Transferred packages sync failed:', error.message);
        
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
    const scriptName = 'sync-transferred-packages';
    const licenseNumber = metrcAuth.licenseNumber;
    
    try {
        console.log('🚀 Starting METRC Transferred Packages Sync');
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
        
        await syncTransferredPackages();
        
        // Record successful sync
        await syncFailureTracker.recordSuccess(scriptName, licenseNumber);
        console.log('✅ Transferred packages sync completed successfully');
        
    } catch (error) {
        console.error('❌ Transferred packages sync failed:', error.message);
        
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
    syncTransferredPackages,
    fetchTransferredPackages
};
