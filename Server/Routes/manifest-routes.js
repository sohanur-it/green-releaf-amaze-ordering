/**
 * Manifest Routes
 * 
 * API routes for manifest creation and management
 */

const express = require('express');
const router = express.Router();
const manifestController = require('../Controllers/manifestController');
const { requireAuth, requirePermission } = require('../Middleware/auth');
const { manifestAuditMiddleware } = require('../Middleware/auditMiddleware');

// Apply authentication to all manifest routes
router.use(requireAuth);

/**
 * @swagger
 * components:
 *   schemas:
 *     ManifestRequest:
 *       type: object
 *       required:
 *         - orderId
 *         - transporterLicenseNumber
 *         - driverName
 *         - vehicleModel
 *         - estimatedDeparture
 *         - estimatedArrival
 *         - packages
 *       properties:
 *         orderId:
 *           type: integer
 *           description: Internal order ID
 *           example: 12345
 *         transporterLicenseNumber:
 *           type: string
 *           description: Transporter license number
 *           example: "TRN-00001"
 *         driverName:
 *           type: string
 *           description: Driver's full name
 *           example: "John Doe"
 *         vehicleModel:
 *           type: string
 *           description: Vehicle model and make
 *           example: "Ford Transit"
 *         estimatedDeparture:
 *           type: string
 *           format: date-time
 *           description: Estimated departure time in ISO 8601 format
 *           example: "2025-10-28T14:00:00Z"
 *         estimatedArrival:
 *           type: string
 *           format: date-time
 *           description: Estimated arrival time in ISO 8601 format
 *           example: "2025-10-28T18:00:00Z"
 *         packages:
 *           type: array
 *           description: Array of packages to be shipped
 *           items:
 *             type: object
 *             required:
 *               - PackageLabel
 *               - Quantity
 *               - UnitOfMeasureName
 *               - WholesalePrice
 *             properties:
 *               PackageLabel:
 *                 type: string
 *                 description: METRC package label
 *                 example: "1A40E0100000067000001234"
 *               Quantity:
 *                 type: number
 *                 description: Package quantity
 *                 example: 10
 *               UnitOfMeasureName:
 *                 type: string
 *                 description: Unit of measure
 *                 example: "Grams"
 *               WholesalePrice:
 *                 type: number
 *                 format: float
 *                 description: Wholesale price per unit
 *                 example: 50.00
 *     ManifestResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             manifestNumber:
 *               type: string
 *               description: METRC manifest number
 *               example: "TRF-2025-001234"
 *             manifestData:
 *               type: object
 *               description: Full manifest data from METRC
 *             orderId:
 *               type: integer
 *               example: 12345
 *         message:
 *           type: string
 *           example: "Manifest created successfully"
 *     ManifestStatusResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             manifestNumber:
 *               type: string
 *               example: "TRF-2025-001234"
 *             status:
 *               type: string
 *               example: "InTransit"
 *             lastModified:
 *               type: string
 *               format: date-time
 *               example: "2025-10-28T15:30:00Z"
 *         message:
 *           type: string
 *           example: "Manifest status retrieved successfully"
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: string
 *           example: "Authentication required"
 *         message:
 *           type: string
 *           example: "Internal server error"
 */

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
router.post('/', 
    requirePermission('fulfillment.manifest_create'),
    manifestAuditMiddleware,
    manifestController.createManifest
);

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
router.get('/:manifestNumber/status', 
    requirePermission('fulfillment.manifest_read'),
    manifestController.getManifestStatus
);

module.exports = router;
