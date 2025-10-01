const logger = require('../../Utilities/logger');

// Completion Tracking Service
// Calculates completion percentage for product details based on required fields

class CompletionTrackingService {

    /**
     * Calculate completion percentage for a product detail record
     * @param {Object} productDetail - Product detail object from database
     * @returns {Object} { percentage: number, missingFields: array, completedFields: array }
     */
    static calculateCompletion(productDetail) {
        const requiredFields = [
            { key: 'category', weight: 10, label: 'Category' },
            { key: 'brand', weight: 10, label: 'Brand' },
            { key: 'default_price', weight: 10, label: 'Price' },
            { key: 'strain_type', weight: 10, label: 'Strain Type' },
            { key: 'product_description', weight: 15, label: 'Description' },
            { key: 'unit_weight', weight: 10, label: 'Unit Weight' },
            { key: 'packages_per_case', weight: 10, label: 'Packages Per Case' },
            { key: 'unit_size_measurement', weight: 10, label: 'Unit Size Measurement' },
            { key: 'strain_flavor', weight: 5, label: 'Strain/Flavor' },
            { key: 'has_images', weight: 20, label: 'Product Images' } // special case
        ];

        const missingFields = [];
        const completedFields = [];
        let totalWeight = 0;
        let completedWeight = 0;

        requiredFields.forEach(field => {
            totalWeight += field.weight;

            // Special handling for images
            if (field.key === 'has_images') {
                const hasImages = productDetail.images &&
                                  Array.isArray(productDetail.images) &&
                                  productDetail.images.length > 0;

                if (hasImages) {
                    completedWeight += field.weight;
                    completedFields.push(field.label);
                } else {
                    missingFields.push(field.label);
                }
                return;
            }

            // Regular field checking
            const value = productDetail[field.key];
            const isComplete = value !== null &&
                             value !== undefined &&
                             value !== '' &&
                             (typeof value !== 'number' || value > 0);

            if (isComplete) {
                completedWeight += field.weight;
                completedFields.push(field.label);
            } else {
                missingFields.push(field.label);
            }
        });

        const percentage = Math.round((completedWeight / totalWeight) * 100);

        return {
            percentage,
            missingFields,
            completedFields,
            isComplete: percentage === 100
        };
    }

    /**
     * Get completion status label based on percentage
     * @param {number} percentage - Completion percentage (0-100)
     * @returns {string} Status label
     */
    static getStatusLabel(percentage) {
        if (percentage === 100) return 'Complete';
        if (percentage >= 75) return 'Almost Complete';
        if (percentage >= 50) return 'In Progress';
        if (percentage >= 25) return 'Started';
        return 'Not Started';
    }

    /**
     * Get completion status badge class for CSS styling
     * @param {number} percentage - Completion percentage (0-100)
     * @returns {string} CSS class name
     */
    static getStatusBadgeClass(percentage) {
        if (percentage === 100) return 'badge-complete';
        if (percentage >= 75) return 'badge-almost-complete';
        if (percentage >= 50) return 'badge-in-progress';
        if (percentage >= 25) return 'badge-started';
        return 'badge-not-started';
    }

    /**
     * Bulk calculate completion for multiple products
     * @param {Array} productDetails - Array of product detail objects
     * @returns {Array} Array of products with completion data added
     */
    static bulkCalculateCompletion(productDetails) {
        return productDetails.map(product => {
            const completion = this.calculateCompletion(product);
            return {
                ...product,
                completion_percentage: completion.percentage,
                completion_status: this.getStatusLabel(completion.percentage),
                completion_badge_class: this.getStatusBadgeClass(completion.percentage),
                missing_fields: completion.missingFields,
                completed_fields: completion.completedFields,
                is_complete: completion.isComplete
            };
        });
    }

    /**
     * Check if a specific field is required for completion
     * @param {string} fieldName - Name of the field to check
     * @returns {boolean} True if field is required
     */
    static isRequiredField(fieldName) {
        const requiredFieldNames = [
            'category', 'brand', 'default_price', 'strain_type',
            'product_description', 'unit_weight', 'packages_per_case',
            'unit_size_measurement', 'strain_flavor', 'has_images'
        ];
        return requiredFieldNames.includes(fieldName);
    }
}

module.exports = CompletionTrackingService;
