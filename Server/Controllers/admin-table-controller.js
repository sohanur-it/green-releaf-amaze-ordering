const ItemDetailsModel = require('../Models/item-details-model');
const BatchStagingModel = require('../Models/batch-staging-model');
const CompletionTrackingService = require('../Services/completion-tracking-service');
const logger = require('../../Utilities/logger');

// Admin Table Controller - handles admin table view with inline editing

class AdminTableController {

    /**
     * Get all table data with completion tracking, batch info, and pairing info
     * GET /admin/api/table-data
     * Shows ALL items from batch staging (including those without product details)
     * Includes master/child pairing information and organizes children under masters
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
                        last_modified: null,
                        parent_product_id: null
                    };
                }
            });

            // Calculate completion percentage for each product
            const withCompletion = CompletionTrackingService.bulkCalculateCompletion(allProducts);

            // Add pairing information to each product
            const withPairingInfo = await Promise.all(withCompletion.map(async (product) => {
                if (!product.id) {
                    // Product has no details yet, no pairing possible
                    return {
                        ...product,
                        is_child: false,
                        is_master: false,
                        child_count: 0,
                        children: []
                    };
                }

                // Check if this is a child
                const isChild = product.parent_product_id !== null;

                // Get children if this is a master
                const children = isChild ? [] : await ItemDetailsModel.getChildProducts(product.id);

                // If this is a child, get master info
                let masterInfo = null;
                if (isChild) {
                    const master = await ItemDetailsModel.getMasterProduct(product.id);
                    if (master) {
                        masterInfo = {
                            id: master.id,
                            item_name: master.item_name,
                            display_item_name: master.display_item_name
                        };
                    }
                }

                return {
                    ...product,
                    is_child: isChild,
                    is_master: children.length > 0,
                    child_count: children.length,
                    children: children,
                    master_info: masterInfo
                };
            }));

            // Group products into families (master + children)
            // Then sort families by master's display name, with children immediately after master
            const families = [];
            const processedItemNames = new Set(); // Use item_name instead of id to handle products without details

            // First pass: identify all masters and independent products
            for (const product of withPairingInfo) {
                const uniqueKey = product.item_name || product.original_item_name;
                if (processedItemNames.has(uniqueKey)) continue;

                if (!product.is_child) {
                    // This is either a master or an independent product
                    const family = [product];
                    processedItemNames.add(uniqueKey);

                    // If it's a master, add all its children
                    if (product.is_master && product.children && product.children.length > 0) {
                        const childIds = product.children.map(c => c.id);
                        const childProducts = withPairingInfo.filter(p => childIds.includes(p.id));

                        // Sort children alphabetically by original_item_name
                        childProducts.sort((a, b) =>
                            (a.original_item_name || a.item_name).localeCompare(b.original_item_name || b.item_name)
                        );

                        family.push(...childProducts);
                        childProducts.forEach(c => {
                            const childKey = c.item_name || c.original_item_name;
                            processedItemNames.add(childKey);
                        });
                    }

                    families.push(family);
                }
            }

            // Sort families by the master/independent product's display name
            families.sort((familyA, familyB) => {
                const nameA = (familyA[0].display_item_name || familyA[0].original_item_name || familyA[0].item_name).toLowerCase();
                const nameB = (familyB[0].display_item_name || familyB[0].original_item_name || familyB[0].item_name).toLowerCase();
                return nameA.localeCompare(nameB);
            });

            // Flatten families into a single sorted array
            const sorted = families.flat();

            // Get filter options for sidebar
            const categories = [...new Set(sorted.map(p => p.category).filter(Boolean))];
            const brands = [...new Set(sorted.map(p => p.brand).filter(Boolean))];
            const strainTypes = [...new Set(sorted.map(p => p.strain_type).filter(Boolean))];

            res.json({
                success: true,
                data: {
                    products: sorted,
                    filters: {
                        categories: categories.sort(),
                        brands: brands.sort(),
                        strainTypes: strainTypes.sort()
                    },
                    stats: {
                        total: sorted.length,
                        complete: sorted.filter(p => p.is_complete).length,
                        incomplete: sorted.filter(p => !p.is_complete).length
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
     * Prevents editing child products (except unpair action)
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
                // Check if this is a child product
                if (product.parent_product_id) {
                    // Get master info
                    const master = await ItemDetailsModel.getMasterProduct(product.id);
                    const masterDisplayName = master ? (master.display_item_name || master.item_name) : 'master product';

                    return res.status(400).json({
                        success: false,
                        error: `This product is paired to "${masterDisplayName}". Please edit the master product or unpair this product first.`,
                        isChild: true,
                        masterInfo: master ? {
                            id: master.id,
                            item_name: master.item_name,
                            display_item_name: master.display_item_name
                        } : null
                    });
                }

                // Product exists and is not a child - update the field
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
