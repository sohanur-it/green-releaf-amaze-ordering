const multer = require('multer');
const { UPLOAD_SETTINGS } = require('../config/constants');

//multer middleware config for file uploads
//stores files in memory buffer for processing

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    //check if file type is allowed
    if (UPLOAD_SETTINGS.ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: ${UPLOAD_SETTINGS.ALLOWED_IMAGE_TYPES.join(', ')}`), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: UPLOAD_SETTINGS.MAX_FILE_SIZE,
        files: UPLOAD_SETTINGS.MAX_IMAGES_PER_PRODUCT
    },
    fileFilter: fileFilter
});

//export different upload configurations
module.exports = {
    //single image upload
    uploadSingle: upload.single('image'),

    //multiple images upload (max 10)
    uploadMultiple: upload.array('images', UPLOAD_SETTINGS.MAX_IMAGES_PER_PRODUCT),

    //handle multer errors
    handleUploadErrors: (err, req, res, next) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    error: `File too large. Maximum size is ${UPLOAD_SETTINGS.MAX_FILE_SIZE / 1024 / 1024}MB`
                });
            }
            if (err.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({
                    error: `Too many files. Maximum ${UPLOAD_SETTINGS.MAX_IMAGES_PER_PRODUCT} images allowed`
                });
            }
            return res.status(400).json({ error: err.message });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }
        next();
    }
};