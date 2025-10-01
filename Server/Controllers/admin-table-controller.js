const ItemDetailsModel = require('../Models/item-details-model');
const BatchStagingModel = require('../Models/batch-staging-model');
const CompletionTrackingService = require('../Services/completion-tracking-service');
const logger = require('../../Utilities/logger');

// Admin Table Controller - handles admin table view with inline editing

class AdminTableController {

    /**
     * Get all table data with completion tracking and batch info
     * GET /admin/api/table-data
     * Shows ALL items from batch staging (including those without product details)
     */
    static async getTableData(req, res, next) {
        try {
            // Get all unique items from batch staging with aggregated batch data
            const batchData = await BatchStagingModel.getBatchesGroupedByName();

            // Get all product details with metadata
            const productDetails = await ItemDetailsModel.getAllWithMetadata();

            // Create a map of product details by item_name for quick lookup
            const detailsMap = new Map(productDetails.map(p => [p.item_name, p]));

            // Merge batch data with product details
            const allProducts = batchData.map(batch => {
                const details = detailsMap.get(batch.item_name);

                if (details) {
                    // Product has details - merge with batch info
                    return {
                        ...details,
                        batch_count: batch.batch_count,
                        total_packages: (batch.total_full_packages || 0) + (batch.total_partial_packages || 0),
                        total_quantity_available: batch.total_quantity_available
                    };
                } else {
                    // Product has NO details yet - create minimal record
                    return {
                        id: null,
                        item_name: batch.item_name,
                        original_item_name: batch.item_name,
                        display_item_name: null,
                        sku: null,
                        category: null,
                        brand: null,
                        strain_flavor: null,
                        strain_type: null,
                        default_price: null,
                        unit_weight: null,
                        packages_per_case: null,
                        unit_size_measurement: null,
                        ingredients: null,
                        product_description: null,
                        internal_notes: null,
                        list_to_buyers: false,
                        featured_product: false,
                        image_count: 0,
                        images: null,
                        batch_count: batch.batch_count,
                        total_packages: (batch.total_full_packages || 0) + (batch.total_partial_packages || 0),
                        total_quantity_available: batch.total_quantity_available,
                        last_modified: null
                    };
                }
            });

            // Calculate completion percentage for each product
            const withCompletion = CompletionTrackingService.bulkCalculateCompletion(allProducts);

            // Get filter options for sidebar
            const categories = [...new Set(withCompletion.map(p => p.category).filter(Boolean))];
            const brands = [...new Set(withCompletion.map(p => p.brand).filter(Boolean))];
            const strainTypes = [...new Set(withCompletion.map(p => p.strain_type).filter(Boolean))];

            res.json({
                success: true,
                data: {
                    products: withCompletion,
                    filters: {
                        categories: categories.sort(),
                        brands: brands.sort(),
                        strainTypes: strainTypes.sort()
                    },
                    stats: {
                        total: withCompletion.length,
                        complete: withCompletion.filter(p => p.is_complete).length,
                        incomplete: withCompletion.filter(p => !p.is_complete).length
                    }
                }
            });
        } catch (error) {
            logger.error('Error fetching table data:', error);
            next(error);
        }
    }

    /**
     * Inline edit a single field
     * PUT /admin/api/inline-edit/:itemName
     * Creates product details if not exists, then updates field
     */
    static async inlineEdit(req, res, next) {
        try {
            const { itemName } = req.params;
            const { fieldName, fieldValue } = req.body;

            if (!fieldName || fieldValue === undefined) {
                return res.status(400).json({
                    success: false,
                    error: 'Field name and value are required'
                });
            }

            // Check if product details exist
            let product = await ItemDetailsModel.getByItemName(itemName);

            if (!product) {
                // Product doesn't exist - create minimal record first
                // Need to provide defaults for NOT NULL columns: category, default_price
                const minimalData = {
                    item_name: itemName,
                    original_item_name: itemName,
                    display_item_name: null,
                    category: fieldName === 'category' ? fieldValue : 'Prepack', // Default or set value
                    default_price: fieldName === 'default_price' ? fieldValue : 0, // Default or set value
                    [fieldName]: fieldValue // Set the field being edited
                };

                product = await ItemDetailsModel.create(minimalData);
            } else {
                // Product exists - update the field
                await ItemDetailsModel.updateField(itemName, fieldName, fieldValue);
                product = await ItemDetailsModel.getByItemName(itemName);
            }

            // Get image count
            const imageCountQuery = await ItemDetailsModel.getWithImages(itemName);
            product.image_count = imageCountQuery?.images?.length || 0;
            product.images = imageCountQuery?.images || [];

            // Calculate completion
            const completion = CompletionTrackingService.calculateCompletion(product);

            res.json({
                success: true,
                data: {
                    ...product,
                    completion_percentage: completion.percentage,
                    completion_status: CompletionTrackingService.getStatusLabel(completion.percentage),
                    completion_badge_class: CompletionTrackingService.getStatusBadgeClass(completion.percentage),
                    missing_fields: completion.missingFields,
                    is_complete: completion.isComplete
                }
            });
        } catch (error) {
            logger.error(`Error in inline edit for ${req.params.itemName}:`, error);
            next(error);
        }
    }

    /**
     * Auto-save product details before photo upload
     * POST /admin/api/auto-save
     */
    static async autoSave(req, res, next) {
        try {
            const { item_name } = req.body;

            if (!item_name) {
                return res.status(400).json({
                    success: false,
                    error: 'item_name is required'
                });
            }

            // Check if product details already exist
            const exists = await ItemDetailsModel.exists(item_name);

            let result;
            if (exists) {
                // Update existing with whatever data we have
                result = await ItemDetailsModel.update(item_name, req.body);
            } else {
                // Create new entry with minimal data
                // Set original_item_name to item_name
                const data = {
                    ...req.body,
                    original_item_name: item_name
                };
                result = await ItemDetailsModel.create(data);
            }

            res.json({
                success: true,
                data: {
                    id: result.id,
                    item_name: result.item_name,
                    message: exists ? 'Product details updated' : 'Product details created'
                }
            });
        } catch (error) {
            logger.error('Error in auto-save:', error);
            next(error);
        }
    }

    /**
     * Get batch details for expandable row
     * GET /admin/api/batch-details/:itemName
     * Works for products with or without details
     */
    static async getBatchDetails(req, res, next) {
        try {
            const { itemName } = req.params;

            // Try to get product details first
            const product = await ItemDetailsModel.getByItemName(itemName);

            // Use original_item_name if product exists, otherwise use itemName directly
            const nameToLookup = product?.original_item_name || itemName;

            // Get batches from staging
            const batches = await BatchStagingModel.getBatchesByItemName(nameToLookup);

            res.json({
                success: true,
                data: batches
            });
        } catch (error) {
            logger.error(`Error fetching batch details for ${req.params.itemName}:`, error);
            next(error);
        }
    }
}

module.exports = AdminTableController;
