const BatchStatusModel = require('../Models/batch-status-model');
const ItemDetailsModel = require('../Models/item-details-model');
const BatchStagingModel = require('../Models/batch-staging-model');
const logger = require('../../Utilities/logger');

// Batch Management Controller - handles batch workflow and management operations

class BatchManagementController {

    /**
     * Get dashboard statistics
     * GET /admin/api/dashboard-stats
     */
    static async getDashboardStats(req, res, next) {
        try {
            const stats = await BatchStatusModel.getStatsForDashboard();

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            logger.error('Error fetching dashboard stats:', error);
            next(error);
        }
    }

    /**
     * Get next product for batch workflow
     * Returns the first product with complete details that has pending batches
     * GET /admin/api/batch-workflow/next
     */
    static async getNextProductForBatchWorkflow(req, res, next) {
        try {
            const products = await BatchStatusModel.getProductsWithPendingBatches();

            if (products.length === 0) {
                return res.json({
                    success: true,
                    data: null,
                    message: 'No products with pending batches'
                });
            }

            // Return the first product
            const product = products[0];

            res.json({
                success: true,
                data: {
                    product,
                    remainingCount: products.length - 1
                }
            });
        } catch (error) {
            logger.error('Error fetching next product for batch workflow:', error);
            next(error);
        }
    }

    /**
     * Get batches for a specific product (for workflow)
     * GET /admin/api/batch-workflow/product/:itemName
     */
    static async getBatchesForProduct(req, res, next) {
        try {
            const { itemName } = req.params;

            if (!itemName) {
                return res.status(400).json({
                    success: false,
                    error: 'Item name is required'
                });
            }

            // Get product details
            const product = await ItemDetailsModel.getByOriginalItemName(itemName);

            if (!product) {
                return res.status(404).json({
                    success: false,
                    error: 'Product not found'
                });
            }

            // Get all batches for this product from staging (active only)
            const allBatches = await BatchStagingModel.getBatchesByItemName(itemName);

            // Get existing batch statuses
            const existingStatuses = await BatchStatusModel.getByItemName(itemName);
            const statusMap = new Map(existingStatuses.map(s => [s.batch_name, s]));

            // Filter to only pending batches (no status yet)
            const pendingBatches = allBatches.filter(batch => !statusMap.has(batch.batch_name));

            res.json({
                success: true,
                data: {
                    product,
                    batches: pendingBatches,
                    batch_count: pendingBatches.length
                }
            });
        } catch (error) {
            logger.error(`Error fetching batches for product ${req.params.itemName}:`, error);
            next(error);
        }
    }

    /**
     * Submit batch decisions (Complete button)
     * POST /admin/api/batch-workflow/submit
     * Body: { decisions: [{ batch_name, status, custom_batch_name, item_name, product_detail_id }] }
     */
    static async submitBatchDecisions(req, res, next) {
        try {
            const { decisions } = req.body;

            if (!decisions || !Array.isArray(decisions) || decisions.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Decisions array is required'
                });
            }

            // Filter out "Ignore" decisions - those don't get saved
            const decisionsToSave = decisions.filter(d => d.status !== 'Ignore');

            if (decisionsToSave.length === 0) {
                return res.json({
                    success: true,
                    message: 'All batches ignored, nothing saved',
                    saved_count: 0
                });
            }

            // Prepare batch status records
            const batchStatuses = decisionsToSave.map(decision => ({
                batch_name: decision.batch_name,
                item_name: decision.item_name,
                product_detail_id: decision.product_detail_id,
                original_batch_name: decision.batch_name,
                custom_batch_name: decision.custom_batch_name || null,
                status: decision.status,
                batch_is_active: true
            }));

            // Bulk create/update
            const results = await BatchStatusModel.bulkCreate(batchStatuses);

            // Update list_to_buyers if any batch was marked as "Sellable"
            // This updates ALL products with the same display_item_name
            const hasSellable = decisionsToSave.some(d => d.status === 'Sellable');
            if (hasSellable && decisionsToSave[0].product_detail_id) {
                const product = await ItemDetailsModel.getByOriginalItemName(decisionsToSave[0].item_name);
                if (product) {
                    const displayName = product.display_item_name || product.original_item_name;
                    await ItemDetailsModel.updateListToBuyersByDisplayName(displayName, true);
                    logger.info(`Set list_to_buyers=true for all products with display_item_name=${displayName}`);
                }
            }

            res.json({
                success: true,
                message: `Successfully saved ${results.length} batch decision(s)`,
                saved_count: results.length,
                data: results
            });
        } catch (error) {
            logger.error('Error submitting batch decisions:', error);
            next(error);
        }
    }

    /**
     * Get all marked batches with details (for "View All Batches" tab)
     * GET /admin/api/batch-management/marked
     */
    static async getAllMarkedBatches(req, res, next) {
        try {
            const batches = await BatchStatusModel.getAllWithDetails();

            res.json({
                success: true,
                data: batches
            });
        } catch (error) {
            logger.error('Error fetching all marked batches:', error);
            next(error);
        }
    }

    /**
     * Update batch status inline (for "View All Batches" tab)
     * PUT /admin/api/batch-management/batch/:batchName
     * Body: { status, custom_batch_name }
     */
    static async updateBatchStatus(req, res, next) {
        try {
            const { batchName } = req.params;
            const { status, custom_batch_name } = req.body;

            if (!batchName) {
                return res.status(400).json({
                    success: false,
                    error: 'Batch name is required'
                });
            }

            if (!status) {
                return res.status(400).json({
                    success: false,
                    error: 'Status is required'
                });
            }

            // Validate status
            const validStatuses = ['Sellable', 'On Deck', 'On Hold'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
                });
            }

            // Update the batch status
            const updated = await BatchStatusModel.updateStatus(batchName, status, custom_batch_name);

            // Get the product_detail_id to update list_to_buyers for ALL related products
            if (updated.product_detail_id) {
                const product = await ItemDetailsModel.getByOriginalItemName(updated.item_name);
                if (product) {
                    const displayName = product.display_item_name || product.original_item_name;

                    // Get all products with this display_item_name
                    const relatedProducts = await ItemDetailsModel.getAllByDisplayName(displayName);

                    // Check if ANY related product has a Sellable active batch
                    let hasSellableActive = false;
                    for (const relatedProduct of relatedProducts) {
                        const batches = await BatchStatusModel.getByItemName(relatedProduct.original_item_name);
                        if (batches.some(b => b.status === 'Sellable' && b.batch_is_active)) {
                            hasSellableActive = true;
                            break;
                        }
                    }

                    // Update list_to_buyers for all products with this display_item_name
                    await ItemDetailsModel.updateListToBuyersByDisplayName(displayName, hasSellableActive);
                }
            }

            res.json({
                success: true,
                message: 'Batch status updated successfully',
                data: updated
            });
        } catch (error) {
            logger.error(`Error updating batch status for ${req.params.batchName}:`, error);
            next(error);
        }
    }

    /**
     * Check for new batches (polling endpoint)
     * GET /admin/api/batch-workflow/check-new
     * Query param: lastCheck (ISO timestamp)
     */
    static async checkForNewBatches(req, res, next) {
        try {
            const { lastCheck } = req.query;

            if (!lastCheck) {
                return res.status(400).json({
                    success: false,
                    error: 'lastCheck query parameter is required'
                });
            }

            const lastCheckTime = new Date(lastCheck);

            if (isNaN(lastCheckTime.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid lastCheck timestamp'
                });
            }

            const result = await BatchStatusModel.checkForNewBatches(lastCheckTime);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            logger.error('Error checking for new batches:', error);
            next(error);
        }
    }
}

module.exports = BatchManagementController;
