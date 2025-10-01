const fs = require('fs').promises;
const path = require('path');
const { sanitizeFilename } = require('../../Utilities/helpers');
const { UPLOAD_SETTINGS } = require('../config/constants');
const logger = require('../../Utilities/logger');

//file upload service - handles saving files to filesystem

class FileUploadService {

    //save uploaded image file to filesystem
    static async saveProductImage(file, itemName) {
        try {
            //sanitize item name for directory
            const dirName = sanitizeFilename(itemName);
            const uploadDir = path.join(process.cwd(), UPLOAD_SETTINGS.IMAGE_UPLOAD_PATH, dirName);

            //create directory if it doesnt exist
            await fs.mkdir(uploadDir, { recursive: true });

            //generate unique filename
            const timestamp = Date.now();
            const ext = path.extname(file.originalname);
            const baseName = sanitizeFilename(path.basename(file.originalname, ext));
            const fileName = `${baseName}-${timestamp}${ext}`;
            const filePath = path.join(uploadDir, fileName);

            //write file
            await fs.writeFile(filePath, file.buffer);

            logger.info(`Saved image ${fileName} to ${uploadDir}`);

            //return relative path for database storage
            const relativePath = path.join(UPLOAD_SETTINGS.IMAGE_UPLOAD_PATH, dirName, fileName);
            return {
                file_name: file.originalname,
                file_path: relativePath,
                file_size: file.size,
                mime_type: file.mimetype
            };
        } catch (error) {
            logger.error('Error saving product image:', error);
            throw error;
        }
    }

    //delete image file from filesystem
    static async deleteProductImage(filePath) {
        try {
            const fullPath = path.join(process.cwd(), filePath);
            await fs.unlink(fullPath);
            logger.info(`Deleted image file: ${filePath}`);
            return true;
        } catch (error) {
            //log but dont throw - file might already be gone
            logger.warn(`Could not delete image file ${filePath}:`, error.message);
            return false;
        }
    }

    //validate image file
    static validateImageFile(file) {
        const errors = [];

        if (!file) {
            errors.push('No file provided');
            return errors;
        }

        //check file size
        if (file.size > UPLOAD_SETTINGS.MAX_FILE_SIZE) {
            errors.push(`File size exceeds maximum of ${UPLOAD_SETTINGS.MAX_FILE_SIZE / 1024 / 1024}MB`);
        }

        //check file type
        if (!UPLOAD_SETTINGS.ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
            errors.push(`File type ${file.mimetype} not allowed. Allowed types: ${UPLOAD_SETTINGS.ALLOWED_IMAGE_TYPES.join(', ')}`);
        }

        return errors;
    }

    //validate multiple image files
    static validateMultipleImageFiles(files) {
        if (!Array.isArray(files) || files.length === 0) {
            return ['No files provided'];
        }

        if (files.length > UPLOAD_SETTINGS.MAX_IMAGES_PER_PRODUCT) {
            return [`Too many files. Maximum ${UPLOAD_SETTINGS.MAX_IMAGES_PER_PRODUCT} images per product`];
        }

        const allErrors = [];
        files.forEach((file, index) => {
            const errors = this.validateImageFile(file);
            if (errors.length > 0) {
                allErrors.push(`File ${index + 1}: ${errors.join(', ')}`);
            }
        });

        return allErrors;
    }
}

module.exports = FileUploadService;