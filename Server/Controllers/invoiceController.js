/**
 * Invoice Controller
 * 
 * Handles invoice creation, management, and state transitions
 */

const invoiceStateMachine = require('../Services/invoiceStateMachineService');
const { query } = require('../config/database');
const auditLogger = require('../Services/auditLogger');

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
                SELECT *
                FROM "ORDERS-invoice-history"
                WHERE fk_invoice_id = $1
                ORDER BY changed_at DESC
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
                SELECT license_number, assigned_sales_rep_id
                FROM "ORDERS-buyer_locations"
                WHERE id = $1
            `, [location_id]);
            
            if (location.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Location not found'
                });
            }
            
            const licenseNumber = location.rows[0].license_number;
            const defaultSalesRep = location.rows[0].assigned_sales_rep_id;
            
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
                    i.fk_buyer_id,
                    i.fk_location_id,
                    COALESCE(b.name, 'Unknown Buyer') as buyer_name,
                    COALESCE(l.name, 'Unknown Location') as location_name,
                    u.username as created_by_username,
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
            
            queryStr += ` ORDER BY i.created_at DESC LIMIT 500`;
            
            const invoices = await query(queryStr, params);
            
            res.render('admin/invoices/index', {
                title: 'Invoices',
                layout: 'layouts/main',
                invoices: invoices.rows || [],
                filters: { status, source },
                user: req.session.user,
                isAdmin: isAdmin,
                isSalesAdmin: isSalesAdmin,
                isSalesRep: isSalesRep
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
            // Get all buyers with locations for dropdown
            const buyers = await query(`
                SELECT 
                    b.entry_id as buyer_id,
                    b.name as buyer_name,
                    l.entry_id as location_id,
                    l.name as location_name
                FROM "ORDERS-buyers" b
                INNER JOIN "ORDERS-buyer_locations" l ON b.entry_id = l.orders_buyer_id
                ORDER BY b.name, l.name
            `);
            
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
            
            // Get original line items
            const lineItems = await query(`
                SELECT 
                    fk_master_product_id,
                    fk_batch_id,
                    quantity_ordered,
                    unit_price,
                    specific_package_labels
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [id]);
            
            // Get location details
            const locationId = new_location_id || origInvoice.fk_location_id;
            const location = await query(`
                SELECT license_number, assigned_sales_rep_id
                FROM "ORDERS-buyer_locations"
                WHERE id = $1
            `, [locationId]);
            
            if (location.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Location not found' });
            }
            
            const locationData = location.rows[0];
            
            // Generate new invoice number
            const invoiceNumber = await this.generateInvoiceNumber();
            
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
                locationData.license_number,
                origInvoice.source,
                userId,
                locationData.assigned_sales_rep_id || userId,
                origInvoice.customer_notes,
                `Cloned from invoice ${origInvoice.invoice_number}`
            ]);
            
            const newInvoiceId = newInvoice.rows[0].id;
            const internalInvoiceService = require('../Services/internalInvoiceService');
            const client = await internalInvoiceService.pool.connect();
            
            try {
                await client.query('BEGIN');
                
                const errors = [];
                
                // Clone line items
                for (const item of lineItems.rows) {
                    // Check batch availability
                    const batch = await client.query(`
                        SELECT quantity, allocated_quantity, status
                        FROM "ORDERS-batches"
                        WHERE id = $1
                    `, [item.fk_batch_id]);
                    
                    if (batch.rows.length === 0) {
                        errors.push(`Batch ${item.fk_batch_id} not found`);
                        continue;
                    }
                    
                    const batchData = batch.rows[0];
                    const available = batchData.quantity - batchData.allocated_quantity;
                    
                    if (batchData.status !== 'Sellable') {
                        errors.push(`Batch ${item.fk_batch_id} is not sellable`);
                        continue;
                    }
                    
                    if (available < item.quantity_ordered) {
                        errors.push(`Batch ${item.fk_batch_id} has insufficient inventory (available: ${available}, needed: ${item.quantity_ordered})`);
                        continue;
                    }
                    
                    // Add line item
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
                    errors: errors.length > 0 ? errors : undefined
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
            
            const isAdmin = isSuperuser || userRoleNames.some(r => r.toLowerCase() === 'administrator');
            const isSalesAdmin = userRoleNames.some(r => r.toLowerCase() === 'sales admin');
            const isSalesRep = !isAdmin && !isSalesAdmin && userRoleNames.some(r => r.toLowerCase() === 'sales representative');
            
            // Get invoice with location info
            const invoice = await query(`
                SELECT 
                    i.*,
                    b.name as buyer_name,
                    l.name as location_name,
                    l.assigned_sales_rep_id as location_assigned_sales_rep_id,
                    u.username as created_by_username
                FROM "ORDERS-invoices" i
                INNER JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                INNER JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                LEFT JOIN users u ON i.created_by_user_id = u.id
                WHERE i.id = $1
            `, [id]);
            
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
            const lineItems = await query(`
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
            
            // Get modification history
            const history = await query(`
                SELECT *
                FROM "ORDERS-invoice-history"
                WHERE fk_invoice_id = $1
                ORDER BY changed_at DESC
            `, [id]);
            
            res.render('admin/invoices/details', {
                title: 'Invoice Details',
                layout: 'layouts/main',
                invoice: invoiceData,
                lineItems: lineItems.rows,
                history: history.rows,
                user: req.session.user,
                isAdmin: isAdmin,
                isSalesAdmin: isSalesAdmin,
                isSalesRep: isSalesRep
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
            const { location_id, search } = req.query;
            
            if (!location_id) {
                return res.status(400).json({ success: false, error: 'location_id is required' });
            }
            
            let queryStr = `
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
                WHERE b.status = 'Sellable'
                  AND (b.quantity - b.allocated_quantity) > 0
            `;
            
            const params = [];
            let paramIndex = 1;
            
            if (search) {
                queryStr += ` AND (
                    p.name ILIKE $${paramIndex} OR 
                    p.brand_name ILIKE $${paramIndex} OR 
                    p.cultivar_name ILIKE $${paramIndex}
                )`;
                params.push(`%${search}%`);
                paramIndex++;
            }
            
            queryStr += ` ORDER BY p.brand_name, p.name LIMIT 50`;
            
            const products = await query(queryStr, params);
            
            res.json({
                success: true,
                products: products.rows
            });
        } catch (error) {
            console.error('Error getting products:', error);
            res.status(500).json({ success: false, error: 'Failed to get products' });
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
            
            const batches = await query(`
                SELECT 
                    b.id,
                    b.batch_name,
                    b.quantity,
                    b.allocated_quantity,
                    (b.quantity - b.allocated_quantity) as available_quantity,
                    COALESCE(b.override_price, p.default_price, 0) as unit_price,
                    b.status
                FROM "ORDERS-batches" b
                INNER JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
                WHERE b.fk_master_product_id = $1
                  AND b.status = 'Sellable'
                  AND (b.quantity - b.allocated_quantity) > 0
                ORDER BY b.created_at DESC
            `, [productId]);
            
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
                line_items,
                customer_notes,
                internal_notes
            } = req.body;
            
            const userId = req.session.userId || req.user?.id;
            
            if (!buyer_id || !location_id || !line_items || line_items.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'buyer_id, location_id, and line_items are required'
                });
            }
            
            const internalInvoiceService = require('../Services/internalInvoiceService');
            
            const result = await internalInvoiceService.createInvoice(userId, {
                fk_buyer_id: parseInt(buyer_id),
                fk_location_id: parseInt(location_id),
                line_items: line_items.map(item => ({
                    fk_batch_id: item.fk_batch_id,
                    quantity: parseInt(item.quantity),
                    partial_packages_selected: item.partial_packages_selected || null
                })),
                customer_notes: customer_notes || null,
                internal_notes: internal_notes || null
            });
            
            res.json({
                success: true,
                invoice_id: result.invoice_id,
                invoice_number: result.invoice_number
            });
        } catch (error) {
            console.error('Error creating internal invoice:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create invoice',
                details: error.message
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
            const { fk_batch_id, quantity, partial_packages_selected } = req.body;
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

            if (invoice.rows[0].status !== 'Draft') {
                return res.status(400).json({
                    success: false,
                    error: 'Line items can only be added to draft invoices'
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
                        partial_packages_selected: partial_packages_selected || null
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
            const { quantity } = req.body;
            const userId = req.session.userId || req.user?.id;

            if (!quantity || quantity <= 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Valid quantity is required'
                });
            }

            const internalInvoiceService = require('../Services/internalInvoiceService');
            const allocationService = require('../Services/allocationService');
            const client = await internalInvoiceService.pool.connect();

            try {
                await client.query('BEGIN');

                // Get current line item
                const lineItem = await client.query(`
                    SELECT 
                        li.*,
                        i.status,
                        i.fk_location_id
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

                if (item.status !== 'Draft') {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'Line items can only be updated in draft invoices'
                    });
                }

                const currentQuantity = parseInt(item.quantity_ordered);
                const currentAllocated = parseInt(item.quantity_allocated || 0);
                const newQuantity = parseInt(quantity);
                const quantityDelta = newQuantity - currentQuantity;

                // Check batch availability if increasing quantity
                if (quantityDelta > 0) {
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
                } else if (quantityDelta < 0) {
                    // Release allocation if decreasing quantity
                    const releaseQty = Math.abs(quantityDelta);
                    await client.query(`
                        UPDATE "ORDERS-batches"
                        SET allocated_quantity = allocated_quantity - $1
                        WHERE id = $2
                    `, [releaseQty, item.fk_batch_id]);

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
                        currentAllocated,
                        currentAllocated - releaseQty,
                        id
                    ]);
                }

                // Update line item
                const unitPrice = parseFloat(item.unit_price);
                const newLineTotal = unitPrice * newQuantity - parseFloat(item.line_discount_amount || 0);

                await client.query(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET 
                        quantity_ordered = $1,
                        quantity_allocated = $1,
                        line_total = $2,
                        updated_at = NOW()
                    WHERE id = $3
                `, [newQuantity, newLineTotal, lineItemId]);

                // Recalculate invoice totals
                await internalInvoiceService.recalculateTotals(parseInt(id), client);

                // Log to invoice history
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id, modification_type, field_name,
                        old_value, new_value, reason, changed_by_user_id
                    ) VALUES ($1, 'line_item_quantity_changed', $2, $3, $4, 'Quantity updated', $5)
                `, [id, `line_item_${lineItemId}`, currentQuantity.toString(), newQuantity.toString(), userId]);

                await client.query('COMMIT');

                // Broadcast inventory update
                if (quantityDelta !== 0) {
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

                // Get line item details
                const lineItem = await client.query(`
                    SELECT 
                        li.*,
                        i.status
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

                if (item.status !== 'Draft') {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'Line items can only be removed from draft invoices'
                    });
                }

                const allocatedQty = parseInt(item.quantity_allocated || 0);

                // Release allocation
                if (allocatedQty > 0) {
                    await client.query(`
                        UPDATE "ORDERS-batches"
                        SET allocated_quantity = allocated_quantity - $1
                        WHERE id = $2
                    `, [allocatedQty, item.fk_batch_id]);

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
                        allocatedQty.toString(),
                        '0',
                        id
                    ]);
                }

                // Delete line item
                await client.query(`
                    DELETE FROM "ORDERS-invoice-line-items"
                    WHERE id = $1
                `, [lineItemId]);

                // Recalculate invoice totals
                await internalInvoiceService.recalculateTotals(parseInt(id), client);

                // Log to invoice history
                await client.query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id, modification_type, field_name,
                        old_value, new_value, reason, changed_by_user_id
                    ) VALUES ($1, 'line_item_removed', $2, $3, NULL, 'Line item removed', $4)
                `, [id, `line_item_${lineItemId}`, item.quantity_ordered.toString(), userId]);

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
     * Get buyer's invoices
     * GET /api/v1/buyers/:buyerId/invoices?location_id=456
     */
    async getBuyerInvoices(req, res) {
        try {
            const { buyerId } = req.params;
            const { location_id } = req.query;

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
            }

            queryStr += ` ORDER BY i.created_at DESC`;

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
}

module.exports = new InvoiceController();

