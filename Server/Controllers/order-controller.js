const BatchModel = require('../Models/batch-model');
const ItemDetailsModel = require('../Models/item-details-model');
const logger = require('../../Utilities/logger');

//order controller - handles order page operations (mockup)

class OrderController {

    //get products for order page with batch aggregation
    static async getOrderProducts(req, res, next) {
        try {
            //get all batches
            const groupedBatches = await BatchModel.getBatchesGroupedByName();

            //get listable product details
            const productDetails = await ItemDetailsModel.getListableItems();
            const detailsMap = new Map(productDetails.map(d => [d.item_name, d]));

            //combine batches with product details
            const products = [];
            const outOfStockProducts = [];

            for (const batchGroup of groupedBatches) {
                const details = detailsMap.get(batchGroup.item_name);

                //skip if no details or not listed to buyers
                if (!details || !details.list_to_buyers) {
                    continue;
                }

                const product = {
                    item_name: batchGroup.item_name,
                    category: details.category,
                    brand: details.brand,
                    strain_flavor: details.strain_flavor,
                    strain_type: details.strain_type,
                    default_price: details.default_price,
                    unit_weight: details.unit_weight,
                    packages_per_case: details.packages_per_case,
                    unit_size_measurement: details.unit_size_measurement,
                    product_description: details.product_description,
                    featured_product: details.featured_product,
                    images: details.images || [],
                    //batch aggregation
                    total_quantity_available: batchGroup.total_full_packages,
                    batch_count: batchGroup.batches.length,
                    batches: batchGroup.batches.map(b => ({
                        batch_name: b.batch_name,
                        full_package_count: b.full_package_count,
                        thc_percentage: b.thc_percentage,
                        test_date: b.test_date,
                        production_date: b.production_date,
                        best_by_date: b.best_by_date
                    }))
                };

                //separate in stock from out of stock
                if (batchGroup.total_full_packages > 0) {
                    products.push(product);
                } else {
                    outOfStockProducts.push(product);
                }
            }

            //sort: featured first, then by name
            products.sort((a, b) => {
                if (a.featured_product && !b.featured_product) return -1;
                if (!a.featured_product && b.featured_product) return 1;
                return a.item_name.localeCompare(b.item_name);
            });

            res.json({
                success: true,
                data: {
                    in_stock: products,
                    out_of_stock: outOfStockProducts,
                    total_in_stock: products.length,
                    total_out_of_stock: outOfStockProducts.length
                }
            });
        } catch (error) {
            logger.error('Error in getOrderProducts:', error);
            next(error);
        }
    }

    //get filters for order page
    static async getFilters(req, res, next) {
        try {
            //get listable products
            const products = await ItemDetailsModel.getListableItems();

            //extract unique values for filters
            const categories = [...new Set(products.map(p => p.category))].sort();
            const brands = [...new Set(products.map(p => p.brand).filter(b => b))].sort();
            const strainTypes = [...new Set(products.map(p => p.strain_type).filter(st => st))].sort();

            res.json({
                success: true,
                data: {
                    categories,
                    brands,
                    strain_types: strainTypes
                }
            });
        } catch (error) {
            logger.error('Error in getFilters:', error);
            next(error);
        }
    }

    //get single product details
    static async getProductDetail(req, res, next) {
        try {
            const { itemName } = req.params;

            if (!itemName) {
                return res.status(400).json({
                    success: false,
                    error: 'Item name is required'
                });
            }

            //get product details
            const details = await ItemDetailsModel.getWithImages(itemName);

            if (!details || !details.list_to_buyers) {
                return res.status(404).json({
                    success: false,
                    error: 'Product not found'
                });
            }

            //get batches for this item
            const batches = await BatchModel.getBatchesByItemName(itemName);

            const product = {
                ...details,
                batches: batches.map(b => ({
                    batch_name: b.batch_name,
                    full_package_count: b.full_package_count,
                    thc_percentage: b.thc_percentage,
                    test_date: b.test_date,
                    production_date: b.production_date,
                    best_by_date: b.best_by_date
                })),
                total_quantity_available: batches.reduce((sum, b) => sum + (b.full_package_count || 0), 0)
            };

            res.json({
                success: true,
                data: product
            });
        } catch (error) {
            logger.error(`Error in getProductDetail for ${req.params.itemName}:`, error);
            next(error);
        }
    }
}

module.exports = OrderController;