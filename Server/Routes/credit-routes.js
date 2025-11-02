/**
 * Credit Routes
 * 
 * API endpoints for managing account credits
 */

const express = require('express');
const router = express.Router();
const accountCreditService = require('../Services/accountCreditService');
const { requireAuth: auth } = require('../Middleware/auth');
const { auditMiddleware } = require('../Middleware/auditMiddleware');

/**
 * Issue a new account credit
 * POST /api/v1/credits
 */
router.post('/', auth, auditMiddleware, async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const creditData = req.body;
        
        // Validate required fields
        if (!creditData.fk_location_id || !creditData.amount || !creditData.reason) {
            return res.status(400).json({
                success: false,
                error: 'fk_location_id, amount, and reason are required'
            });
        }
        
        const result = await accountCreditService.issueCredit(creditData, userId);
        
        if (result.success) {
            res.status(201).json({
                success: true,
                message: 'Account credit issued successfully',
                credit: result.credit
            });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error issuing credit:', error);
        res.status(500).json({ success: false, error: 'Failed to issue credit' });
    }
});

/**
 * Get available credits for a location
 * GET /api/v1/credits?location_id=123
 */
router.get('/', auth, async (req, res) => {
    try {
        const { location_id } = req.query;
        
        if (!location_id) {
            return res.status(400).json({
                success: false,
                error: 'location_id is required'
            });
        }
        
        const credits = await accountCreditService.getAvailableCredits(parseInt(location_id));
        
        res.json({ success: true, credits });
    } catch (error) {
        console.error('Error getting credits:', error);
        res.status(500).json({ success: false, error: 'Failed to get credits' });
    }
});

/**
 * Apply credits to an invoice
 * POST /api/v1/credits/apply/:invoiceId
 */
router.post('/apply/:invoiceId', auth, auditMiddleware, async (req, res) => {
    try {
        const { invoiceId } = req.params;
        
        const result = await accountCreditService.applyCreditsToInvoice(parseInt(invoiceId));
        
        if (result.success) {
            res.json({
                success: true,
                message: `Applied $${result.applied} in credits`,
                applied: result.applied,
                credits_used: result.credits_used
            });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error applying credits:', error);
        res.status(500).json({ success: false, error: 'Failed to apply credits' });
    }
});

module.exports = router;

