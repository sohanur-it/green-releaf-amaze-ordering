//app constants and configuration values

//product categories - these are the options for the dropdown
const PRODUCT_CATEGORIES = [
    'Plant Material',
    'Prepack',
    'Preroll',
    'Seed',
    'Live Plant',
    'Bulk Extract',
    'Extract',
    'Cartridge',
    'Edibles & Drink',
    'Tincture',
    'Pack To Order',
    'Topicals & Wellness',
    'Flower'
];

//brand options - hardcoded list
const BRANDS = [
    'Amaze',
    'Nugz',
    'Acute'
];

//strain types
const STRAIN_TYPES = [
    'Hybrid',
    'Indica',
    'Sativa'
];

//unit size measurements
const UNIT_SIZE_MEASUREMENTS = [
    'Unit',
    'Gram',
    'Kilogram',
    'Pound',
    'Ounce'
];

//buyer types - should match whats in the database
const BUYER_TYPES = [
    { code: 'RETAIL', name: 'Retail' },
    { code: 'WHOLESALE', name: 'Wholesalers' },
    { code: 'DISTRIBUTOR', name: 'Distributors' }
];

//file upload settings
const UPLOAD_SETTINGS = {
    MAX_FILE_SIZE: 10 * 1024 * 1024, //10MB max
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    IMAGE_UPLOAD_PATH: 'Photos/products',
    MAX_IMAGES_PER_PRODUCT: 10
};

//pagination defaults
const PAGINATION = {
    DEFAULT_PAGE_SIZE: 50,
    MAX_PAGE_SIZE: 100
};

module.exports = {
    PRODUCT_CATEGORIES,
    BRANDS,
    STRAIN_TYPES,
    UNIT_SIZE_MEASUREMENTS,
    BUYER_TYPES,
    UPLOAD_SETTINGS,
    PAGINATION
};