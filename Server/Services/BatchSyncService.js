/**
 * Batch Sync Service - Module 3
 * 
 * This service handles the synchronization of METRC packages into sellable batches.
 * It executes the batch extraction query, detects changes, and applies updates with full audit tracking.
 */

const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

class BatchSyncService {
    constructor() {
        const isDevelopment = process.env.NODE_ENV !== 'production';
        
        // Cache for license column name (expensive to query repeatedly)
        this._cachedLicenseColumn = null;
        
        this.dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_DATABASE || 'green_releaf_dev',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'postgres',
            max: 20,
            idleTimeoutMillis: 300000, // 5 minutes for idle connections
            connectionTimeoutMillis: 60000, // 60 seconds to establish connection
            // Prevent connection termination by keeping them active longer
            // Note: PostgreSQL keep-alive is handled at TCP level, but we can set longer timeouts
            // Only use SSL in production
            ...(isDevelopment ? {} : {
                ssl: { rejectUnauthorized: false }
            })
        };
        
        this.pool = new Pool(this.dbConfig);
        
        // Handle pool errors - don't exit, just log and allow retry
        this.pool.on('error', (err) => {
            console.error('❌ Unexpected database pool error:', err.message);
            // Don't exit process, allow retry logic to handle it
        });
        
        // Handle connection errors more gracefully
        this.pool.on('connect', (client) => {
            // Set keep-alive query on each new connection
            client.on('error', (err) => {
                console.error('❌ Client connection error:', err.message);
            });
        });
        
        this.batchExtractionQuery = null;
        
        // Load the batch extraction query
        this.loadBatchExtractionQuery();
    }

    /**
     * Load the batch extraction query from file
     */
    async loadBatchExtractionQuery() {
        try {
            const queryPath = path.join(__dirname, '../../Queries/metrc-batch-extractor-query.sql');
            this.batchExtractionQuery = await fs.readFile(queryPath, 'utf8');
            console.log('✅ Batch extraction query loaded successfully');
        } catch (error) {
            console.error('❌ Failed to load batch extraction query:', error.message);
            throw error;
        }
    }

    /**
     * Get a healthy database client with retry logic
     */
    async getHealthyClient(maxRetries = 3) {
        let retries = maxRetries;
        let lastError;
        
        while (retries > 0) {
            try {
                const client = await this.pool.connect();
                
                // Test the connection with a simple query (with timeout)
                try {
                    await Promise.race([
                        client.query('SELECT 1'),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Connection test timeout')), 10000)
                        )
                    ]);
                } catch (testError) {
                    client.release();
                    throw testError;
                }
                
                // Set statement timeout for this connection (6 minutes)
                try {
                    await client.query('SET statement_timeout = 360000');
                } catch (timeoutError) {
                    // If setting timeout fails, connection might be bad - release and retry
                    client.release();
                    throw timeoutError;
                }
                
                // Add error handler to client to catch connection termination
                const originalRelease = client.release.bind(client);
                client.release = function() {
                    try {
                        originalRelease();
                    } catch (err) {
                        console.error('   ⚠️ Error releasing connection:', err.message);
                    }
                };
                
                return client;
            } catch (error) {
                lastError = error;
                retries--;
                
                if (retries === 0) {
                    throw new Error(`Failed to get healthy database connection after ${maxRetries} attempts: ${error.message}`);
                }
                
                const delay = (maxRetries - retries) * 2000; // Exponential backoff: 2s, 4s, 6s
                console.log(`   ⚠️ Connection test failed (${error.message}), retrying in ${delay}ms... (${retries} attempts left)`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError || new Error('Failed to get database connection');
    }
    
    /**
     * Execute a query with automatic retry on connection errors
     * Note: If connection test fails, throws immediately so caller can get new client
     */
    async executeWithRetry(client, queryText, params = [], maxRetries = 2) {
        let retries = maxRetries;
        
        while (retries >= 0) {
            try {
                // Test connection is still alive before query (with short timeout)
                try {
                    await Promise.race([
                        client.query('SELECT 1'),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Connection test timeout')), 5000)
                        )
                    ]);
                } catch (testError) {
                    // Connection is dead, throw immediately so caller can get new client
                    throw new Error(`Connection lost: ${testError.message}`);
                }
                
                // Execute the actual query
                return await client.query(queryText, params);
            } catch (error) {
                // Check if it's a connection error that might be recoverable
                const isConnectionError = error.message.includes('Connection terminated') || 
                    error.message.includes('connection') ||
                    error.message.includes('ECONNRESET') ||
                    error.message.includes('socket') ||
                    error.message.includes('Connection lost');
                
                if (isConnectionError && retries > 0) {
                    console.log(`   ⚠️ Connection error during query, retrying... (${retries} attempts left)`);
                    retries--;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }
                
                // For non-connection errors or out of retries, throw immediately
                throw error;
            }
        }
        
        throw new Error('Query execution failed after retries');
    }

    /**
     * Execute the batch extraction query to get fresh batch data
     */
    async executeBatchExtractionQuery() {
        let client;
        let retries = 3;
        
        while (retries > 0) {
            try {
                client = await this.getHealthyClient();
                console.log('🔄 Executing batch extraction query...');
                
                // Use executeWithRetry for the long-running query
                const result = await this.executeWithRetry(client, this.batchExtractionQuery, [], 2);
                
                console.log(`✅ Batch extraction completed: ${result.rows.length} batches found`);
                return result.rows;
            } catch (error) {
                retries--;
                
                if (error.message.includes('Connection terminated') || 
                    error.message.includes('connection') ||
                    error.message.includes('ECONNRESET')) {
                    
                    if (retries > 0) {
                        console.log(`   ⚠️ Connection lost during batch extraction, retrying... (${retries} attempts left)`);
                        if (client) {
                            try {
                                client.release();
                            } catch (e) {
                                // Ignore release errors
                            }
                        }
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }
                }
                
                console.error('❌ Batch extraction query failed:', error.message);
                throw error;
            } finally {
                if (client) {
                    try {
                        client.release();
                    } catch (releaseError) {
                        console.error(`   ⚠️ Failed to release connection: ${releaseError.message}`);
                    }
                }
            }
        }
        
        throw new Error('Failed to execute batch extraction query after retries');
    }

    /**
     * Refresh batches for a specific set of METRC item names.
     *
     * This is a targeted mini-sync used after linking METRC items to a master product
     * so that quantities/availability are up-to-date immediately, without waiting for
     * the full scheduled sync.
     *
     * @param {string[]} metrcItemNames - Array of METRC item names (e.g. "M0000...: V2 Amaze Hashish 1g - Triple Burger")
     * @param {number} [productId] - Optional product ID to link batches to. If not provided, will auto-link based on metrc_linked_items
     * @returns {Promise<{success: boolean, updated: number, batches: Array}>}
     */
    async refreshBatchesForItems(metrcItemNames, productId = null) {
        if (!Array.isArray(metrcItemNames) || metrcItemNames.length === 0) {
            return {
                success: true,
                updated: 0,
                batches: []
            };
        }

        console.log('🔄 Refreshing batches for METRC items:', metrcItemNames);
        console.log(`   📊 Processing ${metrcItemNames.length} METRC item(s)`);

        // 1. Execute extraction query and filter to just these item names
        const freshBatchesAll = await this.executeBatchExtractionQuery();
        console.log(`   📦 Found ${freshBatchesAll.length} total batches in METRC extraction`);
        
        const freshBatches = freshBatchesAll.filter(b => metrcItemNames.includes(b.name));
        console.log(`   ✅ Filtered to ${freshBatches.length} batch(es) matching specified METRC items`);

        if (freshBatches.length === 0) {
            console.warn('⚠️ No fresh batches found for specified METRC items during refresh');
            console.warn(`   Available METRC item names in extraction: ${[...new Set(freshBatchesAll.map(b => b.name))].slice(0, 5).join(', ')}...`);
            return {
                success: true,
                updated: 0,
                created: 0,
                modified: 0,
                total: 0,
                batches: []
            };
        }

        // 2. Load existing batches and filter by these item names
        const existingBatchesAll = await this.loadExistingBatches();
        const existingBatches = existingBatchesAll.filter(b => metrcItemNames.includes(b.metrc_item_name));
        console.log(`   📊 Found ${existingBatches.length} existing batch(es) in database for these METRC items`);

        // 3. Detect changes only for these items and apply them with full history tracking
        const changes = this.detectChanges(freshBatches, existingBatches);

        let batchesUpdated = 0;
        let batchesCreated = 0;

        // If nothing changed, batches were still refreshed (checked from METRC)
        if (
            changes.new.length === 0 &&
            changes.updated.length === 0 &&
            changes.removed.length === 0 &&
            changes.packageChanges.length === 0
        ) {
            console.log('ℹ️ No batch changes detected for specified METRC items (batches are already up-to-date)');
            // Count existing batches as "refreshed" even if no changes
            batchesUpdated = existingBatches.length;
        } else {
            // Use default chunk size of 25 for refresh operations
            const chunkSize = 25;
            await this.applyChangesWithHistory(changes, chunkSize);
            batchesUpdated = changes.updated.length + changes.packageChanges.length;
            batchesCreated = changes.new.length;
            console.log(`   📊 Changes applied: ${batchesCreated} new, ${batchesUpdated} updated, ${changes.removed.length} removed`);
        }

        // 4. Link batches to products that have these METRC items in their metrc_linked_items
        // This ensures batches are properly linked after refresh
        const client = await this.pool.connect();
        try {
            // If productId is provided, use it directly. Otherwise, find products that have these METRC items linked
            if (productId) {
                // Link all batches for these METRC items to the specified product
                const linkResult = await client.query(`
                    UPDATE "ORDERS-batches"
                    SET fk_master_product_id = $1
                    WHERE metrc_item_name = ANY($2)
                      AND (fk_master_product_id IS NULL OR fk_master_product_id != $1)
                    RETURNING id, metrc_item_name
                `, [productId, metrcItemNames]);
                
                if (linkResult.rowCount > 0) {
                    console.log(`   🔗 Linked ${linkResult.rowCount} batch(es) to product ${productId}`);
                }
            } else {
                // Find products that have these METRC items linked
                const productsResult = await client.query(`
                    SELECT entry_id, metrc_linked_items
                    FROM "ORDERS-products"
                    WHERE metrc_linked_items IS NOT NULL
                      AND metrc_linked_items::text != '[]'
                `);
                
                // Build a map of metrc_item_name -> product_id
                const itemToProductMap = new Map();
                for (const product of productsResult.rows) {
                    const linkedItems = Array.isArray(product.metrc_linked_items) 
                        ? product.metrc_linked_items 
                        : JSON.parse(product.metrc_linked_items || '[]');
                    
                    for (const itemName of linkedItems) {
                        if (metrcItemNames.includes(itemName)) {
                            // If multiple products have the same item, use the first one found
                            if (!itemToProductMap.has(itemName)) {
                                itemToProductMap.set(itemName, product.entry_id);
                            }
                        }
                    }
                }
                
                // Link batches to products
                if (itemToProductMap.size > 0) {
                    for (const [itemName, prodId] of itemToProductMap.entries()) {
                        const linkResult = await client.query(`
                            UPDATE "ORDERS-batches"
                            SET fk_master_product_id = $1
                            WHERE metrc_item_name = $2
                              AND (fk_master_product_id IS NULL OR fk_master_product_id != $1)
                            RETURNING id
                        `, [prodId, itemName]);
                        
                        if (linkResult.rowCount > 0) {
                            console.log(`   🔗 Linked ${linkResult.rowCount} batch(es) for "${itemName}" to product ${prodId}`);
                        }
                    }
                }
            }
            
            // 5. Return the latest batch records for these items
            const result = await client.query(`
                SELECT 
                    id,
                    batch_name,
                    metrc_item_name,
                    quantity,
                    allocated_quantity,
                    (quantity - COALESCE(allocated_quantity, 0)) as available_quantity,
                    status,
                    fk_master_product_id
                FROM "ORDERS-batches"
                WHERE metrc_item_name = ANY($1)
                ORDER BY created_at DESC
            `, [metrcItemNames]);

            // Return count of batches that were actually updated/created, not just total count
            const totalBatchesAffected = batchesCreated + batchesUpdated;
            console.log(`✅ Refreshed batches for specified METRC items: ${batchesCreated} new, ${batchesUpdated} updated (${result.rowCount} total batches found)`);

            return {
                success: true,
                updated: totalBatchesAffected, // Total batches that were created or updated
                created: batchesCreated,
                modified: batchesUpdated,
                total: result.rowCount, // Total batches that exist for these items
                batches: result.rows
            };
        } catch (error) {
            console.error('❌ Failed to load refreshed batches:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Load existing batches from the database
     */
    async loadExistingBatches() {
        const client = await this.getHealthyClient();
        try {
            const query = `
                SELECT 
                    id, batch_name, metrc_item_name, first_sourcepackage_label,
                    quantity, allocated_quantity, package_count, full_package_count, partial_package_count,
                    available_labels, full_package_details, partial_package_details,
                    thc_percentage, production_date, test_date, best_by_date,
                    status, fk_master_product_id, last_modified, last_synced
                FROM "ORDERS-batches"
                ORDER BY batch_name
            `;
            
            const result = await client.query(query);
            console.log(`📊 Loaded ${result.rows.length} existing batches from database`);
            return result.rows;
        } catch (error) {
            console.error('❌ Failed to load existing batches:', error.message);
            if (error.message.includes('Connection terminated') || error.message.includes('connection')) {
                throw new Error(`Database connection lost while loading batches: ${error.message}`);
            }
            throw error;
        } finally {
            try {
                client.release();
            } catch (releaseError) {
                console.error(`   ⚠️ Failed to release connection: ${releaseError.message}`);
            }
        }
    }

    /**
     * Detect changes between fresh and existing batches
     */
    detectChanges(freshBatches, existingBatches) {
        const changes = {
            new: [],
            updated: [],
            removed: [],
            packageChanges: []
        };

        // Create lookup maps by batch_name (primary)
        const existingMap = new Map(
            existingBatches.map(b => [b.batch_name, b])
        );
        const freshMap = new Map(
            freshBatches.map(b => [b.batch_name, b])
        );

        // Also create lookup by METRC item + license for matching when batch_name changes
        // This handles the case where first_sourcepackage_label changes (packages consumed)
        const existingByMetrcItem = new Map();
        for (const batch of existingBatches) {
            const key = `${batch.metrc_item_name}|||${batch.synclicense || 'unknown'}`;
            if (!existingByMetrcItem.has(key)) {
                existingByMetrcItem.set(key, batch);
            }
        }

        // Detect new batches and handle batch_name changes
        for (const [batchName, freshBatch] of freshMap) {
            if (!existingMap.has(batchName)) {
                // Check if this is actually an existing batch with changed first_sourcepackage_label
                const metrcKey = `${freshBatch.name}|||${freshBatch.sync_license || 'unknown'}`;
                const existingByMetrc = existingByMetrcItem.get(metrcKey);
                
                if (existingByMetrc && existingByMetrc.batch_name !== batchName) {
                    // This is the same batch but with a different first_sourcepackage_label
                    // Treat it as an update, not a new batch
                    const updates = {
                        batch_name_changed: {
                            old: existingByMetrc.batch_name,
                            new: batchName
                        },
                        first_sourcepackage_label: {
                            old: existingByMetrc.first_sourcepackage_label,
                            new: freshBatch.first_sourcepackage_label
                        }
                    };
                    
                    // Check for other changes
                    if (freshBatch.quantity !== existingByMetrc.quantity) {
                        updates.quantity = {
                            old: existingByMetrc.quantity,
                            new: freshBatch.quantity
                        };
                    }
                    
                    if (freshBatch.package_count !== existingByMetrc.package_count) {
                        updates.package_count = {
                            old: existingByMetrc.package_count,
                            new: freshBatch.package_count
                        };
                    }
                    
                    changes.updated.push({
                        batch_name: existingByMetrc.batch_name, // Use old batch_name for update
                        new_batch_name: batchName, // Track new batch_name
                        updates: updates,
                        full_fresh_data: freshBatch,
                        existing_batch_id: existingByMetrc.id
                    });
                } else {
                    // Truly a new batch
                    changes.new.push(freshBatch);
                }
            }
        }

        // Detect updates and package level changes
        for (const [batchName, existingBatch] of existingMap) {
            const freshBatch = freshMap.get(batchName);

            if (!freshBatch) {
                // Check if this batch still exists but with different first_sourcepackage_label
                const metrcKey = `${existingBatch.metrc_item_name}|||${existingBatch.synclicense || 'unknown'}`;
                let foundInFresh = false;
                
                for (const [freshName, fresh] of freshMap) {
                    const freshMetrcKey = `${fresh.name}|||${fresh.sync_license || 'unknown'}`;
                    if (freshMetrcKey === metrcKey && freshName !== batchName) {
                        // This batch exists in fresh but with different name - already handled above
                        foundInFresh = true;
                        break;
                    }
                }
                
                if (!foundInFresh) {
                    // The batch no longer exists in METRC
                    changes.removed.push(existingBatch);
                }
                continue;
            }

            // Compare critical fields
            const updates = {};

            if (freshBatch.quantity !== existingBatch.quantity) {
                updates.quantity = {
                    old: existingBatch.quantity,
                    new: freshBatch.quantity
                };
            }

            if (freshBatch.package_count !== existingBatch.package_count) {
                updates.package_count = {
                    old: existingBatch.package_count,
                    new: freshBatch.package_count
                };

                // Check for package-level changes
                const packageDiff = this.comparePackageLabels(
                    existingBatch.available_labels,
                    freshBatch.available_labels
                );

                if (packageDiff.removed.length > 0 || packageDiff.added.length > 0) {
                    changes.packageChanges.push({
                        batch_name: batchName,
                        removed_packages: packageDiff.removed,
                        added_packages: packageDiff.added
                    });
                }
            }

            if (freshBatch.thc_percentage !== existingBatch.thc_percentage) {
                updates.thc_percentage = {
                    old: existingBatch.thc_percentage,
                    new: freshBatch.thc_percentage
                };
            }

            if (Object.keys(updates).length > 0) {
                changes.updated.push({
                    batch_name: batchName,
                    updates: updates,
                    full_fresh_data: freshBatch
                });
            }
        }

        return changes;
    }

    /**
     * Compare package labels to detect changes
     */
    comparePackageLabels(existingLabels, freshLabels) {
        const existing = new Set(existingLabels?.labels || []);
        const fresh = new Set(freshLabels?.labels || []);
        
        const removed = [...existing].filter(label => !fresh.has(label));
        const added = [...fresh].filter(label => !existing.has(label));
        
        return { removed, added };
    }

    /**
     * Detect orphaned batches - batches whose source packages no longer exist
     * This is a critical validation to prevent linking products to invalid batches
     */
    async detectOrphanedBatches(existingBatches) {
        const client = await this.getHealthyClient();
        try {
            // If existingBatches is provided and limited, only check those batches
            // Otherwise check all batches (for full sync)
            const batchIds = existingBatches && existingBatches.length > 0
                ? existingBatches.map(b => b.id)
                : null;
            
            // Check which batches have missing source packages
            // CRITICAL FIX: Check which license column exists in activepackages
            // Some environments use sync_license, others use synclicense
            const licenseColumnCheck = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'activepackages' 
                AND column_name IN ('sync_license', 'synclicense')
                LIMIT 1
            `);
            const activepackagesLicenseColumn = licenseColumnCheck.rows[0]?.column_name || 'sync_license';
            
            // Build query with optional batch ID filter
            let orphanedQuery = `
                SELECT 
                    b.id,
                    b.batch_name,
                    b.metrc_item_name,
                    b.first_sourcepackage_label,
                    b.sourcepackagelabels,
                    b.status,
                    b.fk_master_product_id,
                    b.synclicense,
                    -- CRITICAL FIX: Check if source package exists FOR THE SAME LICENSE
                    -- Batch has synclicense, activepackages has sync_license (or synclicense)
                    -- Must match licenses to avoid false positives
                    EXISTS (
                        SELECT 1 FROM activepackages 
                        WHERE label = b.first_sourcepackage_label
                        AND ${activepackagesLicenseColumn} = b.synclicense
                        AND isarchived = false
                        AND isfinished = false
                    ) as source_package_exists,
                    -- Check if any packages from sourcepackagelabels exist FOR THE SAME LICENSE
                    (
                        SELECT COUNT(*) 
                        FROM activepackages 
                        WHERE label = ANY(string_to_array(b.sourcepackagelabels, ','))
                        AND ${activepackagesLicenseColumn} = b.synclicense
                        AND isarchived = false
                        AND isfinished = false
                    ) as existing_package_count
                FROM "ORDERS-batches" b
                WHERE b.first_sourcepackage_label IS NOT NULL
                  AND b.first_sourcepackage_label != ''
                  AND b.synclicense IS NOT NULL
            `;
            
            const queryParams = [];
            if (batchIds && batchIds.length > 0) {
                orphanedQuery += ` AND b.id = ANY($1)`;
                queryParams.push(batchIds);
            }
            
            const result = await client.query(orphanedQuery, queryParams);
            const orphaned = result.rows.filter(b => 
                !b.source_package_exists || b.existing_package_count === 0
            );
            
            if (orphaned.length > 0) {
                console.log(`⚠️  Found ${orphaned.length} orphaned batch(es):`);
                orphaned.forEach(b => {
                    console.log(`   - Batch ${b.id} (${b.batch_name}): Source package "${b.first_sourcepackage_label}" missing for license ${b.synclicense}`);
                });
            }
            
            return orphaned.map(b => ({
                id: b.id,
                batch_name: b.batch_name,
                metrc_item_name: b.metrc_item_name,
                first_sourcepackage_label: b.first_sourcepackage_label,
                status: b.status,
                fk_master_product_id: b.fk_master_product_id,
                reason: 'Source package missing from activepackages'
            }));
            
        } catch (error) {
            console.error('❌ Error detecting orphaned batches:', error.message);
            // Don't fail the sync if orphan detection fails
            return [];
        } finally {
            try {
                client.release();
            } catch (e) {
                // Ignore release errors
            }
        }
    }

    /**
     * Find product ID that has this metrc_item_name in its metrc_linked_items
     * Returns null if no product matches
     */
    async findProductForMetrcItem(metrcItemName, client) {
        try {
            const result = await client.query(`
                SELECT entry_id, name
                FROM "ORDERS-products"
                WHERE metrc_linked_items @> $1::jsonb
                  AND is_archived = false
                LIMIT 1
            `, [JSON.stringify([metrcItemName])]);
            
            if (result.rows.length > 0) {
                return {
                    product_id: result.rows[0].entry_id,
                    product_name: result.rows[0].name
                };
            }
            return null;
        } catch (error) {
            console.error(`   ⚠️ Error finding product for metrc_item_name "${metrcItemName}":`, error.message);
            return null;
        }
    }

    /**
     * Apply changes with full history tracking
     * Optimized: Processes in chunks with batch operations
     */
    async applyChangesWithHistory(changes, chunkSize = 25) {
        // Use provided chunk size or default to 25 to prevent deadlocks with large batch updates
        const CHUNK_SIZE = chunkSize || 25;
        
        // Process NEW batches in chunks
        if (changes.new.length > 0) {
            console.log(`📝 Processing ${changes.new.length} new batches in chunks of ${CHUNK_SIZE}...`);
            for (let i = 0; i < changes.new.length; i += CHUNK_SIZE) {
                const chunk = changes.new.slice(i, i + CHUNK_SIZE);
                await this.processNewBatchesChunk(chunk, i + 1, changes.new.length);
            }
        }
        
        // Process UPDATES in chunks (optimized with bulk operations)
        if (changes.updated.length > 0) {
            console.log(`📝 Processing ${changes.updated.length} updated batches in chunks of ${CHUNK_SIZE}...`);
            for (let i = 0; i < changes.updated.length; i += CHUNK_SIZE) {
                const chunk = changes.updated.slice(i, i + CHUNK_SIZE);
                await this.processUpdatedBatchesChunk(chunk, i + 1, changes.updated.length);
            }
        }
        
        // Process REMOVED/ORPHANED batches in chunks (use smaller chunks to avoid deadlocks)
        if (changes.removed.length > 0) {
            const removedChunkSize = Math.min(CHUNK_SIZE, 20); // Smaller chunks for removed batches
            console.log(`📝 Processing ${changes.removed.length} removed/orphaned batches in chunks of ${removedChunkSize}...`);
            for (let i = 0; i < changes.removed.length; i += removedChunkSize) {
                const chunk = changes.removed.slice(i, i + removedChunkSize);
                await this.processRemovedBatchesChunk(chunk, i + 1, changes.removed.length);
            }
        }
        
        // Process REMOVED PACKAGES in chunks
        if (changes.packageChanges.length > 0) {
            console.log(`📝 Processing ${changes.packageChanges.length} package changes in chunks of ${CHUNK_SIZE}...`);
            for (let i = 0; i < changes.packageChanges.length; i += CHUNK_SIZE) {
                const chunk = changes.packageChanges.slice(i, i + CHUNK_SIZE);
                await this.processPackageChangesChunk(chunk, i + 1, changes.packageChanges.length);
            }
        }
        
        console.log('✅ All batch changes applied successfully');
    }

    /**
     * Process a chunk of new batches
     */
    async processNewBatchesChunk(batches, startIndex, total) {
        let client;
        let retries = 3;
        
        while (retries > 0) {
            try {
                client = await this.getHealthyClient();
                break;
            } catch (connectError) {
                retries--;
                if (retries === 0) {
                    throw new Error(`Failed to connect to database after 3 attempts: ${connectError.message}`);
                }
                console.log(`   ⚠️ Connection failed, retrying... (${retries} attempts left)`);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
            }
        }
        
        try {
            // Statement timeout already set in getHealthyClient, but ensure it's set
            await client.query('SET statement_timeout = 360000'); // 6 minutes
            await client.query('BEGIN');
            
            let processedCount = 0;
            for (const batch of batches) {
                try {
                    processedCount++;
                    if (processedCount % 10 === 0 || processedCount === batches.length) {
                        console.log(`   ✓ Processed ${processedCount}/${batches.length} new batches in this chunk`);
                    }
                    
                    // Determine initial status
                    let initialStatus = 'On Hold';
                    
                    // Check if there are already any Sellable batches for this metrc_item_name
                const existingSellableCheck = await client.query(`
                    SELECT COUNT(*) as count
                    FROM "ORDERS-batches"
                    WHERE metrc_item_name = $1 AND status = 'Sellable'
                `, [batch.name]);
                
                if (existingSellableCheck.rows[0].count === '0') {
                    // No Sellable batches exist - check if there are ANY existing batches
                    const existingAnyCheck = await client.query(`
                        SELECT COUNT(*) as count
                        FROM "ORDERS-batches"
                        WHERE metrc_item_name = $1
                    `, [batch.name]);
                    
                    if (existingAnyCheck.rows[0].count === '0') {
                        // First batch ever - make it Sellable!
                        initialStatus = 'Sellable';
                        console.log(`   ✨ Auto-promoting FIRST batch for item "${batch.name}" to Sellable`);
                    } else {
                        // Older batches exist but none are Sellable - promote the OLDEST one (by month then THC)
                        const oldestBatch = await client.query(`
                            SELECT id, batch_name
                            FROM "ORDERS-batches"
                            WHERE metrc_item_name = $1
                              AND status IN ('On Hold', 'On Deck')
                            ORDER BY 
                                DATE_TRUNC('month', production_date) ASC NULLS LAST,
                                COALESCE(thc_override, thc_percentage) ASC NULLS LAST,
                                created_at ASC
                            LIMIT 1
                        `, [batch.name]);
                        
                        if (oldestBatch.rows.length > 0) {
                            // Promote the oldest batch to Sellable
                            await client.query(`
                                UPDATE "ORDERS-batches"
                                SET status = 'Sellable'
                                WHERE id = $1
                            `, [oldestBatch.rows[0].id]);
                            
                            await client.query(`
                                INSERT INTO "ORDERS-batch-history" (
                                    batch_id, change_type, field_name, old_value, new_value, reason, changed_by_system
                                ) VALUES ($1, 'status_changed', 'status', 'On Deck', 'Sellable', 
                                          'Auto-promoted: No Sellable batches existed (oldest month + lowest THC)', true)
                            `, [oldestBatch.rows[0].id]);
                            
                            console.log(`   ✨ Auto-promoted OLDEST batch "${oldestBatch.rows[0].batch_name}" for item "${batch.name}" to Sellable`);
                        }
                        
                        // NEW batch stays as 'On Deck' (queued for auto-promotion)
                        initialStatus = 'On Deck';
                    }
                }
                
                // Check if batch already exists (race condition protection)
                const existingCheck = await client.query(`
                    SELECT id FROM "ORDERS-batches" WHERE batch_name = $1
                `, [batch.batch_name]);
                
                if (existingCheck.rows.length > 0) {
                    console.log(`   ⚠️ Batch "${batch.batch_name}" already exists (ID: ${existingCheck.rows[0].id}), skipping insert`);
                    continue; // Skip this batch - it's already in the database
                }
                
                const result = await client.query(`
                    INSERT INTO "ORDERS-batches" (
                        batch_name, metrc_item_name, first_sourcepackage_label,
                        sourcepackagelabels, quantity, package_count,
                        full_package_count, partial_package_count,
                        available_labels, full_package_details, partial_package_details,
                        item_productcategoryname, synclicense, storage_location,
                        thc_percentage, production_date, test_date, best_by_date,
                        last_modified, items_table_missing, 
                        unit_weight_grams_missing, unit_count_missing,
                        status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
                    ON CONFLICT (batch_name) DO NOTHING
                    RETURNING id
                `, [
                    batch.batch_name,
                    batch.name,
                    batch.first_sourcepackage_label,
                    batch.sourcepackagelabels,
                    batch.quantity,
                    batch.package_count,
                    batch.full_package_count,
                    batch.partial_package_count,
                    JSON.stringify(batch.available_labels),
                    JSON.stringify(batch.full_package_details),
                    JSON.stringify(batch.partial_package_details),
                    batch.item_productcategoryname,
                    batch.sync_license,
                    batch.storage_location,
                    batch.thc_percentage,
                    batch.production_date,
                    batch.test_date,
                    batch.best_by_date,
                    batch.last_modified,
                    batch.items_table_missing,
                    batch.unit_weight_grams_missing,
                    batch.unit_count_missing,
                    initialStatus
                ]);

                    // Check if insert was successful (ON CONFLICT DO NOTHING returns no rows if conflict)
                    if (result.rows.length === 0) {
                        console.log(`   ⚠️ Batch "${batch.batch_name}" already exists (skipped due to conflict)`);
                        continue; // Skip to next batch
                    }
                    
                    const newBatchId = result.rows[0].id;
                    
                    // AUTO-LINK: Find product that has this metrc_item_name in metrc_linked_items
                    const productMatch = await this.findProductForMetrcItem(batch.name, client);
                    if (productMatch) {
                        // Link the batch to the product
                        await client.query(`
                            UPDATE "ORDERS-batches"
                            SET fk_master_product_id = $1
                            WHERE id = $2
                        `, [productMatch.product_id, newBatchId]);
                        
                        // Log the auto-linking
                        await client.query(`
                            INSERT INTO "ORDERS-batch-history" (
                                batch_id, change_type, reason,
                                changed_by_system
                            ) VALUES ($1, 'master_product_linked', 
                                      'Auto-linked to product "${productMatch.product_name}" during batch sync', true)
                        `, [newBatchId]);
                        
                        console.log(`   🔗 Auto-linked batch "${batch.batch_name}" to product "${productMatch.product_name}" (ID: ${productMatch.product_id})`);
                    }

                    // Log creation
                    const reason = initialStatus === 'Sellable' 
                        ? 'Discovered in METRC sync - Auto-promoted as first batch for product'
                        : 'Discovered in METRC sync';
                        
                    await client.query(`
                        INSERT INTO "ORDERS-batch-history" (
                            batch_id, change_type, field_name, new_value, reason, 
                            changed_by_system, timestamp
                        ) VALUES ($1, 'batch_created', 'status', $2, $3, true, NOW())
                    `, [newBatchId, initialStatus, reason]);
                } catch (error) {
                    console.error(`   ❌ CRITICAL: Failed to create batch "${batch.batch_name}": ${error.message}`);
                    console.error(`   ❌ Error details:`, JSON.stringify(batch, null, 2));
                    throw error; // Abort transaction
                }
            }
            
            await client.query('COMMIT');
            console.log(`   ✓ Processed ${startIndex + batches.length - 1}/${total} new batches`);
            
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error(`   ⚠️ Rollback failed (connection may be lost): ${rollbackError.message}`);
            }
            console.error(`   ❌ Failed to process new batches chunk: ${error.message}`);
            if (error.message.includes('Connection terminated') || error.message.includes('connection')) {
                console.error(`   ⚠️ Connection error detected - this may be due to timeout or network issue`);
            }
            throw error;
        } finally {
            try {
                client.release();
            } catch (releaseError) {
                console.error(`   ⚠️ Failed to release connection: ${releaseError.message}`);
            }
        }
    }

    /**
     * Process a chunk of updated batches (OPTIMIZED with bulk operations)
     * Includes deadlock retry logic
     */
    async processUpdatedBatchesChunk(changes, startIndex, total) {
        const maxDeadlockRetries = 5;
        const baseDelay = 100; // Base delay in ms
        let deadlockRetries = 0;
        
        while (deadlockRetries < maxDeadlockRetries) {
            let client;
            let connectionRetries = 3;
            
            // Get connection
            while (connectionRetries > 0) {
                try {
                    client = await this.getHealthyClient();
                    break;
                } catch (connectError) {
                    connectionRetries--;
                    if (connectionRetries === 0) {
                        throw new Error(`Failed to connect to database after 3 attempts: ${connectError.message}`);
                    }
                    console.log(`   ⚠️ Connection failed, retrying... (${connectionRetries} attempts left)`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            try {
                // Statement timeout already set in getHealthyClient, but ensure it's set
                await client.query('SET statement_timeout = 360000'); // 6 minutes
                await client.query('BEGIN');
            
            // Step 1: Bulk fetch all batch IDs by name (single query)
            // Handle both old batch_name and new_batch_name (when first_sourcepackage_label changes)
            const batchNames = changes.map(c => c.batch_name).filter(Boolean);
            const newBatchNames = changes.map(c => c.new_batch_name).filter(Boolean);
            const allBatchNames = [...new Set([...batchNames, ...newBatchNames])];
            const batchIdMap = new Map();
            const batchIdByExistingId = new Map(); // For updates where batch_name changed
            
            if (allBatchNames.length > 0) {
                const batchIdsResult = await client.query(`
                    SELECT id, batch_name, fk_master_product_id, metrc_item_name
                    FROM "ORDERS-batches"
                    WHERE batch_name = ANY($1)
                `, [allBatchNames]);
                
                for (const row of batchIdsResult.rows) {
                    batchIdMap.set(row.batch_name, {
                        id: row.id,
                        isLinked: row.fk_master_product_id !== null,
                        metrcItemName: row.metrc_item_name
                    });
                }
            }
            
            // Also fetch by existing_batch_id for updates where batch_name changed
            const existingBatchIds = changes
                .filter(c => c.existing_batch_id)
                .map(c => c.existing_batch_id);
            
            if (existingBatchIds.length > 0) {
                const existingIdsResult = await client.query(`
                    SELECT id, batch_name, fk_master_product_id, metrc_item_name
                    FROM "ORDERS-batches"
                    WHERE id = ANY($1)
                `, [existingBatchIds]);
                
                for (const row of existingIdsResult.rows) {
                    batchIdByExistingId.set(row.id, {
                        id: row.id,
                        batch_name: row.batch_name,
                        isLinked: row.fk_master_product_id !== null,
                        metrcItemName: row.metrc_item_name
                    });
                }
            }
            
            // Step 2: Bulk fetch product matches for unlinked batches (single query)
            const unlinkedBatches = changes.filter(c => {
                const batchInfo = batchIdMap.get(c.batch_name);
                return batchInfo && !batchInfo.isLinked && batchInfo.metrcItemName;
            });
            
            const productMatchMap = new Map();
            if (unlinkedBatches.length > 0) {
                const metrcItemNames = [...new Set(unlinkedBatches.map(c => batchIdMap.get(c.batch_name).metrcItemName))];
                
                // Get all products with their linked items
                const productsResult = await client.query(`
                    SELECT entry_id, name, metrc_linked_items
                    FROM "ORDERS-products"
                    WHERE metrc_linked_items IS NOT NULL
                `);
                
                // Build a map of metrc_item_name -> product
                for (const product of productsResult.rows) {
                    const linkedItems = Array.isArray(product.metrc_linked_items) 
                        ? product.metrc_linked_items 
                        : (product.metrc_linked_items ? JSON.parse(product.metrc_linked_items) : []);
                    
                    for (const itemName of linkedItems) {
                        if (metrcItemNames.includes(itemName)) {
                            productMatchMap.set(itemName, {
                                product_id: product.entry_id,
                                product_name: product.name
                            });
                        }
                    }
                }
            }
            
            // Step 3: Prepare bulk update data
            const updateData = [];
            const historyInserts = [];
            const linkingHistoryInserts = [];
            
            for (const change of changes) {
                // Handle batch_name changes: use existing_batch_id if available
                let batchInfo = null;
                let batchId = null;
                
                if (change.existing_batch_id) {
                    // Batch name changed - use existing_batch_id
                    batchInfo = batchIdByExistingId.get(change.existing_batch_id);
                    batchId = change.existing_batch_id;
                } else {
                    // Normal update - use batch_name lookup
                    batchInfo = batchIdMap.get(change.batch_name);
                    batchId = batchInfo?.id;
                }
                
                if (!batchInfo || !batchId) {
                    console.log(`   ⚠️ Batch not found for update: ${change.batch_name} (existing_id: ${change.existing_batch_id})`);
                    continue;
                }
                const productMatch = !batchInfo.isLinked && batchInfo.metrcItemName
                    ? productMatchMap.get(batchInfo.metrcItemName)
                    : null;
                
                if (productMatch) {
                    console.log(`   🔗 Auto-linking unlinked batch "${change.batch_name}" to product "${productMatch.product_name}" (ID: ${productMatch.product_id})`);
                }
                
                // Prepare update data
                updateData.push({
                    batchId,
                    new_batch_name: change.new_batch_name || null, // New batch_name if it changed
                    new_first_sourcepackage_label: change.full_fresh_data.first_sourcepackage_label || null,
                    new_sourcepackagelabels: change.full_fresh_data.sourcepackagelabels || null,
                    quantity: change.full_fresh_data.quantity,
                    package_count: change.full_fresh_data.package_count,
                    full_package_count: change.full_fresh_data.full_package_count,
                    partial_package_count: change.full_fresh_data.partial_package_count,
                    available_labels: JSON.stringify(change.full_fresh_data.available_labels),
                    full_package_details: JSON.stringify(change.full_fresh_data.full_package_details),
                    partial_package_details: JSON.stringify(change.full_fresh_data.partial_package_details),
                    thc_percentage: change.full_fresh_data.thc_percentage,
                    last_modified: change.full_fresh_data.last_modified,
                    product_id: productMatch ? productMatch.product_id : null
                });
                
                // Prepare history inserts
                if (productMatch) {
                    linkingHistoryInserts.push({
                        batch_id: batchId,
                        reason: `Auto-linked to product "${productMatch.product_name}" during batch sync update`
                    });
                }
                
                // Only log significant field changes (not every field)
                if (change.updates && Object.keys(change.updates).length > 0) {
                    // Log as a single summary entry instead of per-field
                    const changedFields = Object.keys(change.updates).join(', ');
                    historyInserts.push({
                        batch_id: batchId,
                        change_type: 'field_updated',
                        field_name: 'multiple_fields',
                        old_value: 'see_change_details',
                        new_value: 'see_change_details',
                        reason: `METRC sync: ${changedFields} updated`,
                        change_details: JSON.stringify(change.updates)
                    });
                }
            }
            
            // Step 4: Update batches (sequential but optimized with prepared statements)
            // IMPORTANT: Sort by batchId to ensure consistent lock ordering and prevent deadlocks
            if (updateData.length > 0) {
                updateData.sort((a, b) => a.batchId - b.batchId);
                
                for (const d of updateData) {
                    // Build dynamic SET clause for batch_name changes
                    const setClauses = [];
                    const params = [];
                    let paramIndex = 1;
                    
                    // Add conditional fields first
                    if (d.new_batch_name) {
                        setClauses.push(`batch_name = $${paramIndex++}`);
                        params.push(d.new_batch_name);
                    }
                    if (d.new_first_sourcepackage_label) {
                        setClauses.push(`first_sourcepackage_label = $${paramIndex++}`);
                        params.push(d.new_first_sourcepackage_label);
                    }
                    if (d.new_sourcepackagelabels) {
                        setClauses.push(`sourcepackagelabels = $${paramIndex++}`);
                        params.push(d.new_sourcepackagelabels);
                    }
                    
                    // Add standard fields
                    setClauses.push(`quantity = $${paramIndex++}`);
                    params.push(d.quantity);
                    setClauses.push(`package_count = $${paramIndex++}`);
                    params.push(d.package_count);
                    setClauses.push(`full_package_count = $${paramIndex++}`);
                    params.push(d.full_package_count);
                    setClauses.push(`partial_package_count = $${paramIndex++}`);
                    params.push(d.partial_package_count);
                    setClauses.push(`available_labels = $${paramIndex++}::jsonb`);
                    params.push(d.available_labels);
                    setClauses.push(`full_package_details = $${paramIndex++}::jsonb`);
                    params.push(d.full_package_details);
                    setClauses.push(`partial_package_details = $${paramIndex++}::jsonb`);
                    params.push(d.partial_package_details);
                    setClauses.push(`thc_percentage = $${paramIndex++}`);
                    params.push(d.thc_percentage);
                    setClauses.push(`last_modified = $${paramIndex++}`);
                    params.push(d.last_modified);
                    setClauses.push(`last_synced = NOW()`);
                    setClauses.push(`fk_master_product_id = COALESCE($${paramIndex++}, fk_master_product_id)`);
                    params.push(d.product_id);
                    
                    // Add WHERE clause parameter
                    params.push(d.batchId);
                    
                    // Execute update
                    await client.query(`
                        UPDATE "ORDERS-batches"
                        SET ${setClauses.join(', ')}
                        WHERE id = $${paramIndex}
                    `, params);
                }
            }
            
            // Step 5: Insert history records (using individual inserts but still fast in chunks)
            if (linkingHistoryInserts.length > 0) {
                for (const h of linkingHistoryInserts) {
                    await client.query(`
                        INSERT INTO "ORDERS-batch-history" (batch_id, change_type, reason, changed_by_system)
                        VALUES ($1, 'master_product_linked', $2, true)
                    `, [h.batch_id, h.reason]);
                }
            }
            
            if (historyInserts.length > 0) {
                for (const h of historyInserts) {
                    await client.query(`
                        INSERT INTO "ORDERS-batch-history" (
                            batch_id, change_type, field_name, old_value, new_value, reason, changed_by_system, change_details
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, true, $7::jsonb)
                    `, [
                        h.batch_id, h.change_type, h.field_name, h.old_value, h.new_value, h.reason, h.change_details
                    ]);
                }
            }
            
                await client.query('COMMIT');
                console.log(`   ✓ Processed ${startIndex + changes.length - 1}/${total} updated batches`);
                
                // Success - break out of retry loop
                return;
                
            } catch (error) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    // Ignore rollback errors
                }
                
                // Check if it's a deadlock
                const isDeadlock = error.code === '40P01' || 
                                  error.message.includes('deadlock') || 
                                  error.message.includes('Deadlock');
                
                if (isDeadlock && deadlockRetries < maxDeadlockRetries - 1) {
                    deadlockRetries++;
                    // Exponential backoff with jitter
                    const delay = baseDelay * Math.pow(2, deadlockRetries) + Math.random() * 100;
                    console.log(`   ⚠️ Deadlock detected (attempt ${deadlockRetries}/${maxDeadlockRetries}), retrying after ${Math.round(delay)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    // Release connection before retry
                    try {
                        client.release();
                    } catch (e) {
                        // Ignore
                    }
                    continue; // Retry
                }
                
                // Not a deadlock, or max retries reached
                try {
                    client.release();
                } catch (releaseError) {
                    // Ignore
                }
                
                console.error(`   ❌ Failed to process batch chunk: ${error.message}`);
                if (error.message.includes('Connection terminated') || error.message.includes('connection')) {
                    console.error(`   ⚠️ Connection error detected - this may be due to timeout or network issue`);
                }
                throw error;
            }
        }
        
        // If we get here, all retries exhausted
        throw new Error(`Failed to process batch chunk after ${maxDeadlockRetries} deadlock retries`);
    }

    /**
     * Process a chunk of package changes
     */
    async processPackageChangesChunk(packageChanges, startIndex, total) {
        const client = await this.getHealthyClient();
        
        try {
            // Statement timeout already set in getHealthyClient, but ensure it's set
            await client.query('SET statement_timeout = 360000'); // 6 minutes
            await client.query('BEGIN');
            
            // Bulk fetch batch IDs
            const batchNames = packageChanges
                .filter(pc => pc.batch_name && pc.removed_packages && pc.removed_packages.length > 0)
                .map(pc => pc.batch_name);
            
            const batchIdMap = new Map();
            if (batchNames.length > 0) {
                const batchIdsResult = await client.query(`
                    SELECT id, batch_name
                    FROM "ORDERS-batches"
                    WHERE batch_name = ANY($1)
                `, [batchNames]);
                
                for (const row of batchIdsResult.rows) {
                    batchIdMap.set(row.batch_name, row.id);
                }
            }
            
            // Prepare bulk history inserts
            const historyInserts = [];
            
            for (const packageChange of packageChanges) {
                if (!packageChange.batch_name || !packageChange.removed_packages || packageChange.removed_packages.length === 0) {
                    continue;
                }
                
                const batchId = batchIdMap.get(packageChange.batch_name);
                if (!batchId) {
                    console.log(`   ⚠️ Batch not found: ${packageChange.batch_name}`);
                    continue;
                }
                
                for (const removedLabel of packageChange.removed_packages) {
                    const investigation = await this.investigateRemovedPackage(
                        removedLabel,
                        packageChange.batch_name,
                        client
                    );
                    
                    if (!investigation.reason) {
                        investigation.reason = 'unknown_removal';
                    }
                    
                    historyInserts.push({
                        batch_id: batchId,
                        reason: investigation.reason,
                        package_label: investigation.package_label,
                        related_invoice: investigation.related_invoice,
                        change_details: JSON.stringify(investigation)
                    });
                }
            }
            
            // Insert history records
            if (historyInserts.length > 0) {
                for (const h of historyInserts) {
                    await client.query(`
                        INSERT INTO "ORDERS-batch-history" (
                            batch_id, change_type, reason, related_package_label, 
                            related_invoice_id, change_details, changed_by_system
                        )
                        VALUES ($1, 'package_removed', $2, $3, $4, $5::jsonb, true)
                    `, [
                        h.batch_id, h.reason, h.package_label, h.related_invoice, h.change_details
                    ]);
                }
            }
            
            await client.query('COMMIT');
            console.log(`   ✓ Processed ${startIndex + packageChanges.length - 1}/${total} package changes`);
            
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error(`   ⚠️ Rollback failed (connection may be lost): ${rollbackError.message}`);
            }
            console.error(`   ❌ Failed to process package changes chunk: ${error.message}`);
            if (error.message.includes('Connection terminated') || error.message.includes('connection')) {
                console.error(`   ⚠️ Connection error detected - this may be due to timeout or network issue`);
            }
            throw error;
        } finally {
            try {
                client.release();
            } catch (releaseError) {
                console.error(`   ⚠️ Failed to release connection: ${releaseError.message}`);
            }
        }
    }

    /**
     * Process a chunk of removed/orphaned batches
     * Orphaned batches are batches whose source packages no longer exist in activepackages
     */
    async processRemovedBatchesChunk(batches, startIndex, total) {
        const maxDeadlockRetries = 5;
        const baseDelay = 200; // Base delay in ms for deadlock retries
        let deadlockRetries = 0;
        
        while (deadlockRetries < maxDeadlockRetries) {
            const client = await this.getHealthyClient();
            try {
                await client.query('BEGIN');
                
                // Cache the license column name ONCE per chunk (not per batch) to avoid expensive information_schema queries
                if (!this._cachedLicenseColumn) {
                    const licenseColumnCheck = await client.query(`
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_name = 'activepackages' 
                        AND column_name IN ('sync_license', 'synclicense')
                        LIMIT 1
                    `);
                    this._cachedLicenseColumn = licenseColumnCheck.rows[0]?.column_name || 'sync_license';
                }
                const activepackagesLicenseColumn = this._cachedLicenseColumn;
            
            for (const batch of batches) {
                const batchId = batch.id || await this.getBatchIdByName(batch.batch_name, client);
                if (!batchId) {
                    console.log(`   ⚠️ Batch not found: ${batch.batch_name || batch.id}`);
                    continue;
                }
                
                // Check if batch is orphaned (missing source packages)
                const isOrphaned = batch.reason && batch.reason.includes('Source package missing');
                
                if (isOrphaned) {
                    // Get old status and product info BEFORE update
                    const oldBatchInfo = await client.query(`
                        SELECT status, fk_master_product_id, metrc_item_name, synclicense
                        FROM "ORDERS-batches" 
                        WHERE id = $1
                    `, [batchId]);
                    const oldStatus = oldBatchInfo.rows[0]?.status || 'Unknown';
                    const oldProductId = oldBatchInfo.rows[0]?.fk_master_product_id;
                    const metrcItemName = oldBatchInfo.rows[0]?.metrc_item_name;
                    const batchLicense = oldBatchInfo.rows[0]?.synclicense;
                    
                    // CRITICAL FIX: Check if there are still active packages for this METRC item
                    // If yes, don't unlink - the batch extraction query will update the batch with new source packages
                    // Only unlink if there are truly no packages left for this METRC item
                    
                    const activePackagesCheck = await client.query(`
                        SELECT COUNT(*) as count
                        FROM activepackages
                        WHERE item_name = $1
                          AND ${activepackagesLicenseColumn} = $2
                          AND isarchived = false
                          AND isfinished = false
                    `, [metrcItemName, batchLicense]);
                    
                    const hasActivePackages = parseInt(activePackagesCheck.rows[0]?.count || 0, 10) > 0;
                    
                    // If there are still active packages for this METRC item, don't unlink
                    // The batch extraction query will update the batch with new source packages
                    // Only unlink if there are truly no packages left
                    const shouldUnlink = !hasActivePackages;
                    
                    // Mark orphaned batch as "On Hold" and set quantity to 0
                    // Only unlink from product if there are no active packages left for this METRC item
                    // Don't delete it - keep for audit trail
                    await client.query(`
                        UPDATE "ORDERS-batches"
                        SET 
                            status = 'On Hold',
                            quantity = 0,
                            allocated_quantity = 0,
                            ${shouldUnlink ? 'fk_master_product_id = NULL,' : ''}
                            last_synced = NOW()
                        WHERE id = $1
                    `, [batchId]);
                    
                    // Log to batch history
                    const reasonMessage = shouldUnlink 
                        ? 'Batch marked as orphaned - source package missing from activepackages. No active packages left for METRC item. Product unlinked.'
                        : 'Batch marked as orphaned - source package missing from activepackages. Active packages still exist for METRC item - will be updated by batch extraction query. Product link preserved.';
                    
                    await client.query(`
                        INSERT INTO "ORDERS-batch-history" (
                            batch_id, change_type, field_name, old_value, new_value,
                            reason, change_details, changed_by_system
                        ) VALUES ($1, 'status_changed', 'status', $2, 'On Hold',
                                  $3,
                                  $4::jsonb, true)
                    `, [batchId, oldStatus, reasonMessage, JSON.stringify({
                        reason: batch.reason,
                        first_sourcepackage_label: batch.first_sourcepackage_label,
                        metrc_item_name: batch.metrc_item_name,
                        action: 'marked_orphaned',
                        has_active_packages: hasActivePackages,
                        active_packages_count: activePackagesCheck.rows[0]?.count || 0,
                        product_unlinked: shouldUnlink && oldProductId ? true : false,
                        old_product_id: oldProductId
                    })]);
                    
                    if (shouldUnlink && oldProductId) {
                        console.log(`   ⚠️  Marked orphaned batch ${batchId} (${batch.batch_name}) as "On Hold" and unlinked from product ${oldProductId} - source package missing, no active packages left for METRC item`);
                    } else if (oldProductId) {
                        console.log(`   ⚠️  Marked orphaned batch ${batchId} (${batch.batch_name}) as "On Hold" but kept product link - active packages still exist for METRC item (will be updated by batch extraction)`);
                    } else {
                        console.log(`   ⚠️  Marked orphaned batch ${batchId} (${batch.batch_name}) as "On Hold" - source package missing`);
                    }
                } else {
                    // Batch was removed from METRC (no longer in extraction query)
                    // Mark as "On Hold" and set quantity to 0
                    await client.query(`
                        UPDATE "ORDERS-batches"
                        SET 
                            status = 'On Hold',
                            quantity = 0,
                            allocated_quantity = 0,
                            last_synced = NOW()
                        WHERE id = $1
                    `, [batchId]);
                    
                    // Log to batch history
                    await client.query(`
                        INSERT INTO "ORDERS-batch-history" (
                            batch_id, change_type, field_name, old_value, new_value,
                            reason, changed_by_system
                        ) VALUES ($1, 'status_changed', 'status', 
                                  (SELECT status FROM "ORDERS-batches" WHERE id = $1),
                                  'On Hold',
                                  'Batch removed from METRC - no longer in batch extraction query',
                                  true)
                    `, [batchId]);
                    
                    console.log(`   ⚠️  Marked removed batch ${batchId} (${batch.batch_name}) as "On Hold" - no longer in METRC`);
                }
            }
            
                await client.query('COMMIT');
                console.log(`   ✓ Processed ${startIndex + batches.length - 1}/${total} removed/orphaned batches`);
                
                // Success - break out of retry loop
                try {
                    client.release();
                } catch (releaseError) {
                    console.error(`   ⚠️ Failed to release connection: ${releaseError.message}`);
                }
                return;
                
            } catch (error) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    // Ignore rollback errors
                }
                
                try {
                    client.release();
                } catch (releaseError) {
                    // Ignore release errors
                }
                
                // Check if it's a deadlock
                const isDeadlock = error.message && (
                    error.message.includes('deadlock') ||
                    error.message.includes('deadlock detected') ||
                    error.code === '40P01'
                );
                
                if (isDeadlock && deadlockRetries < maxDeadlockRetries - 1) {
                    deadlockRetries++;
                    const delay = baseDelay * deadlockRetries; // Exponential backoff
                    console.log(`   ⚠️ Deadlock detected (attempt ${deadlockRetries}/${maxDeadlockRetries}), retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue; // Retry
                } else {
                    // Not a deadlock, or out of retries
                    console.error(`   ❌ Failed to process removed batches chunk: ${error.message}`);
                    throw error;
                }
            }
        }
        
        // Should never reach here, but just in case
        throw new Error('Failed to process removed batches chunk after all retries');
    }

    /**
     * Get batch ID by name
     */
    async getBatchIdByName(batchName, client) {
        const result = await client.query(
            'SELECT id FROM "ORDERS-batches" WHERE batch_name = $1',
            [batchName]
        );
        return result.rows[0]?.id;
    }

    /**
     * Investigate why a package was removed
     */
    async investigateRemovedPackage(packageLabel, batchName, client) {
        const investigation = {
            package_label: packageLabel,
            batch_name: batchName,
            reason: null,
            related_invoice: null,
            metrc_status: null
        };

        // Skip order_line_items check (Module 4 not implemented yet)
        // Skip transferredpackages and inactivepackages checks due to schema differences
        // Just mark as unknown removal for now
        
        investigation.reason = 'unknown_removal';
        return investigation;
    }

    /**
     * Check for auto-promotion triggers
     */
    async checkAutoPromotion() {
        const client = await this.getHealthyClient();
        try {
            // Find all Master Products that might need promotion
            const candidates = await client.query(`
                SELECT DISTINCT fk_master_product_id
                FROM "ORDERS-batches"
                WHERE status = 'On Deck'
                  AND fk_master_product_id IS NOT NULL
            `);

            for (const { fk_master_product_id } of candidates.rows) {
                await this.evaluateAndPromote(fk_master_product_id, client);
            }
        } finally {
            client.release();
        }
    }

    /**
     * Evaluate and promote batches for a Master Product
     */
    async evaluateAndPromote(masterProductId, client) {
        try {
            await client.query('BEGIN');

            // Check: Do ANY sellable batches have available quantity?
            const sellableCheck = await client.query(`
                SELECT SUM(quantity - allocated_quantity) as available
                FROM "ORDERS-batches"
                WHERE fk_master_product_id = $1
                  AND status = 'Sellable'
            `, [masterProductId]);

            const availableQty = sellableCheck.rows[0].available || 0;

            if (availableQty > 0) {
                // Still have sellable inventory, no promotion needed
                await client.query('COMMIT');
                return {
                    promoted: false,
                    reason: 'sellable_inventory_remaining'
                };
            }

            // Trigger auto-promotion!
            const promotionResult = await client.query(`
                UPDATE "ORDERS-batches"
                SET status = 'Sellable'
                WHERE fk_master_product_id = $1
                  AND status = 'On Deck'
                RETURNING id, batch_name
            `, [masterProductId]);

            if (promotionResult.rowCount === 0) {
                // No On Deck batches to promote
                await client.query('COMMIT');
                return {
                    promoted: false,
                    reason: 'no_on_deck_batches'
                };
            }

            // Log history for each promoted batch
            for (const batch of promotionResult.rows) {
                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id, change_type, field_name,
                        old_value, new_value, reason,
                        changed_by_system
                    ) VALUES ($1, 'status_changed', 'status', 'On Deck', 'Sellable', 
                              'Auto-promoted: Sellable inventory depleted', true)
                `, [batch.id]);
            }

            await client.query('COMMIT');

            // Log to audit trail (after commit to ensure data is saved)
            try {
                const auditLogger = require('./auditLogger');
                
                // Get product name for better logging
                const productInfo = await client.query(`
                    SELECT name FROM "ORDERS-products"
                    WHERE entry_id = $1
                `, [masterProductId]);
                
                const productName = productInfo.rows[0]?.name || `Product ID ${masterProductId}`;
                
                // Log summary promotion action
                await auditLogger.logAction({
                    userId: null, // System action
                    action: 'batch_promotion_auto',
                    resourceType: 'Product',
                    resourceId: masterProductId.toString(),
                    details: {
                        message: `System automatically promoted ${promotionResult.rows.length} batch(es) to Sellable for ${productName} (Product ID ${masterProductId}) due to inventory depletion during batch sync`,
                        batch_count: promotionResult.rows.length,
                        batch_names: promotionResult.rows.map(row => row.batch_name).join(', '),
                        batch_ids: promotionResult.rows.map(row => row.id),
                        new_status: 'Sellable',
                        product_id: masterProductId,
                        product_name: productName,
                        promotion_reason: 'Auto-promoted: Sellable inventory depleted',
                        promotion_type: 'automatic',
                        triggered_by: 'batch_sync'
                    },
                    status: 'success',
                    sourceIp: null
                });
                
                // Also log individual batch status updates for each batch
                for (const batch of promotionResult.rows) {
                    await auditLogger.logAction({
                        userId: null, // System action
                        action: 'batch_status_update',
                        resourceType: 'Batch',
                        resourceId: batch.id.toString(),
                        details: {
                            message: `System automatically updated Batch "${batch.batch_name}" (ID: ${batch.id}) status from "On Deck" to "Sellable" during batch sync`,
                            batch_id: batch.id,
                            batch_name: batch.batch_name,
                            old_status: 'On Deck',
                            new_status: 'Sellable',
                            product_id: masterProductId,
                            product_name: productName,
                            reason: 'Auto-promoted: Sellable inventory depleted',
                            update_type: 'automatic_promotion',
                            triggered_by: 'batch_sync',
                            changed: true
                        },
                        status: 'success',
                        sourceIp: null
                    });
                }
                
                console.log(`📝 Logged ${promotionResult.rows.length} batch promotion(s) to audit trail for product ${masterProductId}`);
            } catch (auditError) {
                // Don't fail the promotion if audit logging fails
                console.error('⚠️ Failed to log batch promotion to audit trail:', auditError.message);
            }

            return {
                promoted: true,
                count: promotionResult.rowCount,
                batches: promotionResult.rows
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    }

    /**
     * Main sync method
     */
    async syncBatches(options = {}) {
        const startTime = Date.now();
        console.log('🔄 Starting batch synchronization...');
        
        // Add test limit if specified (from options, env var, or default to null)
        const testLimit = options.testLimit || 
                         (process.env.TEST_SYNC_LIMIT ? parseInt(process.env.TEST_SYNC_LIMIT) : null) ||
                         (process.env.BATCH_SYNC_LIMIT ? parseInt(process.env.BATCH_SYNC_LIMIT) : null);
        
        if (testLimit) {
            console.log(`🧪 TEST MODE: Processing first ${testLimit} batches only`);
        }
        
        // Chunk size for processing (smaller chunks = less deadlock risk)
        const chunkSize = options.chunkSize || 
                         (process.env.BATCH_SYNC_CHUNK_SIZE ? parseInt(process.env.BATCH_SYNC_CHUNK_SIZE) : 50);
        console.log(`📦 Processing in chunks of ${chunkSize} batches`);

        try {
            // 1. Execute extraction query
            const freshBatches = await this.executeBatchExtractionQuery();
            
            // Apply test limit to fresh batches if specified
            const limitedFreshBatches = testLimit ? freshBatches.slice(0, testLimit) : freshBatches;
            if (testLimit && freshBatches.length > testLimit) {
                console.log(`🧪 Limited fresh batches from ${freshBatches.length} to ${limitedFreshBatches.length} for testing`);
            }

            // 2. Load existing batches
            const existingBatches = await this.loadExistingBatches();
            
            // Apply test limit to existing batches if specified (match by METRC item)
            let limitedExistingBatches = existingBatches;
            if (testLimit && limitedFreshBatches.length > 0) {
                const testMetrcItems = new Set(limitedFreshBatches.map(b => b.name));
                limitedExistingBatches = existingBatches.filter(b => testMetrcItems.has(b.metrc_item_name));
                if (existingBatches.length > limitedExistingBatches.length) {
                    console.log(`🧪 Limited existing batches from ${existingBatches.length} to ${limitedExistingBatches.length} for testing`);
                }
            }

            // 3. Compare and classify changes
            const changes = this.detectChanges(limitedFreshBatches, limitedExistingBatches);

            // 3.5. Detect orphaned batches (batches with missing source packages) - only for limited batches if test mode
            const orphanedBatches = await this.detectOrphanedBatches(limitedExistingBatches);
            if (orphanedBatches.length > 0) {
                console.log(`⚠️  WARNING: ${orphanedBatches.length} orphaned batch(es) detected (missing source packages)`);
                // Add orphaned batches to removed list for cleanup
                changes.removed.push(...orphanedBatches);
            }

            // Apply test limit to removed batches if specified
            if (testLimit && changes.removed.length > testLimit) {
                console.log(`🧪 Limiting removed batches from ${changes.removed.length} to ${testLimit} for testing`);
                changes.removed = changes.removed.slice(0, testLimit);
            }

            console.log(`📊 Sync plan: ${changes.new.length} new, ${changes.updated.length} updated, ${changes.removed.length} removed, ${changes.packageChanges.length} package changes`);

            // 4. Apply test limit if specified (already applied above)
            if (testLimit) {
                if (changes.new.length > testLimit) {
                    console.log(`🧪 Limiting new batches from ${changes.new.length} to ${testLimit}`);
                    changes.new = changes.new.slice(0, testLimit);
                }
                if (changes.updated.length > testLimit) {
                    console.log(`🧪 Limiting updated batches from ${changes.updated.length} to ${testLimit}`);
                    changes.updated = changes.updated.slice(0, testLimit);
                }
                if (changes.packageChanges.length > testLimit) {
                    console.log(`🧪 Limiting package changes from ${changes.packageChanges.length} to ${testLimit}`);
                    changes.packageChanges = changes.packageChanges.slice(0, testLimit);
                }
            }

            // 4. Execute updates in transaction
            await this.applyChangesWithHistory(changes);

            // 5. Check for auto-promotion triggers
            await this.checkAutoPromotion();

            const duration = Date.now() - startTime;
            console.log(`✅ Batch sync completed in ${duration}ms`);

            return {
                success: true,
                duration,
                changes: {
                    new: changes.new.length,
                    updated: changes.updated.length,
                    removed: changes.removed.length,
                    packageChanges: changes.packageChanges.length
                }
            };

        } catch (error) {
            console.error('❌ Batch sync failed:', error.message);
            throw error;
        }
    }

    /**
     * Close database connections
     * Adds timeout to prevent hanging if connections are stuck
     */
    async close() {
        try {
            // First, drain the pool by waiting for active connections to finish
            // This gives connections time to complete their work
            await this.pool.drain();
            
            // Then close the pool with a timeout
            await Promise.race([
                this.pool.end(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Pool close timeout after 15 seconds')), 15000)
                )
            ]);
            console.log('✅ BatchSyncService pool closed successfully');
        } catch (error) {
            if (error.message.includes('timeout')) {
                console.warn('⚠️ Pool close timed out - forcing close');
                // Force close by removing all idle connections
                this.pool.end().catch(() => {
                    // Ignore errors on forced close
                });
            } else {
                console.warn('⚠️ Error closing BatchSyncService pool:', error.message);
                throw error;
            }
        }
    }
}

module.exports = BatchSyncService;

