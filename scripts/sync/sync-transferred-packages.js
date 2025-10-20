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
 * Fetch transferred packages from METRC API
 */
async function fetchTransferredPackages() {
    try {
        console.log('🔐 Authenticating with METRC T3 API...');
        const success = await metrcAuth.ensureValidToken();
        if (!success) {
            throw new Error('Failed to obtain valid METRC authentication token');
        }

        console.log('📡 Fetching transferred packages from METRC API...');
        
        let allPackages = [];
        let page = 1;
        let hasMorePages = true;
        const pageSize = 500; // Maximum allowed by API
        
        while (hasMorePages) {
            console.log(`📄 Fetching transferred packages page ${page}...`);
            
            let retries = 3;
            let success = false;
            
            while (retries > 0 && !success) {
                try {
                    const response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: `${metrcAuth.apiBaseUrl}/packages/transferred`,
                        params: {
                            licenseNumber: metrcAuth.licenseNumber,
                            page: page,
                            pageSize: pageSize
                        }
                    });

                    if (response.data && response.data.data) {
                        const packages = response.data.data;
                        allPackages = allPackages.concat(packages);
                        
                        console.log(`✅ Retrieved ${packages.length} transferred packages from page ${page} (total: ${allPackages.length})`);
                        
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

        console.log(`✅ Retrieved ${allPackages.length} total transferred packages across ${page - 1} pages`);
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
    
    await client.query(insertQuery, values);
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
        
        // Fetch data from API
        const transferredPackages = await fetchTransferredPackages();
        
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
            const existing = existingPackages.has(pkg.id);
            
            if (!existing) {
                // New package - insert
                packagesToInsert.push(pkg);
            } else {
                // Existing package - update
                packagesToUpdate.push(pkg);
            }
        }
        
        // Find packages to delete (exist locally but not in API)
        for (const [metrcid, existing] of existingPackages) {
            if (!transferredPackages.find(pkg => pkg.id === metrcid)) {
                packagesToDelete.push(metrcid);
            }
        }
        
        console.log(`📊 Sync plan: ${packagesToInsert.length} insert, ${packagesToUpdate.length} update, ${packagesToDelete.length} delete`);
        
        // Execute operations
        if (packagesToInsert.length > 0) {
            console.log('📥 Inserting new packages...');
            await processRecordsInChunks(client, packagesToInsert, 'INSERT');
        }
        
        if (packagesToUpdate.length > 0) {
            console.log('🔄 Updating existing packages...');
            await processRecordsInChunks(client, packagesToUpdate, 'UPDATE');
        }
        
        if (packagesToDelete.length > 0) {
            console.log('🗑️ Deleting stale packages...');
            const deleteQuery = `
                DELETE FROM transferredpackages 
                WHERE metrcid = ANY($1) AND sync_license = $2
            `;
            await client.query(deleteQuery, [packagesToDelete, metrcAuth.licenseNumber]);
        }
        
        const duration = Date.now() - startTime;
        scriptOutput = `Transferred packages sync completed: ${packagesToInsert.length} inserted, ${packagesToUpdate.length} updated, ${packagesToDelete.length} deleted in ${duration}ms`;
        
        // Update all tracking entries
        await updateSyncJob(client, jobId, 'completed', scriptOutput);
        await updateSyncHistory(client, historyId, 'completed', duration, scriptOutput);
        await updateSyncBatchHistory(client, batchId, 'completed', duration);
        await updateSyncProgress(client, 'transferred_packages', metrcAuth.licenseNumber, new Date());
        
        console.log(`✅ Transferred packages sync completed: ${packagesToInsert.length} inserted, ${packagesToUpdate.length} updated, ${packagesToDelete.length} deleted`);
        
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
    try {
        console.log('🚀 Starting METRC Transferred Packages Sync');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 License: ${metrcAuth.licenseNumber}`);
        
        await syncTransferredPackages();
        
        console.log('✅ Transferred packages sync completed successfully');
        
    } catch (error) {
        console.error('❌ Transferred packages sync failed:', error.message);
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
