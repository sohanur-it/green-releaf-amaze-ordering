// Server/Middleware/inputValidation.js
// Module 14.3: Input Validation & Sanitization

const validator = require('validator');

class InputValidationMiddleware {
    /**
     * Validate package label format (24 alphanumeric characters)
     */
    static validatePackageLabel(req, res, next) {
        const { package_label } = req.body;
        
        if (package_label && !package_label.match(/^[A-Z0-9]{24}$/)) {
            return res.status(400).json({
                error: 'Invalid package label format',
                message: 'Package label must be exactly 24 alphanumeric characters (uppercase)'
            });
        }
        
        // Sanitize: Convert to uppercase
        if (package_label) {
            req.body.package_label = package_label.toUpperCase().trim();
        }
        
        next();
    }

    /**
     * XSS escaping for package labels
     */
    static sanitizePackageLabel(req, res, next) {
        if (req.body.package_label) {
            req.body.package_label = validator.escape(req.body.package_label);
        }
        next();
    }

    /**
     * Validate driver name (max 100 characters, letters/spaces only)
     */
    static validateDriverName(req, res, next) {
        const { driver_name } = req.body;
        
        if (driver_name) {
            if (driver_name.length > 100) {
                return res.status(400).json({
                    error: 'Driver name too long',
                    message: 'Driver name must be 100 characters or less'
                });
            }
            
            if (!driver_name.match(/^[a-zA-Z\s]+$/)) {
                return res.status(400).json({
                    error: 'Invalid driver name format',
                    message: 'Driver name can only contain letters and spaces'
                });
            }
        }
        
        next();
    }

    /**
     * Validate license plate (max 10 characters, alphanumeric)
     */
    static validateLicensePlate(req, res, next) {
        const { license_plate } = req.body;
        
        if (license_plate) {
            if (license_plate.length > 10) {
                return res.status(400).json({
                    error: 'License plate too long',
                    message: 'License plate must be 10 characters or less'
                });
            }
            
            if (!license_plate.match(/^[A-Z0-9]+$/)) {
                return res.status(400).json({
                    error: 'Invalid license plate format',
                    message: 'License plate can only contain uppercase letters and numbers'
                });
            }
        }
        
        next();
    }

    /**
     * Validate date (reject past dates)
     */
    static validateFutureDate(req, res, next) {
        const { date_field } = req.body; // Generic - specify field name in route
        
        if (date_field) {
            const date = new Date(date_field);
            const now = new Date();
            
            if (isNaN(date.getTime())) {
                return res.status(400).json({
                    error: 'Invalid date format'
                });
            }
            
            if (date < now) {
                return res.status(400).json({
                    error: 'Date cannot be in the past',
                    message: 'Please select a future date'
                });
            }
        }
        
        next();
    }

    /**
     * Validate issue notes (max 2000 characters, HTML stripping)
     */
    static validateIssueNotes(req, res, next) {
        const { notes, issue_notes, reason } = req.body;
        const notesField = notes || issue_notes || reason;
        
        if (notesField) {
            if (notesField.length > 2000) {
                return res.status(400).json({
                    error: 'Notes too long',
                    message: 'Notes must be 2000 characters or less'
                });
            }
            
            // Strip HTML tags
            req.body.notes = validator.stripLow(validator.escape(notesField));
            if (issue_notes) req.body.issue_notes = validator.stripLow(validator.escape(notesField));
            if (reason) req.body.reason = validator.stripLow(validator.escape(notesField));
        }
        
        next();
    }

    /**
     * Validate package label in array
     */
    static validatePackageLabelArray(req, res, next) {
        const { package_labels, packages } = req.body;
        const labels = package_labels || packages || [];
        
        if (Array.isArray(labels)) {
            for (const label of labels) {
                if (label && !label.match(/^[A-Z0-9]{24}$/)) {
                    return res.status(400).json({
                        error: 'Invalid package label format',
                        message: `Package label "${label}" must be exactly 24 alphanumeric characters`
                    });
                }
            }
        }
        
        next();
    }
}

module.exports = InputValidationMiddleware;



