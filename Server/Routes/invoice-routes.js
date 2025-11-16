/**
 * Invoice Routes
 * 
 * Module 4 API endpoints for invoice management
 */

const express = require('express');
const router = express.Router();
const invoiceController = require('../Controllers/invoiceController');
const { requireAuth: auth, requireRole } = require('../Middleware/auth');
const { auditMiddleware } = require('../Middleware/auditMiddleware');
const discountService = require('../Services/discountService');

/**
 * @swagger
 * tags:
 *   - name: Module 4 - Invoices
 *     description: Invoice management endpoints
 */

/**
 * @swagger
 * /api/v1/invoices:
 *   get:
 *     summary: Get all invoices
 *     tags: [Module 4 - Invoices]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status
 *       - in: query
 *         name: buyer_id
 *         schema:
 *           type: integer
 *         description: Filter by buyer
 *       - in: query
 *         name: location_id
 *         schema:
 *           type: integer
 *         description: Filter by location
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [Internal, External]
 *         description: Filter by source
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/', auth, invoiceController.getAllInvoices);

/**
 * Get products for location (for invoice creation UI)
 * GET /api/v1/invoices/products?location_id=123&search=keyword
 * NOTE: Must be before /:id route to avoid route conflict
 */
router.get('/products', auth, invoiceController.getProductsForLocation);

/**
 * Get batches for a product (for invoice creation UI)
 * GET /api/v1/invoices/products/:productId/batches?location_id=123
 * NOTE: Must be before /:id route to avoid route conflict
 */
router.get('/products/:productId/batches', auth, invoiceController.getBatchesForProduct);

/**
 * Get recent invoices for a buyer (optional filtered by location)
 * GET /api/v1/invoices/buyers/:buyerId?location_id=123&limit=5
 * Must be before /:id route
 */
router.get('/buyers/:buyerId', auth, invoiceController.getBuyerInvoices);

/**
 * @swagger
 * /api/v1/invoices/:id:
 *   get:
 *     summary: Get invoice by ID
 *     tags: [Module 4 - Invoices]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Success
 *       404:
 *         description: Invoice not found
 */
router.get('/:id', auth, invoiceController.getInvoiceById);

/**
 * @swagger
 * /api/v1/invoices:
 *   post:
 *     summary: Create new invoice
 *     tags: [Module 4 - Invoices]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - buyer_id
 *               - location_id
 *             properties:
 *               buyer_id:
 *                 type: integer
 *               location_id:
 *                 type: integer
 *               source:
 *                 type: string
 *                 enum: [Internal, External]
 *               assigned_sales_rep_id:
 *                 type: integer
 *               customer_notes:
 *                 type: string
 *               internal_notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Invoice created
 */
router.post('/', auth, auditMiddleware, invoiceController.createInvoice);

/**
 * @swagger
 * /api/v1/invoices/:id/transition:
 *   post:
 *     summary: Transition invoice to new status
 *     tags: [Module 4 - Invoices]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transition successful
 *       400:
 *         description: Invalid transition
 */
router.post('/:id/transition', auth, auditMiddleware, invoiceController.transitionInvoice);

/**
 * Create internal invoice (for invoice creation UI)
 * POST /api/v1/invoices/internal
 * NOTE: Must be before /:id routes to avoid route conflict
 */
router.post('/internal', auth, auditMiddleware, invoiceController.createInternalInvoice);

/**
 * Apply manual discount to a line item
 * POST /api/v1/invoices/:invoiceId/line-items/:lineItemId/discount
 * Requires Sales Admin or Administrator permission
 */
router.post('/:invoiceId/line-items/:lineItemId/discount', auth, requireRole('Sales Admin', 'Administrator'), auditMiddleware, async (req, res) => {
    try {
        const { invoiceId, lineItemId } = req.params;
        const { discount_amount, reason } = req.body;
        const userId = req.session.userId || req.user?.id;
        
        if (!discount_amount || !reason) {
            return res.status(400).json({
                success: false,
                error: 'discount_amount and reason are required'
            });
        }
        
        const result = await discountService.applyManualDiscount(
            parseInt(lineItemId),
            parseFloat(discount_amount),
            reason,
            userId
        );
        
        if (result.success) {
            res.json({ success: true, message: 'Manual discount applied successfully' });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error applying manual discount:', error);
        res.status(500).json({ success: false, error: 'Failed to apply discount' });
    }
});

/**
 * Remove manual discount from a line item
 * DELETE /api/v1/invoices/:invoiceId/line-items/:lineItemId/discount
 * Requires Sales Admin or Administrator permission
 */
router.delete('/:invoiceId/line-items/:lineItemId/discount', auth, requireRole('Sales Admin', 'Administrator'), auditMiddleware, async (req, res) => {
    try {
        const { invoiceId, lineItemId } = req.params;
        const userId = req.session.userId || req.user?.id;
        
        const result = await discountService.removeManualDiscount(
            parseInt(lineItemId),
            userId
        );
        
        if (result.success) {
            res.json({ success: true, message: 'Manual discount removed successfully' });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error removing manual discount:', error);
        res.status(500).json({ success: false, error: 'Failed to remove discount' });
    }
});

/**
 * Add line item to existing draft invoice
 * POST /api/v1/invoices/:id/line-items
 */
router.post('/:id/line-items', auth, auditMiddleware, invoiceController.addLineItem);

/**
 * Update line item quantity
 * PATCH /api/v1/invoices/:id/line-items/:lineItemId
 */
router.patch('/:id/line-items/:lineItemId', auth, auditMiddleware, invoiceController.updateLineItem);

/**
 * Remove line item from invoice
 * DELETE /api/v1/invoices/:id/line-items/:lineItemId
 */
router.delete('/:id/line-items/:lineItemId', auth, auditMiddleware, invoiceController.removeLineItem);

/**
 * Submit invoice for fulfillment
 * POST /api/v1/invoices/:id/submit
 */
router.post('/:id/submit', auth, auditMiddleware, invoiceController.submitForFulfillment);

/**
 * Approve pending order
 * POST /api/v1/invoices/:id/approve
 */
router.post('/:id/approve', auth, auditMiddleware, invoiceController.approveInvoice);

/**
 * Reject pending order
 * POST /api/v1/invoices/:id/reject
 */
router.post('/:id/reject', auth, auditMiddleware, invoiceController.rejectInvoice);

/**
 * Get invoice history
 * GET /api/v1/invoices/:id/history
 */
router.get('/:id/history', auth, invoiceController.getInvoiceHistory);

/**
 * Accept order for fulfillment
 * POST /api/v1/invoices/:id/fulfillment/accept
 */
router.post('/:id/fulfillment/accept', auth, auditMiddleware, invoiceController.acceptFulfillment);

/**
 * Report fulfillment issue
 * POST /api/v1/invoices/:id/fulfillment/issue
 */
router.post('/:id/fulfillment/issue', auth, auditMiddleware, invoiceController.reportFulfillmentIssue);

/**
 * Update invoice notes (customer and internal)
 * PATCH /api/v1/invoices/:id/notes
 */
router.patch('/:id/notes', auth, auditMiddleware, invoiceController.updateInvoiceNotes);

module.exports = router;

