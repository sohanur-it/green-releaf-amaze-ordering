/**
 * File Upload Middleware
 * 
 * Handles product image uploads using multer
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../public/product/images');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generate unique filename: timestamp-random-originalname
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');
        cb(null, `${safeName}-${uniqueSuffix}${ext}`);
    }
});

// File filter - only allow images
const fileFilter = (req, file, cb) => {
    // Accept image files only
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'), false);
    }
};

// Configure multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max file size
        files: 10 // Max 10 files per upload
    }
});

/**
 * Middleware for single image upload
 */
const uploadSingle = upload.single('image');

/**
 * Middleware for multiple image uploads
 */
const uploadMultiple = upload.array('images', 10);

/**
 * Error handler for multer errors
 */
const handleUploadError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large. Maximum size is 5MB'
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                error: 'Too many files. Maximum is 10 files'
            });
        }
        return res.status(400).json({
            success: false,
            error: err.message
        });
    }
    
    if (err) {
        return res.status(400).json({
            success: false,
            error: err.message || 'File upload error'
        });
    }
    
    next();
};

module.exports = {
    uploadSingle,
    uploadMultiple,
    handleUploadError
};

