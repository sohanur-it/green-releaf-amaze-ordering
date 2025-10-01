const { PRODUCT_CATEGORIES, BRANDS, STRAIN_TYPES, UNIT_SIZE_MEASUREMENTS } = require('../config/constants');

//validation service - validates input data

class ValidationService {

    //validate product details input
    static validateProductDetails(data) {
        const errors = [];

        //required fields
        if (!data.item_name || data.item_name.trim() === '') {
            errors.push('Item name is required');
        }

        if (!data.category || !PRODUCT_CATEGORIES.includes(data.category)) {
            errors.push(`Category must be one of: ${PRODUCT_CATEGORIES.join(', ')}`);
        }

        if (!data.default_price || isNaN(parseFloat(data.default_price)) || parseFloat(data.default_price) < 0) {
            errors.push('Default price must be a valid positive number');
        }

        if (!data.brand || data.brand.trim() === '') {
            errors.push('Brand is required');
        }

        if (!data.strain_type || !STRAIN_TYPES.includes(data.strain_type)) {
            errors.push(`Strain type must be one of: ${STRAIN_TYPES.join(', ')}`);
        }

        //optional but validated if provided
        if (data.unit_weight && (isNaN(parseFloat(data.unit_weight)) || parseFloat(data.unit_weight) < 0)) {
            errors.push('Unit weight must be a valid positive number');
        }

        if (data.packages_per_case && (isNaN(parseInt(data.packages_per_case)) || parseInt(data.packages_per_case) < 0)) {
            errors.push('Packages per case must be a valid positive integer');
        }

        if (data.unit_size_measurement && !UNIT_SIZE_MEASUREMENTS.includes(data.unit_size_measurement)) {
            errors.push(`Unit size measurement must be one of: ${UNIT_SIZE_MEASUREMENTS.join(', ')}`);
        }

        //buyer types validation
        if (data.buyer_types && !Array.isArray(data.buyer_types)) {
            errors.push('Buyer types must be an array');
        }

        return errors;
    }

    //sanitize html input - basic xss protection
    static sanitizeHtml(html) {
        if (!html) return '';

        //this is a very basic sanitization
        //in production you'd use a library like DOMPurify or sanitize-html
        //for now just strip script tags
        return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }

    //validate and sanitize product details before save
    static prepareProductDetails(data) {
        //validate first
        const errors = this.validateProductDetails(data);
        if (errors.length > 0) {
            throw new Error(`Validation failed: ${errors.join('; ')}`);
        }

        //sanitize and prepare
        return {
            item_name: data.item_name.trim(),
            sku: data.sku ? data.sku.trim() : null,
            category: data.category.trim(),
            brand: data.brand.trim(),
            strain_flavor: data.strain_flavor ? data.strain_flavor.trim() : null,
            strain_type: data.strain_type.trim(),
            default_price: parseFloat(data.default_price),
            unit_weight: data.unit_weight ? parseFloat(data.unit_weight) : null,
            packages_per_case: data.packages_per_case ? parseInt(data.packages_per_case) : null,
            unit_size_measurement: data.unit_size_measurement ? data.unit_size_measurement.trim() : null,
            ingredients: data.ingredients ? data.ingredients.trim() : null,
            product_description: data.product_description ? this.sanitizeHtml(data.product_description) : null,
            internal_notes: data.internal_notes ? data.internal_notes.trim() : null,
            list_to_buyers: data.list_to_buyers === true || data.list_to_buyers === 'true',
            featured_product: data.featured_product === true || data.featured_product === 'true',
            buyer_types: Array.isArray(data.buyer_types) ? data.buyer_types : [],
            created_by: data.created_by || 'system',
            updated_by: data.updated_by || 'system'
        };
    }
}

module.exports = ValidationService;