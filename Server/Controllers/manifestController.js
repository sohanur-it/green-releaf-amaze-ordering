/**
 * Manifest Controller
 * 
 * Handles manifest creation API endpoints
 * Provides interface for fulfillment team to create METRC manifests
 */

const manifestService = require('../Services/manifestService');

class ManifestController {
    /**
     * Create a new manifest
     * POST /api/v1/manifests
     */
    async createManifest(req, res) {
        try {
            const userId = req.session.userId;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
            }

            // Validate request body
            const validationResult = this.validateManifestRequest(req.body);
            if (!validationResult.valid) {
                return res.status(400).json({
                    success: false,
                    error: validationResult.error
                });
            }

            // Create manifest
            const result = await manifestService.createManifestFromOrderAndPackages(req.body, userId);
            
            if (result.success) {
                res.status(201).json({
                    success: true,
                    data: {
                        manifestNumber: result.manifestNumber,
                        manifestData: result.manifestData,
                        orderId: req.body.orderId
                    },
                    message: 'Manifest created successfully'
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: result.error
                });
            }
            
        } catch (error) {
            console.error('❌ Manifest creation error:', error.message);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    /**
     * Get manifest status
     * GET /api/v1/manifests/:manifestNumber/status
     */
    async getManifestStatus(req, res) {
        try {
            const { manifestNumber } = req.params;
            
            if (!manifestNumber) {
                return res.status(400).json({
                    success: false,
                    error: 'Manifest number is required'
                });
            }

            const status = await manifestService.getManifestStatus(manifestNumber);
            
            if (status) {
                res.json({
                    success: true,
                    data: status
                });
            } else {
                res.status(404).json({
                    success: false,
                    error: 'Manifest not found'
                });
            }
            
        } catch (error) {
            console.error('❌ Manifest status error:', error.message);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    /**
     * Validate manifest request body
     */
    validateManifestRequest(body) {
        const requiredFields = [
            'orderId',
            'transporterLicenseNumber',
            'driverName',
            'vehicleModel',
            'estimatedDeparture',
            'estimatedArrival',
            'packages'
        ];

        // Check required fields
        for (const field of requiredFields) {
            if (!body[field]) {
                return {
                    valid: false,
                    error: `Missing required field: ${field}`
                };
            }
        }

        // Validate packages array
        if (!Array.isArray(body.packages) || body.packages.length === 0) {
            return {
                valid: false,
                error: 'Packages must be a non-empty array'
            };
        }

        // Validate each package
        for (let i = 0; i < body.packages.length; i++) {
            const pkg = body.packages[i];
            const packageRequiredFields = ['PackageLabel', 'Quantity', 'UnitOfMeasureName'];
            
            for (const field of packageRequiredFields) {
                if (!pkg[field]) {
                    return {
                        valid: false,
                        error: `Package ${i + 1} missing required field: ${field}`
                    };
                }
            }

            // Validate quantity is positive number
            if (typeof pkg.Quantity !== 'number' || pkg.Quantity <= 0) {
                return {
                    valid: false,
                    error: `Package ${i + 1} quantity must be a positive number`
                };
            }
        }

        // Validate dates
        try {
            new Date(body.estimatedDeparture);
            new Date(body.estimatedArrival);
        } catch (error) {
            return {
                valid: false,
                error: 'Invalid date format for estimatedDeparture or estimatedArrival'
            };
        }

        return { valid: true };
    }
}

module.exports = new ManifestController();
