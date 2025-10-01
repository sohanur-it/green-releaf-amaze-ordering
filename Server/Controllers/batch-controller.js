const BatchStagingModel = require('../Models/batch-staging-model');
const ItemDetailsModel = require('../Models/item-details-model');
const logger = require('../../Utilities/logger');

//batch controller - handles batch-related operations
//now uses BatchStagingModel for better performance

class BatchController {

    //get all batches grouped by item name with details status
    static async getBatchesWithDetailsStatus(req, res, next) {
        try {
            //get grouped batches from staging table
            const groupedBatches = await BatchStagingModel.getBatchesGroupedByName();

            //get all existing product details
            const allDetails = await ItemDetailsModel.getAll();
            const detailsMap = new Map(allDetails.map(d => [d.original_item_name, d]));

            //add details status to each group
            const batchesWithStatus = groupedBatches.map(group => ({
                ...group,
                has_details: detailsMap.has(group.item_name),
                details: detailsMap.get(group.item_name) || null
            }));

            //separate into with/without details
            const withDetails = batchesWithStatus.filter(b => b.has_details);
            const withoutDetails = batchesWithStatus.filter(b => !b.has_details);

            res.json({
                success: true,
                data: {
                    with_details: withDetails,
                    without_details: withoutDetails,
                    total_items: batchesWithStatus.length,
                    items_with_details: withDetails.length,
                    items_without_details: withoutDetails.length
                }
            });
        } catch (error) {
            logger.error('Error in getBatchesWithDetailsStatus:', error);
            next(error);
        }
    }

    //get batches for a specific item
    static async getBatchesByItem(req, res, next) {
        try {
            const { itemName } = req.params;

            if (!itemName) {
                return res.status(400).json({
                    success: false,
                    error: 'Item name is required'
                });
            }

            const batches = await BatchStagingModel.getBatchesByItemName(itemName);

            res.json({
                success: true,
                data: batches
            });
        } catch (error) {
            logger.error(`Error in getBatchesByItem for ${req.params.itemName}:`, error);
            next(error);
        }
    }

    //get all unique item names
    static async getUniqueItemNames(req, res, next) {
        try {
            const names = await BatchStagingModel.getUniqueItemNames();

            res.json({
                success: true,
                data: names
            });
        } catch (error) {
            logger.error('Error in getUniqueItemNames:', error);
            next(error);
        }
    }
}

module.exports = BatchController;