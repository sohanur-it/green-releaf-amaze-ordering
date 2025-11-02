/**
 * Discount Routes
 * 
 * API endpoints for managing standing discounts
 */

const express = require('express');
const router = express.Router();
const discountService = require('../Services/discountService');
const { requireAuth: auth } = require('../Middleware/auth');
const { auditMiddleware } = require('../Middleware/auditMiddleware');

/**
 * Get all standing discounts for a location
 * GET /api/v1/discounts/standing?location_id=123
 */
router.get('/standing', auth, async (req, res) => {
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
router.post('/standing', auth, auditMiddleware, async (req, res) => {
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
router.put('/standing/:id', auth, auditMiddleware, async (req, res) => {
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
router.delete('/standing/:id', auth, auditMiddleware, async (req, res) => {
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

