/**
 * Manifest Controller
 * 
 * Handles manifest creation API endpoints
 * Provides interface for fulfillment team to create METRC manifests
 */

const manifestService = require('../Services/manifestService');
const manifestStatusService = require('../Services/manifestStatusService');

class ManifestController {
    /**
     * @swagger
     * /api/v1/manifests:
     *   post:
     *     summary: Create a new manifest
     *     description: Creates a METRC manifest for order fulfillment. This endpoint handles the complete workflow from order validation to METRC API submission.
     *     tags: [Manifests]
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ManifestRequest'
     *           examples:
     *             example1:
     *               summary: Standard manifest creation
     *               value:
     *                 orderId: 12345
     *                 transporterLicenseNumber: "TRN-00001"
     *                 driverName: "John Doe"
     *                 vehicleModel: "Ford Transit"
     *                 estimatedDeparture: "2025-10-28T14:00:00Z"
     *                 estimatedArrival: "2025-10-28T18:00:00Z"
     *                 packages:
     *                   - PackageLabel: "1A40E0100000067000001234"
     *                     Quantity: 10
     *                     UnitOfMeasureName: "Grams"
     *                     WholesalePrice: 50.00
     *                   - PackageLabel: "1A40E0100000067000005678"
     *                     Quantity: 5
     *                     UnitOfMeasureName: "Grams"
     *                     WholesalePrice: 50.00
     *     responses:
     *       201:
     *         description: Manifest created successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ManifestResponse'
     *             examples:
     *               success:
     *                 summary: Successful manifest creation
     *                 value:
     *                   success: true
     *                   data:
     *                     manifestNumber: "TRF-2025-001234"
     *                     manifestData:
     *                       id: 12345
     *                       manifestNumber: "TRF-2025-001234"
     *                       status: "Created"
     *                     orderId: 12345
     *                   message: "Manifest created successfully"
     *       400:
     *         description: Bad request - validation error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *             examples:
     *               validation_error:
     *                 summary: Validation error
     *                 value:
     *                   success: false
     *                   error: "Invalid request body - missing required fields"
     *       401:
     *         description: Authentication required
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *             examples:
     *               auth_required:
     *                 summary: Authentication required
     *                 value:
     *                   success: false
     *                   error: "Authentication required"
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *             examples:
     *               permission_denied:
     *                 summary: Permission denied
     *                 value:
     *                   success: false
     *                   error: "Insufficient permissions - fulfillment.manifest_create required"
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *             examples:
     *               server_error:
     *                 summary: Server error
     *                 value:
     *                   success: false
     *                   error: "Internal server error"
     *                   message: "Failed to create manifest in METRC"
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
                // ✅ TRIGGER: Check inventory depletion after successful order/manifest creation
                // This implements the required logic: "trigger every time an order is successfully created"
                try {
                    const batchStatusService = require('../Services/batchStatusService');
                    
                    // Get all affected products from the packages in the order
                    const affectedProducts = await this.getAffectedProductsFromOrder(req.body.orderId);
                    
                    console.log(`🔄 Order ${req.body.orderId} created. Checking inventory depletion for ${affectedProducts.length} products...`);
                    
                    // Check each affected product for inventory depletion
                    for (const productId of affectedProducts) {
                        const isDepleted = await batchStatusService.isInventoryDepleted(productId);
                        
                        if (isDepleted) {
                            console.log(`⚠️ Product ${productId} depleted! Promoting On Deck batches...`);
                            await batchStatusService.promoteBatchesToSellable(productId);
                        }
                    }
                } catch (promotionError) {
                    // Log the error but don't fail the order creation
                    console.error('❌ Error during post-order batch promotion:', promotionError.message);
                    // Continue - the cron job will catch this later if needed
                }
                
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
     * @swagger
     * /api/v1/manifests/{manifestNumber}/status:
     *   get:
     *     summary: Get manifest status
     *     description: Retrieves the current status of a manifest from METRC. This endpoint queries the METRC T3 API to get real-time status information.
     *     tags: [Manifests]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: path
     *         name: manifestNumber
     *         required: true
     *         schema:
     *           type: string
     *         description: METRC manifest number
     *         example: "TRF-2025-001234"
     *     responses:
     *       200:
     *         description: Manifest status retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ManifestStatusResponse'
     *             examples:
     *               success:
     *                 summary: Successful status retrieval
     *                 value:
     *                   success: true
     *                   data:
     *                     manifestNumber: "TRF-2025-001234"
     *                     status: "InTransit"
     *                     lastModified: "2025-10-28T15:30:00Z"
     *                   message: "Manifest status retrieved successfully"
     *       400:
     *         description: Bad request - invalid manifest number
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *             examples:
     *               invalid_manifest:
     *                 summary: Invalid manifest number
     *                 value:
     *                   success: false
     *                   error: "Invalid manifest number format"
     *       401:
     *         description: Authentication required
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       404:
     *         description: Manifest not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *             examples:
     *               not_found:
     *                 summary: Manifest not found
     *                 value:
     *                   success: false
     *                   error: "Manifest not found in METRC"
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *             examples:
     *               server_error:
     *                 summary: Server error
     *                 value:
     *                   success: false
     *                   error: "Internal server error"
     *                   message: "Failed to retrieve manifest status from METRC"
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

            // Use manifestStatusService for consistent status format
            const manifestStatusService = require('../Services/manifestStatusService');
            
            // Try to get license from query or use default
            const { license } = req.query;
            
            const statusResult = await manifestStatusService.checkManifestStatus(manifestNumber, license);
            
            if (statusResult && statusResult.status) {
                // Return status in a format that's easy to check
                res.json({
                    success: true,
                    status: statusResult.status,  // 'active', 'voided', 'accepted', 'not_found', 'error'
                    message: statusResult.message,
                    data: statusResult.data
                });
            } else {
                // If statusResult is null or doesn't have status, return not_found
                res.json({
                    success: true,
                    status: 'not_found',
                    message: 'Manifest status could not be determined',
                    data: null
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
     * Get manifest statuses for an invoice
     * GET /api/v1/manifests/invoice/:invoiceId/statuses
     */
    async getInvoiceManifestStatuses(req, res) {
        try {
            const { invoiceId } = req.params;
            
            if (!invoiceId) {
                return res.status(400).json({
                    success: false,
                    error: 'Invoice ID is required'
                });
            }

            const result = await manifestStatusService.getInvoiceManifestStatuses(invoiceId);
            
            if (result.success) {
                res.json({
                    success: true,
                    manifests: result.manifests
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: result.error || 'Failed to get manifest statuses'
                });
            }
            
        } catch (error) {
            console.error('❌ Error getting invoice manifest statuses:', error.message);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    /**
     * Get manifest PDF
     * GET /api/v1/manifests/:manifestNumber/pdf
     */
    async getManifestPDF(req, res) {
        try {
            const { manifestNumber } = req.params;
            const { license, invoiceId } = req.query;
            
            if (!manifestNumber) {
                return res.status(400).json({
                    success: false,
                    error: 'Manifest number is required'
                });
            }

            // Parse invoiceId if provided
            const parsedInvoiceId = invoiceId ? parseInt(invoiceId, 10) : null;

            const result = await manifestStatusService.getManifestPDF(
                manifestNumber, 
                license || null,
                parsedInvoiceId || null
            );
            
            if (result.success && result.pdfBuffer) {
                // Set appropriate headers for PDF
                res.setHeader('Content-Type', result.contentType || 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename="manifest-${manifestNumber}.pdf"`);
                res.setHeader('Content-Length', result.pdfBuffer.length);
                
                // Send PDF buffer
                res.send(result.pdfBuffer);
            } else {
                res.status(404).json({
                    success: false,
                    error: result.error || 'Failed to fetch manifest PDF'
                });
            }
            
        } catch (error) {
            console.error('❌ Error getting manifest PDF:', error.message);
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

    /**
     * Get affected product IDs from an order
     * Helper function to identify which products need inventory depletion check
     * @param {number} orderId - Order ID
     * @returns {Promise<Array<number>>} - Array of product IDs
     */
    async getAffectedProductsFromOrder(orderId) {
        const { Pool } = require('pg');
        const pool = new Pool({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_DATABASE,
            password: process.env.DB_PASSWORD,
            port: parseInt(process.env.DB_PORT, 10) || 5432,
        });

        try {
            // Query to get all unique product IDs from batches allocated in this order
            const query = `
                SELECT DISTINCT b.fk_master_product_id as product_id
                FROM "ORDERS-batches" b
                INNER JOIN order_items oi ON oi.batch_id = b.id
                WHERE oi.order_id = $1
                  AND b.fk_master_product_id IS NOT NULL
            `;
            
            const result = await pool.query(query, [orderId]);
            const productIds = result.rows.map(row => row.product_id);
            
            return productIds;
        } catch (error) {
            console.error('Error fetching affected products:', error.message);
            return []; // Return empty array on error
        } finally {
            await pool.end();
        }
    }
}

module.exports = new ManifestController();
