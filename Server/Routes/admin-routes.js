// Server/Routes/admin-routes.js

const express = require('express');
const router = express.Router();
const buyerController = require('../Controllers/crm/buyerController');
const salesRepController = require('../Controllers/crm/salesRepController');
const productController = require('../Controllers/productController');
const portalAccessController = require('../Controllers/portalAccessController');
const invoiceController = require('../Controllers/invoiceController');
const settingsController = require('../Controllers/settingsController');
const creditUiController = require('../Controllers/creditUiController');
const discountUiController = require('../Controllers/discountUiController');
const UserModel = require('../Models/userModel');
const { requireAuth, requirePermission, requireRole } = require('../Middleware/auth');
const syncFailureTracker = require('../Services/syncFailureTracker');

// Apply authentication to all admin routes
router.use(requireAuth);

// Route to render the main admin dashboard
// Allow access to authenticated users (Sales Admin, Sales Rep, Administrator, etc.)
router.get('/', async (req, res) => {
    try {
        const userId = req.session.userId;
        const UserModel = require('../Models/userModel');
        
        // Get user info and roles
        let user = null;
        let userRoles = [];
        let isAdmin = false;
        let isSalesAdmin = false;
        let isSalesRep = false;
        
        if (userId) {
            user = await UserModel.findById(userId);
            const roles = await UserModel.getUserRoles(userId);
            userRoles = roles.map(r => r.name || r.role_name).filter(Boolean);
            const isSuperuser = await UserModel.isSuperuser(userId);
            
            isAdmin = isSuperuser || userRoles.some(r => r.toLowerCase() === 'administrator');
            isSalesAdmin = userRoles.some(r => r.toLowerCase() === 'sales admin');
            isSalesRep = userRoles.some(r => r.toLowerCase() === 'sales representative');
        }
        
        // Fetch invoice statistics for charts (for Admin, Sales Admin, and Sales Rep)
        let invoiceStats = null;
        let recentInvoices = [];
        
        if (isAdmin || isSalesAdmin || isSalesRep) {
            try {
                const { query } = require('../config/database');
                
                // Build query - Sales Admin and Admin see all invoices, Sales Rep sees only their assigned invoices
                let invoiceQuery = `
                    SELECT 
                        COUNT(*) as total_invoices,
                        SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) as approved_count,
                        SUM(CASE WHEN status = 'Draft' THEN 1 ELSE 0 END) as draft_count,
                        SUM(CASE WHEN status = 'Partially_Rejected' OR status = 'Fully_Rejected' THEN 1 ELSE 0 END) as rejected_count,
                        SUM(CASE WHEN status = 'Pending_Approval' THEN 1 ELSE 0 END) as pending_count,
                        SUM(CASE WHEN status = 'Fulfillment_Accepted' THEN 1 ELSE 0 END) as fulfilled_count,
                        SUM(CASE WHEN status = 'Shipped' THEN 1 ELSE 0 END) as shipped_count,
                        SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) as delivered_count,
                        SUM(CASE WHEN status = 'Paid' THEN 1 ELSE 0 END) as paid_count,
                        SUM(total) as total_revenue,
                        SUM(CASE WHEN status = 'Approved' THEN total ELSE 0 END) as approved_revenue,
                        AVG(total) as avg_invoice_value
                    FROM "ORDERS-invoices" i
                    LEFT JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                    WHERE 1=1
                `;
                
                // Add filtering for Sales Reps
                if (isSalesRep && !isAdmin && !isSalesAdmin) {
                    // Check if assigned_sales_rep_id column exists on buyer_locations
                    let hasLocationSalesRepColumn = false;
                    try {
                        const columnCheck = await query(`
                            SELECT column_name 
                            FROM information_schema.columns 
                            WHERE table_name = 'ORDERS-buyer_locations' 
                            AND column_name = 'assigned_sales_rep_id'
                        `);
                        hasLocationSalesRepColumn = columnCheck.rows.length > 0;
                    } catch (err) {
                        console.warn('Could not check for assigned_sales_rep_id column:', err);
                    }
                    
                    if (hasLocationSalesRepColumn) {
                        invoiceQuery += ` AND (i.assigned_sales_rep_id = $1 OR l.assigned_sales_rep_id = $1)`;
                    } else {
                        invoiceQuery += ` AND i.assigned_sales_rep_id = $1`;
                    }
                }
                
                const queryParams = isSalesRep && !isAdmin && !isSalesAdmin ? [userId] : [];
                const statsResult = await query(invoiceQuery, queryParams);
                
                if (statsResult.rows.length > 0) {
                    invoiceStats = statsResult.rows[0];
                }
                
                // Fetch sales over time (last 30 days)
                let salesOverTimeQuery = `
                    SELECT 
                        DATE(i.created_at) as date,
                        COUNT(*) as invoice_count,
                        SUM(i.total) as daily_revenue
                    FROM "ORDERS-invoices" i
                    LEFT JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                    WHERE i.created_at >= NOW() - INTERVAL '30 days'
                `;
                
                // Add filtering for Sales Reps
                if (isSalesRep && !isAdmin && !isSalesAdmin) {
                    let hasLocationSalesRepColumn = false;
                    try {
                        const columnCheck = await query(`
                            SELECT column_name 
                            FROM information_schema.columns 
                            WHERE table_name = 'ORDERS-buyer_locations' 
                            AND column_name = 'assigned_sales_rep_id'
                        `);
                        hasLocationSalesRepColumn = columnCheck.rows.length > 0;
                    } catch (err) {
                        console.warn('Could not check for assigned_sales_rep_id column:', err);
                    }
                    
                    if (hasLocationSalesRepColumn) {
                        salesOverTimeQuery += ` AND (i.assigned_sales_rep_id = $1 OR l.assigned_sales_rep_id = $1)`;
                    } else {
                        salesOverTimeQuery += ` AND i.assigned_sales_rep_id = $1`;
                    }
                }
                
                salesOverTimeQuery += ` GROUP BY DATE(i.created_at) ORDER BY date ASC`;
                
                const salesOverTimeParams = isSalesRep && !isAdmin && !isSalesAdmin ? [userId] : [];
                const salesOverTimeResult = await query(salesOverTimeQuery, salesOverTimeParams);
                
                // Fetch invoice status breakdown
                let statusBreakdownQuery = `
                    SELECT 
                        i.status,
                        COUNT(*) as count,
                        SUM(i.total) as revenue
                    FROM "ORDERS-invoices" i
                    LEFT JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                    WHERE 1=1
                `;
                
                // Add filtering for Sales Reps
                if (isSalesRep && !isAdmin && !isSalesAdmin) {
                    let hasLocationSalesRepColumn = false;
                    try {
                        const columnCheck = await query(`
                            SELECT column_name 
                            FROM information_schema.columns 
                            WHERE table_name = 'ORDERS-buyer_locations' 
                            AND column_name = 'assigned_sales_rep_id'
                        `);
                        hasLocationSalesRepColumn = columnCheck.rows.length > 0;
                    } catch (err) {
                        console.warn('Could not check for assigned_sales_rep_id column:', err);
                    }
                    
                    if (hasLocationSalesRepColumn) {
                        statusBreakdownQuery += ` AND (i.assigned_sales_rep_id = $1 OR l.assigned_sales_rep_id = $1)`;
                    } else {
                        statusBreakdownQuery += ` AND i.assigned_sales_rep_id = $1`;
                    }
                }
                
                statusBreakdownQuery += ` GROUP BY i.status ORDER BY count DESC`;
                
                const statusBreakdownParams = isSalesRep && !isAdmin && !isSalesAdmin ? [userId] : [];
                const statusBreakdownResult = await query(statusBreakdownQuery, statusBreakdownParams);
                
                // Fetch recent invoices (last 5)
                try {
                    let recentInvoicesQuery = `
                        SELECT 
                            i.id,
                            i.invoice_number,
                            i.status,
                            i.total,
                            i.created_at,
                            COALESCE(b.name, 'Unknown Buyer') as buyer_name,
                            COALESCE(l.name, 'Unknown Location') as location_name
                        FROM "ORDERS-invoices" i
                        LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                        LEFT JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                        WHERE 1=1
                    `;
                    
                    // Add filtering for Sales Reps
                    if (isSalesRep && !isAdmin && !isSalesAdmin) {
                        let hasLocationSalesRepColumn = false;
                        try {
                            const columnCheck = await query(`
                                SELECT column_name 
                                FROM information_schema.columns 
                                WHERE table_name = 'ORDERS-buyer_locations' 
                                AND column_name = 'assigned_sales_rep_id'
                            `);
                            hasLocationSalesRepColumn = columnCheck.rows.length > 0;
                        } catch (err) {
                            console.warn('Could not check for assigned_sales_rep_id column:', err);
                        }
                        
                        if (hasLocationSalesRepColumn) {
                            recentInvoicesQuery += ` AND (i.assigned_sales_rep_id = $1 OR l.assigned_sales_rep_id = $1)`;
                        } else {
                            recentInvoicesQuery += ` AND i.assigned_sales_rep_id = $1`;
                        }
                    }
                    
                    recentInvoicesQuery += ` ORDER BY i.created_at DESC LIMIT 5`;
                    
                    const recentInvoicesParams = isSalesRep && !isAdmin && !isSalesAdmin ? [userId] : [];
                    const recentInvoicesResult = await query(recentInvoicesQuery, recentInvoicesParams);
                    recentInvoices = recentInvoicesResult.rows || [];
                    console.log('Recent invoices fetched:', recentInvoices.length);
                } catch (recentError) {
                    console.error('Error fetching recent invoices:', recentError);
                    recentInvoices = [];
                }
                
                invoiceStats = {
                    ...invoiceStats,
                    salesOverTime: salesOverTimeResult.rows,
                    statusBreakdown: statusBreakdownResult.rows
                };
            } catch (error) {
                console.error('Error fetching invoice stats:', error);
                invoiceStats = null;
                recentInvoices = [];
            }
        }
        
        // Debug logging
        console.log('Dashboard render:', {
            isAdmin,
            isSalesAdmin,
            isSalesRep,
            showFullDashboard: isAdmin,
            showSalesDashboard: isSalesAdmin || isSalesRep, // Both Sales Admin and Sales Rep see sales dashboard
            hasInvoiceStats: !!invoiceStats,
            recentInvoicesCount: recentInvoices ? recentInvoices.length : 0
        });
        
        res.render('admin/dashboard', {
            title: 'Dashboard',
            layout: 'layouts/main',
            user: user,
            userEmail: user?.email || req.session.username || '',
            isAdmin: isAdmin,
            isSalesAdmin: isSalesAdmin,
            isSalesRep: isSalesRep,
            showFullDashboard: isAdmin, // Only admins see sync status
            showSalesDashboard: isSalesAdmin || isSalesRep, // Sales Admin and Sales Rep see sales dashboard
            invoiceStats: invoiceStats,
            recentInvoices: recentInvoices || []
        });
    } catch (error) {
        console.error('Error loading dashboard:', error);
    res.render('admin/dashboard', {
        title: 'Dashboard',
            layout: 'layouts/main',
            user: null,
            userEmail: req.session.username || '',
            isAdmin: false,
            isSalesAdmin: false,
            isSalesRep: false,
            showFullDashboard: false,
            showSalesDashboard: false,
            invoiceStats: null,
            recentInvoices: []
        });
    }
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
const { uploadMultiple, handleUploadError } = require('../Middleware/upload');
router.post('/products', 
    requireRole('Sales Admin', 'Administrator'),
    uploadMultiple,
    handleUploadError,
    productController.createProduct
);

// Show link items page
router.get('/products/:id/link-items', productController.showLinkItemsPage);

// Show product details
router.get('/products/:id', productController.getProductById);

// Product image management
router.get('/products/:id/images/manage', requireRole('Sales Admin', 'Administrator'), productController.showImageManagement);

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

// =============================================
// INVOICE MANAGEMENT ROUTES (Module 4)
// =============================================

// List invoices - Sales Admin, Sales Rep, and Administrator can access invoices
router.get('/invoices', requireRole('Sales Admin', 'Sales Representative', 'Administrator'), invoiceController.showInvoiceList);

// Show create invoice form
router.get('/invoices/create', requireRole('Sales Admin', 'Sales Representative', 'Administrator'), invoiceController.showCreateInvoiceForm);

// Clone invoice
router.post('/invoices/:id/clone', requireRole('Sales Admin', 'Administrator'), invoiceController.cloneInvoice.bind(invoiceController));

// Show invoice details
router.get('/invoices/:id', requireRole('Sales Admin', 'Sales Representative', 'Administrator'), invoiceController.showInvoiceDetails);

// Approve pending invoice (Sales Admin, Sales Rep, and Administrator)
router.post('/invoices/:id/approve', requireRole('Sales Admin', 'Sales Representative', 'Administrator'), invoiceController.approveInvoice);

// Reject pending invoice (Sales Admin, Sales Rep, and Administrator)
router.post('/invoices/:id/reject', requireRole('Sales Admin', 'Sales Representative', 'Administrator'), invoiceController.rejectInvoice);

// =============================================
// ACCOUNT CREDITS (UI)
// =============================================
router.get('/credits', requireRole('Sales Admin', 'Administrator'), creditUiController.listCredits);
router.get('/discounts', requireRole('Sales Admin', 'Administrator'), discountUiController.renderBuilder);
router.get('/discounts/assignments', requireRole('Sales Admin', 'Administrator'), discountUiController.renderAssignments);

// =============================================
// PORTAL ACCESS MANAGEMENT ROUTES (Module 4)
// =============================================

// List portal access links
router.get('/portal-access', requirePermission('admin', 'buyers'), portalAccessController.list);

// Create new portal access
router.post('/api/portal-access', requirePermission('admin', 'buyers'), portalAccessController.create);

// Toggle portal access active status
router.post('/api/portal-access/:id/toggle', requirePermission('admin', 'buyers'), portalAccessController.toggleActive);

// Regenerate UUID for portal access
router.post('/api/portal-access/:id/regenerate', requirePermission('admin', 'buyers'), portalAccessController.regenerateUuid);

// Delete portal access
router.delete('/api/portal-access/:id', requirePermission('admin', 'buyers'), portalAccessController.delete);

// Get locations for a buyer (must come before /:id/url to avoid route conflict)
router.get('/api/portal-access/buyers/:buyerId/locations', requireRole('Sales Admin', 'Sales Representative', 'Administrator'), portalAccessController.getLocationsForBuyer);

// Get portal URL
router.get('/api/portal-access/:id/url', requirePermission('admin', 'buyers'), portalAccessController.getUrl);

// =============================================
// SETTINGS ROUTES
// =============================================

// Show settings page
router.get('/settings', settingsController.showSettings);

// Change password
router.post('/settings/change-password', settingsController.changePassword);

// API endpoint for sync health status (used by dashboard)
// Allow authenticated users to access sync health
router.get('/api/sync-health', async (req, res) => {
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

// =============================================
// FULFILLMENT ROUTES (Module 5)
// =============================================

// Fulfillment Queue
router.get('/fulfillment/queue', requireRole('fulfillment_worker', 'fulfillment_admin', 'sales_admin', 'admin'), async (req, res) => {
    try {
        res.render('admin/fulfillment/queue', {
            title: 'Fulfillment Queue',
            layout: 'layouts/main',
            currentUserId: req.session.userId
        });
    } catch (error) {
        console.error('Error rendering fulfillment queue:', error);
        res.status(500).send('Error loading fulfillment queue');
    }
});

// Package Scanning Interface
router.get('/fulfillment/scanning/:invoiceId', requireRole('fulfillment_worker', 'fulfillment_admin'), async (req, res) => {
    try {
        const invoiceId = parseInt(req.params.invoiceId);
        res.render('admin/fulfillment/scanning', {
            title: 'Package Scanning',
            layout: 'layouts/main',
            invoiceId: invoiceId
        });
    } catch (error) {
        console.error('Error rendering scanning interface:', error);
        res.status(500).send('Error loading scanning interface');
    }
});

// Transportation Details Form
router.get('/fulfillment/transportation/:invoiceId', requireRole('fulfillment_worker', 'fulfillment_admin'), async (req, res) => {
    try {
        const invoiceId = parseInt(req.params.invoiceId);
        res.render('admin/fulfillment/transportation', {
            title: 'Transportation Details',
            layout: 'layouts/main',
            invoiceId: invoiceId
        });
    } catch (error) {
        console.error('Error rendering transportation form:', error);
        res.status(500).send('Error loading transportation form');
    }
});

// Manifest Creation/Preview
router.get('/fulfillment/manifest/:invoiceId', requireRole('fulfillment_worker', 'fulfillment_admin'), async (req, res) => {
    try {
        const invoiceId = parseInt(req.params.invoiceId);
        res.render('admin/fulfillment/manifest', {
            title: 'Create Manifest',
            layout: 'layouts/main',
            invoiceId: invoiceId
        });
    } catch (error) {
        console.error('Error rendering manifest creation:', error);
        res.status(500).send('Error loading manifest creation');
    }
});

module.exports = router;