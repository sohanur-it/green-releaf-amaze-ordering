#!/usr/bin/env node

/**
 * Enhanced Sync Active Packages from METRC T3 API
 * 
 * This script implements Full Mirror Sync strategy for active packages.
 * It fetches all active packages, compares them with local data based on
 * metrcid and lastmodified timestamps, and performs atomic INSERTs, UPDATEs, and DELETEs.
 * 
 * Usage: node scripts/sync/sync-active-packages-enhanced.js
 */

const axios = require('axios');
const { Pool } = require('pg');
const path = require('path');
const metrcAuth = require('../../Server/Services/metrcAuth');

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
        const success = await metrcAuth.ensureValidToken();
        if (success) {
            console.log('✅ Authentication successful');
            return true;
        } else {
            throw new Error('Failed to obtain valid METRC authentication token');
        }
    } catch (error) {
        console.error('❌ Authentication failed:', error.message);
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
 * Fetch all active packages from METRC API
 */
async function fetchAllActivePackages() {
    try {
        if (!isTokenValid()) {
            const authSuccess = await authenticateWithMetrc();
            if (!authSuccess) {
                throw new Error('Failed to authenticate');
            }
        }

        console.log('📡 Fetching all active packages from METRC API...');
        
        const response = await metrcAuth.makeAuthenticatedRequest({
            method: 'GET',
            url: `${METRC_CONFIG.baseURL}/packages/active`,
            params: {
                licenseNumber: METRC_CONFIG.licenseNumber
            }
        });

        if (response.data && response.data.data) {
            console.log(`✅ Retrieved ${response.data.data.length} active packages`);
            return response.data.data;
        } else {
            console.log('⚠️ No active packages data received');
            return [];
        }
    } catch (error) {
        console.error('❌ Error fetching active packages:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        throw error;
    }
}

/**
 * Get existing packages from local database
 */
async function getExistingPackages(client) {
    try {
        const query = `
            SELECT metrcid, lastmodified 
            FROM activepackages 
            WHERE sync_license = $1
        `;
        
        const result = await client.query(query, [METRC_CONFIG.licenseNumber]);
        
        const existingPackages = new Map();
        result.rows.forEach(row => {
            existingPackages.set(row.metrcid, {
                lastmodified: row.lastmodified,
                exists: true
            });
        });
        
        console.log(`📊 Found ${existingPackages.size} existing packages in local database`);
        return existingPackages;
        
    } catch (error) {
        console.error('❌ Error getting existing packages:', error.message);
        throw error;
    }
}

/**
 * Process records in chunks to prevent database locks
 */
async function processRecordsInChunks(client, records, operation = 'INSERT') {
    const CHUNK_SIZE = 50;
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
 * Truncate string to specified length
 */
function truncateString(str, maxLength) {
    if (!str) return str;
    return str.length > maxLength ? str.substring(0, maxLength) : str;
}

/**
 * Perform bulk INSERT operation
 */
async function performBulkInsert(client, packages) {
    if (packages.length === 0) return;
    
    // Use a simplified field mapping for now - we'll expand this based on actual API response
    const insertQuery = `
        INSERT INTO activepackages (
            metrcid, label, item_name, item_productcategoryname, quantity, item_unitofmeasurename,
            lastmodified, sync_license
        )
        VALUES ${packages.map((_, index) => 
            `($${index * 8 + 1}, $${index * 8 + 2}, $${index * 8 + 3}, $${index * 8 + 4}, $${index * 8 + 5}, $${index * 8 + 6}, $${index * 8 + 7}, $${index * 8 + 8})`
        ).join(', ')}
        ON CONFLICT (metrcid) DO NOTHING
    `;
    
    const values = [];
    packages.forEach(pkg => {
        values.push(
            pkg.id,
            truncateString(pkg.label, 255),
            truncateString(pkg.item?.name || '', 255),
            truncateString(pkg.item?.productCategoryName || '', 100),
            pkg.quantity || 0,
            truncateString(pkg.unitOfMeasureAbbreviation || '', 50),
            pkg.lastModified ? new Date(pkg.lastModified) : null,
            METRC_CONFIG.licenseNumber
        );
    });
    
    await client.query(insertQuery, values);
}

/**
 * Perform bulk UPDATE operation
 */
async function performBulkUpdate(client, packages) {
    if (packages.length === 0) return;
    
    for (const pkg of packages) {
        const updateQuery = `
            UPDATE activepackages 
            SET 
                label = $1,
                item_name = $2,
                item_productcategoryname = $3,
                quantity = $4,
                item_unitofmeasurename = $5,
                lastmodified = $6
            WHERE metrcid = $7 AND sync_license = $8
        `;
        
        // Perform the actual update
        try {
            await client.query(updateQuery, [
                pkg.label,
                pkg.itemName,
                pkg.itemProductCategoryName,
                pkg.quantity,
                pkg.itemUnitOfMeasureName,
                pkg.lastModified,
                pkg.id,
                pkg.licenseNumber
            ]);
            console.log(`✅ Updated package ${pkg.id}`);
        } catch (error) {
            console.error(`❌ Failed to update package ${pkg.id}:`, error.message);
        }
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
 * Enhanced sync active packages using Full Mirror Sync strategy
 */
async function syncActivePackagesEnhanced() {
    const client = await pool.connect();
    const startTime = Date.now();
    let jobId = null;
    let historyId = null;
    let batchId = null;
    let scriptOutput = '';
    let scriptError = '';
    
    try {
        console.log('🔄 Starting enhanced active packages sync (Full Mirror)...');
        
        // Create tracking entries
        jobId = await createSyncJob(client, 'sync-active-packages.js', METRC_CONFIG.licenseNumber);
        historyId = await createSyncHistory(client, 'active_packages', METRC_CONFIG.licenseNumber, null, 'sync-active-packages.js');
        batchId = await createSyncBatchHistory(client, 'active_packages');
        
        // Start transaction
        await client.query('BEGIN');
        
        // Fetch all packages from API
        const apiPackages = await fetchAllActivePackages();
        
        if (apiPackages.length === 0) {
            console.log('ℹ️ No active packages to sync');
            await client.query('COMMIT');
            return;
        }
        
        // Get existing packages from local database for THIS LICENSE ONLY
        const existingPackages = await getExistingPackages(client);
        
        // Categorize packages
        const packagesToInsert = [];
        const packagesToUpdate = [];
        const packagesToDelete = [];
        
        // Process API packages
        for (const pkg of apiPackages) {
            const existing = existingPackages.get(pkg.id);
            
            if (!existing) {
                // New package - insert
                packagesToInsert.push(pkg);
            } else {
                // Existing package - check if needs update
                const apiLastModified = pkg.lastModified ? new Date(pkg.lastModified) : null;
                const localLastModified = existing.lastmodified;
                
                if (!apiLastModified || !localLastModified || apiLastModified > localLastModified) {
                    packagesToUpdate.push(pkg);
                }
            }
        }
        
        // Find packages to delete (exist locally but not in API)
        // CRITICAL: Only delete packages that belong to the same license being synced
        for (const [metrcid, existing] of existingPackages) {
            if (!apiPackages.find(pkg => pkg.id === metrcid)) {
                packagesToDelete.push(metrcid);
            }
        }
        
        console.log(`📊 Sync plan: ${packagesToInsert.length} insert, ${packagesToUpdate.length} update, ${packagesToDelete.length} delete`);
        
        // SAFETY CHECK: Prevent mass deletions
        if (packagesToDelete.length > 100) {
            console.error(`🚨 SAFETY CHECK FAILED: Attempting to delete ${packagesToDelete.length} packages. This exceeds the safety limit of 100.`);
            console.error(`🚨 This might indicate a sync logic error. Aborting sync to prevent data loss.`);
            await client.query('ROLLBACK');
            throw new Error(`Safety check failed: Too many deletions (${packagesToDelete.length} > 100). Sync aborted.`);
        }
        
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
                DELETE FROM activepackages 
                WHERE metrcid = ANY($1) AND sync_license = $2
            `;
            await client.query(deleteQuery, [packagesToDelete, METRC_CONFIG.licenseNumber]);
        }
        
        // Commit transaction
        await client.query('COMMIT');
        
        const duration = Date.now() - startTime;
        scriptOutput = `Active packages sync completed: ${packagesToInsert.length} inserted, ${packagesToUpdate.length} updated, ${packagesToDelete.length} deleted in ${duration}ms`;
        
        // Update all tracking entries
        await updateSyncJob(client, jobId, 'completed', scriptOutput);
        await updateSyncHistory(client, historyId, 'completed', duration, scriptOutput);
        await updateSyncBatchHistory(client, batchId, 'completed', duration);
        await updateSyncProgress(client, 'active_packages', METRC_CONFIG.licenseNumber, new Date());
        
        console.log(`✅ Enhanced sync completed: ${packagesToInsert.length} inserted, ${packagesToUpdate.length} updated, ${packagesToDelete.length} deleted`);
        
    } catch (error) {
        const duration = Date.now() - startTime;
        scriptError = error.message;
        
        console.error('❌ Enhanced sync failed:', error.message);
        await client.query('ROLLBACK');
        
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
        console.log('🚀 Starting METRC Enhanced Active Packages Sync');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 License: ${METRC_CONFIG.licenseNumber}`);
        
        await syncActivePackagesEnhanced();
        
        console.log('✅ Enhanced active packages sync completed successfully');
        
    } catch (error) {
        console.error('❌ Enhanced active packages sync failed:', error.message);
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
    syncActivePackagesEnhanced,
    fetchAllActivePackages,
    authenticateWithMetrc
};
