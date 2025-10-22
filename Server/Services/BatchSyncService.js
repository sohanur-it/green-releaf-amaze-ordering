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
        
        this.dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_DATABASE || 'green_releaf_dev',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'postgres',
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 30000,
            // Only use SSL in production
            ...(isDevelopment ? {} : {
                ssl: { rejectUnauthorized: false }
            })
        };
        
        this.pool = new Pool(this.dbConfig);
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
     * Execute the batch extraction query to get fresh batch data
     */
    async executeBatchExtractionQuery() {
        const client = await this.pool.connect();
        try {
            console.log('🔄 Executing batch extraction query...');
            const result = await client.query(this.batchExtractionQuery);
            console.log(`✅ Batch extraction completed: ${result.rows.length} batches found`);
            return result.rows;
        } catch (error) {
            console.error('❌ Batch extraction query failed:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Load existing batches from the database
     */
    async loadExistingBatches() {
        const client = await this.pool.connect();
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
            throw error;
        } finally {
            client.release();
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

        // Create lookup maps
        const existingMap = new Map(
            existingBatches.map(b => [b.batch_name, b])
        );
        const freshMap = new Map(
            freshBatches.map(b => [b.batch_name, b])
        );

        // Detect new batches
        for (const [batchName, freshBatch] of freshMap) {
            if (!existingMap.has(batchName)) {
                changes.new.push(freshBatch);
            }
        }

        // Detect updates and package level changes
        for (const [batchName, existingBatch] of existingMap) {
            const freshBatch = freshMap.get(batchName);

            if (!freshBatch) {
                // The batch no longer exists in METRC
                changes.removed.push(existingBatch);
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
     * Apply changes with full history tracking
     */
    async applyChangesWithHistory(changes) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Process NEW batches
            console.log(`📝 Processing ${changes.new.length} new batches...`);
            let processedNew = 0;
            for (const batch of changes.new) {
                processedNew++;
                if (processedNew % 10 === 0 || processedNew === changes.new.length) {
                    console.log(`   ✓ Processed ${processedNew}/${changes.new.length} new batches`);
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
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 'On Hold')
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
                    batch.unit_count_missing
                ]);

                // Log creation
                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id, change_type, reason, 
                        changed_by_system, timestamp
                    ) VALUES ($1, 'batch_created', 'Discovered in METRC sync', true, NOW())
                `, [result.rows[0].id]);
            }

            // Process UPDATES
            console.log(`📝 Processing ${changes.updated.length} updated batches...`);
            let processedUpdates = 0;
            for (const change of changes.updated) {
                processedUpdates++;
                if (processedUpdates % 10 === 0 || processedUpdates === changes.updated.length) {
                    console.log(`   ✓ Processed ${processedUpdates}/${changes.updated.length} updates`);
                }
                const batchId = await this.getBatchIdByName(change.batch_name, client);

                // Update the batch (preserving the status)
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET 
                        quantity = $1,
                        package_count = $2,
                        full_package_count = $3,
                        partial_package_count = $4,
                        available_labels = $5,
                        full_package_details = $6,
                        partial_package_details = $7,
                        thc_percentage = $8,
                        last_modified = $9,
                        last_synced = NOW()
                    WHERE id = $10
                `, [
                    change.full_fresh_data.quantity,
                    change.full_fresh_data.package_count,
                    change.full_fresh_data.full_package_count,
                    change.full_fresh_data.partial_package_count,
                    JSON.stringify(change.full_fresh_data.available_labels),
                    JSON.stringify(change.full_fresh_data.full_package_details),
                    JSON.stringify(change.full_fresh_data.partial_package_details),
                    change.full_fresh_data.thc_percentage,
                    change.full_fresh_data.last_modified,
                    batchId
                ]);

                // Log each field change
                for (const [field, values] of Object.entries(change.updates)) {
                    await client.query(`
                        INSERT INTO "ORDERS-batch-history" (
                            batch_id, change_type, field_name,
                            old_value, new_value, reason,
                            changed_by_system
                        ) VALUES ($1, 'field_updated', $2, $3, $4, 'METRC sync detected change', true)
                    `, [batchId, field, values.old?.toString() || 'null', values.new?.toString() || 'null']);
                }
            }

            // Process REMOVED PACKAGES
            console.log(`📝 Processing ${changes.packageChanges.length} package changes...`);
            let processedPkgChanges = 0;
            for (const packageChange of changes.packageChanges) {
                processedPkgChanges++;
                if (processedPkgChanges % 10 === 0 || processedPkgChanges === changes.packageChanges.length) {
                    console.log(`   ✓ Processed ${processedPkgChanges}/${changes.packageChanges.length} package changes`);
                }
                const batchId = await this.getBatchIdByName(packageChange.batch_name, client);

                for (const removedLabel of packageChange.removed_packages) {
                    // Investigate WHY it was removed
                    const investigation = await this.investigateRemovedPackage(
                        removedLabel,
                        packageChange.batch_name,
                        client
                    );

                    // Log detailed history
                    await client.query(`
                        INSERT INTO "ORDERS-batch-history" (
                            batch_id, change_type, reason,
                            related_package_label, related_invoice_id,
                            change_details, changed_by_system
                        ) VALUES ($1, 'package_removed', $2, $3, $4, $5, true)
                    `, [
                        batchId,
                        investigation.reason,
                        investigation.package_label,
                        investigation.related_invoice,
                        JSON.stringify(investigation)
                    ]);
                }
            }

            console.log('💾 Committing all changes to database...');
            await client.query('COMMIT');
            console.log('✅ All batch changes applied successfully');

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Failed to apply batch changes:', error.message);
            throw error;
        } finally {
            client.release();
        }
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

        // Check if package was allocated to an order
        const allocation = await client.query(`
            SELECT invoice_id, allocated_at
            FROM order_line_items
            WHERE package_label = $1
            ORDER BY allocated_at DESC
            LIMIT 1
        `, [packageLabel]);

        if (allocation.rows.length > 0) {
            investigation.reason = 'allocated_to_invoice';
            investigation.related_invoice = allocation.rows[0].invoice_id;
            return investigation;
        }

        // Check if package was transferred out
        const transferred = await client.query(`
            SELECT metrcid, destination_license
            FROM transferredpackages
            WHERE label = $1
            LIMIT 1
        `, [packageLabel]);

        if (transferred.rows.length > 0) {
            investigation.reason = 'transferred_out';
            investigation.metrc_status = 'transferred';
            return investigation;
        }

        // Check if package was made inactive
        const inactive = await client.query(`
            SELECT metrcid, finisheddate
            FROM inactivepackages
            WHERE label = $1
            LIMIT 1
        `, [packageLabel]);

        if (inactive.rows.length > 0) {
            investigation.reason = 'made_inactive';
            investigation.metrc_status = 'finished';
            return investigation;
        }

        // Unknown reason
        investigation.reason = 'unknown_removal';
        return investigation;
    }

    /**
     * Check for auto-promotion triggers
     */
    async checkAutoPromotion() {
        const client = await this.pool.connect();
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
    async syncBatches() {
        const startTime = Date.now();
        console.log('🔄 Starting batch synchronization...');

        try {
            // 1. Execute extraction query
            const freshBatches = await this.executeBatchExtractionQuery();

            // 2. Load existing batches
            const existingBatches = await this.loadExistingBatches();

            // 3. Compare and classify changes
            const changes = this.detectChanges(freshBatches, existingBatches);

            console.log(`📊 Sync plan: ${changes.new.length} new, ${changes.updated.length} updated, ${changes.removed.length} removed, ${changes.packageChanges.length} package changes`);

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
     */
    async close() {
        await this.pool.end();
    }
}

module.exports = BatchSyncService;

