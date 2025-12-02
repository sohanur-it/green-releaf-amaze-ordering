/**
 * Credit Routes
 * 
 * API endpoints for managing account credits
 */

const express = require('express');
const router = express.Router();
const accountCreditService = require('../Services/accountCreditService');
const { requireAuth: auth, requireRole, requireSuperuser } = require('../Middleware/auth');
const { auditMiddleware } = require('../Middleware/auditMiddleware');

// Block fulfillment users from all credit routes
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
            message: 'Fulfillment users do not have access to account credit management'
        });
    }
    next();
};

/**
 * Issue a new account credit
 * POST /api/v1/credits
 */
router.post('/', auth, blockFulfillmentUsers, requireRole('Sales Admin', 'Administrator'), auditMiddleware, async (req, res) => {
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
router.get('/', auth, blockFulfillmentUsers, async (req, res) => {
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
router.post('/apply/:invoiceId', auth, blockFulfillmentUsers, requireRole('Sales Admin', 'Administrator'), auditMiddleware, async (req, res) => {
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

/**
 * Void a credit
 * POST /api/v1/credits/:creditId/void
 */
router.post('/:creditId/void', auth, blockFulfillmentUsers, requireRole('Sales Admin', 'Administrator'), auditMiddleware, async (req, res) => {
    try {
        const { creditId } = req.params;
        const { reason } = req.body;
        const userId = req.session.userId || req.user?.id;

        const result = await accountCreditService.voidCredit(parseInt(creditId, 10), reason, userId);
        if (result.success) {
            res.json({ success: true, message: 'Credit voided successfully' });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error voiding credit:', error);
        res.status(500).json({ success: false, error: 'Failed to void credit' });
    }
});

/**
 * Manual correction of credit balance
 * POST /api/v1/credits/:creditId/correct-balance
 */
router.post('/:creditId/correct-balance', auth, blockFulfillmentUsers, requireSuperuser, auditMiddleware, async (req, res) => {
    try {
        const { creditId } = req.params;
        const { new_remaining_balance: newRemainingBalance, reason } = req.body;
        const userId = req.session.userId || req.user?.id;

        const result = await accountCreditService.correctCreditBalance(
            parseInt(creditId, 10),
            newRemainingBalance,
            reason,
            userId
        );

        if (result.success) {
            res.json({
                success: true,
                message: 'Credit balance corrected successfully',
                remaining_balance: result.remaining_balance
            });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error correcting credit balance:', error);
        res.status(500).json({ success: false, error: 'Failed to correct credit balance' });
    }
});

/**
 * Unapply credits from an invoice
 * POST /api/v1/credits/unapply/:invoiceId
 */
router.post('/unapply/:invoiceId', auth, blockFulfillmentUsers, requireRole('Sales Admin', 'Administrator'), auditMiddleware, async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const { credit_ids: creditIds, reason } = req.body;
        const userId = req.session.userId || req.user?.id;

        const result = await accountCreditService.unapplyCreditsFromInvoice(
            parseInt(invoiceId, 10),
            {
                creditIds: Array.isArray(creditIds) ? creditIds.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id)) : null,
                reason,
                userId
            }
        );

        if (result.success) {
            res.json({
                success: true,
                message: `Reversed $${result.reversed.toFixed(2)} in credits`,
                reversed: result.reversed
            });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error unappling credits:', error);
        res.status(500).json({ success: false, error: 'Failed to unapply credits' });
    }
});

module.exports = router;

