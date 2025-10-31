#!/usr/bin/env node

/**
 * Batch Sync Script - Module 3
 * 
 * This script runs the batch synchronization process to transform METRC packages into sellable batches.
 * 
 * Usage: node scripts/sync/sync-batches.js
 */

const path = require('path');
const { Pool } = require('pg');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
}

const BatchSyncService = require('../../Server/Services/BatchSyncService');
const syncFailureTracker = require('../../Server/Services/syncFailureTracker');

// Database pool for sync history tracking
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }
});

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

async function syncBatches() {
    const batchSyncService = new BatchSyncService();
    const client = await pool.connect();
    let historyId = null;
    const startTime = Date.now();
    
    try {
        await client.query('BEGIN');
        
        console.log('🚀 Starting Module 3 Batch Synchronization...');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 Database: ${process.env.DB_DATABASE || 'green_releaf_dev'}`);
        
        // Create sync history entry
        const licenseNumber = process.env.SYNC_LICENSE || 'CUL000063';
        historyId = await createSyncHistory(client, 'batches', licenseNumber, null, 'sync-batches.js');
        
        const result = await batchSyncService.syncBatches();
        
        const duration = Date.now() - startTime;
        const scriptOutput = `Batch sync completed: ${result.changes.new} new, ${result.changes.updated} updated, ${result.changes.removed} removed, ${result.changes.packageChanges} package changes`;
        
        // Update sync history on success
        await updateSyncHistory(client, historyId, 'completed', duration, scriptOutput, null);
        await client.query('COMMIT');
        
        // Record success in failure tracker
        try {
            await syncFailureTracker.recordSuccess('sync-batches', licenseNumber);
        } catch (trackError) {
            console.error('⚠️ Failed to record success in failure tracker:', trackError.message);
        }
        
        console.log('✅ Batch synchronization completed successfully!');
        console.log(`📊 Results: ${result.changes.new} new, ${result.changes.updated} updated, ${result.changes.removed} removed, ${result.changes.packageChanges} package changes`);
        console.log(`⏱️ Duration: ${duration}ms`);
        
        return result;
        
    } catch (error) {
        await client.query('ROLLBACK');
        const duration = Date.now() - startTime;
        const errorMessage = error.message || 'Unknown error';
        
        // Update sync history on failure
        if (historyId) {
            await updateSyncHistory(client, historyId, 'failed', duration, null, errorMessage);
        }
        
        // Record failure in failure tracker
        try {
            const licenseNumber = process.env.SYNC_LICENSE || 'CUL000063';
            await syncFailureTracker.recordFailure('sync-batches', errorMessage, licenseNumber);
        } catch (trackError) {
            console.error('⚠️ Failed to record failure in failure tracker:', trackError.message);
        }
        
        console.error('❌ Batch synchronization failed:', errorMessage);
        throw error;
    } finally {
        client.release();
        await batchSyncService.close();
        await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    syncBatches()
        .then(() => {
            console.log('🎉 Batch sync completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Batch sync failed:', error.message);
            process.exit(1);
        });
}

module.exports = { syncBatches };

