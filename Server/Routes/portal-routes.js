// Server/Routes/portal-routes.js

const express = require('express');
const router = express.Router();
const PortalController = require('../Controllers/portalController');
const { authenticatePortalAccess, requirePortalAccess } = require('../Middleware/portalAuth');
const discountBuilderService = require('../Services/discountBuilderService');
const accountCreditService = require('../Services/accountCreditService');

// Product catalog - requires UUID authentication
router.get('/external/store/:uuid', authenticatePortalAccess, PortalController.showCatalog);

// Shopping cart API endpoints
router.get('/api/portal/:uuid/cart', authenticatePortalAccess, PortalController.getCart);
router.get('/api/portal/:uuid/inventory', authenticatePortalAccess, PortalController.getInventory);
router.post('/api/portal/:uuid/cart/add', authenticatePortalAccess, PortalController.addToCart);
router.post('/api/portal/:uuid/cart/remove', authenticatePortalAccess, PortalController.removeFromCart);
router.post('/api/portal/:uuid/cart/update', authenticatePortalAccess, PortalController.updateCartItem);
router.post('/api/portal/:uuid/cart/extend', authenticatePortalAccess, requirePortalAccess, PortalController.extendCart);

// Pricing simulation for external portal cart - returns subtotal, discounts, total
router.post('/api/portal/:uuid/cart/pricing', authenticatePortalAccess, requirePortalAccess, async (req, res) => {
    try {
        const access = req.portalAccess || {};
        const buyerId = access.buyerId || access.buyer_id || access.buyer?.entry_id || null;
        const rawItems = Array.isArray(req.body?.cartItems) ? req.body.cartItems : [];
        if (!buyerId) {
            return res.status(400).json({ success: false, error: 'Missing buyer context' });
        }
        if (!rawItems.length) {
            return res.json({ success: true, subtotal: 0, discounts: 0, total: 0, result: { breakdown: [] } });
        }
        const cartItems = rawItems.map((i) => ({
            product_id: Number(i.product_id),
            category_name: i.category_name || null,
            unit_price: Number(i.unit_price || 0),
            quantity: Number(i.quantity || 0)
        })).filter(ci => ci.product_id && ci.quantity > 0);
        const result = await discountBuilderService.simulatePricing({ buyerId, cartItems });
        return res.json({
            success: true,
            subtotal: result.subtotal,
            discounts: result.totalDiscounts,
            total: result.grandTotal,
            result
        });
    } catch (err) {
        console.error('Portal cart pricing error:', err);
        res.status(500).json({ success: false, error: 'Failed to compute pricing' });
    }
});

// Available credits for current buyer location
router.get('/api/portal/:uuid/credits/available', authenticatePortalAccess, requirePortalAccess, async (req, res) => {
    try {
        const access = req.portalAccess || {};
        const locationId = access.locationId || access.location_id || null;
        if (!locationId) {
            return res.status(400).json({ success: false, error: 'Missing location context' });
        }
        const credits = await accountCreditService.getAvailableCredits(Number(locationId));
        res.json({ success: true, credits });
    } catch (err) {
        console.error('Portal credits available error:', err);
        res.status(500).json({ success: false, error: 'Failed to get available credits' });
    }
});

// Update invoice location
router.post('/api/portal/:uuid/update-location', authenticatePortalAccess, requirePortalAccess, PortalController.updateInvoiceLocation);

// Checkout page
router.get('/external/store/:uuid/checkout', authenticatePortalAccess, requirePortalAccess, PortalController.showCheckout);
router.post('/api/portal/:uuid/checkout', authenticatePortalAccess, requirePortalAccess, PortalController.processCheckout);

// Order confirmation page
router.get('/external/store/:uuid/confirmation/:invoiceId', authenticatePortalAccess, requirePortalAccess, PortalController.showConfirmation);

// Orders/history
router.get('/external/store/:uuid/orders', authenticatePortalAccess, requirePortalAccess, PortalController.showOrders);
router.get('/api/portal/:uuid/orders', authenticatePortalAccess, requirePortalAccess, PortalController.getPortalOrders);

module.exports = router;

