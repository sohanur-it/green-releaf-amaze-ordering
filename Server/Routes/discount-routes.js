/**
 * Discount Routes
 * 
 * API endpoints for managing standing discounts
 */

const express = require('express');
const router = express.Router();
const discountService = require('../Services/discountService');
const discountBuilderService = require('../Services/discountBuilderService');
const { requireAuth: auth, requireRole } = require('../Middleware/auth');
const { auditMiddleware } = require('../Middleware/auditMiddleware');
const { query } = require('../config/database');

// Block fulfillment users from all discount routes
const blockFulfillmentUsers = (req, res, next) => {
    const userRoles = req.session?.roles || [];
    const normalizeRole = (role) => role.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
    const isFulfillmentUser = userRoles.some(role => {
        const normalized = normalizeRole(role);
        return normalized === 'fulfillment team' || 
               normalized === 'fulfillment worker' || 
               normalized === 'fulfillment admin';
    });
    
    if (isFulfillmentUser) {
        return res.status(403).json({ 
            success: false,
            error: 'Forbidden',
            message: 'Fulfillment users do not have access to discount management'
        });
    }
    next();
};

/**
 * Discount Builder Endpoints
 */
router.get('/codes', auth, blockFulfillmentUsers, async (req, res) => {
    try {
        const codes = await discountBuilderService.listDiscountCodes();
        res.json({ success: true, discounts: codes });
    } catch (error) {
        console.error('Error loading discount codes:', error);
        res.status(500).json({ success: false, error: 'Failed to load discounts' });
    }
});

router.post('/codes', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const required = ['display_name', 'code_name'];
        const missing = required.filter((field) => !req.body[field]);
        if (missing.length) {
            return res.status(400).json({ success: false, error: `Missing fields: ${missing.join(', ')}` });
        }
        const discount = await discountBuilderService.createDiscountCode(req.body, userId);
        res.status(201).json({ success: true, discount });
    } catch (error) {
        console.error('Error creating discount code:', error);
        res.status(500).json({ success: false, error: 'Failed to create discount' });
    }
});

router.get('/codes/:id', auth, blockFulfillmentUsers, async (req, res) => {
    try {
        const code = await discountBuilderService.getDiscountCodeById(parseInt(req.params.id, 10));
        if (!code) {
            return res.status(404).json({ success: false, error: 'Discount not found' });
        }
        res.json({ success: true, discount: code });
    } catch (error) {
        console.error('Error fetching discount code:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch discount' });
    }
});

router.put('/codes/:id', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const discount = await discountBuilderService.updateDiscountCode(parseInt(req.params.id, 10), req.body, userId);
        res.json({ success: true, discount });
    } catch (error) {
        console.error('Error updating discount code:', error);
        res.status(500).json({ success: false, error: 'Failed to update discount' });
    }
});

router.delete('/codes/:id', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        await discountBuilderService.deleteDiscountCode(parseInt(req.params.id, 10));
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting discount code:', error);
        res.status(500).json({ success: false, error: 'Failed to delete discount' });
    }
});

router.post('/codes/:id/rules', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        const required = ['applies_to', 'action', 'value'];
        const missing = required.filter((field) => req.body[field] === undefined || req.body[field] === null);
        if (missing.length) {
            return res.status(400).json({ success: false, error: `Missing fields: ${missing.join(', ')}` });
        }
        const rule = await discountBuilderService.addRule(parseInt(req.params.id, 10), req.body);
        res.status(201).json({ success: true, rule });
    } catch (error) {
        console.error('Error adding discount rule:', error);
        res.status(500).json({ success: false, error: 'Failed to add rule' });
    }
});

router.put('/rules/:ruleId', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        const rule = await discountBuilderService.updateRule(parseInt(req.params.ruleId, 10), req.body);
        res.json({ success: true, rule });
    } catch (error) {
        console.error('Error updating discount rule:', error);
        res.status(500).json({ success: false, error: 'Failed to update rule' });
    }
});

router.delete('/rules/:ruleId', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        await discountBuilderService.deleteRule(parseInt(req.params.ruleId, 10));
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting discount rule:', error);
        res.status(500).json({ success: false, error: 'Failed to delete rule' });
    }
});

/**
 * Reorder rules for a discount
 * PUT /api/v1/discounts/codes/:id/rules/reorder
 */
router.put('/codes/:id/rules/reorder', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const ordering = Array.isArray(req.body.ordering) ? req.body.ordering : [];
        await discountBuilderService.reorderRules(parseInt(id, 10), ordering);
        res.json({ success: true });
    } catch (error) {
        console.error('Error reordering rules:', error);
        res.status(500).json({ success: false, error: 'Failed to reorder rules' });
    }
});

router.post('/codes/:id/conflicts', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        const conflictIds = Array.isArray(req.body.conflicts) ? req.body.conflicts : [];
        await discountBuilderService.updateConflicts(parseInt(req.params.id, 10), conflictIds);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating discount conflicts:', error);
        res.status(500).json({ success: false, error: 'Failed to update conflicts' });
    }
});

router.get('/buyers/:buyerId/assignments', auth, blockFulfillmentUsers, async (req, res) => {
    try {
        const assignments = await discountBuilderService.getBuyerAssignments(parseInt(req.params.buyerId, 10));
        res.json({ success: true, assignments });
    } catch (error) {
        console.error('Error fetching buyer assignments:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch assignments' });
    }
});

router.post('/buyers/:buyerId/assignments', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const { discount_id } = req.body;
        if (!discount_id) {
            return res.status(400).json({ success: false, error: 'discount_id is required' });
        }
        const assignment = await discountBuilderService.assignDiscountToBuyer(
            parseInt(req.params.buyerId, 10),
            parseInt(discount_id, 10),
            userId
        );
        res.status(201).json({ success: true, assignment });
    } catch (error) {
        console.error('Error assigning discount:', error);
        res.status(500).json({ success: false, error: 'Failed to assign discount' });
    }
});

router.put('/buyers/:buyerId/assignments/reorder', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        const ordering = Array.isArray(req.body.ordering) ? req.body.ordering : [];
        await discountBuilderService.reorderAssignments(parseInt(req.params.buyerId, 10), ordering);
        res.json({ success: true });
    } catch (error) {
        console.error('Error reordering assignments:', error);
        res.status(500).json({ success: false, error: 'Failed to reorder' });
    }
});

router.put('/buyers/:buyerId/assignments/:assignmentId', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        const { priority, is_active } = req.body;
        const assignment = await discountBuilderService.updateAssignment(
            parseInt(req.params.assignmentId, 10),
            { priority, is_active }
        );
        res.json({ success: true, assignment });
    } catch (error) {
        console.error('Error updating assignment:', error);
        res.status(500).json({ success: false, error: 'Failed to update assignment' });
    }
});

router.delete('/buyers/:buyerId/assignments/:assignmentId', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        await discountBuilderService.removeAssignment(parseInt(req.params.assignmentId, 10));
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing assignment:', error);
        res.status(500).json({ success: false, error: 'Failed to remove assignment' });
    }
});

router.post('/simulate', auth, blockFulfillmentUsers, async (req, res) => {
    try {
        const result = await discountBuilderService.simulatePricing(req.body || {});
        res.json({ success: true, result });
    } catch (error) {
        console.error('Error running pricing simulation:', error);
        res.status(500).json({ success: false, error: 'Simulation failed' });
    }
});

/**
 * Helper: list products for a buyer (first location fallback)
 * GET /api/v1/discounts/buyers/:buyerId/products?limit=50
 */
router.get('/buyers/:buyerId/products', auth, blockFulfillmentUsers, async (req, res) => {
    try {
        const buyerId = parseInt(req.params.buyerId, 10);
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        if (Number.isNaN(buyerId)) {
            return res.status(400).json({ success: false, error: 'Invalid buyer id' });
        }
        // Find a location to anchor pricing context (fallback to first)
        const loc = await query(`
            SELECT entry_id FROM "ORDERS-buyer_locations"
            WHERE orders_buyer_id = $1
            ORDER BY entry_id ASC
            LIMIT 1
        `, [buyerId]);
        const locationId = loc.rows[0]?.entry_id || null;
        // Return basic product list with default price
        const products = await query(`
            SELECT entry_id AS product_id, name, COALESCE(default_price, 0) AS unit_price, category_name
            FROM "ORDERS-products"
            ORDER BY name ASC
            LIMIT $1
        `, [limit]);
        res.json({
            success: true,
            location_id: locationId,
            products: products.rows
        });
    } catch (error) {
        console.error('Error getting buyer products:', error);
        res.status(500).json({ success: false, error: 'Failed to load products' });
    }
});

/**
 * Get all standing discounts for a location
 * GET /api/v1/discounts/standing?location_id=123
 */
router.get('/standing', auth, blockFulfillmentUsers, async (req, res) => {
    try {
        const { location_id } = req.query;
        
        if (!location_id) {
            return res.status(400).json({
                success: false,
                error: 'location_id is required'
            });
        }
        
        const discounts = await discountService.getStandingDiscountsForLocation(parseInt(location_id));
        
        res.json({ success: true, discounts });
    } catch (error) {
        console.error('Error getting standing discounts:', error);
        res.status(500).json({ success: false, error: 'Failed to get discounts' });
    }
});

/**
 * Create a new standing discount
 * POST /api/v1/discounts/standing
 */
router.post('/standing', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const discountData = req.body;
        
        // Validate required fields
        if (!discountData.fk_location_id || !discountData.fk_master_product_id || 
            !discountData.discount_type || !discountData.discount_value) {
            return res.status(400).json({
                success: false,
                error: 'fk_location_id, fk_master_product_id, discount_type, and discount_value are required'
            });
        }
        
        const result = await discountService.createStandingDiscount(discountData, userId);
        
        if (result.success) {
            res.status(201).json({
                success: true,
                message: 'Standing discount created successfully',
                discount: result.discount
            });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error creating standing discount:', error);
        res.status(500).json({ success: false, error: 'Failed to create discount' });
    }
});

/**
 * Update a standing discount
 * PUT /api/v1/discounts/standing/:id
 */
router.put('/standing/:id', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const discountData = req.body;
        const userId = req.session.userId || req.user?.id;
        
        const result = await discountService.updateStandingDiscount(parseInt(id), discountData, userId);
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Standing discount updated successfully',
                discount: result.discount
            });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error updating standing discount:', error);
        res.status(500).json({ success: false, error: 'Failed to update discount' });
    }
});

/**
 * Delete a standing discount
 * DELETE /api/v1/discounts/standing/:id
 */
router.delete('/standing/:id', auth, blockFulfillmentUsers, auditMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await discountService.deleteStandingDiscount(parseInt(id));
        
        if (result.success) {
            res.json({ success: true, message: 'Standing discount deleted successfully' });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error deleting standing discount:', error);
        res.status(500).json({ success: false, error: 'Failed to delete discount' });
    }
});

module.exports = router;

