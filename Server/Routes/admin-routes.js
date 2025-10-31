// Server/Routes/admin-routes.js

const express = require('express');
const router = express.Router();
const buyerController = require('../Controllers/crm/buyerController');
const salesRepController = require('../Controllers/crm/salesRepController');
const productController = require('../Controllers/productController');
const UserModel = require('../Models/userModel');
const { requireAuth, requirePermission } = require('../Middleware/auth');
const syncFailureTracker = require('../Services/syncFailureTracker');

// Apply authentication to all admin routes
router.use(requireAuth);

// Route to render the main admin dashboard
router.get('/', requirePermission('admin', 'dashboard'), (req, res) => {
    res.render('admin/dashboard', {
        title: 'Dashboard',
        layout: 'layouts/main'
    });
});

// Route to render the CRM page, handled by our controller
router.get('/crm', buyerController.getAllBuyers);

// The page to manage all sales reps
router.get('/crm/sales-reps', salesRepController.showRepsPage);

// otherwise the server will think "new" is an ID.
router.get('/crm/buyers/new', buyerController.showAddBuyerForm);

// POST route to handle the form submission and create the new buyer.
router.post('/crm/buyers', buyerController.createBuyer);

// GET route to show the form for editing an existing buyer.
router.get('/crm/buyers/:id/edit', buyerController.showEditBuyerForm);

// POST route to handle the submission of the edit form.
router.post('/crm/buyers/:id', buyerController.updateBuyer);

// POST route to handle the actual deletion of a buyer.
router.post('/crm/buyers/:id/delete', buyerController.deleteBuyer);

//route to display a single buyer's profile page.
// The ':id' part is a placeholder for the actual buyer's entry_id
router.get('/crm/buyers/:id', buyerController.getBuyerById);

// =============================================
// PRODUCT MANAGEMENT ROUTES (Module 3)
// =============================================

// List all products
router.get('/products', productController.getAllProducts);

// Show create product form (must be before /:id route)
router.get('/products/new', productController.showCreateProductForm);

// Create new product
router.post('/products', productController.createProduct);

// Show link items page
router.get('/products/:id/link-items', productController.showLinkItemsPage);

// Show product details
router.get('/products/:id', productController.getProductById);

// User management page
router.get('/users', requirePermission('admin', 'user'), (req, res) => {
    res.render('admin/user-management-enhanced', { 
        title: 'User Management',
        layout: 'layouts/main',
        user: req.session.user 
    });
});

// Audit logs page (enhanced with Chart.js)
router.get('/audit-logs', requirePermission('admin', 'audit'), (req, res) => {
    res.render('admin/audit-logs-enhanced', { 
        title: 'Audit Logs',
        layout: 'layouts/main',
        user: req.session.user 
    });
});

// API endpoint for sync health status (used by dashboard)
router.get('/api/sync-health', requirePermission('admin', 'dashboard'), async (req, res) => {
    try {
        // Disable caching for this endpoint to ensure fresh data
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        
        const alerts = await syncFailureTracker.getAllAlerts();
        const stats = await syncFailureTracker.getFailureStats();
        const recentSyncs = await syncFailureTracker.getRecentSyncHistory(5);
        const allSyncStatuses = await syncFailureTracker.getAllSyncStatuses();
        
        res.json({
            success: true,
            alerts,
            stats,
            recentSyncs,
            allSyncStatuses,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching sync health:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch sync health status'
        });
    }
});

module.exports = router;