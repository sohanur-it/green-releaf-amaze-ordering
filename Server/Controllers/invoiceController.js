/**
 * Invoice Controller
 * 
 * Handles invoice creation, management, and state transitions
 */

const invoiceStateMachine = require('../Services/invoiceStateMachineService');
const { query } = require('../config/database');
const websocketService = require('../Services/websocketService');
const auditLogger = require('../Services/auditLogger');
const lineItemHistoryService = require('../Services/lineItemHistoryService');

class InvoiceController {
    /**
     * Get all invoices with optional filtering
     * GET /api/v1/invoices
     */
    async getAllInvoices(req, res) {
        try {
            const { status, buyer_id, location_id, source } = req.query;
            
            let queryStr = `
                SELECT 
                    i.*,
                    b.name as buyer_name,
                    l.name as location_name
                FROM "ORDERS-invoices" i
                INNER JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                INNER JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                WHERE 1=1
            `;
            
            const params = [];
            let paramIndex = 1;
            
            if (status) {
                queryStr += ` AND i.status = $${paramIndex}`;
                params.push(status);
                paramIndex++;
            }
            
            if (buyer_id) {
                queryStr += ` AND i.fk_buyer_id = $${paramIndex}`;
                params.push(buyer_id);
                paramIndex++;
            }
            
            if (location_id) {
                queryStr += ` AND i.fk_location_id = $${paramIndex}`;
                params.push(location_id);
                paramIndex++;
            }
            
            if (source) {
                queryStr += ` AND i.source = $${paramIndex}`;
                params.push(source);
                paramIndex++;
            }
            
            queryStr += ` ORDER BY i.created_at DESC`;
            
            const invoices = await query(queryStr, params);
            
            res.json({
                success: true,
                count: invoices.rows.length,
                invoices: invoices.rows
            });
        } catch (error) {
            console.error('Error fetching invoices:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch invoices',
                message: error.message
            });
        }
    }

    /**
     * Get invoice by ID
     * GET /api/v1/invoices/:id
     */
    async getInvoiceById(req, res) {
        try {
            const { id } = req.params;
            
            const invoice = await query(`
                SELECT 
                    i.*,
                    b.name as buyer_name,
                    l.name as location_name
                FROM "ORDERS-invoices" i
                INNER JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                INNER JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                WHERE i.id = $1
            `, [id]);
            
            if (invoice.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Invoice not found'
                });
            }
            
            // Get line items
            const lineItems = await query(`
                SELECT 
                    li.*,
                    p.name as product_name,
                    p.brand_name,
                    p.cultivar_name,
                    b.batch_name
                FROM "ORDERS-invoice-line-items" li
                INNER JOIN "ORDERS-products" p ON li.fk_master_product_id = p.entry_id
                INNER JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
                WHERE li.fk_invoice_id = $1
                ORDER BY li.line_item_order
            `, [id]);
            
            // Get modification history
            const history = await query(`
                SELECT 
                    h.*,
                    u.first_name || ' ' || u.last_name AS changed_by_name,
                    u.email AS changed_by_email
                FROM "ORDERS-invoice-history" h
                LEFT JOIN users u ON h.changed_by_user_id = u.id
                WHERE h.fk_invoice_id = $1
                ORDER BY h.changed_at DESC
            `, [id]);
            
            res.json({
                success: true,
                invoice: {
                    ...invoice.rows[0],
                    line_items: lineItems.rows,
                    history: history.rows
                }
            });
        } catch (error) {
            console.error('Error fetching invoice:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch invoice',
                message: error.message
            });
        }
    }

    /**
     * Create new invoice (internal or external)
     * POST /api/v1/invoices
     */
    async createInvoice(req, res) {
        try {
            const {
                buyer_id,
                location_id,
                source = 'Internal', // or 'External'
                assigned_sales_rep_id,
                customer_notes,
                internal_notes
            } = req.body;
            
            const userId = req.session?.userId || req.user?.id || null;
            
            if (!buyer_id || !location_id) {
                return res.status(400).json({
                    success: false,
                    error: 'buyer_id and location_id are required'
                });
            }
            
            // Get location license number
            const location = await query(`
                SELECT 
                    l.state_license,
                    l.entry_id,
                    COALESCE(l.assigned_sales_rep_id, sr.fk_sales_rep_id) as assigned_sales_rep_id
                FROM "ORDERS-buyer_locations" l
                LEFT JOIN "ORDERS-buyer_sales_rep_assignments" sr ON l.orders_buyer_id = sr.fk_buyer_id
                WHERE l.entry_id = $1
                LIMIT 1
            `, [location_id]);
            
            if (location.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Location not found'
                });
            }
            
            const licenseNumber = location.rows[0].state_license || null;
            const defaultSalesRep = location.rows[0].assigned_sales_rep_id || null;
            
            // Generate invoice number
            const invoiceNumber = await this.generateInvoiceNumber();
            
            // For external orders, set cart expiry
            let cartCreatedAt = null;
            let cartExpiresAt = null;
            if (source === 'External') {
                cartCreatedAt = new Date();
                cartExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
            }
            
            // Create invoice
            const invoice = await query(`
                INSERT INTO "ORDERS-invoices" (
                    invoice_number, fk_buyer_id, fk_location_id,
                    location_license_number, source, created_by_user_id,
                    assigned_sales_rep_id, status, cart_created_at, cart_expires_at,
                    customer_notes, internal_notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING *
            `, [
                invoiceNumber,
                buyer_id,
                location_id,
                licenseNumber,
                source,
                userId,
                assigned_sales_rep_id || defaultSalesRep,
                'Draft',
                cartCreatedAt,
                cartExpiresAt,
                customer_notes || null,
                internal_notes || null
            ]);
            
            // Log history
            await query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id, modification_type, reason, changed_by_user_id, changed_by_system
                ) VALUES ($1, 'invoice_created', 'Invoice created', $2, false)
            `, [invoice.rows[0].id, userId]);
            
            // Audit log
            await auditLogger.logAction({
                userId,
                action: 'invoice_created',
                resourceType: 'Invoice',
                resourceId: invoice.rows[0].id.toString(),
                details: {
                    invoice_number: invoiceNumber,
                    buyer_id,
                    location_id,
                    source
                },
                status: 'success',
                sourceIp: req.ip
            });
            
            res.status(201).json({
                success: true,
                invoice: invoice.rows[0]
            });
        } catch (error) {
            console.error('Error creating invoice:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create invoice',
                message: error.message
            });
        }
    }

    /**
     * Transition invoice to a new status
     * POST /api/v1/invoices/:id/transition
     */
    async transitionInvoice(req, res) {
        try {
            const { id } = req.params;
            const { status, reason } = req.body;
            
            const userId = req.session?.userId || req.user?.id || null;
            
            if (!status) {
                return res.status(400).json({
                    success: false,
                    error: 'status is required'
                });
            }
            
            const result = await invoiceStateMachine.transitionTo(
                id,
                status,
                userId,
                reason
            );
            
            if (!result.success) {
                return res.status(400).json(result);
            }
            
            // Audit log
            await auditLogger.logAction({
                userId,
                action: 'invoice_status_transition',
                resourceType: 'Invoice',
                resourceId: id.toString(),
                details: {
                    old_status: result.oldStatus,
                    new_status: result.newStatus,
                    reason
                },
                status: 'success',
                sourceIp: req.ip
            });
            
            res.json({
                success: true,
                message: `Invoice transitioned from ${result.oldStatus} to ${result.newStatus}`,
                ...result
            });
        } catch (error) {
            console.error('Error transitioning invoice:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to transition invoice',
                message: error.message
            });
        }
    }

    /**
     * Generate unique invoice number
     */
    async generateInvoiceNumber() {
        const year = new Date().getFullYear();
        const result = await query(`
            SELECT COUNT(*) as count
            FROM "ORDERS-invoices"
            WHERE invoice_number LIKE $1
        `, [`INV-${year}-%`]);
        
        const count = parseInt(result.rows[0].count || 0) + 1;
        return `INV-${year}-${String(count).padStart(5, '0')}`;
    }

    /**
     * Show invoice list page (Admin UI)
     * GET /admin/invoices
     */
    async showInvoiceList(req, res) {
        try {
            const { status, source } = req.query;
            const userId = req.session.userId || req.user?.id;
            const UserModel = require('../Models/userModel');
            
            // Check if user is admin or sales admin
            const isSuperuser = await UserModel.isSuperuser(userId);
            const userRoles = await UserModel.getUserRoles(userId);
            const userRoleNames = userRoles.map(r => r.name || r.role_name).filter(Boolean);
            
            // Check role names (case-insensitive)
            const isAdmin = isSuperuser || userRoleNames.some(r => r.toLowerCase() === 'administrator');
            const isSalesAdmin = userRoleNames.some(r => r.toLowerCase() === 'sales admin');
            
            // Check if user is fulfillment user (normalize role names for comparison)
            // Only set isFulfillmentUser to true if user has ONLY fulfillment roles (no Sales Admin/Rep or Admin)
            const normalizeRole = (role) => role ? role.toLowerCase().replace(/[\s_-]+/g, ' ').trim() : '';
            const hasFulfillmentRole = userRoleNames.some(r => {
                const normalized = normalizeRole(r);
                return normalized === 'fulfillment team' || 
                       normalized === 'fulfillment worker' || 
                       normalized === 'fulfillment admin';
            });
            // Only treat as fulfillment-only user if they have fulfillment role BUT NOT Sales Admin/Rep or Admin
            const isFulfillmentUser = hasFulfillmentRole && !isAdmin && !isSalesAdmin && !userRoleNames.some(r => r.toLowerCase() === 'sales representative');
            
            // Use LEFT JOIN to show invoices even if buyer/location is missing
            let queryStr = `
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.status,
                    i.source,
                    i.total,
                    i.subtotal,
                    i.discount_amount,
                    i.credit_applied,
                    i.created_at,
                    i.updated_at,
                    i.cart_expires_at,
                    i.fk_buyer_id,
                    i.fk_location_id,
                    COALESCE(b.name, 'Unknown Buyer') as buyer_name,
                    COALESCE(l.name, 'Unknown Location') as location_name,
                    COALESCE(b.name, u.username, 'System') as created_by_username,
                    COALESCE(sr.first_name || ' ' || sr.last_name, 'Unassigned') as sales_rep_name
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                LEFT JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                LEFT JOIN users u ON i.created_by_user_id = u.id
                LEFT JOIN users sr ON i.assigned_sales_rep_id = sr.id
                WHERE 1=1
            `;
            
            const params = [];
            let paramIndex = 1;
            
            // Check if user is sales rep
            const isSalesRep = !isAdmin && !isSalesAdmin && userRoleNames.some(r => r.toLowerCase() === 'sales representative');
            
            // Sales Admin can see all invoices (no filtering by assigned_sales_rep_id)
            // Only filter by sales rep if they are a regular Sales Rep (not Sales Admin)
            if (isSalesRep) {
                // Check if assigned_sales_rep_id column exists on buyer_locations table
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
                    // Filter by invoices assigned to this sales rep OR invoices from locations assigned to this sales rep
                    queryStr += ` AND (
                        i.assigned_sales_rep_id = $${paramIndex} 
                        OR l.assigned_sales_rep_id = $${paramIndex}
                    )`;
                } else {
                    // Fallback: filter only by invoice's assigned_sales_rep_id
                    queryStr += ` AND i.assigned_sales_rep_id = $${paramIndex}`;
                }
                params.push(userId);
                paramIndex++;
            }
            
            // Additional filter options
            const fulfillmentStatus = req.query.fulfillment_status; // 'fulfilled', 'not_fulfilled', 'all'
            const deliveryStatus = req.query.delivery_status; // 'delivered', 'not_delivered', 'all'
            
            if (status) {
                queryStr += ` AND i.status = $${paramIndex}`;
                params.push(status);
                paramIndex++;
            }
            
            if (source) {
                queryStr += ` AND i.source = $${paramIndex}`;
                params.push(source);
                paramIndex++;
            }
            
            // Fulfillment status filter
            if (fulfillmentStatus === 'fulfilled') {
                queryStr += ` AND i.status IN ('Fulfillment_Accepted', 'Manifested', 'Shipped', 'Delivered', 'Paid')`;
            } else if (fulfillmentStatus === 'not_fulfilled') {
                queryStr += ` AND i.status NOT IN ('Fulfillment_Accepted', 'Manifested', 'Shipped', 'Delivered', 'Paid')`;
            }
            
            // Delivery status filter
            if (deliveryStatus === 'delivered') {
                queryStr += ` AND i.status IN ('Delivered', 'Paid')`;
            } else if (deliveryStatus === 'not_delivered') {
                queryStr += ` AND i.status NOT IN ('Delivered', 'Paid')`;
            }
            
            // Get total count for pagination (before adding LIMIT/OFFSET)
            const countParams = params.slice(); // Copy params array
            const countQuery = queryStr.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM').replace(/ORDER BY[\s\S]*$/, '');
            const countResult = await query(countQuery, countParams);
            const totalInvoices = parseInt(countResult.rows[0]?.total || 0);
            
            // Pagination
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 25;
            const offset = (page - 1) * limit;
            const totalPages = Math.ceil(totalInvoices / limit);
            
            queryStr += ` ORDER BY i.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);
            
            const invoices = await query(queryStr, params);
            
            const websocketPort = process.env.WEBSOCKET_PORT || 8080;

            res.render('admin/invoices/index', {
                title: 'Invoices',
                layout: 'layouts/main',
                invoices: invoices.rows || [],
                filters: { status, source, fulfillment_status: fulfillmentStatus, delivery_status: deliveryStatus },
                pagination: {
                    page: page,
                    limit: limit,
                    total: totalInvoices,
                    totalPages: totalPages
                },
                user: req.session.user,
                isAdmin: isAdmin,
                isSalesAdmin: isSalesAdmin,
                isSalesRep: isSalesRep,
                isFulfillmentUser: isFulfillmentUser, // Pass fulfillment flag for read-only mode
                websocketPort
            });
        } catch (error) {
            console.error('Error loading invoice list:', error);
            res.status(500).send('Error loading invoices: ' + error.message);
        }
    }
    
    /**
     * Approve pending invoice
     * POST /admin/invoices/:id/approve
     */
    async approveInvoice(req, res) {
        try {
            const { id } = req.params;
            const userId = req.session.userId || req.user?.id;
            
            const invoiceStateMachine = require('../Services/invoiceStateMachineService');
            const result = await invoiceStateMachine.transitionTo(
                parseInt(id),
                'Approved',
                userId,
                'Invoice approved by sales rep/admin'
            );
            
            if (result.success) {
                res.json({ success: true, message: 'Invoice approved successfully' });
            } else {
                res.status(400).json({ 
                    success: false, 
                    error: result.error,
                    validTransitions: result.validTransitions 
                });
            }
        } catch (error) {
            console.error('Error approving invoice:', error);
            res.status(500).json({ success: false, error: 'Failed to approve invoice' });
        }
    }
    
    /**
     * Reject pending invoice
     * POST /admin/invoices/:id/reject
     */
    async rejectInvoice(req, res) {
        try {
            const { id } = req.params;
            const userId = req.session.userId || req.user?.id;
            const { reason } = req.body;
            
            const invoiceStateMachine = require('../Services/invoiceStateMachineService');
            const result = await invoiceStateMachine.transitionTo(
                parseInt(id),
                'Rejected',
                userId,
                reason || 'Invoice rejected by sales rep/admin'
            );
            
            if (result.success) {
                res.json({ success: true, message: 'Invoice rejected successfully' });
            } else {
                res.status(400).json({ 
                    success: false, 
                    error: result.error,
                    validTransitions: result.validTransitions 
                });
            }
        } catch (error) {
            console.error('Error rejecting invoice:', error);
            res.status(500).json({ success: false, error: 'Failed to reject invoice' });
        }
    }

    /**
     * Show create invoice form (Admin UI)
     * GET /admin/invoices/create
     */
    async showCreateInvoiceForm(req, res) {
        try {
            const userId = req.session.userId || req.user?.id;
            const UserModel = require('../Models/userModel');
            
            // Check if user is admin or sales admin
            const isSuperuser = await UserModel.isSuperuser(userId);
            const userRoles = await UserModel.getUserRoles(userId);
            const userRoleNames = userRoles.map(r => r.name || r.role_name).filter(Boolean);
            
            const isAdmin = isSuperuser || userRoleNames.some(r => r.toLowerCase() === 'administrator');
            const isSalesAdmin = userRoleNames.some(r => r.toLowerCase() === 'sales admin');
            const isSalesRep = !isAdmin && !isSalesAdmin && userRoleNames.some(r => r.toLowerCase() === 'sales representative');
            
            // Build query to get buyers with locations
            let queryStr = `
                SELECT DISTINCT
                    b.entry_id as buyer_id,
                    b.name as buyer_name,
                    l.entry_id as location_id,
                    l.name as location_name
                FROM "ORDERS-buyers" b
                INNER JOIN "ORDERS-buyer_locations" l ON b.entry_id = l.orders_buyer_id
            `;
            
            const params = [];
            let paramIndex = 1;
            
            // If Sales Rep, filter to only show assigned locations
            // Sales Admin and Administrators see all buyers/locations (no filter)
            if (isSalesRep && !isAdmin && !isSalesAdmin) {
                // Check if assigned_sales_rep_id column exists on buyer_locations table
                let hasLocationSalesRepColumn = false;
                try {
                    const columnCheck = await query(`
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_schema = 'public'
                        AND table_name = 'ORDERS-buyer_locations' 
                        AND column_name = 'assigned_sales_rep_id'
                    `);
                    hasLocationSalesRepColumn = columnCheck.rows.length > 0;
                } catch (err) {
                    console.warn('Could not check for assigned_sales_rep_id column:', err);
                }
                
                if (hasLocationSalesRepColumn) {
                    // Filter by locations directly assigned to this sales rep (via assigned_sales_rep_id)
                    // OR locations belonging to buyers assigned to this sales rep
                    queryStr += `
                        LEFT JOIN "ORDERS-buyer_sales_rep_assignments" ba ON b.entry_id = ba.fk_buyer_id
                        LEFT JOIN "ORDERS-sales_reps" sr ON ba.fk_sales_rep_id = sr.entry_id
                        LEFT JOIN users u ON sr.email = u.email
                        WHERE (
                            l.assigned_sales_rep_id = $${paramIndex}
                            OR u.id = $${paramIndex}
                        )
                    `;
                } else {
                    // Fallback: filter by buyer assignments only (if location-level assignment column doesn't exist)
                    queryStr += `
                        INNER JOIN "ORDERS-buyer_sales_rep_assignments" ba ON b.entry_id = ba.fk_buyer_id
                        INNER JOIN "ORDERS-sales_reps" sr ON ba.fk_sales_rep_id = sr.entry_id
                        INNER JOIN users u ON sr.email = u.email
                        WHERE u.id = $${paramIndex}
                    `;
                }
                params.push(userId);
                paramIndex++;
            }
            // If Sales Admin or Admin, no WHERE clause - show all buyers and locations
            
            queryStr += ` ORDER BY b.name, l.name`;
            
            const buyers = await query(queryStr, params);
            
            res.render('admin/invoices/create', {
                title: 'Create Invoice',
                layout: 'layouts/main',
                buyers: buyers.rows,
                user: req.session.user
            });
        } catch (error) {
            console.error('Error loading create invoice form:', error);
            res.status(500).send('Error loading create invoice form: ' + error.message);
        }
    }
    
    /**
     * Clone invoice
     * POST /admin/invoices/:id/clone
     */
    async cloneInvoice(req, res) {
        // Ensure 'this' context is preserved
        if (!this || typeof this.generateInvoiceNumber !== 'function') {
            console.error('Context lost in cloneInvoice. this:', this);
            return res.status(500).json({ 
                success: false, 
                error: 'Internal server error - context issue',
                details: 'Method context was lost'
            });
        }
        try {
            const { id } = req.params;
            const { new_location_id } = req.body;
            const userId = req.session.userId || req.user?.id;
            
            // Get original invoice
            const original = await query(`
                SELECT * FROM "ORDERS-invoices"
                WHERE id = $1
            `, [id]);
            
            if (original.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Invoice not found' });
            }
            
            const origInvoice = original.rows[0];
            
            // Get original line items with product info for better error messages
            const lineItems = await query(`
                SELECT 
                    li.fk_master_product_id,
                    li.fk_batch_id,
                    li.quantity_ordered,
                    li.unit_price,
                    li.specific_package_labels,
                    p.name as product_name,
                    b.batch_name
                FROM "ORDERS-invoice-line-items" li
                INNER JOIN "ORDERS-products" p ON li.fk_master_product_id = p.entry_id
                LEFT JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
                WHERE li.fk_invoice_id = $1
            `, [id]);
            
            // Get location details
            const locationId = new_location_id || origInvoice.fk_location_id;
            
            // First try to get state_license and check if assigned_sales_rep_id column exists
            let location;
            try {
                location = await query(`
                    SELECT 
                        state_license,
                        entry_id
                    FROM "ORDERS-buyer_locations"
                    WHERE entry_id = $1
                    LIMIT 1
                `, [locationId]);
            } catch (err) {
                // If state_license doesn't exist, try without it
                console.warn('Error querying location with state_license, trying alternative:', err.message);
                location = await query(`
                    SELECT 
                        entry_id
                    FROM "ORDERS-buyer_locations"
                    WHERE entry_id = $1
                    LIMIT 1
                `, [locationId]);
            }
            
            // Try to get assigned_sales_rep_id if column exists
            let assignedSalesRepId = null;
            try {
                const salesRepQuery = await query(`
                    SELECT assigned_sales_rep_id
                    FROM "ORDERS-buyer_locations"
                    WHERE entry_id = $1
                    LIMIT 1
                `, [locationId]);
                if (salesRepQuery.rows.length > 0 && salesRepQuery.rows[0].assigned_sales_rep_id) {
                    assignedSalesRepId = salesRepQuery.rows[0].assigned_sales_rep_id;
                }
            } catch (err) {
                // Column doesn't exist, try getting from buyer_sales_rep_assignments
                try {
                    const buyerId = origInvoice.fk_buyer_id;
                    const salesRepAssignment = await query(`
                        SELECT fk_sales_rep_id
                        FROM "ORDERS-buyer_sales_rep_assignments"
                        WHERE fk_buyer_id = $1
                        LIMIT 1
                    `, [buyerId]);
                    if (salesRepAssignment.rows.length > 0) {
                        assignedSalesRepId = salesRepAssignment.rows[0].fk_sales_rep_id;
                    }
                } catch (assignmentErr) {
                    console.warn('Could not get sales rep assignment:', assignmentErr.message);
                }
            }
            
            if (location.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Location not found' });
            }
            
            const locationData = location.rows[0];
            const stateLicense = locationData.state_license || null;
            
            // Generate new invoice number
            // Use bound method or fallback to direct call
            let invoiceNumber;
            if (this && typeof this.generateInvoiceNumber === 'function') {
                invoiceNumber = await this.generateInvoiceNumber();
            } else {
                // Fallback: generate invoice number directly
                const year = new Date().getFullYear();
                const result = await query(`
                    SELECT COUNT(*) as count
                    FROM "ORDERS-invoices"
                    WHERE invoice_number LIKE $1
                `, [`INV-${year}-%`]);
                
                const count = parseInt(result.rows[0].count || 0) + 1;
                invoiceNumber = `INV-${year}-${String(count).padStart(5, '0')}`;
            }
            
            // Create new invoice
            const newInvoice = await query(`
                INSERT INTO "ORDERS-invoices" (
                    invoice_number, fk_buyer_id, fk_location_id,
                    location_license_number, source, created_by_user_id,
                    assigned_sales_rep_id, status, customer_notes, internal_notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Draft', $8, $9)
                RETURNING id
            `, [
                invoiceNumber,
                origInvoice.fk_buyer_id,
                locationId,
                stateLicense,
                origInvoice.source,
                userId,
                assignedSalesRepId,
                origInvoice.customer_notes,
                `Cloned from invoice ${origInvoice.invoice_number}`
            ]);
            
            const newInvoiceId = newInvoice.rows[0].id;
            const internalInvoiceService = require('../Services/internalInvoiceService');
            const client = await internalInvoiceService.pool.connect();
            
            try {
                await client.query('BEGIN');
                
                const allocationFailures = [];
                
                // Clone line items with proper error handling
                for (const item of lineItems.rows) {
                    try {
                        // CRITICAL: Use FOR UPDATE to lock batch row and prevent race conditions
                        // This ensures availability check and allocation happen atomically
                        const batch = await client.query(`
                            SELECT 
                                id,
                                batch_name,
                                quantity, 
                                allocated_quantity, 
                                status,
                                fk_master_product_id
                            FROM "ORDERS-batches"
                            WHERE id = $1
                            FOR UPDATE
                        `, [item.fk_batch_id]);
                        
                        if (batch.rows.length === 0) {
                            allocationFailures.push({
                                batch_id: item.fk_batch_id,
                                product_id: item.fk_master_product_id,
                                product_name: item.product_name || 'Unknown Product',
                                batch_name: item.batch_name || 'Unknown Batch',
                                reason: 'batch_not_found',
                                message: `Batch ${item.fk_batch_id} not found`,
                                requested_quantity: item.quantity_ordered,
                                available_quantity: null
                            });
                            continue;
                        }
                        
                        const batchData = batch.rows[0];
                        const available = batchData.quantity - batchData.allocated_quantity;
                        
                        // Only check batch status for external invoices
                        // Internal invoices can access any batch regardless of status
                        // Status is only used as a marker for external portal behavior
                        if (origInvoice.source === 'External' && batchData.status !== 'Sellable') {
                            allocationFailures.push({
                                batch_id: item.fk_batch_id,
                                product_id: item.fk_master_product_id,
                                product_name: item.product_name || 'Unknown Product',
                                batch_name: batchData.batch_name || 'Unknown Batch',
                                reason: 'batch_not_sellable',
                                message: `Batch "${batchData.batch_name || item.fk_batch_id}" is not sellable (status: ${batchData.status})`,
                                requested_quantity: item.quantity_ordered,
                                available_quantity: available,
                                batch_status: batchData.status
                            });
                            continue;
                        }
                        
                        if (available < item.quantity_ordered) {
                            allocationFailures.push({
                                batch_id: item.fk_batch_id,
                                product_id: item.fk_master_product_id,
                                product_name: item.product_name || 'Unknown Product',
                                batch_name: batchData.batch_name || 'Unknown Batch',
                                reason: 'insufficient_inventory',
                                message: `Insufficient inventory for "${item.product_name || 'Product'}" - Batch "${batchData.batch_name || item.fk_batch_id}": Available ${available}, Needed ${item.quantity_ordered}`,
                                requested_quantity: item.quantity_ordered,
                                available_quantity: available
                            });
                            continue;
                        }
                        
                        // Add line item with error handling
                        // Note: addLineItem also checks availability, but we've already checked here
                        // This provides better error messages and prevents unnecessary processing
                        try {
                            await internalInvoiceService.addLineItem(
                                newInvoiceId,
                                {
                                    fk_batch_id: item.fk_batch_id,
                                    quantity: item.quantity_ordered,
                                    partial_packages_selected: item.specific_package_labels 
                                        ? JSON.parse(item.specific_package_labels) 
                                        : null
                                },
                                userId,
                                client
                            );
                        } catch (addItemError) {
                            // If addLineItem fails (e.g., batch became unavailable between checks),
                            // add to allocation failures and continue with other items
                            allocationFailures.push({
                                batch_id: item.fk_batch_id,
                                product_id: item.fk_master_product_id,
                                product_name: item.product_name || 'Unknown Product',
                                batch_name: batchData.batch_name || 'Unknown Batch',
                                reason: 'allocation_failed',
                                message: `Failed to allocate "${item.product_name || 'Product'}" - Batch "${batchData.batch_name || item.fk_batch_id}": ${addItemError.message}`,
                                requested_quantity: item.quantity_ordered,
                                available_quantity: available,
                                error: addItemError.message
                            });
                        }
                    } catch (itemError) {
                        // Catch any unexpected errors during item processing
                        allocationFailures.push({
                            batch_id: item.fk_batch_id,
                            product_id: item.fk_master_product_id,
                            product_name: item.product_name || 'Unknown Product',
                            batch_name: item.batch_name || 'Unknown Batch',
                            reason: 'unexpected_error',
                            message: `Unexpected error cloning "${item.product_name || 'Product'}": ${itemError.message}`,
                            requested_quantity: item.quantity_ordered,
                            available_quantity: null,
                            error: itemError.message
                        });
                    }
                }
                
                await internalInvoiceService.recalculateTotals(newInvoiceId, client);
                
                // Log clone history
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id, modification_type, reason, changed_by_user_id, changed_by_system
                    ) VALUES ($1, 'cloned_from', $2, $3, false)
                `, [newInvoiceId, `Cloned from invoice ${origInvoice.invoice_number}`, userId]);
                
                await client.query('COMMIT');
                
                res.json({
                    success: true,
                    invoice_id: newInvoiceId,
                    invoice_number: invoiceNumber,
                    allocation_failures: allocationFailures.length > 0 ? allocationFailures : undefined,
                    // Legacy support: also include errors array for backward compatibility
                    errors: allocationFailures.length > 0 ? allocationFailures.map(f => f.message) : undefined
                });
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error cloning invoice:', error);
            res.status(500).json({ success: false, error: 'Failed to clone invoice', details: error.message });
        }
    }
    
    /**
     * Show invoice details page (Admin UI)
     * GET /admin/invoices/:id
     */
    async showInvoiceDetails(req, res) {
        try {
            const { id } = req.params;
            const userId = req.session.userId || req.user?.id;
            const UserModel = require('../Models/userModel');
            
            // Check user roles
            const isSuperuser = await UserModel.isSuperuser(userId);
            const userRoles = await UserModel.getUserRoles(userId);
            const userRoleNames = userRoles.map(r => r.name || r.role_name).filter(Boolean);
            
            const normalizeRole = (role) => role.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
            
            const isAdmin = isSuperuser || userRoleNames.some(r => r.toLowerCase() === 'administrator');
            const isSalesAdmin = userRoleNames.some(r => r.toLowerCase() === 'sales admin');
            const hasFulfillmentRole = userRoleNames.some(r => {
                const normalized = normalizeRole(r);
                return normalized === 'fulfillment team' || 
                       normalized === 'fulfillment worker' || 
                       normalized === 'fulfillment admin';
            });
            // Only treat as fulfillment-only user if they have fulfillment role BUT NOT Sales Admin/Rep or Admin
            // Users with Sales Admin + Fulfillment should get Sales Admin permissions (write access)
            const isFulfillmentUser = hasFulfillmentRole && !isAdmin && !isSalesAdmin && !userRoleNames.some(r => r.toLowerCase() === 'sales representative');
            const isSalesRep = !isAdmin && !isSalesAdmin && !isFulfillmentUser && userRoleNames.some(r => r.toLowerCase() === 'sales representative');
            
            // Get invoice with location info and check for active scanning session
            const invoice = await query(`
                SELECT 
                    i.*,
                    b.name as buyer_name,
                    l.name as location_name,
                    l.assigned_sales_rep_id as location_assigned_sales_rep_id,
                    COALESCE(b.name, u.username, 'System') as created_by_username,
                    EXISTS(
                        SELECT 1 FROM "ORDERS-scanning-sessions" ss
                        WHERE ss.fk_invoice_id = i.id 
                        AND ss.session_status = 'active'
                    ) as has_active_scanning_session
                FROM "ORDERS-invoices" i
                INNER JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                INNER JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                LEFT JOIN users u ON i.created_by_user_id = u.id
                WHERE i.id = $1
            `, [id]);
            
            // Note: i.* includes shipped_at, so it will be available in invoiceData
            
            if (invoice.rows.length === 0) {
                return res.status(404).send('Invoice not found');
            }
            
            const invoiceData = invoice.rows[0];
            
            // If user is a Sales Rep, check if they have access to this invoice
            if (isSalesRep) {
                const hasAccess = invoiceData.assigned_sales_rep_id === userId || 
                                 invoiceData.location_assigned_sales_rep_id === userId;
                
                if (!hasAccess) {
                    return res.status(403).send('You do not have permission to view this invoice');
                }
            }
            
            // Get line items
            // Fetch line items first, then process in JavaScript to safely handle invalid JSON
            const lineItemsResult = await query(`
                SELECT 
                    li.*,
                    p.name as product_name,
                    p.brand_name,
                    b.batch_name
                FROM "ORDERS-invoice-line-items" li
                INNER JOIN "ORDERS-products" p ON li.fk_master_product_id = p.entry_id
                INNER JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
                WHERE li.fk_invoice_id = $1
                ORDER BY li.line_item_order
            `, [id]);
            
            // Process line items in JavaScript to safely check for partial packages
            // This avoids SQL JSON parsing errors on invalid data
            const lineItems = {
                rows: lineItemsResult.rows.map(item => {
                    let isPartialPackage = false;
                    if (item.specific_package_labels) {
                        try {
                            // Parse the JSONB value (pg returns it as an object or string)
                            const labels = typeof item.specific_package_labels === 'string' 
                                ? JSON.parse(item.specific_package_labels)
                                : item.specific_package_labels;
                            
                            // Check if it's an array with elements or a non-empty string
                            if (Array.isArray(labels) && labels.length > 0) {
                                isPartialPackage = true;
                            } else if (typeof labels === 'string' && labels.trim().length > 0) {
                                isPartialPackage = true;
                            }
                        } catch (e) {
                            // If JSON parsing fails, it's not a valid partial package
                            console.warn(`Invalid JSON in specific_package_labels for line item ${item.id}:`, e.message);
                            isPartialPackage = false;
                        }
                    }
                    return {
                        ...item,
                        is_partial_package: isPartialPackage
                    };
                })
            };
            
            // Get modification history
            const history = await query(`
                SELECT 
                    h.*,
                    u.first_name || ' ' || u.last_name AS changed_by_name,
                    u.email AS changed_by_email
                FROM "ORDERS-invoice-history" h
                LEFT JOIN users u ON h.changed_by_user_id = u.id
                WHERE h.fk_invoice_id = $1
                ORDER BY h.changed_at DESC
            `, [id]);
            
            res.render('admin/invoices/details', {
                title: 'Invoice Details',
                layout: 'layouts/main',
                invoice: invoiceData,
                lineItems: lineItems.rows,
                history: history.rows,
                user: req.session.user,
                isAdmin: isAdmin,
                isSuperuser: isSuperuser,
                isSalesAdmin: isSalesAdmin,
                isSalesRep: isSalesRep,
                isFulfillmentUser: isFulfillmentUser, // Pass fulfillment flag for read-only mode
                userRoles: userRoleNames
            });
        } catch (error) {
            console.error('Error loading invoice details:', error);
            res.status(500).send('Error loading invoice: ' + error.message);
        }
    }

    /**
     * Get products for location (API endpoint for invoice creation UI)
     * GET /api/v1/invoices/products?location_id=123&search=keyword
     */
    async getProductsForLocation(req, res) {
        try {
            const { location_id, search, source = 'Internal', invoice_id } = req.query;
            
            if (!location_id) {
                return res.status(400).json({ success: false, error: 'location_id is required' });
            }
            
            // Determine invoice source - for internal invoices, show all products regardless of batch status
            // Status is only used as a marker for external portal behavior
            let invoiceSource = source;
            if (invoice_id) {
                const invoiceCheck = await query(`
                    SELECT source FROM "ORDERS-invoices" WHERE id = $1
                `, [invoice_id]);
                if (invoiceCheck.rows.length > 0) {
                    invoiceSource = invoiceCheck.rows[0].source || 'Internal';
                }
            }
            
            // For internal invoices, show ALL products with batches (regardless of status)
            // For external invoices, only show products with sellable batches
            // Status is only used as a marker for external portal behavior
            
            // Get products with available batches
            // Note: Products aren't location-specific, but we verify the location exists
            const params = [];
            let paramIndex = 1;
            let queryStr;
            
            // Build base conditions
            // Note: We need to check batch availability, but also include products that match search
            // even if their batches might not be fully available (for internal invoices)
            let baseConditions = `
                WHERE (p.is_archived = FALSE OR p.is_archived IS NULL)
            `;
            
            // For external invoices, only show products with sellable full packages
            // For internal invoices, show products with any available batches (full or partial)
            if (invoiceSource === 'External') {
                baseConditions += ` AND b.status = 'Sellable' 
                    AND b.full_package_count > 0
                    AND (b.quantity - COALESCE(b.allocated_quantity, 0)) > 0`;
            } else {
                // Internal invoices can use both full and partial packages
                // Show products if they have:
                // 1. Available full packages (quantity - allocated > 0 AND full_package_count > 0), OR
                // 2. Partial packages (partial_package_count > 0)
                baseConditions += ` AND (
                    (b.full_package_count > 0 AND (b.quantity - COALESCE(b.allocated_quantity, 0)) > 0)
                    OR 
                    (b.partial_package_count > 0)
                )`;
            }
            
            if (search && search.trim().length > 0) {
                const searchTerm = search.trim();
                const searchPattern = `%${searchTerm}%`;
                const searchTermLower = searchTerm.toLowerCase();
                const searchStartsWith = `${searchTermLower}%`;
                
                baseConditions += ` AND (
                    p.name ILIKE $${paramIndex} OR 
                    COALESCE(p.brand_name, '') ILIKE $${paramIndex} OR 
                    COALESCE(p.cultivar_name, '') ILIKE $${paramIndex} OR
                    COALESCE(p.product_type_name, '') ILIKE $${paramIndex} OR
                    b.batch_name ILIKE $${paramIndex}
                )`;
                params.push(searchPattern);
                const searchPatternParam = paramIndex;
                paramIndex++;
                
                // Add parameters for relevance sorting
                params.push(searchTermLower); // For exact match
                const exactMatchParam = paramIndex;
                paramIndex++;
                
                params.push(searchStartsWith); // For starts with
                const startsWithParam = paramIndex;
                paramIndex++;
                
                // Use subquery to calculate relevance score, then order by it
                // This avoids the DISTINCT + ORDER BY issue
                queryStr = `
                    SELECT 
                        product_id,
                        name,
                        brand_name,
                        product_type_name,
                        category_name,
                        default_price,
                        cultivar_name,
                        cultivar_type_name,
                        relevance_score
                    FROM (
                        SELECT DISTINCT
                            p.entry_id as product_id,
                            p.name,
                            p.brand_name,
                            p.product_type_name,
                            p.category_name,
                            p.default_price,
                            p.cultivar_name,
                            p.cultivar_type_name,
                            CASE 
                                WHEN LOWER(p.name) = $${exactMatchParam} THEN 1
                                WHEN LOWER(COALESCE(p.brand_name, '')) = $${exactMatchParam} THEN 2
                                WHEN LOWER(p.name) LIKE $${startsWithParam} THEN 3
                                WHEN LOWER(COALESCE(p.brand_name, '')) LIKE $${startsWithParam} THEN 4
                                WHEN LOWER(p.name) LIKE $${searchPatternParam} THEN 5
                                WHEN LOWER(COALESCE(p.brand_name, '')) LIKE $${searchPatternParam} THEN 6
                                ELSE 7
                            END as relevance_score
                        FROM "ORDERS-products" p
                        INNER JOIN "ORDERS-batches" b ON p.entry_id = b.fk_master_product_id
                        ${baseConditions}
                    ) ranked_products
                    ORDER BY relevance_score, brand_name, name
                    LIMIT 100
                `;
            } else {
                // No search - simple query without relevance scoring
                queryStr = `
                    SELECT DISTINCT
                        p.entry_id as product_id,
                        p.name,
                        p.brand_name,
                        p.product_type_name,
                        p.category_name,
                        p.default_price,
                        p.cultivar_name,
                        p.cultivar_type_name
                    FROM "ORDERS-products" p
                    INNER JOIN "ORDERS-batches" b ON p.entry_id = b.fk_master_product_id
                    ${baseConditions}
                    ORDER BY p.brand_name, p.name
                    LIMIT 100
                `;
            }
            
            const products = await query(queryStr, params);
            
            res.json({
                success: true,
                products: products.rows,
                count: products.rows.length
            });
        } catch (error) {
            console.error('Error getting products:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Failed to get products',
                message: error.message 
            });
        }
    }

    /**
     * Get batches for a product at a location (API endpoint for invoice creation UI)
     * GET /api/v1/invoices/products/:productId/batches?location_id=123
     */
    async getBatchesForProduct(req, res) {
        try {
            const { productId } = req.params;
            const { location_id } = req.query;
            
            if (!productId || !location_id) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'productId and location_id are required' 
                });
            }
            
            // NOTE: Batch sync is now handled via:
            // 1. Scheduled jobs (automatic sync)
            // 2. "Refresh All Batches" button (manual bulk refresh)
            // 3. "Refresh from METRC" button on product details page (manual single product refresh)
            // This prevents slow API responses on every request
            
            // Get invoice source from query parameter (defaults to 'Internal' for admin interface)
            // If invoice_id is provided, look up the invoice source
            let invoiceSource = req.query.source || 'Internal';
            if (req.query.invoice_id) {
                const invoiceCheck = await query(`
                    SELECT source FROM "ORDERS-invoices" WHERE id = $1
                `, [req.query.invoice_id]);
                if (invoiceCheck.rows.length > 0) {
                    invoiceSource = invoiceCheck.rows[0].source || 'Internal';
                }
            }
            
            // For internal invoices, show ALL batches regardless of status
            // Status is only used as a marker for external portal behavior
            // For external invoices, only show 'Sellable' batches
            const params = [productId];
            let statusCondition = '';
            if (invoiceSource === 'External') {
                statusCondition = 'AND b.status = \'Sellable\'';
            }
            
            const batches = await query(`
                SELECT 
                    b.id,
                    b.batch_name,
                    b.quantity,
                    b.allocated_quantity,
                    (b.quantity - b.allocated_quantity) as available_quantity,
                    COALESCE(b.override_price, p.default_price, 0) as unit_price,
                    b.status,
                    b.full_package_count,
                    b.partial_package_count,
                    b.partial_package_details
                FROM "ORDERS-batches" b
                INNER JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
                WHERE b.fk_master_product_id = $1
                  ${statusCondition}
                  AND (
                      -- Show batches with available full packages
                      (b.quantity - b.allocated_quantity) > 0
                      OR
                      -- OR show batches with partial packages (even if no full packages available)
                      (b.partial_package_count > 0 AND b.partial_package_details IS NOT NULL)
                  )
                ORDER BY b.created_at DESC
            `, params);
            
            res.json({
                success: true,
                batches: batches.rows
            });
        } catch (error) {
            console.error('Error getting batches:', error);
            res.status(500).json({ success: false, error: 'Failed to get batches' });
        }
    }

    /**
     * Create internal invoice (API endpoint for invoice creation UI)
     * POST /api/v1/invoices/internal
     */
    async createInternalInvoice(req, res) {
        try {
            const {
                buyer_id,
                location_id,
                line_items = [],
                customer_notes,
                internal_notes,
                status
            } = req.body;
            
            const userId = req.session.userId || req.user?.id;
            const UserModel = require('../Models/userModel');
            
            if (!buyer_id || !location_id) {
                return res.status(400).json({
                    success: false,
                    error: 'buyer_id and location_id are required'
                });
            }

            const requestedStatus = typeof status === 'string' ? status.trim() : 'Draft';
            const allowedStatuses = ['Draft', 'Pending_Approval'];
            let targetStatus = allowedStatuses.includes(requestedStatus) ? requestedStatus : 'Draft';

            // Internal invoices should go directly to Approved, not Pending_Approval
            // Only external invoices need approval workflow
            if (targetStatus === 'Pending_Approval') {
                targetStatus = 'Approved';
            }

            if (targetStatus !== 'Draft' && (!Array.isArray(line_items) || line_items.length === 0)) {
                return res.status(400).json({
                    success: false,
                    error: 'At least one line item is required when submitting the invoice'
                });
            }
            
            // Check if user is Sales Rep and validate access to buyer/location
            const isSuperuser = await UserModel.isSuperuser(userId);
            const userRoles = await UserModel.getUserRoles(userId);
            const userRoleNames = userRoles.map(r => r.name || r.role_name).filter(Boolean);
            
            const isAdmin = isSuperuser || userRoleNames.some(r => r.toLowerCase() === 'administrator');
            const isSalesAdmin = userRoleNames.some(r => r.toLowerCase() === 'sales admin');
            const isSalesRep = !isAdmin && !isSalesAdmin && userRoleNames.some(r => r.toLowerCase() === 'sales representative');
            
            // If Sales Rep, verify they have access to this buyer/location
            if (isSalesRep) {
                // Check if assigned_sales_rep_id column exists on buyer_locations table
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
                
                let hasAccess = false;
                if (hasLocationSalesRepColumn) {
                    // Check if location is assigned to this sales rep OR buyer is assigned to this sales rep
                    const accessCheck = await query(`
                        SELECT 
                            l.entry_id,
                            l.assigned_sales_rep_id,
                            ba.fk_sales_rep_id
                        FROM "ORDERS-buyer_locations" l
                        LEFT JOIN "ORDERS-buyer_sales_rep_assignments" ba ON l.orders_buyer_id = ba.fk_buyer_id
                        LEFT JOIN "ORDERS-sales_reps" sr ON ba.fk_sales_rep_id = sr.entry_id
                        WHERE l.entry_id = $1
                          AND (
                              l.assigned_sales_rep_id = $2
                              OR sr.email = (SELECT email FROM users WHERE id = $2)
                          )
                    `, [parseInt(location_id), userId]);
                    hasAccess = accessCheck.rows.length > 0;
                } else {
                    // Fallback: check buyer assignments only
                    const accessCheck = await query(`
                        SELECT ba.entry_id
                        FROM "ORDERS-buyer_sales_rep_assignments" ba
                        INNER JOIN "ORDERS-sales_reps" sr ON ba.fk_sales_rep_id = sr.entry_id
                        WHERE ba.fk_buyer_id = $1
                          AND sr.email = (SELECT email FROM users WHERE id = $2)
                    `, [parseInt(buyer_id), userId]);
                    hasAccess = accessCheck.rows.length > 0;
                }
                
                if (!hasAccess) {
                    return res.status(403).json({
                        success: false,
                        error: 'Forbidden',
                        message: 'You do not have permission to create invoices for this buyer/location'
                    });
                }
            }
            
            const internalInvoiceService = require('../Services/internalInvoiceService');
            
            console.log('📝 Creating internal invoice:', {
                userId,
                buyer_id,
                location_id,
                line_items_count: line_items.length,
                targetStatus
            });
            
            const result = await internalInvoiceService.createInvoice(userId, {
                fk_buyer_id: parseInt(buyer_id),
                fk_location_id: parseInt(location_id),
                line_items: line_items.map(item => ({
                    fk_batch_id: item.fk_batch_id,
                    quantity: parseInt(item.quantity),
                    partial_packages_selected: item.partial_packages_selected || null,
                    manual_line_total: item.manual_line_total !== undefined && item.manual_line_total !== null 
                        ? parseFloat(item.manual_line_total) 
                        : undefined
                })),
                customer_notes: customer_notes || null,
                internal_notes: internal_notes || null
            });

            let finalStatus = 'Draft';

            if (targetStatus !== 'Draft') {
                try {
                    const invoiceStateMachine = require('../Services/invoiceStateMachineService');
                    const transition = await invoiceStateMachine.transitionTo(
                        result.invoice_id,
                        targetStatus,
                        userId,
                        `Invoice submitted for ${targetStatus.toLowerCase().replace(/_/g, ' ')} during creation`
                    );

                    if (!transition.success) {
                        return res.status(400).json({
                            success: false,
                            error: transition.error || `Failed to transition invoice to ${targetStatus}`,
                            valid_transitions: transition.validTransitions || []
                        });
                    }

                    finalStatus = transition.newStatus || targetStatus;
                } catch (transitionError) {
                    console.error('Error transitioning invoice status:', transitionError);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to finalize invoice status',
                        details: transitionError.message
                    });
                }
            }
            
            res.json({
                success: true,
                invoice_id: result.invoice_id,
                invoice_number: result.invoice_number,
                status: finalStatus
            });

            try {
                const eventName = finalStatus === 'Draft'
                    ? 'invoice_draft_created'
                    : 'invoice_created_internal';

                await websocketService.broadcastInvoiceEvent(result.invoice_id, eventName, {
                    buyer_id: parseInt(buyer_id),
                    location_id: parseInt(location_id),
                    status: finalStatus
                });
            } catch (wsError) {
                console.error('WebSocket broadcast error (internal invoice create):', wsError.message);
            }
        } catch (error) {
            console.error('❌ Error in createInternalInvoice controller:');
            console.error('  - Error message:', error.message);
            console.error('  - Error stack:', error.stack);
            if (error.originalError) {
                console.error('  - Original error:', error.originalError.message);
            }
            if (error.context) {
                console.error('  - Context:', error.context);
            }
            
            // Extract user-friendly error message
            let errorMessage = error.message || 'Failed to create invoice';
            let errorDetails = error.message;
            
            // Handle specific error types
            if (error.message && error.message.includes('transaction is aborted')) {
                errorMessage = 'Database transaction error occurred';
                errorDetails = 'A database error occurred during invoice creation. Please try again.';
            } else if (error.message && error.message.includes('Insufficient inventory')) {
                errorMessage = 'Insufficient inventory';
                errorDetails = error.message;
            } else if (error.message && error.message.includes('Batch not found')) {
                errorMessage = 'Batch not found';
                errorDetails = error.message;
            } else if (error.message && error.message.includes('not authorized')) {
                errorMessage = 'Authorization failed';
                errorDetails = error.message;
            }
            
            res.status(500).json({
                success: false,
                error: errorMessage,
                details: errorDetails
            });
        }
    }

    /**
     * Add line item to existing draft invoice
     * POST /api/v1/invoices/:id/line-items
     */
    async addLineItem(req, res) {
        try {
            const { id } = req.params;
            const { fk_batch_id, quantity, partial_packages_selected, manual_line_total } = req.body;
            const userId = req.session.userId || req.user?.id;

            if (!fk_batch_id || !quantity) {
                return res.status(400).json({
                    success: false,
                    error: 'fk_batch_id and quantity are required'
                });
            }

            // Verify invoice exists and is in Draft status
            const invoice = await query(`
                SELECT id, status, fk_buyer_id, fk_location_id
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [id]);

            if (invoice.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Invoice not found'
                });
            }

            const invoiceStatus = invoice.rows[0].status;
            
            // Explicitly block terminal states
            const terminalStates = ['Paid', 'Cancelled', 'Fully_Rejected'];
            if (terminalStates.includes(invoiceStatus)) {
                return res.status(403).json({
                    success: false,
                    error: `Cannot modify invoice in terminal state: ${invoiceStatus}. Invoice is locked.`
                });
            }

            // Check if fulfillment has started work on this invoice
            const fulfillmentCheck = await query(`
                SELECT 
                    i.fulfillment_accepted_by,
                    EXISTS(
                        SELECT 1 FROM "ORDERS-scanning-sessions" ss
                        WHERE ss.fk_invoice_id = i.id 
                        AND ss.session_status = 'active'
                    ) as has_active_scanning_session
                FROM "ORDERS-invoices" i
                WHERE i.id = $1
            `, [id]);

            const fulfillmentStarted = fulfillmentCheck.rows.length > 0 && 
                (fulfillmentCheck.rows[0].fulfillment_accepted_by !== null || 
                 fulfillmentCheck.rows[0].has_active_scanning_session === true);

            // Allow adding line items if:
            // 1. Status is Draft, Pending_Approval, Approved (before fulfillment starts)
            // 2. Status is Fulfillment_Issue (fulfillment kicked it back)
            const editableStatuses = ['Draft', 'Pending_Approval', 'Approved', 'Fulfillment_Issue'];
            if (!editableStatuses.includes(invoiceStatus)) {
                return res.status(400).json({
                    success: false,
                    error: `Line items can only be added when invoice is in Draft, Pending Approval, Approved, or Fulfillment Issue status. Current status: ${invoiceStatus}`
                });
            }

            // Block if fulfillment has started (unless it's Fulfillment_Issue - fulfillment kicked it back)
            if (fulfillmentStarted && invoiceStatus !== 'Fulfillment_Issue') {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot modify invoice - fulfillment team has started working on this order. If changes are needed, fulfillment must report an issue first.'
                });
            }

            const internalInvoiceService = require('../Services/internalInvoiceService');
            const client = await internalInvoiceService.pool.connect();

            try {
                await client.query('BEGIN');

                const lineItemId = await internalInvoiceService.addLineItem(
                    parseInt(id),
                    {
                        fk_batch_id: parseInt(fk_batch_id),
                        quantity: parseInt(quantity),
                        partial_packages_selected: partial_packages_selected || null,
                        manual_line_total: manual_line_total !== undefined && manual_line_total !== null
                            ? parseFloat(manual_line_total)
                            : undefined
                    },
                    userId,
                    client
                );

                // Recalculate totals
                await internalInvoiceService.recalculateTotals(parseInt(id), client);

                await client.query('COMMIT');

                // Get updated invoice totals
                const updatedInvoice = await query(`
                    SELECT subtotal, total, discount_amount, credit_applied
                    FROM "ORDERS-invoices"
                    WHERE id = $1
                `, [id]);

                try {
                    await websocketService.broadcastInvoiceEvent(parseInt(id), 'line_item_added', {
                        buyer_id: invoice.rows[0].fk_buyer_id,
                        location_id: invoice.rows[0].fk_location_id,
                        line_item_id: lineItemId,
                        totals: updatedInvoice.rows[0]
                    });
                } catch (wsError) {
                    console.error('WebSocket broadcast error (line item added, internal):', wsError.message);
                }

                try {
                    await websocketService.broadcastInvoiceEvent(parseInt(id), 'line_item_updated', {
                        buyer_id: invoice.rows[0].fk_buyer_id,
                        location_id: invoice.rows[0].fk_location_id,
                        line_item_id: lineItemId,
                        totals: updatedInvoice.rows[0]
                    });
                } catch (wsError) {
                    console.error('WebSocket broadcast error (line item added, internal):', wsError.message);
                }

                res.json({
                    success: true,
                    message: 'Line item added successfully',
                    line_item_id: lineItemId,
                    invoice: updatedInvoice.rows[0]
                });
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error adding line item:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to add line item',
                details: error.message
            });
        }
    }

    /**
     * Update line item quantity
     * PATCH /api/v1/invoices/:id/line-items/:lineItemId
     */
    async updateLineItem(req, res) {
        try {
            const { id, lineItemId } = req.params;
            const { quantity, modification_reason, manual_line_total, unit_price, line_total } = req.body;
            const userId = req.session.userId || req.user?.id;

            // Check if this is a price-only update (for Fulfillment_Accepted status)
            // Can be either unit_price OR line_total (for partial packages)
            const isPriceOnlyUpdate = ((unit_price !== null && unit_price !== undefined) || 
                                      (line_total !== null && line_total !== undefined)) && 
                                     (quantity === null || quantity === undefined);

            // Handle quantity = 0 as remove line item (only if not price-only update)
            if (!isPriceOnlyUpdate) {
                if (!quantity || quantity < 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'Valid quantity is required (use DELETE endpoint to remove line item)'
                    });
                }

                // If quantity is 0, treat as remove line item
                if (parseInt(quantity) === 0) {
                    // Call removeLineItem method directly with same request/response
                    // This handles the removal properly with all the same validations
                    return this.removeLineItem(req, res);
                }
            }

            const internalInvoiceService = require('../Services/internalInvoiceService');
            const allocationService = require('../Services/allocationService');
            const client = await internalInvoiceService.pool.connect();

            try {
                await client.query('BEGIN');

                // Get current line item with invoice manifest info
                // Include specific_package_labels to check if it's a partial package
                const lineItem = await client.query(`
                    SELECT 
                        li.*,
                        i.status,
                        i.fk_location_id,
                        i.fk_buyer_id,
                        i.metrc_manifest_numbers,
                        i.manifest_created_at,
                        CASE 
                            WHEN li.specific_package_labels IS NOT NULL 
                                 AND li.specific_package_labels != 'null'::jsonb
                                 AND jsonb_array_length(li.specific_package_labels) > 0
                            THEN true
                            ELSE false
                        END as is_partial_package
                    FROM "ORDERS-invoice-line-items" li
                    INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                    WHERE li.id = $1 AND li.fk_invoice_id = $2
                    FOR UPDATE
                `, [lineItemId, id]);

                if (lineItem.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
                        success: false,
                        error: 'Line item not found'
                    });
                }

                const item = lineItem.rows[0];

                // Explicitly block terminal states
                const terminalStates = ['Paid', 'Cancelled', 'Fully_Rejected'];
                if (terminalStates.includes(item.status)) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({
                        success: false,
                        error: `Cannot modify invoice in terminal state: ${item.status}. Invoice is locked.`
                    });
                }

                // Check if fulfillment has started work on this invoice
                // Fulfillment starts when: fulfillment_accepted_by is set OR there's an active scanning session
                const fulfillmentCheck = await client.query(`
                    SELECT 
                        i.fulfillment_accepted_by,
                        EXISTS(
                            SELECT 1 FROM "ORDERS-scanning-sessions" ss
                            WHERE ss.fk_invoice_id = i.id 
                            AND ss.session_status = 'active'
                        ) as has_active_scanning_session
                    FROM "ORDERS-invoices" i
                    WHERE i.id = $1
                `, [id]);

                const fulfillmentStarted = fulfillmentCheck.rows.length > 0 && 
                    (fulfillmentCheck.rows[0].fulfillment_accepted_by !== null || 
                     fulfillmentCheck.rows[0].has_active_scanning_session === true);

                // Allow editing if:
                // 1. Status is Draft, Pending_Approval, Approved (before fulfillment starts)
                // 2. Status is Fulfillment_Issue (fulfillment kicked it back)
                // 3. Status is Fulfillment_Accepted (only for price-only updates)
                const editableStatuses = ['Draft', 'Pending_Approval', 'Approved', 'Fulfillment_Issue'];
                const isEditableStatus = editableStatuses.includes(item.status);
                const isFulfillmentAccepted = item.status === 'Fulfillment_Accepted';
                
                // For Fulfillment_Accepted, only allow price-only updates (to fix 0 price issues)
                if (isFulfillmentAccepted && !isPriceOnlyUpdate) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: `For invoices in Fulfillment_Accepted status, only price updates are allowed. Cannot modify quantity.`
                    });
                }
                
                if (!isEditableStatus && !isFulfillmentAccepted) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: `Line items can only be updated when invoice is in Draft, Pending Approval, Approved, Fulfillment_Accepted (price only), or Fulfillment Issue status. Current status: ${item.status}`
                    });
                }

                // Block if fulfillment has started (unless it's Fulfillment_Issue or price-only update for Fulfillment_Accepted)
                if (fulfillmentStarted && item.status !== 'Fulfillment_Issue' && !(isFulfillmentAccepted && isPriceOnlyUpdate)) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'Cannot modify invoice - fulfillment team has started working on this order. If changes are needed, fulfillment must report an issue first.'
                    });
                }

                const currentQuantity = parseInt(item.quantity_ordered);
                const currentAllocated = parseInt(item.quantity_allocated || 0);
                const newQuantity = isPriceOnlyUpdate ? currentQuantity : parseInt(quantity);
                const quantityDelta = isPriceOnlyUpdate ? 0 : (newQuantity - currentQuantity);

                // Store original quantity if this is a modification (Module 4 requirement)
                // Only store original_quantity if it hasn't been set before (first modification)
                const originalQuantity = item.original_quantity || currentQuantity;
                
                // Determine modification reason
                // Use provided reason, or default based on context
                let modReason = modification_reason;
                if (!modReason) {
                    if (isPriceOnlyUpdate) {
                        modReason = 'Price updated for METRC compliance (was 0)';
                    } else if (item.status === 'Fulfillment_Issue') {
                        modReason = 'Modified to resolve fulfillment issue';
                    } else {
                        modReason = 'Line item quantity updated';
                    }
                }

                // Skip batch allocation changes for price-only updates
                // Check batch availability if increasing quantity
                if (!isPriceOnlyUpdate && quantityDelta > 0) {
                    const batch = await client.query(`
                        SELECT quantity, allocated_quantity
                        FROM "ORDERS-batches"
                        WHERE id = $1
                        FOR UPDATE
                    `, [item.fk_batch_id]);

                    if (batch.rows.length === 0) {
                        await client.query('ROLLBACK');
                        return res.status(404).json({
                            success: false,
                            error: 'Batch not found'
                        });
                    }

                    const available = batch.rows[0].quantity - batch.rows[0].allocated_quantity;
                    
                    if (available < quantityDelta) {
                        await client.query('ROLLBACK');
                        return res.status(400).json({
                            success: false,
                            error: `Insufficient inventory. Available: ${available}, Requested: ${quantityDelta}`
                        });
                    }

                    // Allocate additional quantity
                    await client.query(`
                        UPDATE "ORDERS-batches"
                        SET allocated_quantity = allocated_quantity + $1
                        WHERE id = $2
                    `, [quantityDelta, item.fk_batch_id]);

                    // Log batch history
                    await client.query(`
                        INSERT INTO "ORDERS-batch-history" (
                            batch_id, change_type, field_name,
                            old_value, new_value, reason,
                            related_invoice_id, changed_by_system
                        ) VALUES ($1, 'allocation_increased', 'allocated_quantity',
                                  $2, $3, 'Line item quantity increased', $4, true)
                    `, [
                        item.fk_batch_id,
                        batch.rows[0].allocated_quantity,
                        batch.rows[0].allocated_quantity + quantityDelta,
                        id
                    ]);
                } else if (!isPriceOnlyUpdate && quantityDelta < 0) {
                    // Release allocation if decreasing quantity
                    const releaseQty = Math.abs(quantityDelta);
                    
                    // Get current allocated_quantity to prevent negative values
                    const batchCheck = await client.query(`
                        SELECT allocated_quantity
                        FROM "ORDERS-batches"
                        WHERE id = $1
                        FOR UPDATE
                    `, [item.fk_batch_id]);
                    
                    if (batchCheck.rows.length > 0) {
                        const currentAllocated = parseInt(batchCheck.rows[0].allocated_quantity || 0);
                        const actualReleaseQty = Math.min(releaseQty, currentAllocated);
                        
                        if (actualReleaseQty > 0) {
                            await client.query(`
                                UPDATE "ORDERS-batches"
                                SET allocated_quantity = GREATEST(0, allocated_quantity - $1)
                                WHERE id = $2
                            `, [actualReleaseQty, item.fk_batch_id]);

                            // Log batch history
                            await client.query(`
                                INSERT INTO "ORDERS-batch-history" (
                                    batch_id, change_type, field_name,
                                    old_value, new_value, reason,
                                    related_invoice_id, changed_by_system
                                ) VALUES ($1, 'allocation_decreased', 'allocated_quantity',
                                          $2, $3, 'Line item quantity decreased', $4, true)
                            `, [
                                item.fk_batch_id,
                                currentAllocated.toString(),
                                Math.max(0, currentAllocated - actualReleaseQty).toString(),
                                id
                            ]);
                        } else {
                            console.warn(`⚠️  Cannot release allocation for batch ${item.fk_batch_id}: current allocated is ${currentAllocated}, trying to release ${releaseQty}`);
                        }
                    }
                }

                // Update line item with modification tracking (Module 4 requirement)
                let unitPrice = parseFloat(item.unit_price);
                let newLineTotal;
                const isPartialPackage = item.is_partial_package === true;
                
                // Handle price-only updates for Fulfillment_Accepted
                if (isPriceOnlyUpdate) {
                    // For partial packages, prefer line_total; for full packages, use unit_price
                    if (isPartialPackage && line_total !== null && line_total !== undefined) {
                        // Partial package: set line_total directly
                        newLineTotal = parseFloat(line_total);
                        // Ensure line_total is positive (METRC requirement)
                        if (newLineTotal <= 0) {
                            await client.query('ROLLBACK');
                            return res.status(400).json({
                                success: false,
                                error: 'Line total must be greater than 0 for METRC compliance'
                            });
                        }
                        // Calculate unit_price from line_total for display (quantity might be in grams)
                        unitPrice = currentQuantity > 0 ? newLineTotal / currentQuantity : 0;
                    } else if (unit_price !== null && unit_price !== undefined) {
                        // Full package or unit_price provided: use unit_price
                        unitPrice = parseFloat(unit_price);
                        // Ensure unit_price is positive (METRC requirement)
                        if (unitPrice <= 0) {
                            await client.query('ROLLBACK');
                            return res.status(400).json({
                                success: false,
                                error: 'Unit price must be greater than 0 for METRC compliance'
                            });
                        }
                        // Calculate line_total from new unit_price
                        newLineTotal = unitPrice * currentQuantity - parseFloat(item.line_discount_amount || 0);
                        newLineTotal = Math.max(0, newLineTotal);
                    } else if (line_total !== null && line_total !== undefined) {
                        // line_total provided for non-partial (fallback)
                        newLineTotal = parseFloat(line_total);
                        if (newLineTotal <= 0) {
                            await client.query('ROLLBACK');
                            return res.status(400).json({
                                success: false,
                                error: 'Line total must be greater than 0 for METRC compliance'
                            });
                        }
                        unitPrice = currentQuantity > 0 ? newLineTotal / currentQuantity : 0;
                    } else {
                        await client.query('ROLLBACK');
                        return res.status(400).json({
                            success: false,
                            error: 'Either unit_price or line_total must be provided for price update'
                        });
                    }
                } else if (manual_line_total !== null && manual_line_total !== undefined) {
                    // If manual_line_total is provided, use it for price override
                    newLineTotal = parseFloat(manual_line_total);
                    // Ensure line_total is non-negative (can be 0 for partial packages with no price)
                    newLineTotal = Math.max(0, newLineTotal);
                    // Calculate unit price from total (for display purposes)
                    unitPrice = newQuantity > 0 ? newLineTotal / newQuantity : 0;
                } else {
                    // Standard calculation
                    newLineTotal = unitPrice * newQuantity - parseFloat(item.line_discount_amount || 0);
                    // Ensure line_total is non-negative
                    newLineTotal = Math.max(0, newLineTotal);
                }
                
                // Set fulfillment_issue_modification flag if invoice is in Fulfillment_Issue status
                const isFulfillmentIssueMod = item.status === 'Fulfillment_Issue';
                
                // Check if fulfillment_issue_modification column exists
                const columnCheck = await client.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'ORDERS-invoice-line-items' 
                    AND column_name = 'fulfillment_issue_modification'
                `);
                const hasColumn = columnCheck.rows.length > 0;

                // Update unit_price if manual pricing was used
                // For price-only updates, don't change quantity fields
                // Use sequential placeholders to avoid parameter type issues
                if (isPriceOnlyUpdate) {
                    // Price-only update: only update price and total
                    const priceUpdateFields = hasColumn && isFulfillmentIssueMod
                        ? `unit_price = $1,
                           line_total = $2,
                           was_modified = true,
                           modification_reason = $3,
                           modified_at = NOW(),
                           modified_by = $4,
                           updated_at = NOW(),
                           fulfillment_issue_modification = true`
                        : `unit_price = $1,
                           line_total = $2,
                           was_modified = true,
                           modification_reason = $3,
                           modified_at = NOW(),
                           modified_by = $4,
                           updated_at = NOW()`;
                    
                    await client.query(`
                        UPDATE "ORDERS-invoice-line-items"
                        SET ${priceUpdateFields}
                        WHERE id = $5
                    `, [unitPrice, newLineTotal, modReason, userId, lineItemId]);
                } else {
                    // Full update: includes quantity changes
                    const fullUpdateFields = hasColumn && isFulfillmentIssueMod
                        ? `quantity_ordered = $1,
                           quantity_allocated = $1,
                           unit_price = $7,
                           line_total = $2,
                           was_modified = true,
                           original_quantity = $3,
                           modification_reason = $4,
                           modified_at = NOW(),
                           modified_by = $5,
                           updated_at = NOW(),
                           fulfillment_issue_modification = true`
                        : `quantity_ordered = $1,
                           quantity_allocated = $1,
                           unit_price = $7,
                           line_total = $2,
                           was_modified = true,
                           original_quantity = $3,
                           modification_reason = $4,
                           modified_at = NOW(),
                           modified_by = $5,
                           updated_at = NOW()`;
                    
                    await client.query(`
                        UPDATE "ORDERS-invoice-line-items"
                        SET ${fullUpdateFields}
                        WHERE id = $6
                    `, [newQuantity, newLineTotal, originalQuantity, modReason, userId, lineItemId, unitPrice]);
                }

                await lineItemHistoryService.addLineItemHistoryEntry({
                    client,
                    lineItemId: parseInt(lineItemId, 10),
                    modificationType: 'quantity_changed', // Use 'quantity_changed' for both quantity and price changes
                    fieldChanged: isPriceOnlyUpdate ? 'unit_price' : 'quantity_ordered',
                    oldValue: isPriceOnlyUpdate ? parseFloat(item.unit_price).toString() : currentQuantity.toString(),
                    newValue: isPriceOnlyUpdate ? unitPrice.toString() : newQuantity.toString(),
                    reason: modReason,
                    changedByUserId: userId,
                    changedBySystem: false
                });

                // Recalculate invoice totals
                await internalInvoiceService.recalculateTotals(parseInt(id), client);

                // Log to invoice history with modification reason
                // Mark as triggered by fulfillment issue if invoice is in that state
                // Note: Using 'line_item_quantity_changed' for both quantity and price changes
                // since 'line_item_price_changed' doesn't exist in the enum
                const triggeredByIssue = item.status === 'Fulfillment_Issue';
                const historyFieldName = isPriceOnlyUpdate ? 'unit_price' : 'quantity_ordered';
                const historyModType = 'line_item_quantity_changed'; // Use existing enum value for all line item changes
                const historyOldValue = isPriceOnlyUpdate ? parseFloat(item.unit_price).toString() : currentQuantity.toString();
                const historyNewValue = isPriceOnlyUpdate ? unitPrice.toString() : newQuantity.toString();
                
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id, modification_type, field_name,
                        old_value, new_value, reason, changed_by_user_id, triggered_by_fulfillment_issue
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [
                    id, 
                    historyModType,
                    `line_item_${lineItemId}_${historyFieldName}`, 
                    historyOldValue, 
                    historyNewValue, 
                    modReason,
                    userId,
                    triggeredByIssue
                ]);

                await client.query('COMMIT');

                // Broadcast inventory update (skip for price-only updates)
                if (!isPriceOnlyUpdate && quantityDelta !== 0) {
                    try {
                        const batch = await client.query(`
                            SELECT quantity, allocated_quantity
                            FROM "ORDERS-batches"
                            WHERE id = $1
                        `, [item.fk_batch_id]);

                        if (batch.rows.length > 0) {
                            const newAvailable = batch.rows[0].quantity - batch.rows[0].allocated_quantity;
                            await allocationService.broadcastInventoryUpdate(item.fk_batch_id, newAvailable);
                        }
                    } catch (wsError) {
                        console.error('WebSocket broadcast error (non-critical):', wsError.message);
                    }
                }

                // Get updated invoice
                const updatedInvoice = await query(`
                    SELECT subtotal, total, discount_amount, credit_applied
                    FROM "ORDERS-invoices"
                    WHERE id = $1
                `, [id]);

                try {
                    await websocketService.broadcastInvoiceEvent(parseInt(id), 'line_item_updated', {
                        buyer_id: item.fk_buyer_id,
                        location_id: item.fk_location_id,
                        line_item_id: parseInt(lineItemId),
                        quantity: newQuantity,
                        totals: updatedInvoice.rows[0]
                    });
                } catch (wsError) {
                    console.error('WebSocket broadcast error (line item updated, internal):', wsError.message);
                }

                res.json({
                    success: true,
                    message: 'Line item updated successfully',
                    invoice: updatedInvoice.rows[0]
                });
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error updating line item:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update line item',
                details: error.message
            });
        }
    }

    /**
     * Remove line item from invoice
     * DELETE /api/v1/invoices/:id/line-items/:lineItemId
     */
    async removeLineItem(req, res) {
        try {
            const { id, lineItemId } = req.params;
            const userId = req.session.userId || req.user?.id;

            const internalInvoiceService = require('../Services/internalInvoiceService');
            const allocationService = require('../Services/allocationService');
            const client = await internalInvoiceService.pool.connect();

            try {
                await client.query('BEGIN');

                // Get line item details with invoice manifest info
                const lineItem = await client.query(`
                    SELECT 
                        li.*,
                        i.status,
                        i.fk_buyer_id,
                        i.fk_location_id,
                        i.metrc_manifest_numbers,
                        i.manifest_created_at
                    FROM "ORDERS-invoice-line-items" li
                    INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                    WHERE li.id = $1 AND li.fk_invoice_id = $2
                    FOR UPDATE
                `, [lineItemId, id]);

                if (lineItem.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
                        success: false,
                        error: 'Line item not found'
                    });
                }

                const item = lineItem.rows[0];

                // Explicitly block terminal states
                const terminalStates = ['Paid', 'Cancelled', 'Fully_Rejected'];
                if (terminalStates.includes(item.status)) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({
                        success: false,
                        error: `Cannot modify invoice in terminal state: ${item.status}. Invoice is locked.`
                    });
                }

                // Check if fulfillment has started work on this invoice
                const fulfillmentCheck = await client.query(`
                    SELECT 
                        i.fulfillment_accepted_by,
                        EXISTS(
                            SELECT 1 FROM "ORDERS-scanning-sessions" ss
                            WHERE ss.fk_invoice_id = i.id 
                            AND ss.session_status = 'active'
                        ) as has_active_scanning_session
                    FROM "ORDERS-invoices" i
                    WHERE i.id = $1
                `, [id]);

                const fulfillmentStarted = fulfillmentCheck.rows.length > 0 && 
                    (fulfillmentCheck.rows[0].fulfillment_accepted_by !== null || 
                     fulfillmentCheck.rows[0].has_active_scanning_session === true);

                // Allow removing line items if:
                // 1. Status is Draft, Pending_Approval, Approved (before fulfillment starts)
                // 2. Status is Fulfillment_Issue (fulfillment kicked it back)
                const editableStatuses = ['Draft', 'Pending_Approval', 'Approved', 'Fulfillment_Issue'];
                if (!editableStatuses.includes(item.status)) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: `Line items can only be removed when invoice is in Draft, Pending Approval, Approved, or Fulfillment Issue status. Current status: ${item.status}`
                    });
                }

                // Block if fulfillment has started (unless it's Fulfillment_Issue - fulfillment kicked it back)
                if (fulfillmentStarted && item.status !== 'Fulfillment_Issue') {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'Cannot modify invoice - fulfillment team has started working on this order. If changes are needed, fulfillment must report an issue first.'
                    });
                }

                const allocatedQty = parseInt(item.quantity_allocated || 0);

                // Release allocation
                if (allocatedQty > 0) {
                    // Get current allocated_quantity to prevent negative values
                    const batchCheck = await client.query(`
                        SELECT allocated_quantity
                        FROM "ORDERS-batches"
                        WHERE id = $1
                        FOR UPDATE
                    `, [item.fk_batch_id]);
                    
                    if (batchCheck.rows.length > 0) {
                        const currentAllocated = parseInt(batchCheck.rows[0].allocated_quantity || 0);
                        const releaseQty = Math.min(allocatedQty, currentAllocated);
                        
                        if (releaseQty > 0) {
                            await client.query(`
                                UPDATE "ORDERS-batches"
                                SET allocated_quantity = GREATEST(0, allocated_quantity - $1)
                                WHERE id = $2
                            `, [releaseQty, item.fk_batch_id]);

                            // Log batch history
                            await client.query(`
                                INSERT INTO "ORDERS-batch-history" (
                                    batch_id, change_type, field_name,
                                    old_value, new_value, reason,
                                    related_invoice_id, changed_by_system
                                ) VALUES ($1, 'allocation_decreased', 'allocated_quantity',
                                          $2, $3, 'Line item removed', $4, true)
                            `, [
                                item.fk_batch_id,
                                currentAllocated.toString(),
                                Math.max(0, currentAllocated - releaseQty).toString(),
                                id
                            ]);
                        } else {
                            console.warn(`⚠️  Cannot release allocation for batch ${item.fk_batch_id}: current allocated is ${currentAllocated}, trying to release ${allocatedQty}`);
                        }
                    }
                }

                // Delete line item
                await client.query(`
                    DELETE FROM "ORDERS-invoice-line-items"
                    WHERE id = $1
                `, [lineItemId]);

                // Recalculate invoice totals
                await internalInvoiceService.recalculateTotals(parseInt(id), client);

                // Log to invoice history
                // Mark as triggered by fulfillment issue if invoice is in that state
                const triggeredByIssue = item.status === 'Fulfillment_Issue';
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id, modification_type, field_name,
                        old_value, new_value, reason, changed_by_user_id, triggered_by_fulfillment_issue
                    ) VALUES ($1, 'line_item_removed', $2, $3, NULL, 'Line item removed', $4, $5)
                `, [id, `line_item_${lineItemId}`, item.quantity_ordered.toString(), userId, triggeredByIssue]);

                await client.query('COMMIT');

                // Broadcast inventory update
                if (allocatedQty > 0) {
                    try {
                        const batch = await client.query(`
                            SELECT quantity, allocated_quantity
                            FROM "ORDERS-batches"
                            WHERE id = $1
                        `, [item.fk_batch_id]);

                        if (batch.rows.length > 0) {
                            const newAvailable = batch.rows[0].quantity - batch.rows[0].allocated_quantity;
                            await allocationService.broadcastInventoryUpdate(item.fk_batch_id, newAvailable);
                        }
                    } catch (wsError) {
                        console.error('WebSocket broadcast error (non-critical):', wsError.message);
                    }
                }

                // Get updated invoice
                const updatedInvoice = await query(`
                    SELECT subtotal, total, discount_amount, credit_applied
                    FROM "ORDERS-invoices"
                    WHERE id = $1
                `, [id]);

                try {
                    await websocketService.broadcastInvoiceEvent(parseInt(id), 'line_item_removed', {
                        buyer_id: item.fk_buyer_id,
                        location_id: item.fk_location_id,
                        removed_line_item_id: parseInt(lineItemId),
                        totals: updatedInvoice.rows[0]
                    });
                } catch (wsError) {
                    console.error('WebSocket broadcast error (line item removed, internal):', wsError.message);
                }

                res.json({
                    success: true,
                    message: 'Line item removed successfully',
                    invoice: updatedInvoice.rows[0]
                });
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error removing line item:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to remove line item',
                details: error.message
            });
        }
    }

    /**
     * Submit invoice for fulfillment
     * POST /api/v1/invoices/:id/submit
     */
    async submitForFulfillment(req, res) {
        try {
            const { id } = req.params;
            const userId = req.session.userId || req.user?.id;

            // Transition to Approved (internal orders go straight to Approved)
            const result = await invoiceStateMachine.transitionTo(
                id,
                'Approved',
                userId,
                'Invoice submitted for fulfillment'
            );

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.error || 'Failed to submit invoice',
                    validTransitions: result.validTransitions
                });
            }

            res.json({
                success: true,
                message: 'Invoice submitted for fulfillment',
                status: result.newStatus
            });
        } catch (error) {
            console.error('Error submitting invoice:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to submit invoice',
                details: error.message
            });
        }
    }

    /**
     * Approve pending order
     * POST /api/v1/invoices/:id/approve
     */
    async approveInvoice(req, res) {
        try {
            const { id } = req.params;
            const { reason } = req.body;
            const userId = req.session.userId || req.user?.id;

            // Transition from Pending_Approval to Approved
            const result = await invoiceStateMachine.transitionTo(
                id,
                'Approved',
                userId,
                reason || 'Order approved by sales rep'
            );

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.error || 'Failed to approve invoice',
                    validTransitions: result.validTransitions
                });
            }

            res.json({
                success: true,
                message: 'Invoice approved successfully',
                status: result.newStatus
            });
        } catch (error) {
            console.error('Error approving invoice:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to approve invoice',
                details: error.message
            });
        }
    }

    /**
     * Reject pending order
     * POST /api/v1/invoices/:id/reject
     */
    async rejectInvoice(req, res) {
        try {
            const { id } = req.params;
            const { reason } = req.body;
            const userId = req.session.userId || req.user?.id;

            if (!reason) {
                return res.status(400).json({
                    success: false,
                    error: 'Rejection reason is required'
                });
            }

            // Transition to Cancelled
            const result = await invoiceStateMachine.transitionTo(
                id,
                'Cancelled',
                userId,
                `Order rejected: ${reason}`
            );

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.error || 'Failed to reject invoice',
                    validTransitions: result.validTransitions
                });
            }

            res.json({
                success: true,
                message: 'Invoice rejected and cancelled',
                status: result.newStatus
            });
        } catch (error) {
            console.error('Error rejecting invoice:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to reject invoice',
                details: error.message
            });
        }
    }

    /**
     * Get invoice history
     * GET /api/v1/invoices/:id/history
     */
    async getInvoiceHistory(req, res) {
        try {
            const { id } = req.params;

            // Verify invoice exists and user has access
            const invoice = await query(`
                SELECT id, fk_buyer_id, assigned_sales_rep_id
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [id]);

            if (invoice.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Invoice not found'
                });
            }

            // Get history
            const history = await query(`
                SELECT 
                    h.*,
                    u.first_name || ' ' || u.last_name as changed_by_name,
                    u.email as changed_by_email
                FROM "ORDERS-invoice-history" h
                LEFT JOIN users u ON h.changed_by_user_id = u.id
                WHERE h.fk_invoice_id = $1
                ORDER BY h.changed_at DESC
            `, [id]);

            res.json({
                success: true,
                history: history.rows
            });
        } catch (error) {
            console.error('Error getting invoice history:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get invoice history',
                details: error.message
            });
        }
    }

    /**
     * Accept order for fulfillment
     * POST /api/v1/invoices/:id/fulfillment/accept
     */
    async acceptFulfillment(req, res) {
        try {
            const { id } = req.params;
            const userId = req.session.userId || req.user?.id;

            // Transition to Fulfillment_Accepted
            const result = await invoiceStateMachine.transitionTo(
                id,
                'Fulfillment_Accepted',
                userId,
                'Order accepted by fulfillment team'
            );

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.error || 'Failed to accept order',
                    validTransitions: result.validTransitions
                });
            }

            res.json({
                success: true,
                message: 'Order accepted for fulfillment',
                status: result.newStatus
            });
        } catch (error) {
            console.error('Error accepting fulfillment:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to accept order',
                details: error.message
            });
        }
    }

    /**
     * Report fulfillment issue
     * POST /api/v1/invoices/:id/fulfillment/issue
     */
    async reportFulfillmentIssue(req, res) {
        try {
            const { id } = req.params;
            const { issues, note } = req.body;
            const userId = req.session.userId || req.user?.id;

            if (!issues || !Array.isArray(issues) || issues.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'issues array is required and must not be empty'
                });
            }

            // Build issue note from issues array
            const issueDescriptions = issues.map(issue => {
                return `${issue.type}: ${issue.batch_name || issue.batch_id} - ${issue.description || 'No description'}`;
            }).join('\n');

            const fullNote = note 
                ? `${note}\n\nIssues:\n${issueDescriptions}`
                : `Fulfillment issues reported:\n${issueDescriptions}`;

            // Transition to Fulfillment_Issue
            const result = await invoiceStateMachine.transitionTo(
                id,
                'Fulfillment_Issue',
                userId,
                fullNote
            );

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.error || 'Failed to report issue',
                    validTransitions: result.validTransitions
                });
            }

            // Update fulfillment issue note
            await query(`
                UPDATE "ORDERS-invoices"
                SET fulfillment_issue_note = $1
                WHERE id = $2
            `, [fullNote, id]);

            // Log detailed issue information
            await query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id, modification_type, field_name,
                    old_value, new_value, reason, change_details,
                    changed_by_user_id, triggered_by_fulfillment_issue
                ) VALUES ($1, 'fulfillment_issue_reported', 'fulfillment_issues',
                          NULL, $2, 'Fulfillment issues reported', $3, $4, true)
            `, [id, JSON.stringify(issues), JSON.stringify({ issues }), userId]);

            res.json({
                success: true,
                message: 'Fulfillment issues reported',
                status: result.newStatus
            });
        } catch (error) {
            console.error('Error reporting fulfillment issue:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to report issue',
                details: error.message
            });
        }
    }

    /**
     * Void invoice (only allowed before shipping)
     * POST /api/v1/invoices/:id/void
     * Requires Sales Admin or Sales Representative role
     */
    async voidInvoice(req, res) {
        try {
            const { id } = req.params;
            const { reason } = req.body;
            const userId = req.session.userId || req.user?.id;

            if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
                return res.status(400).json({
                    success: false,
                    error: 'Void reason is required and must be at least 10 characters'
                });
            }

            // Check user permissions - must be Sales Admin or Sales Rep
            const UserModel = require('../Models/userModel');
            const isSuperuser = await UserModel.isSuperuser(userId);
            const userRoles = await UserModel.getUserRoles(userId);
            const userRoleNames = userRoles.map(r => r.name || r.role_name).filter(Boolean);
            
            const isAdmin = isSuperuser || userRoleNames.some(r => r.toLowerCase() === 'administrator');
            const isSalesAdmin = userRoleNames.some(r => r.toLowerCase() === 'sales admin');
            const isSalesRep = userRoleNames.some(r => r.toLowerCase() === 'sales representative');

            if (!isAdmin && !isSalesAdmin && !isSalesRep) {
                return res.status(403).json({
                    success: false,
                    error: 'Only Sales Admin or Sales Representative can void invoices'
                });
            }

            // Get invoice and check if it has shipped or if fulfillment is scanning
            const invoice = await query(`
                SELECT 
                    i.id, 
                    i.status, 
                    i.source, 
                    i.shipped_at,
                    i.fulfillment_accepted_by,
                    EXISTS(
                        SELECT 1 FROM "ORDERS-scanning-sessions" ss
                        WHERE ss.fk_invoice_id = i.id 
                        AND ss.session_status = 'active'
                    ) as has_active_scanning_session
                FROM "ORDERS-invoices" i
                WHERE i.id = $1
            `, [id]);

            if (invoice.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Invoice not found'
                });
            }

            const invoiceData = invoice.rows[0];

            // Check if invoice has already shipped
            if (invoiceData.shipped_at) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot void an invoice that has already been shipped'
                });
            }

            // Check if fulfillment is currently scanning this invoice
            if (invoiceData.has_active_scanning_session) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot void invoice - fulfillment team is currently scanning packages for this order. Please wait until scanning is complete.'
                });
            }

            // Check if status allows voiding (before shipping)
            const statusesBeforeShipping = [
                'Draft',
                'Pending_Approval',
                'Approved',
                'Fulfillment_Accepted',
                'Fulfillment_Issue',
                'Partially_Manifested',
                'Manifested'
            ];

            if (!statusesBeforeShipping.includes(invoiceData.status)) {
                return res.status(400).json({
                    success: false,
                    error: `Cannot void invoice in ${invoiceData.status} status. Voiding is only allowed before shipping.`
                });
            }

            // Transition to Voided (entire invoice voided)
            const invoiceStateMachine = require('../Services/invoiceStateMachineService');
            
            // Add timeout wrapper
            const transitionPromise = invoiceStateMachine.transitionTo(
                id,
                'Voided',
                userId,
                `Invoice voided: ${reason.trim()}`
            );
            
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Transaction timeout - invoice may be locked by another operation')), 30000);
            });
            
            const result = await Promise.race([transitionPromise, timeoutPromise]);

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.error || 'Failed to void invoice',
                    validTransitions: result.validTransitions
                });
            }

            res.json({
                success: true,
                message: 'Invoice voided successfully',
                status: result.newStatus
            });
        } catch (error) {
            console.error('Error voiding invoice:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to void invoice',
                details: error.message
            });
        }
    }

    /**
     * Acknowledge voided manifest (sales team)
     * POST /api/v1/invoices/:id/acknowledge-void
     */
    async acknowledgeVoidedManifest(req, res) {
        try {
            const { id } = req.params;
            const userId = req.session.userId || req.user?.id;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
            }

            const { query } = require('../config/database');
            
            // Get invoice and verify it's in Manifest_Voided or Partially_Voided status
            const invoice = await query(`
                SELECT 
                    id, 
                    invoice_number,
                    status,
                    voided_at,
                    sales_acknowledged_void
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [id]);

            if (invoice.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Invoice not found'
                });
            }

            const inv = invoice.rows[0];

            // Verify invoice has a voided manifest
            if (!['Manifest_Voided', 'Partially_Voided'].includes(inv.status)) {
                return res.status(400).json({
                    success: false,
                    error: `Invoice is not in a voided manifest status. Current status: ${inv.status}`
                });
            }

            if (!inv.voided_at) {
                return res.status(400).json({
                    success: false,
                    error: 'Invoice does not have a voided manifest'
                });
            }

            if (inv.sales_acknowledged_void) {
                return res.status(400).json({
                    success: false,
                    error: 'Voided manifest has already been acknowledged'
                });
            }

            // Update invoice to mark sales acknowledgment
            await query(`
                UPDATE "ORDERS-invoices"
                SET 
                    sales_acknowledged_void = true,
                    sales_acknowledged_void_at = NOW(),
                    sales_acknowledged_void_by = $1,
                    status_updated_at = NOW()
                WHERE id = $2
            `, [userId, id]);

            // Log to invoice history
            await query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id, 
                    modification_type, 
                    field_name,
                    old_value, 
                    new_value, 
                    reason, 
                    changed_by_user_id
                ) VALUES ($1, 'status_changed', 'sales_acknowledged_void', 'false', 'true', 'Sales acknowledged voided manifest - ready for rescanning', $2)
            `, [id, userId]);

            // Broadcast update
            const websocketService = require('../Services/websocketService');
            websocketService.broadcastInvoiceEvent(id, 'invoice_status_changed', {
                status: inv.status,
                sales_acknowledged_void: true,
                message: 'Sales acknowledged voided manifest - fulfillment can now rescan'
            }).catch(error => {
                console.error('Error broadcasting invoice update:', error.message);
            });

            res.json({
                success: true,
                message: 'Voided manifest acknowledged. Fulfillment team can now rescan.',
                data: {
                    invoiceId: id,
                    invoiceNumber: inv.invoice_number,
                    salesAcknowledged: true,
                    acknowledgedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('Error acknowledging voided manifest:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to acknowledge voided manifest',
                details: error.message
            });
        }
    }

    /**
     * Get buyer's invoices
     * GET /api/v1/buyers/:buyerId/invoices?location_id=456
     */
    async getBuyerInvoices(req, res) {
        try {
            const { buyerId } = req.params;
            const { location_id, limit: limitParam } = req.query;

            let queryStr = `
                SELECT 
                    i.*,
                    l.name as location_name,
                    u.first_name || ' ' || u.last_name as sales_rep_name
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                LEFT JOIN users u ON i.assigned_sales_rep_id = u.id
                WHERE i.fk_buyer_id = $1
            `;

            const params = [buyerId];
            let paramIndex = 2;

            if (location_id) {
                queryStr += ` AND i.fk_location_id = $${paramIndex}`;
                params.push(location_id);
                paramIndex++;
            }

            queryStr += ` ORDER BY i.created_at DESC`;

            let limit = parseInt(limitParam, 10);
            if (!Number.isNaN(limit)) {
                limit = Math.min(Math.max(limit, 1), 100);
                queryStr += ` LIMIT $${paramIndex}`;
                params.push(limit);
                paramIndex++;
            }

            const invoices = await query(queryStr, params);

            res.json({
                success: true,
                invoices: invoices.rows
            });
        } catch (error) {
            console.error('Error getting buyer invoices:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get buyer invoices',
                details: error.message
            });
        }
    }

    /**
     * Update invoice notes (customer and internal)
     * PATCH /api/v1/invoices/:id/notes
     */
    async updateInvoiceNotes(req, res) {
        try {
            const { id } = req.params;
            const { customer_notes, internal_notes } = req.body;
            const userId = req.session?.userId || req.user?.id;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
            }
            
            const invoiceId = parseInt(id, 10);
            if (isNaN(invoiceId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid invoice ID'
                });
            }
            
            // Verify invoice exists and user has access
            const invoice = await query(`
                SELECT 
                    i.*,
                    l.assigned_sales_rep_id as location_assigned_sales_rep_id
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                WHERE i.id = $1
            `, [invoiceId]);
            
            if (invoice.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Invoice not found'
                });
            }
            
            const invoiceData = invoice.rows[0];
            
            // Check permissions - Sales Rep can only update their assigned invoices
            const UserModel = require('../Models/userModel');
            const isSuperuser = await UserModel.isSuperuser(userId);
            const userRoles = await UserModel.getUserRoles(userId);
            const userRoleNames = userRoles.map(r => r.name || r.role_name).filter(Boolean);
            const isAdmin = isSuperuser || userRoleNames.some(r => r.toLowerCase() === 'administrator');
            const isSalesAdmin = userRoleNames.some(r => r.toLowerCase() === 'sales admin');
            const isSalesRep = !isAdmin && !isSalesAdmin && userRoleNames.some(r => r.toLowerCase() === 'sales representative');
            
            if (isSalesRep) {
                const hasAccess = invoiceData.assigned_sales_rep_id === userId || 
                                 invoiceData.location_assigned_sales_rep_id === userId;
                if (!hasAccess) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to update this invoice'
                    });
                }
            }
            
            // Update notes - only update fields that are provided
            let updateFields = [];
            let updateValues = [];
            let paramIndex = 1;
            
            if (customer_notes !== undefined) {
                updateFields.push(`customer_notes = $${paramIndex}`);
                updateValues.push(customer_notes || null);
                paramIndex++;
            }
            
            if (internal_notes !== undefined) {
                updateFields.push(`internal_notes = $${paramIndex}`);
                updateValues.push(internal_notes || null);
                paramIndex++;
            }
            
            if (updateFields.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'At least one note field (customer_notes or internal_notes) must be provided'
                });
            }
            
            updateFields.push(`updated_at = NOW()`);
            
            // Add id as the last parameter
            updateValues.push(invoiceId);
            
            const updateQuery = `
                UPDATE "ORDERS-invoices"
                SET ${updateFields.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING customer_notes, internal_notes
            `;
            
            console.log('updateInvoiceNotes - Query:', updateQuery);
            console.log('updateInvoiceNotes - Values:', updateValues);
            
            const result = await query(updateQuery, updateValues);
            
            if (result.rows.length === 0) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to update invoice notes - no rows returned'
                });
            }
            
            // Log history
            try {
                // Get old values before update for history
                const oldCustomerNotes = invoiceData.customer_notes || null;
                const oldInternalNotes = invoiceData.internal_notes || null;
                const newCustomerNotes = customer_notes !== undefined ? (customer_notes || null) : oldCustomerNotes;
                const newInternalNotes = internal_notes !== undefined ? (internal_notes || null) : oldInternalNotes;
                
                // Build change details
                const changes = [];
                if (customer_notes !== undefined && oldCustomerNotes !== newCustomerNotes) {
                    changes.push('customer_notes');
                }
                if (internal_notes !== undefined && oldInternalNotes !== newInternalNotes) {
                    changes.push('internal_notes');
                }
                
                // Log history entry if there were actual changes
                if (changes.length > 0) {
                    // Use status_changed as the modification_type since notes updates don't have a specific type
                    // Store the actual change details in the reason and change_details fields
                    await query(`
                        INSERT INTO "ORDERS-invoice-history" (
                            fk_invoice_id, modification_type, field_name, old_value, new_value, 
                            reason, change_details, changed_by_user_id, changed_by_system
                        ) VALUES ($1, 'status_changed', 'notes', $2, $3, $4, $5, $6, false)
                    `, [
                        invoiceId,
                        JSON.stringify({ customer_notes: oldCustomerNotes, internal_notes: oldInternalNotes }),
                        JSON.stringify({ customer_notes: newCustomerNotes, internal_notes: newInternalNotes }),
                        `Notes updated: ${changes.join(', ')}`,
                        JSON.stringify({ fields_changed: changes }),
                        userId
                    ]);
                }
            } catch (historyError) {
                console.error('Error logging invoice history:', historyError);
                console.error('History error details:', historyError.message, historyError.stack);
                // Continue - history logging failure shouldn't block the update
            }
            
            // Audit log
            try {
                await auditLogger.logAction({
                    userId: userId,
                    action: 'invoice_notes_updated',
                    resourceType: 'Invoice',
                    resourceId: invoiceId.toString(),
                    details: {
                        invoice_id: invoiceId,
                        invoice_number: invoiceData.invoice_number,
                        customer_notes_updated: customer_notes !== undefined,
                        internal_notes_updated: internal_notes !== undefined
                    },
                    status: 'success',
                    sourceIp: req.ip || req.connection?.remoteAddress
                });
            } catch (auditError) {
                console.error('Error logging audit trail:', auditError);
                // Continue - audit logging failure shouldn't block the update
            }
            
            res.json({
                success: true,
                message: 'Invoice notes updated successfully',
                invoice: {
                    customer_notes: result.rows[0].customer_notes,
                    internal_notes: result.rows[0].internal_notes
                }
            });
        } catch (error) {
            console.error('Error updating invoice notes:', error);
            console.error('Error stack:', error.stack);
            res.status(500).json({
                success: false,
                error: 'Failed to update invoice notes',
                details: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }
}

module.exports = new InvoiceController();

