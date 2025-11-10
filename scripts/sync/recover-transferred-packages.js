#!/usr/bin/env node

/**
 * Recovery Script for Transferred Packages
 * 
 * This script forces a FULL sync to restore all transferred packages from METRC API
 * Use this after accidental deletion to recover all historical data
 * 
 * Usage: NODE_ENV=production node scripts/sync/recover-transferred-packages.js
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

// Import the sync functions from the main script
// We'll need to copy the fetch function but force it to do a full sync
const pool = new Pool(DB_CONFIG);

/**
 * Fetch ALL transferred packages from METRC API (FORCED FULL SYNC)
 * This bypasses delta sync to recover all data
 */
async function fetchAllTransferredPackages(maxPages = null) {
    try {
        console.log('🔐 Authenticating with METRC T3 API...');
        const success = await metrcAuth.ensureValidToken();
        if (!success) {
            throw new Error('Failed to obtain valid METRC authentication token');
        }

        if (maxPages) {
            console.log(`📡 RECOVERY MODE (TEST): Fetching first ${maxPages} pages from METRC API...`);
        } else {
            console.log('📡 RECOVERY MODE: Fetching ALL transferred packages from METRC API (FULL SYNC)...');
            console.log('⚠️  This will fetch all pages and may take a long time...');
        }
        
        let allPackages = [];
        let page = 1;
        let hasMorePages = true;
        const pageSize = 500;
        
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
                    const response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: `${metrcAuth.apiBaseUrl}/packages/transferred`,
                        params: {
                            licenseNumber: metrcAuth.licenseNumber,
                            page: page,
                            pageSize: pageSize
                        },
                        timeout: 60000 // 60 second timeout for recovery
                    });

                    if (response.data && response.data.data) {
                        const packages = response.data.data;
                        allPackages = allPackages.concat(packages);
                        
                        console.log(`✅ Retrieved ${packages.length} transferred packages from page ${page} (total: ${allPackages.length})`);
                        
                        // Check if there are more pages
                        const totalPages = response.data.totalPages || Math.ceil(response.data.total / pageSize);
                        hasMorePages = page < totalPages && (!maxPages || page < maxPages);
                        page++;
                        success = true;
                        
                        // Small delay to avoid rate limiting
                        if (hasMorePages) {
                            await new Promise(resolve => setTimeout(resolve, 300));
                        }
                    } else {
                        console.log('⚠️ No transferred packages data received for page', page);
                        hasMorePages = false;
                        success = true;
                    }
                } catch (error) {
                    retries--;
                    if (retries > 0) {
                        const waitTime = 3000 * (4 - retries); // Exponential backoff
                        console.log(`⚠️ API error on page ${page}, retrying in ${waitTime/1000} seconds... (${retries} retries left)`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
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
 * Check if unique constraint exists on metrcid
 */
async function checkMetrcIdConstraint(client) {
    try {
        const query = `
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'transferredpackages' 
            AND constraint_type = 'UNIQUE' 
            AND constraint_name LIKE '%metrcid%'
        `;
        const result = await client.query(query);
        return result.rows.length > 0;
    } catch (error) {
        console.error('Error checking constraint:', error.message);
        return false;
    }
}

/**
 * Main recovery function
 */
async function recoverTransferredPackages() {
    const client = await pool.connect();
    const startTime = Date.now();
    const maxPages = process.env.MAX_PAGES ? parseInt(process.env.MAX_PAGES) : null;
    
    try {
        console.log('🚨 STARTING TRANSFERRED PACKAGES RECOVERY');
        console.log('==========================================');
        if (maxPages) {
            console.log(`🧪 TEST MODE: Will only fetch first ${maxPages} pages`);
        } else {
            console.log('⚠️  This will restore ALL transferred packages from METRC API');
            console.log('⚠️  This may take a long time depending on the number of packages');
        }
        console.log('==========================================\n');
        
        // Check if unique constraint exists
        const hasConstraint = await checkMetrcIdConstraint(client);
        if (!hasConstraint) {
            console.log('⚠️  WARNING: No unique constraint found on metrcid column');
            console.log('⚠️  Will use INSERT with duplicate checking instead of UPSERT\n');
        }
        
        // Fetch all packages from API
        const transferredPackages = await fetchAllTransferredPackages(maxPages);
        
        if (transferredPackages.length === 0) {
            console.log('ℹ️ No transferred packages found in METRC API');
            return;
        }
        
        console.log(`\n📊 Found ${transferredPackages.length} transferred packages to restore`);
        console.log('🔄 Starting database restoration...\n');
        
        // Get existing packages count
        const existingResult = await client.query(
            'SELECT COUNT(*) as count FROM transferredpackages WHERE sync_license = $1',
            [metrcAuth.licenseNumber]
        );
        const existingCount = parseInt(existingResult.rows[0].count);
        
        console.log(`📊 Current database has ${existingCount} transferred packages`);
        console.log(`📊 Will restore ${transferredPackages.length} packages from METRC\n`);
        
        // Use UPSERT to insert/update all packages
        // Import the field mapping and prepare functions from main script
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
        
        function prepareValue(value, fieldName) {
            if (value === null || value === undefined) {
                if (fieldName === 'label') {
                    return 'UNKNOWN_LABEL';
                }
                return null;
            }
            // Keep numeric fields as numbers for metrcid
            if (fieldName === 'metrcid') {
                return parseInt(value) || value;
            }
            return String(value);
        }
        
        // Process in chunks
        const CHUNK_SIZE = 500;
        let totalInserted = 0;
        let totalUpdated = 0;
        
        for (let i = 0; i < transferredPackages.length; i += CHUNK_SIZE) {
            const chunk = transferredPackages.slice(i, i + CHUNK_SIZE);
            const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
            const totalChunks = Math.ceil(transferredPackages.length / CHUNK_SIZE);
            
            console.log(`📦 Processing chunk ${chunkNumber}/${totalChunks} (${chunk.length} packages)...`);
            
            const fields = Object.keys(TRANSFERRED_PACKAGE_FIELDS);
            const fieldList = fields.join(', ');
            const updateFields = fields.filter(field => field !== 'metrcid' && field !== 'sync_license');
            const updateClause = updateFields.map(field => `${field} = EXCLUDED.${field}`).join(', ');
            
            // Build values array
            const values = [];
            const placeholders = [];
            chunk.forEach((record, recordIndex) => {
                const recordPlaceholders = [];
                fields.forEach((field, fieldIndex) => {
                    const paramIndex = recordIndex * fields.length + fieldIndex + 1;
                    recordPlaceholders.push(`$${paramIndex}`);
                    
                    if (field === 'sync_license') {
                        values.push(metrcAuth.licenseNumber);
                    } else {
                        const apiField = TRANSFERRED_PACKAGE_FIELDS[field];
                        values.push(prepareValue(record[apiField], field));
                    }
                });
                placeholders.push(`(${recordPlaceholders.join(', ')})`);
            });
            
            // Use different approach based on whether constraint exists
            let query;
            if (hasConstraint) {
                // Use UPSERT if constraint exists
                query = `
                    INSERT INTO transferredpackages (${fieldList})
                    VALUES ${placeholders.join(', ')}
                    ON CONFLICT (metrcid) 
                    DO UPDATE SET ${updateClause}
                `;
            } else {
                // Use INSERT with duplicate checking
                // Insert records one by one with existence check to avoid type issues
                // This is slower but more reliable when constraint doesn't exist
                query = null; // Will use individual inserts below
            }
            
            // If no constraint, use temp table approach for bulk insert
            if (!hasConstraint) {
                console.log(`   Using temp table for bulk insert (${chunk.length} packages)...`);
                const tempTableName = `temp_transferred_${Date.now()}`;
                
                try {
                    // Create temp table with same structure
                    await client.query(`
                        CREATE TEMP TABLE ${tempTableName} (LIKE transferredpackages INCLUDING ALL)
                    `);
                    
                    // Insert all records into temp table
                    const tempValues = [];
                    const tempPlaceholders = [];
                    chunk.forEach((record, recordIndex) => {
                        const recordPlaceholders = [];
                        fields.forEach((field, fieldIndex) => {
                            const paramIndex = recordIndex * fields.length + fieldIndex + 1;
                            recordPlaceholders.push(`$${paramIndex}`);
                            
                            if (field === 'sync_license') {
                                tempValues.push(metrcAuth.licenseNumber);
                            } else {
                                const apiField = TRANSFERRED_PACKAGE_FIELDS[field];
                                tempValues.push(prepareValue(record[apiField], field));
                            }
                        });
                        tempPlaceholders.push(`(${recordPlaceholders.join(', ')})`);
                    });
                    
                    const tempInsertQuery = `
                        INSERT INTO ${tempTableName} (${fieldList})
                        VALUES ${tempPlaceholders.join(', ')}
                    `;
                    
                    await client.query(tempInsertQuery, tempValues);
                    console.log(`   ✅ Loaded ${chunk.length} records into temp table`);
                    
                    // Insert from temp table to main table, excluding duplicates
                    const bulkInsertQuery = `
                        INSERT INTO transferredpackages (${fieldList})
                        SELECT ${fieldList} FROM ${tempTableName} t
                        WHERE NOT EXISTS (
                            SELECT 1 FROM transferredpackages tp
                            WHERE tp.metrcid = t.metrcid::integer 
                            AND tp.sync_license = t.sync_license
                        )
                    `;
                    
                    const result = await client.query(bulkInsertQuery);
                    const chunkInserted = result.rowCount;
                    
                    // Drop temp table
                    await client.query(`DROP TABLE IF EXISTS ${tempTableName}`);
                    
                    totalInserted += chunkInserted;
                    console.log(`✅ Chunk ${chunkNumber}/${totalChunks} completed (${chunkInserted} packages inserted)`);
                    continue; // Skip to next chunk
                    
                } catch (error) {
                    // Clean up temp table on error
                    try {
                        await client.query(`DROP TABLE IF EXISTS ${tempTableName}`);
                    } catch (e) {
                        // Ignore cleanup errors
                    }
                    console.error(`❌ Error in temp table approach: ${error.message}`);
                    throw error;
                }
            }
            
            try {
                const result = await client.query(query, values);
                const insertedCount = hasConstraint ? chunk.length : result.rowCount;
                totalInserted += insertedCount;
                if (hasConstraint) {
                    totalUpdated += chunk.length - insertedCount; // Approximate
                }
                console.log(`✅ Chunk ${chunkNumber}/${totalChunks} completed (${insertedCount} packages inserted)`);
            } catch (error) {
                console.error(`❌ Error processing chunk ${chunkNumber}:`, error.message);
                // Try individual inserts as fallback
                console.log(`🔄 Attempting individual inserts for chunk ${chunkNumber}...`);
                let individualSuccess = 0;
                for (const record of chunk) {
                    try {
                        const recordValues = [];
                        const recordPlaceholders = [];
                        fields.forEach((field, fieldIndex) => {
                            recordPlaceholders.push(`$${fieldIndex + 1}`);
                            if (field === 'sync_license') {
                                recordValues.push(metrcAuth.licenseNumber);
                            } else {
                                const apiField = TRANSFERRED_PACKAGE_FIELDS[field];
                                recordValues.push(prepareValue(record[apiField], field));
                            }
                        });
                        
                        // Check if record exists first
                        // metrcid is INTEGER, so convert to integer
                        const metrcIdValue = parseInt(record.id) || record.id;
                        const checkQuery = `
                            SELECT 1 FROM transferredpackages 
                            WHERE metrcid = $1 AND sync_license = $2
                        `;
                        const checkResult = await client.query(checkQuery, [
                            metrcIdValue,
                            metrcAuth.licenseNumber
                        ]);
                        
                        if (checkResult.rows.length === 0) {
                            // Record doesn't exist, insert it
                            const insertQuery = `
                                INSERT INTO transferredpackages (${fieldList})
                                VALUES (${recordPlaceholders.join(', ')})
                            `;
                            await client.query(insertQuery, recordValues);
                            individualSuccess++;
                        }
                        // If record exists, skip it
                    } catch (e) {
                        // Skip duplicates or errors
                    }
                }
                totalInserted += individualSuccess;
                console.log(`✅ Individual inserts: ${individualSuccess}/${chunk.length} succeeded`);
            }
            
            // Small delay between chunks
            if (i + CHUNK_SIZE < transferredPackages.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        const duration = Date.now() - startTime;
        const finalResult = await client.query(
            'SELECT COUNT(*) as count FROM transferredpackages WHERE sync_license = $1',
            [metrcAuth.licenseNumber]
        );
        const finalCount = parseInt(finalResult.rows[0].count);
        
        console.log('\n==========================================');
        console.log('✅ RECOVERY COMPLETED');
        console.log('==========================================');
        console.log(`📊 Packages inserted: ${totalInserted}`);
        if (totalUpdated > 0) {
            console.log(`📊 Packages updated: ${totalUpdated}`);
        }
        console.log(`📊 Total packages in database: ${finalCount}`);
        console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)} seconds`);
        if (maxPages) {
            console.log(`🧪 TEST MODE: Only processed ${maxPages} pages`);
            console.log('💡 Run without MAX_PAGES to restore all data');
        }
        console.log('==========================================\n');
        
    } catch (error) {
        console.error('\n❌ RECOVERY FAILED:', error.message);
        console.error(error.stack);
        throw error;
    } finally {
        client.release();
    }
}

// Run recovery
if (require.main === module) {
    recoverTransferredPackages()
        .then(() => {
            console.log('✅ Recovery script completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Recovery script failed:', error);
            process.exit(1);
        });
}

module.exports = { recoverTransferredPackages };

