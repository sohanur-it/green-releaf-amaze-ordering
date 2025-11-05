// Server/Routes/portal-routes.js

const express = require('express');
const router = express.Router();
const PortalController = require('../Controllers/portalController');
const { authenticatePortalAccess, requirePortalAccess } = require('../Middleware/portalAuth');

// Product catalog - requires UUID authentication
router.get('/external/store/:uuid', authenticatePortalAccess, PortalController.showCatalog);

// Shopping cart API endpoints
router.get('/api/portal/:uuid/cart', authenticatePortalAccess, PortalController.getCart);
router.get('/api/portal/:uuid/inventory', authenticatePortalAccess, PortalController.getInventory);
router.post('/api/portal/:uuid/cart/add', authenticatePortalAccess, PortalController.addToCart);
router.post('/api/portal/:uuid/cart/remove', authenticatePortalAccess, PortalController.removeFromCart);
router.post('/api/portal/:uuid/cart/update', authenticatePortalAccess, PortalController.updateCartItem);
router.post('/api/portal/:uuid/cart/extend', authenticatePortalAccess, requirePortalAccess, PortalController.extendCart);

// Update invoice location
router.post('/api/portal/:uuid/update-location', authenticatePortalAccess, requirePortalAccess, PortalController.updateInvoiceLocation);

// Checkout page
router.get('/external/store/:uuid/checkout', authenticatePortalAccess, requirePortalAccess, PortalController.showCheckout);
router.post('/api/portal/:uuid/checkout', authenticatePortalAccess, requirePortalAccess, PortalController.processCheckout);

// Order confirmation page
router.get('/external/store/:uuid/confirmation/:invoiceId', authenticatePortalAccess, requirePortalAccess, PortalController.showConfirmation);

module.exports = router;

