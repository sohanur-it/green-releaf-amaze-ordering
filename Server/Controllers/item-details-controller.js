const ItemDetailsModel = require('../Models/item-details-model');
const ItemsModel = require('../Models/items-model');
const ProductImagesModel = require('../Models/product-images-model');
const FileUploadService = require('../Services/file-upload-service');
const ValidationService = require('../Services/validation-service');
const logger = require('../../Utilities/logger');

//item details controller - handles product details CRUD operations

class ItemDetailsController {

    //get product details by item name
    static async getDetails(req, res, next) {
        try {
            const { itemName } = req.params;

            if (!itemName) {
                return res.status(400).json({
                    success: false,
                    error: 'Item name is required'
                });
            }

            const details = await ItemDetailsModel.getWithImages(itemName);

            if (!details) {
                return res.status(404).json({
                    success: false,
                    error: 'Product details not found'
                });
            }

            res.json({
                success: true,
                data: details
            });
        } catch (error) {
            logger.error(`Error in getDetails for ${req.params.itemName}:`, error);
            next(error);
        }
    }

    //get default values from items table for form
    static async getDefaultValues(req, res, next) {
        try {
            const { itemName } = req.params;

            if (!itemName) {
                return res.status(400).json({
                    success: false,
                    error: 'Item name is required'
                });
            }

            const item = await ItemsModel.getItemByName(itemName);

            res.json({
                success: true,
                data: item || {}
            });
        } catch (error) {
            logger.error(`Error in getDefaultValues for ${req.params.itemName}:`, error);
            next(error);
        }
    }

    //create or update product details
    static async saveDetails(req, res, next) {
        try {
            const { itemName } = req.params;

            if (!itemName) {
                return res.status(400).json({
                    success: false,
                    error: 'Item name is required'
                });
            }

            //prepare and validate data
            const preparedData = ValidationService.prepareProductDetails({
                ...req.body,
                item_name: itemName
            });

            //check if details already exist
            const exists = await ItemDetailsModel.exists(itemName);

            let result;
            if (exists) {
                result = await ItemDetailsModel.update(itemName, preparedData);
            } else {
                result = await ItemDetailsModel.create(preparedData);
            }

            //update items table if needed
            //update brand if it changed
            if (preparedData.brand) {
                await ItemsModel.updateBrand(itemName, preparedData.brand);
            }

            //update unit_weight if provided and items table has empty value
            if (preparedData.unit_weight) {
                await ItemsModel.updateUnitWeight(itemName, preparedData.unit_weight);
            }

            //update unit_count if provided and items table has empty value
            if (preparedData.packages_per_case) {
                await ItemsModel.updateUnitCount(itemName, preparedData.packages_per_case);
            }

            res.json({
                success: true,
                message: exists ? 'Product details updated successfully' : 'Product details created successfully',
                data: result
            });
        } catch (error) {
            logger.error(`Error in saveDetails for ${req.params.itemName}:`, error);

            if (error.message.startsWith('Validation failed')) {
                return res.status(400).json({
                    success: false,
                    error: error.message
                });
            }

            next(error);
        }
    }

    //upload product images
    static async uploadImages(req, res, next) {
        try {
            const { itemName } = req.params;

            if (!itemName) {
                return res.status(400).json({
                    success: false,
                    error: 'Item name is required'
                });
            }

            //get product details id
            const details = await ItemDetailsModel.getByItemName(itemName);

            if (!details) {
                return res.status(404).json({
                    success: false,
                    error: 'Product details not found. Please save product details before uploading images.'
                });
            }

            //validate files
            const files = req.files;
            const validationErrors = FileUploadService.validateMultipleImageFiles(files);

            if (validationErrors.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: validationErrors.join('; ')
                });
            }

            //save each file
            const savedImages = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileInfo = await FileUploadService.saveProductImage(file, itemName);

                //save to database
                const imageRecord = await ProductImagesModel.create({
                    product_detail_id: details.id,
                    file_name: fileInfo.file_name,
                    file_path: fileInfo.file_path,
                    file_size: fileInfo.file_size,
                    mime_type: fileInfo.mime_type,
                    sort_order: i,
                    is_primary: i === 0, //first image is primary
                    uploaded_by: req.body.uploaded_by || 'system'
                });

                savedImages.push(imageRecord);
            }

            res.json({
                success: true,
                message: `Successfully uploaded ${savedImages.length} image(s)`,
                data: savedImages
            });
        } catch (error) {
            logger.error(`Error in uploadImages for ${req.params.itemName}:`, error);
            next(error);
        }
    }

    //update image sort order
    static async updateImageOrder(req, res, next) {
        try {
            const { itemName } = req.params;
            const { imageOrders } = req.body; //array of {id, sort_order, is_primary}

            if (!itemName) {
                return res.status(400).json({
                    success: false,
                    error: 'Item name is required'
                });
            }

            if (!Array.isArray(imageOrders) || imageOrders.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Image orders array is required'
                });
            }

            //get product details id
            const details = await ItemDetailsModel.getByItemName(itemName);

            if (!details) {
                return res.status(404).json({
                    success: false,
                    error: 'Product details not found'
                });
            }

            //bulk update
            await ProductImagesModel.bulkUpdateSortOrders(details.id, imageOrders);

            res.json({
                success: true,
                message: 'Image order updated successfully'
            });
        } catch (error) {
            logger.error(`Error in updateImageOrder for ${req.params.itemName}:`, error);
            next(error);
        }
    }

    //delete product image
    static async deleteImage(req, res, next) {
        try {
            const { imageId } = req.params;

            if (!imageId) {
                return res.status(400).json({
                    success: false,
                    error: 'Image ID is required'
                });
            }

            //delete from database and get file path
            const deletedImage = await ProductImagesModel.delete(imageId);

            if (!deletedImage) {
                return res.status(404).json({
                    success: false,
                    error: 'Image not found'
                });
            }

            //delete file from filesystem
            await FileUploadService.deleteProductImage(deletedImage.file_path);

            res.json({
                success: true,
                message: 'Image deleted successfully'
            });
        } catch (error) {
            logger.error(`Error in deleteImage for ${req.params.imageId}:`, error);
            next(error);
        }
    }

    //delete product details
    static async deleteDetails(req, res, next) {
        try {
            const { itemName } = req.params;

            if (!itemName) {
                return res.status(400).json({
                    success: false,
                    error: 'Item name is required'
                });
            }

            const deleted = await ItemDetailsModel.delete(itemName);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    error: 'Product details not found'
                });
            }

            res.json({
                success: true,
                message: 'Product details deleted successfully'
            });
        } catch (error) {
            logger.error(`Error in deleteDetails for ${req.params.itemName}:`, error);
            next(error);
        }
    }
}

module.exports = ItemDetailsController;