#!/usr/bin/env node

/**
 * Batch Sync Script - Module 3
 * 
 * This script runs the batch synchronization process to transform METRC packages into sellable batches.
 * 
 * Usage: node scripts/sync/sync-batches.js
 */

const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
}

const BatchSyncService = require('../../Server/Services/BatchSyncService');

async function syncBatches() {
    const batchSyncService = new BatchSyncService();
    
    try {
        console.log('🚀 Starting Module 3 Batch Synchronization...');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 Database: ${process.env.DB_DATABASE || 'green_releaf_dev'}`);
        
        const result = await batchSyncService.syncBatches();
        
        console.log('✅ Batch synchronization completed successfully!');
        console.log(`📊 Results: ${result.changes.new} new, ${result.changes.updated} updated, ${result.changes.removed} removed, ${result.changes.packageChanges} package changes`);
        console.log(`⏱️ Duration: ${result.duration}ms`);
        
        return result;
        
    } catch (error) {
        console.error('❌ Batch synchronization failed:', error.message);
        throw error;
    } finally {
        await batchSyncService.close();
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

