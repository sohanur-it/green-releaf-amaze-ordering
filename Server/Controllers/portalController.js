// Server/Controllers/portalController.js

const { query } = require('../config/database');

// Cache for system user ID (avoids repeated queries)
let cachedSystemUserId = null;
let systemUserIdCacheTime = 0;
const SYSTEM_USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

class PortalController {
    /**
     * Get system user ID with caching
     */
    static async getSystemUserId() {
        const now = Date.now();
        if (cachedSystemUserId && (now - systemUserIdCacheTime) < SYSTEM_USER_CACHE_TTL) {
            return cachedSystemUserId;
        }

        try {
            // Try superuser first
            try {
                const superUserResult = await query(`
                    SELECT id FROM users 
                    WHERE is_superuser = true
                    LIMIT 1
                `);
                if (superUserResult.rows.length > 0) {
                    cachedSystemUserId = superUserResult.rows[0].id;
                    systemUserIdCacheTime = now;
                    return cachedSystemUserId;
                }
            } catch (e) {
                // Column might not exist
            }
            
            // Try admin role
            try {
                const roleUserResult = await query(`
                    SELECT u.id 
                    FROM users u
                    INNER JOIN user_roles ur ON u.id = ur.user_id
                    INNER JOIN roles r ON ur.role_id = r.id
                    WHERE LOWER(r.name) IN ('admin', 'sales_rep')
                    LIMIT 1
                `);
                if (roleUserResult.rows.length > 0) {
                    cachedSystemUserId = roleUserResult.rows[0].id;
                    systemUserIdCacheTime = now;
                    return cachedSystemUserId;
                }
            } catch (e) {
                // Table might not exist
            }
            
            // Fallback: any active user
            const anyUserResult = await query(`
                SELECT id FROM users 
                WHERE status IN ('active', 'pending')
                LIMIT 1
            `);
            if (anyUserResult.rows.length > 0) {
                cachedSystemUserId = anyUserResult.rows[0].id;
                systemUserIdCacheTime = now;
                return cachedSystemUserId;
            }
            
            // Last resort: any user
            const lastResortResult = await query(`
                SELECT id FROM users 
                LIMIT 1
            `);
            if (lastResortResult.rows.length > 0) {
                cachedSystemUserId = lastResortResult.rows[0].id;
                systemUserIdCacheTime = now;
                return cachedSystemUserId;
            }
            
            // Default fallback
            cachedSystemUserId = 1;
            systemUserIdCacheTime = now;
            return cachedSystemUserId;
        } catch (err) {
            console.log('Could not find system user, using default ID 1:', err.message);
            cachedSystemUserId = 1;
            systemUserIdCacheTime = now;
            return cachedSystemUserId;
        }
    }
    /**
     * Show product catalog with shopping cart
     */
    static async showCatalog(req, res) {
        try {
            const { uuid } = req.params;
            const portalAccess = req.session.portalAccess || {};
            
            // Fetch available products for this buyer's location
            const products = await query(`
                SELECT 
                    p.entry_id as product_id,
                    p.name as product_name,
                    p.brand_name,
                    p.cultivar_name,
                    p.cultivar_type_name,
                    p.default_price,
                    p.product_type_name as product_type,
                    p.category_name,
                    p.description as product_description,
                    p.unit_size,
                    p.unit_measurement_name,
                    p.sold_as,
                    p.units_per_case,
                    -- Get featured image
                    (
                        SELECT file_path 
                        FROM "ORDERS-product-images" pi
                        WHERE pi.fk_product_id = p.entry_id
                          AND pi.is_deleted = false
                          AND pi.is_featured = true
                        ORDER BY pi.uploaded_at ASC
                        LIMIT 1
                    ) as primary_image_path,
                    -- Get available batches for this product
                    -- CRITICAL: External portal only shows batches with full_package_count > 0
                    -- (per MODULE_4_REQUIREMENTS: "External Orders Cannot Use Partial Packages")
                    (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'batch_id', b.id,
                                'batch_name', b.batch_name,
                                'quantity_available', b.quantity - b.allocated_quantity,
                                'unit_price', COALESCE(b.override_price, p.default_price, 0),
                                'production_date', b.production_date,
                                'best_by_date', b.best_by_date,
                                'status', b.status,
                                'metrc_item_name', b.metrc_item_name,
                                'thc_percentage', COALESCE(b.thc_override, b.thc_percentage)
                            )
                        )
                        FROM "ORDERS-batches" b
                        WHERE b.fk_master_product_id = p.entry_id
                        AND b.status IN ('Sellable', 'On Hold')  -- Include both Sellable and On Hold batches
                        AND (b.quantity - b.allocated_quantity) > 0
                        AND b.full_package_count > 0  -- External portal only shows full packages
                    ) as available_batches
                FROM "ORDERS-products" p
                WHERE p.is_archived = false
                AND EXISTS (
                    SELECT 1 FROM "ORDERS-batches" b
                    WHERE b.fk_master_product_id = p.entry_id
                    AND b.status IN ('Sellable', 'On Hold')  -- Include both Sellable and On Hold batches
                    AND (b.quantity - b.allocated_quantity) > 0
                    AND b.full_package_count > 0  -- External portal only shows full packages
                )
                ORDER BY p.brand_name, p.name
            `);
            
            // Add image URLs to products and parse available_batches if needed
            const productsWithImages = products.rows.map(product => {
                // Parse available_batches if it's a string (PostgreSQL JSONB sometimes returns as string)
                let available_batches = product.available_batches;
                if (typeof available_batches === 'string') {
                    try {
                        available_batches = JSON.parse(available_batches);
                    } catch (e) {
                        console.error('Error parsing available_batches:', e);
                        available_batches = [];
                    }
                }
                
                // Debug: Log first batch's unit_price to diagnose the issue
                if (available_batches && available_batches.length > 0 && available_batches[0]) {
                    const firstBatch = available_batches[0];
                    console.log(`[DEBUG] Product: ${product.name || product.product_name}, Batch unit_price: ${firstBatch.unit_price}, Product default_price: ${product.default_price}, Units per case: ${product.units_per_case}`);
                }
                
                return {
                    ...product,
                    available_batches: available_batches || [],
                    primary_image_url: product.primary_image_path ? `/public/${product.primary_image_path}` : null
                };
            });
            
            res.render('external/store', {
                title: 'Product Catalog',
                layout: 'layouts/portal',
                products: productsWithImages,
                portalAccess: portalAccess,
                uuid: uuid
            });
        } catch (error) {
            console.error('Error loading catalog:', error);
            res.status(500).render('external/error', {
                title: 'Error',
                layout: 'layouts/portal',
                error: 'Failed to load products',
                message: 'Please try again later'
            });
        }
    }
    
    /**
     * Get inventory data for validation (batch availability)
     */
    static async getInventory(req, res) {
        try {
            const portalAccess = req.session.portalAccess;
            if (!portalAccess) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            
            // Get batch availability for all batches in cart
            const batches = await query(`
                SELECT 
                    b.id as batch_id,
                    (b.quantity - b.allocated_quantity)::INTEGER as quantity_available
                FROM "ORDERS-batches" b
                WHERE b.status = 'Sellable'
            `);
            
            res.json({
                success: true,
                batches: batches.rows
            });
        } catch (error) {
            console.error('Error getting inventory:', error);
            res.status(500).json({ error: 'Failed to get inventory data', details: error.message });
        }
    }
    
    /**
     * Get cart data for current user session
     */
    static async getCart(req, res) {
        try {
            const portalAccess = req.session.portalAccess;
            
            if (!portalAccess) {
                return res.json({ items: [], subtotal: 0, total: 0 });
            }
            
            // Get active draft invoice for this buyer/location
            // Use CTE to aggregate duplicate batch items (same batch in multiple line items)
            const draftInvoice = await query(`
                WITH line_items_aggregated AS (
                    SELECT 
                        li.fk_invoice_id,
                        li.fk_batch_id,
                        li.fk_master_product_id,
                        SUM(li.quantity_ordered) as total_quantity,
                        AVG(li.unit_price) as unit_price,
                        SUM(li.line_total) as total_line_total,
                        MAX(li.id) as line_item_id,
                        MAX(li.line_item_order) as line_item_order
                    FROM "ORDERS-invoice-line-items" li
                    INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                    WHERE i.fk_buyer_id = $1
                    AND i.fk_location_id = $2
                    AND i.status = 'Draft'
                    AND i.source = 'External'
                    GROUP BY li.fk_invoice_id, li.fk_batch_id, li.fk_master_product_id
                )
                SELECT 
                    i.id as invoice_id,
                    i.subtotal,
                    i.total,
                    jsonb_agg(
                        jsonb_build_object(
                            'line_item_id', lia.line_item_id,
                            'product_id', lia.fk_master_product_id,
                            'batch_id', lia.fk_batch_id,
                            'product_name', p.name,
                            'cultivar_name', p.cultivar_name,
                            'brand_name', p.brand_name,
                            'category_name', p.category_name,
                            'product_type', p.product_type_name,
                            'units_per_case', p.units_per_case,
                            'unit_size', p.unit_size,
                            'unit_measurement_name', p.unit_measurement_name,
                            'batch_name', b.batch_name,
                            'quantity', lia.total_quantity::INTEGER,
                            'unit_price', lia.unit_price,
                            'line_total', lia.total_line_total
                        ) ORDER BY lia.line_item_order
                    ) as items
                FROM "ORDERS-invoices" i
                INNER JOIN line_items_aggregated lia ON i.id = lia.fk_invoice_id
                INNER JOIN "ORDERS-products" p ON lia.fk_master_product_id = p.entry_id
                INNER JOIN "ORDERS-batches" b ON lia.fk_batch_id = b.id
                WHERE i.fk_buyer_id = $1
                AND i.fk_location_id = $2
                AND i.status = 'Draft'
                AND i.source = 'External'
                GROUP BY i.id, i.subtotal, i.total
                ORDER BY i.id DESC
                LIMIT 1
            `, [portalAccess.buyerId, portalAccess.locationId]);
            
            if (draftInvoice.rows.length === 0) {
                return res.json({ items: [], subtotal: 0, total: 0, invoice_id: null });
            }
            
            const invoice = draftInvoice.rows[0];
            console.log('getCart - Invoice loaded:', {
                invoice_id: invoice.invoice_id,
                item_count: invoice.items ? invoice.items.length : 0,
                items: invoice.items
            });
            
            return res.json({
                invoice_id: invoice.invoice_id,
                items: invoice.items || [],
                subtotal: parseFloat(invoice.subtotal || 0),
                total: parseFloat(invoice.total || 0)
            });
        } catch (error) {
            console.error('Error loading cart:', error);
            res.status(500).json({ error: 'Failed to load cart' });
        }
    }
    
    /**
     * Add item to cart
     */
    static async addToCart(req, res) {
        try {
            const portalAccess = req.session.portalAccess;
            const { batch_id, quantity: quantityParam } = req.body;
            
            if (!portalAccess) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            
            // Parse and validate quantity - ensure it's an integer
            const quantity = parseInt(quantityParam, 10);
            if (!batch_id || !quantity || isNaN(quantity) || quantity <= 0) {
                return res.status(400).json({ error: 'Invalid batch_id or quantity' });
            }
            
            console.log('addToCart - Request:', { batch_id, quantity, original_quantity: quantityParam, quantity_type: typeof quantityParam });
            
            // Get batch information to find product and price
            const batchResult = await query(`
                SELECT 
                    b.id,
                    b.fk_master_product_id,
                    b.override_price,
                    b.quantity,
                    b.allocated_quantity,
                    p.default_price,
                    p.name as product_name
                FROM "ORDERS-batches" b
                INNER JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
                WHERE b.id = $1
                AND b.status = 'Sellable'
            `, [batch_id]);
            
            if (batchResult.rows.length === 0) {
                return res.status(404).json({ error: 'Batch not found or not available' });
            }
            
            const batch = batchResult.rows[0];
            
            // Check availability
            const available = batch.quantity - batch.allocated_quantity;
            if (quantity > available) {
                return res.status(400).json({ error: `Only ${available} cases available` });
            }
            
            // Get or create draft invoice
            // Note: Only reuse Draft invoices. If invoice was checked out, it's now Pending_Approval
            // and we'll create a new Draft invoice for the next cart session
            let invoiceResult;
            try {
                invoiceResult = await query(`
                    SELECT id, invoice_number, status
                    FROM "ORDERS-invoices"
                    WHERE fk_buyer_id = $1
                    AND fk_location_id = $2
                    AND status = 'Draft'
                    AND source = 'External'
                    AND (cart_expires_at IS NULL OR cart_expires_at > NOW())
                    ORDER BY created_at DESC
                    LIMIT 1
                `, [portalAccess.buyerId, portalAccess.locationId]);
            } catch (err) {
                // Fallback if 'source' column doesn't exist - check by invoice_number pattern
                if (err.code === '42703') {
                    console.log('Source column not found, using invoice_number pattern fallback');
                    invoiceResult = await query(`
                        SELECT id, invoice_number, status
                        FROM "ORDERS-invoices"
                        WHERE fk_buyer_id = $1
                        AND fk_location_id = $2
                        AND status = 'Draft'
                        AND invoice_number LIKE 'EXT-%'
                        AND (cart_expires_at IS NULL OR cart_expires_at > NOW())
                        ORDER BY created_at DESC
                        LIMIT 1
                    `, [portalAccess.buyerId, portalAccess.locationId]);
                } else {
                    throw err;
                }
            }
            
            let invoiceId;
            let invoiceNumber;
            
            if (invoiceResult.rows.length === 0) {
                console.log('addToCart - No existing Draft invoice found, creating new one');
                
                // Generate invoice number - Simplified approach to avoid regex issues
                const year = new Date().getFullYear();
                const yearPrefix = `EXT-${year}-`;
                
                try {
                    // First try: optimized MAX with simple string replacement
                    const maxNumberResult = await query(`
                        SELECT COALESCE(MAX(
                            CAST(
                                SUBSTRING(invoice_number FROM LENGTH($1) + 1) AS INTEGER
                            )
                        ), 0) as max_num
                        FROM "ORDERS-invoices"
                        WHERE invoice_number LIKE $1 || '%'
                        AND invoice_number ~ ('^' || $1 || '[0-9]+$')
                    `, [yearPrefix]);
                    const maxNum = parseInt(maxNumberResult.rows[0].max_num || 0);
                    invoiceNumber = `${yearPrefix}${String(maxNum + 1).padStart(5, '0')}`;
                } catch (err) {
                    // Fallback: simple count if regex/SUBSTRING fails
                    console.log('Using fallback invoice number generation:', err.message);
                    try {
                        const countResult = await query(`
                            SELECT COUNT(*)::INTEGER as count 
                            FROM "ORDERS-invoices"
                            WHERE invoice_number LIKE $1 || '%'
                        `, [yearPrefix]);
                        const count = parseInt(countResult.rows[0].count || 0) + 1;
                        invoiceNumber = `${yearPrefix}${String(count).padStart(5, '0')}`;
                    } catch (fallbackErr) {
                        // Ultimate fallback: timestamp-based invoice number
                        const timestamp = Date.now();
                        invoiceNumber = `${yearPrefix}${String(timestamp).slice(-5)}`;
                        console.log('Using timestamp-based invoice number:', invoiceNumber);
                    }
                }
                
                // Get location license number - OPTIMIZED: Single query
                let locationLicense = 'UNKNOWN';
                try {
                    const locationResult = await query(`
                        SELECT state_license 
                        FROM "ORDERS-buyer_locations"
                        WHERE entry_id = $1
                        LIMIT 1
                    `, [portalAccess.locationId]);
                    if (locationResult.rows.length > 0 && locationResult.rows[0].state_license) {
                        locationLicense = locationResult.rows[0].state_license;
                    }
                } catch (err) {
                    // Column might not exist, use default
                }
                
                // Get system user ID using cached method
                const userId = await PortalController.getSystemUserId();
                
                // Set cart expiry (24 hours from now)
                const cartExpiresAt = new Date();
                cartExpiresAt.setHours(cartExpiresAt.getHours() + 24);
                
                const newInvoiceResult = await query(`
                    INSERT INTO "ORDERS-invoices" (
                        invoice_number, fk_buyer_id, fk_location_id, location_license_number,
                        source, created_by_user_id, status, cart_created_at, cart_expires_at
                    ) VALUES ($1, $2, $3, $4, 'External', $5, 'Draft', NOW(), $6)
                    RETURNING id, invoice_number
                `, [invoiceNumber, portalAccess.buyerId, portalAccess.locationId, locationLicense, userId, cartExpiresAt]);
                
                invoiceId = newInvoiceResult.rows[0].id;
                invoiceNumber = newInvoiceResult.rows[0].invoice_number;
            } else {
                invoiceId = invoiceResult.rows[0].id;
                invoiceNumber = invoiceResult.rows[0].invoice_number;
                console.log('addToCart - Reusing existing Draft invoice:', { invoiceId, invoiceNumber, status: invoiceResult.rows[0].status });
            }
            
            // Check if line item already exists for this batch - OPTIMIZED: Single query
            const existingLineItem = await query(`
                SELECT id, quantity_ordered, quantity_allocated
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1 AND fk_batch_id = $2
                ORDER BY id ASC
                LIMIT 1
            `, [invoiceId, batch_id]);
            
            const unitPrice = batch.override_price || batch.default_price || 0;
            const lineTotal = unitPrice * quantity;
            
            let lineItemId;
            let quantityToAllocate = parseInt(quantity, 10);
            
            if (existingLineItem.rows.length > 0) {
                // Update existing line item
                const currentQty = parseInt(existingLineItem.rows[0].quantity_ordered, 10);
                const currentAllocated = parseInt(existingLineItem.rows[0].quantity_allocated || 0, 10);
                const addQty = parseInt(quantity, 10);
                const newQuantity = currentQty + addQty;
                console.log('addToCart - Updating existing item:', { currentQty, addQty, newQuantity, currentAllocated });
                const newTotal = unitPrice * newQuantity;
                
                lineItemId = existingLineItem.rows[0].id;
                
                // Update line item (allocation will happen separately)
                await query(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET quantity_ordered = $1,
                        unit_price = $2,
                        line_total = $3,
                        updated_at = NOW()
                    WHERE id = $4
                `, [newQuantity, unitPrice, newTotal, lineItemId]);
                
                // Calculate how much additional allocation is needed
                quantityToAllocate = newQuantity - currentAllocated;
            } else {
                // Create new line item (without allocation initially)
                const lineItemOrderResult = await query(`
                    SELECT COALESCE(MAX(line_item_order), 0) + 1 as next_order
                    FROM "ORDERS-invoice-line-items"
                    WHERE fk_invoice_id = $1
                `, [invoiceId]);
                const lineItemOrder = lineItemOrderResult.rows[0].next_order;
                
                const insertQuantity = parseInt(quantity);
                console.log('addToCart - Creating new line item:', { quantity: insertQuantity, unitPrice, lineTotal });
                const lineItemResult = await query(`
                    INSERT INTO "ORDERS-invoice-line-items" (
                        fk_invoice_id, fk_master_product_id, fk_batch_id,
                        quantity_ordered, quantity_allocated, unit_price, line_total, line_item_order
                    ) VALUES ($1, $2, $3, $4, 0, $5, $6, $7)
                    RETURNING id
                `, [invoiceId, batch.fk_master_product_id, batch_id, insertQuantity, unitPrice, lineTotal, lineItemOrder]);
                
                lineItemId = lineItemResult.rows[0].id;
            }
            
            // CRITICAL: Allocate inventory according to Module 4 requirements
            // This prevents overselling and updates allocated_quantity immediately
            if (quantityToAllocate > 0) {
                const allocationService = require('../Services/allocationService');
                const allocationResult = await allocationService.allocateBatchToInvoice(
                    batch_id,
                    quantityToAllocate,
                    invoiceId,
                    lineItemId
                );
                
                if (!allocationResult.success) {
                    // Allocation failed - rollback line item changes
                    if (existingLineItem.rows.length > 0) {
                        // Revert quantity_ordered
                        const currentQty = parseInt(existingLineItem.rows[0].quantity_ordered, 10);
                        const revertQty = currentQty - quantityToAllocate;
                        await query(`
                            UPDATE "ORDERS-invoice-line-items"
                            SET quantity_ordered = $1,
                                line_total = $1 * unit_price,
                                updated_at = NOW()
                            WHERE id = $2
                        `, [revertQty, lineItemId]);
                    } else {
                        // Delete the line item we just created
                        await query(`
                            DELETE FROM "ORDERS-invoice-line-items"
                            WHERE id = $1
                        `, [lineItemId]);
                    }
                    
                    return res.status(400).json({ 
                        error: allocationResult.error || 'Failed to allocate inventory',
                        available: allocationResult.available,
                        requested: allocationResult.requested
                    });
                }
                
                console.log('✅ Inventory allocated successfully:', {
                    batchId: batch_id,
                    quantityAllocated: quantityToAllocate,
                    remainingAvailable: allocationResult.remaining_available
                });
            }
            
            // Recalculate invoice totals - OPTIMIZED: Single UPDATE with subquery instead of two queries
            const updateResult = await query(`
                UPDATE "ORDERS-invoices"
                SET subtotal = (
                    SELECT COALESCE(SUM(line_total), 0)
                    FROM "ORDERS-invoice-line-items"
                    WHERE fk_invoice_id = $1
                ),
                total = (
                    SELECT COALESCE(SUM(line_total), 0)
                    FROM "ORDERS-invoice-line-items"
                    WHERE fk_invoice_id = $1
                ),
                updated_at = NOW()
                WHERE id = $1
                RETURNING subtotal, total
            `, [invoiceId]);
            
            const subtotal = parseFloat(updateResult.rows[0].subtotal || 0);
            const total = subtotal;
            
            console.log('Cart item added:', {
                invoiceId,
                invoiceNumber,
                batchId: batch_id,
                quantity,
                quantityAllocated: quantityToAllocate,
                subtotal,
                total
            });
            
            res.json({ 
                success: true, 
                message: 'Item added to cart',
                invoice_id: invoiceId,
                invoice_number: invoiceNumber
            });
        } catch (error) {
            console.error('Error adding to cart:', error);
            res.status(500).json({ error: 'Failed to add item to cart', details: error.message });
        }
    }
    
    /**
     * Remove item from cart
     */
    static async removeFromCart(req, res) {
        try {
            const portalAccess = req.session.portalAccess;
            const { line_item_id, batch_id } = req.body;
            
            if (!portalAccess) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            
            if (!line_item_id) {
                return res.status(400).json({ error: 'Invalid line_item_id' });
            }
            
            // Get the invoice ID and batch ID from the line item
            const lineItemResult = await query(`
                SELECT li.fk_invoice_id, li.fk_batch_id
                FROM "ORDERS-invoice-line-items" li
                WHERE li.id = $1
            `, [line_item_id]);
            
            if (lineItemResult.rows.length === 0) {
                return res.status(404).json({ error: 'Line item not found' });
            }
            
            const invoiceId = lineItemResult.rows[0].fk_invoice_id;
            const actualBatchId = lineItemResult.rows[0].fk_batch_id;
            const batchIdToDelete = batch_id || actualBatchId; // Use provided batch_id or the one from the line item
            
            // Verify invoice belongs to this buyer/location
            const invoiceCheck = await query(`
                SELECT id FROM "ORDERS-invoices"
                WHERE id = $1
                AND fk_buyer_id = $2
                AND fk_location_id = $3
                AND status = 'Draft'
                AND source = 'External'
            `, [invoiceId, portalAccess.buyerId, portalAccess.locationId]);
            
            if (invoiceCheck.rows.length === 0) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
            
            // If batch_id is provided, delete ALL line items for that batch in this invoice
            // This handles the case where duplicates exist (same batch, multiple line items)
            // Otherwise, just delete the specific line_item_id
            let deleteQuery;
            let deleteParams;
            
            if (batch_id) {
                // Delete all line items for this batch (handles duplicates)
                deleteQuery = `
                    DELETE FROM "ORDERS-invoice-line-items"
                    WHERE fk_invoice_id = $1 AND fk_batch_id = $2
                    RETURNING id
                `;
                deleteParams = [invoiceId, batchIdToDelete];
            } else {
                // Delete only the specific line item
                deleteQuery = `
                    DELETE FROM "ORDERS-invoice-line-items"
                    WHERE id = $1
                    RETURNING id
                `;
                deleteParams = [line_item_id];
            }
            
            const deleteResult = await query(deleteQuery, deleteParams);
            
            if (deleteResult.rows.length === 0) {
                return res.status(404).json({ error: 'Line item not found or already deleted' });
            }
            
            console.log('removeFromCart - Deleted line items:', { 
                deleted_count: deleteResult.rows.length,
                line_item_id, 
                batch_id: batchIdToDelete,
                invoice_id: invoiceId 
            });
            
            // Recalculate invoice totals
            const totalsResult = await query(`
                SELECT 
                    COALESCE(SUM(line_total), 0) as subtotal,
                    COALESCE(SUM(quantity_ordered), 0) as total_items
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [invoiceId]);
            
            const subtotal = parseFloat(totalsResult.rows[0].subtotal || 0);
            const total = subtotal;
            
            await query(`
                UPDATE "ORDERS-invoices"
                SET subtotal = $1,
                    total = $2,
                    updated_at = NOW()
                WHERE id = $3
            `, [subtotal, total, invoiceId]);
            
            // Check if invoice has no more items - delete it if empty
            const itemCountResult = await query(`
                SELECT COUNT(*) as count
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [invoiceId]);
            
            if (parseInt(itemCountResult.rows[0].count) === 0) {
                await query(`
                    DELETE FROM "ORDERS-invoices"
                    WHERE id = $1
                `, [invoiceId]);
            }
            
            res.json({ 
                success: true, 
                message: 'Item removed from cart'
            });
        } catch (error) {
            console.error('Error removing from cart:', error);
            res.status(500).json({ error: 'Failed to remove item from cart', details: error.message });
        }
    }
    
    /**
     * Update cart item quantity
     */
    static async updateCartItem(req, res) {
        try {
            const portalAccess = req.session.portalAccess;
            const { line_item_id, quantity } = req.body;
            
            if (!portalAccess) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            
            if (!line_item_id || !quantity || quantity <= 0) {
                return res.status(400).json({ error: 'Invalid line_item_id or quantity' });
            }
            
            // Get the line item and verify it belongs to this buyer
            const lineItemResult = await query(`
                SELECT li.id, li.fk_invoice_id, li.unit_price, li.fk_batch_id, li.fk_master_product_id,
                       i.fk_buyer_id, i.fk_location_id
                FROM "ORDERS-invoice-line-items" li
                INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                WHERE li.id = $1
            `, [line_item_id]);
            
            if (lineItemResult.rows.length === 0) {
                return res.status(404).json({ error: 'Line item not found' });
            }
            
            const lineItem = lineItemResult.rows[0];
            
            // Verify invoice belongs to this buyer/location
            if (lineItem.fk_buyer_id !== portalAccess.buyerId || 
                lineItem.fk_location_id !== portalAccess.locationId) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
            
            // Check batch availability
            const batchResult = await query(`
                SELECT quantity, allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [lineItem.fk_batch_id]);
            
            if (batchResult.rows.length === 0) {
                return res.status(404).json({ error: 'Batch not found' });
            }
            
            const batch = batchResult.rows[0];
            const available = batch.quantity - batch.allocated_quantity;
            
            if (quantity > available) {
                return res.status(400).json({ error: `Only ${available} cases available` });
            }
            
            // Check if there are duplicate line items for this batch
            const duplicateCheck = await query(`
                SELECT COUNT(*) as count
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1 AND fk_batch_id = $2
            `, [lineItem.fk_invoice_id, lineItem.fk_batch_id]);
            
            const duplicateCount = parseInt(duplicateCheck.rows[0].count);
            
            // If there are duplicates, delete all of them and create a new one with the desired quantity
            // Otherwise, just update the existing one
            if (duplicateCount > 1) {
                // Get the next line item order BEFORE deleting (to preserve max order)
                const lineItemOrderResult = await query(`
                    SELECT COALESCE(MAX(line_item_order), 0) + 1 as next_order
                    FROM "ORDERS-invoice-line-items"
                    WHERE fk_invoice_id = $1
                `, [lineItem.fk_invoice_id]);
                const lineItemOrder = lineItemOrderResult.rows[0].next_order;
                
                // Delete all line items for this batch
                await query(`
                    DELETE FROM "ORDERS-invoice-line-items"
                    WHERE fk_invoice_id = $1 AND fk_batch_id = $2
                `, [lineItem.fk_invoice_id, lineItem.fk_batch_id]);
                
                // Create a new line item with the desired quantity
                // Use the product_id from lineItem (we have it from the SELECT above)
                const unitPrice = lineItem.unit_price;
                const lineTotal = unitPrice * quantity;
                
                await query(`
                    INSERT INTO "ORDERS-invoice-line-items" (
                        fk_invoice_id, fk_master_product_id, fk_batch_id,
                        quantity_ordered, unit_price, line_total, line_item_order
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [lineItem.fk_invoice_id, lineItem.fk_master_product_id, 
                     lineItem.fk_batch_id, quantity, unitPrice, lineTotal, lineItemOrder]);
                
                console.log('updateCartItem - Merged duplicates and created new item:', {
                    invoice_id: lineItem.fk_invoice_id,
                    batch_id: lineItem.fk_batch_id,
                    quantity,
                    deleted_duplicates: duplicateCount
                });
            } else {
                // Update the single line item
                const unitPrice = lineItem.unit_price;
                const lineTotal = unitPrice * quantity;
                
                await query(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET quantity_ordered = $1,
                        line_total = $2,
                        updated_at = NOW()
                    WHERE id = $3
                `, [quantity, lineTotal, line_item_id]);
                
                console.log('updateCartItem - Updated line item:', {
                    line_item_id,
                    quantity
                });
            }
            
            // Recalculate invoice totals
            const totalsResult = await query(`
                SELECT 
                    COALESCE(SUM(line_total), 0) as subtotal
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [lineItem.fk_invoice_id]);
            
            const subtotal = parseFloat(totalsResult.rows[0].subtotal || 0);
            const total = subtotal;
            
            await query(`
                UPDATE "ORDERS-invoices"
                SET subtotal = $1,
                    total = $2,
                    updated_at = NOW()
                WHERE id = $3
            `, [subtotal, total, lineItem.fk_invoice_id]);
            
            res.json({ 
                success: true, 
                message: 'Quantity updated',
                subtotal: subtotal,
                total: total
            });
        } catch (error) {
            console.error('Error updating cart item:', error);
            res.status(500).json({ error: 'Failed to update quantity', details: error.message });
        }
    }
    
    /**
     * Show checkout page
     */
    static async showCheckout(req, res) {
        try {
            const { uuid } = req.params;
            const portalAccess = req.session.portalAccess || {};
            
            // Get cart items for display
            const cartData = await PortalController.getCartData(portalAccess);
            
            // Get ALL locations for this buyer (for dropdown)
            const allLocations = await query(`
                SELECT 
                    l.entry_id as location_id,
                    l.name,
                    l.line_one,
                    l.line_two,
                    l.city,
                    l.state,
                    l.zip,
                    l.state_license
                FROM "ORDERS-buyer_locations" l
                WHERE l.orders_buyer_id = $1
                ORDER BY l.name
            `, [portalAccess.buyerId]);
            
            // Get the current location data for shipping address pre-fill
            const locationData = await query(`
                SELECT 
                    l.name,
                    l.line_one as address,
                    l.line_two,
                    l.city,
                    l.state,
                    l.zip as zip_code
                FROM "ORDERS-buyer_locations" l
                WHERE l.entry_id = $1
            `, [portalAccess.locationId]);
            
            const shippingAddress = locationData.rows[0] || {};
            
            console.log('Checkout - Cart data:', {
                buyerId: portalAccess.buyerId,
                locationId: portalAccess.locationId,
                itemCount: cartData.items ? cartData.items.length : 0,
                subtotal: cartData.subtotal,
                total: cartData.total,
                locationsFound: allLocations.rows.length
            });
            
            res.render('external/checkout', {
                title: 'Checkout',
                layout: 'layouts/portal',
                cart: cartData,
                portalAccess: portalAccess,
                uuid: uuid,
                shippingAddress: shippingAddress,
                locations: allLocations.rows
            });
        } catch (error) {
            console.error('Error loading checkout:', error);
            res.status(500).render('external/error', {
                title: 'Error',
                layout: 'layouts/portal',
                error: 'Failed to load checkout',
                message: 'Please try again later'
            });
        }
    }
    
    /**
     * Show order confirmation page
     */
    static async showConfirmation(req, res) {
        try {
            const { uuid, invoiceId } = req.params;
            const portalAccess = req.session.portalAccess || {};
            
            // Get invoice details with sales rep info from location assignment
            // First verify the invoice belongs to this buyer (regardless of location)
            const invoiceCheck = await query(`
                SELECT 
                    i.id,
                    i.fk_buyer_id,
                    i.fk_location_id
                FROM "ORDERS-invoices" i
                WHERE i.id = $1 AND i.fk_buyer_id = $2
            `, [invoiceId, portalAccess.buyerId]);
            
            if (invoiceCheck.rows.length === 0) {
                return res.status(404).render('external/error', {
                    title: 'Order Not Found',
                    layout: 'layouts/portal',
                    error: 'Order Not Found',
                    message: 'The requested order could not be found.'
                });
            }
            
            // Get full invoice details with sales rep info
            const invoiceDetails = await query(`
                SELECT 
                    i.invoice_number,
                    i.total,
                    i.credit_applied,
                    COALESCE(u.first_name || ' ' || u.last_name, '') as sales_rep_full_name
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                LEFT JOIN users u ON l.assigned_sales_rep_id = u.id
                WHERE i.id = $1
            `, [invoiceId]);
            
            if (invoiceDetails.rows.length === 0) {
                return res.status(404).render('external/error', {
                    title: 'Order Not Found',
                    layout: 'layouts/portal',
                    error: 'Order Not Found',
                    message: 'The requested order could not be found.'
                });
            }
            
            // Update session location to match invoice location (in case it changed)
            const invoiceLocationId = invoiceCheck.rows[0].fk_location_id;
            if (invoiceLocationId && invoiceLocationId !== portalAccess.locationId) {
                req.session.portalAccess.locationId = invoiceLocationId;
            }
            
            const invoice = invoiceDetails.rows[0];
            const salesRepName = invoice.sales_rep_full_name && invoice.sales_rep_full_name.trim() 
                ? invoice.sales_rep_full_name.trim() 
                : null;
            
            res.render('external/order-confirmation', {
                title: 'Order Confirmation',
                layout: 'layouts/portal',
                uuid: uuid,
                invoiceNumber: invoice.invoice_number,
                orderTotal: invoice.total,
                creditApplied: invoice.credit_applied || 0,
                salesRepName: salesRepName
            });
        } catch (error) {
            console.error('Error loading confirmation:', error);
            res.status(500).render('external/error', {
                title: 'Error',
                layout: 'layouts/portal',
                error: 'Failed to load confirmation',
                message: 'Please try again later'
            });
        }
    }
    
    /**
     * Helper method to get cart data
     */
    static async getCartData(portalAccess) {
        try {
            if (!portalAccess || !portalAccess.buyerId || !portalAccess.locationId) {
                return { items: [], subtotal: 0, total: 0, invoice_id: null };
            }
            
            // Get active draft invoice for this buyer/location
            // OPTIMIZED: Simplified query structure - filter invoice first, then join
            const draftInvoice = await query(`
                WITH invoice_base AS (
                    SELECT id, subtotal, total
                    FROM "ORDERS-invoices"
                    WHERE fk_buyer_id = $1
                    AND fk_location_id = $2
                    AND status = 'Draft'
                    AND source = 'External'
                    AND (cart_expires_at IS NULL OR cart_expires_at > NOW())
                    ORDER BY created_at DESC
                    LIMIT 1
                ),
                line_items_agg AS (
                    SELECT 
                        li.fk_invoice_id,
                        li.fk_batch_id,
                        li.fk_master_product_id,
                        SUM(li.quantity_ordered)::INTEGER as total_quantity,
                        AVG(li.unit_price) as unit_price,
                        SUM(li.line_total) as total_line_total,
                        MAX(li.id) as line_item_id,
                        MAX(li.line_item_order) as line_item_order
                    FROM "ORDERS-invoice-line-items" li
                    INNER JOIN invoice_base ib ON li.fk_invoice_id = ib.id
                    GROUP BY li.fk_invoice_id, li.fk_batch_id, li.fk_master_product_id
                )
                SELECT 
                    ib.id as invoice_id,
                    ib.subtotal,
                    ib.total,
                    COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'line_item_id', lia.line_item_id,
                                'product_id', lia.fk_master_product_id,
                                'batch_id', lia.fk_batch_id,
                                'product_name', p.name,
                                'cultivar_name', p.cultivar_name,
                                'brand_name', p.brand_name,
                                'category_name', p.category_name,
                                'product_type', p.product_type_name,
                                'units_per_case', p.units_per_case,
                                'unit_size', p.unit_size,
                                'unit_measurement_name', p.unit_measurement_name,
                                'batch_name', b.batch_name,
                                'quantity', lia.total_quantity,
                                'unit_price', lia.unit_price,
                                'line_total', lia.total_line_total,
                                'quantity_available', (b.quantity - b.allocated_quantity)::INTEGER
                            ) ORDER BY lia.line_item_order
                        ),
                        '[]'::jsonb
                    ) as items
                FROM invoice_base ib
                LEFT JOIN line_items_agg lia ON ib.id = lia.fk_invoice_id
                LEFT JOIN "ORDERS-products" p ON lia.fk_master_product_id = p.entry_id
                LEFT JOIN "ORDERS-batches" b ON lia.fk_batch_id = b.id
                GROUP BY ib.id, ib.subtotal, ib.total
            `, [portalAccess.buyerId, portalAccess.locationId]);
            
            if (draftInvoice.rows.length === 0) {
                console.log('getCartData - No draft invoice found', {
                    buyerId: portalAccess.buyerId,
                    locationId: portalAccess.locationId
                });
                return { items: [], subtotal: 0, total: 0, invoice_id: null };
            }
            
            const invoice = draftInvoice.rows[0];
            console.log('getCartData - Invoice found', {
                invoice_id: invoice.invoice_id,
                item_count: invoice.items ? invoice.items.length : 0,
                subtotal: invoice.subtotal,
                total: invoice.total
            });
            
            return {
                invoice_id: invoice.invoice_id,
                items: invoice.items || [],
                subtotal: parseFloat(invoice.subtotal || 0),
                total: parseFloat(invoice.total || 0)
            };
        } catch (error) {
            console.error('Error getting cart data:', error);
            return { items: [], subtotal: 0, total: 0, invoice_id: null };
        }
    }
    
    /**
     * Process checkout and submit cart for approval
     * Transitions external cart from Draft to Pending_Approval
     */
    static async updateInvoiceLocation(req, res) {
        try {
            const portalAccess = req.session.portalAccess;
            const { location_id } = req.body;
            
            if (!portalAccess) {
                return res.status(401).json({ success: false, error: 'Not authenticated' });
            }
            
            if (!location_id) {
                return res.status(400).json({ success: false, error: 'location_id is required' });
            }
            
            // Get cart data
            const cartData = await PortalController.getCartData(portalAccess);
            
            if (!cartData.invoice_id) {
                return res.status(400).json({ success: false, error: 'No active cart found' });
            }
            
            // Verify location belongs to the buyer
            const locationCheck = await query(`
                SELECT entry_id, state_license 
                FROM "ORDERS-buyer_locations"
                WHERE entry_id = $1 AND orders_buyer_id = $2
            `, [location_id, portalAccess.buyerId]);
            
            if (locationCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Location not found or not accessible' });
            }
            
            const locationLicense = locationCheck.rows[0].state_license || 'UNKNOWN';
            
            // Update invoice location
            await query(`
                UPDATE "ORDERS-invoices"
                SET fk_location_id = $1, 
                    location_license_number = $2,
                    updated_at = NOW()
                WHERE id = $3 AND fk_buyer_id = $4 AND status = 'Draft'
            `, [location_id, locationLicense, cartData.invoice_id, portalAccess.buyerId]);
            
            // Update session location for consistency
            req.session.portalAccess.locationId = location_id;
            
            res.json({ 
                success: true, 
                message: 'Invoice location updated successfully' 
            });
        } catch (error) {
            console.error('Error updating invoice location:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to update invoice location',
                details: error.message 
            });
        }
    }
    
    static async processCheckout(req, res) {
        try {
            const portalAccess = req.session.portalAccess;
            const { notes, location_id } = req.body;
            
            if (!portalAccess) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            
            // First, find the draft invoice for this buyer (regardless of current location)
            // Then update location if provided, then get cart data
            const draftInvoice = await query(`
                SELECT id, fk_location_id 
                FROM "ORDERS-invoices"
                WHERE fk_buyer_id = $1
                AND status = 'Draft'
                AND source = 'External'
                AND (cart_expires_at IS NULL OR cart_expires_at > NOW())
                ORDER BY created_at DESC
                LIMIT 1
            `, [portalAccess.buyerId]);
            
            if (draftInvoice.rows.length === 0) {
                return res.status(400).json({ error: 'No active cart found' });
            }
            
            const invoiceId = draftInvoice.rows[0].id;
            const currentLocationId = draftInvoice.rows[0].fk_location_id;
            
            // Update location if provided and different from current
            if (location_id && location_id !== currentLocationId) {
                // Verify location belongs to the buyer
                const locationCheck = await query(`
                    SELECT entry_id, state_license 
                    FROM "ORDERS-buyer_locations"
                    WHERE entry_id = $1 AND orders_buyer_id = $2
                `, [location_id, portalAccess.buyerId]);
                
                if (locationCheck.rows.length > 0) {
                    const locationLicense = locationCheck.rows[0].state_license || 'UNKNOWN';
                    
                    // Update invoice location
                    await query(`
                        UPDATE "ORDERS-invoices"
                        SET fk_location_id = $1, 
                            location_license_number = $2,
                            updated_at = NOW()
                        WHERE id = $3 AND fk_buyer_id = $4 AND status = 'Draft'
                    `, [location_id, locationLicense, invoiceId, portalAccess.buyerId]);
                    
                    // Update session location for consistency
                    req.session.portalAccess.locationId = location_id;
                    
                    console.log('Invoice location updated during checkout:', {
                        invoiceId,
                        oldLocation: currentLocationId,
                        newLocation: location_id
                    });
                } else {
                    console.warn('Location not found or not accessible:', location_id);
                }
            } else if (location_id) {
                // Location is same as current, just update session
                req.session.portalAccess.locationId = location_id;
            }
            
            // Get cart data (now with correct location in session and invoice)
            const cartData = await PortalController.getCartData(portalAccess);
            
            if (!cartData.invoice_id) {
                return res.status(400).json({ error: 'No active cart found' });
            }
            
            if (!cartData.items || cartData.items.length === 0) {
                return res.status(400).json({ error: 'Cart is empty' });
            }
            
            // Update customer notes if provided
            if (notes) {
                await query(`
                    UPDATE "ORDERS-invoices"
                    SET customer_notes = $1
                    WHERE id = $2
                `, [notes, cartData.invoice_id]);
            }
            
            // Apply available credits to invoice
            const accountCreditService = require('../Services/accountCreditService');
            const creditResult = await accountCreditService.applyCreditsToInvoice(cartData.invoice_id);
            console.log('Credit application result:', creditResult);
            
            // Note: Purchase limit validation happens inside state machine transition
            // No need to validate twice - state machine handles it
            
            // Submit cart for approval using state machine
            // Note: For external portal orders, there's no logged-in user, so pass null for userId
            // The system will record this as a system change
            console.log('Starting state machine transition to Pending_Approval...');
            const invoiceStateMachine = require('../Services/invoiceStateMachineService');
            const result = await invoiceStateMachine.transitionTo(
                cartData.invoice_id,
                'Pending_Approval',
                null, // No user ID for external portal orders - system change
                'External order submitted'
            );
            
            console.log('State machine transition result:', result);
            
            if (!result.success) {
                console.error('State machine transition failed:', result.error);
                return res.status(400).json({ 
                    success: false,
                    error: result.error || 'Failed to submit order',
                    validTransitions: result.validTransitions
                });
            }
            
            console.log(`✅ Invoice ${cartData.invoice_id} successfully transitioned to Pending_Approval`);
            
            // Return JSON with invoice_id for client redirect
            res.json({ 
                success: true, 
                message: 'Order submitted successfully and pending approval',
                invoice_id: cartData.invoice_id,
                credit_applied: creditResult.applied || 0
            });
        } catch (error) {
            console.error('Error processing checkout:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to process checkout',
                details: error.message 
            });
        }
    }

    /**
     * Extend cart expiry (one-time only)
     * POST /api/portal/:uuid/cart/extend
     */
    static async extendCart(req, res) {
        try {
            const portalAccess = req.session.portalAccess;
            
            if (!portalAccess) {
                return res.status(401).json({ success: false, error: 'Not authenticated' });
            }

            // Get current cart (draft invoice)
            const cartData = await PortalController.getCartData(portalAccess);
            
            if (!cartData.invoice_id) {
                return res.status(400).json({ success: false, error: 'No active cart found' });
            }

            const invoiceId = cartData.invoice_id;

            // Check if cart can be extended
            const invoice = await query(`
                SELECT cart_extended, cart_expires_at, status, source
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Cart not found' });
            }

            const invoiceData = invoice.rows[0];

            // Verify it's a draft external cart
            if (invoiceData.status !== 'Draft' || invoiceData.source !== 'External') {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Only draft external carts can be extended' 
                });
            }

            // Check if already extended
            if (invoiceData.cart_extended) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Cart can only be extended once' 
                });
            }

            // Extend by 24 hours using server time
            const result = await query(`
                UPDATE "ORDERS-invoices"
                SET cart_expires_at = cart_expires_at + INTERVAL '24 hours',
                    cart_extended = TRUE,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING cart_expires_at
            `, [invoiceId]);

            const newExpiry = result.rows[0].cart_expires_at;

            console.log(`✅ Cart ${invoiceId} extended. New expiry: ${newExpiry}`);

            res.json({ 
                success: true, 
                message: 'Cart extended successfully',
                cart_expires_at: newExpiry
            });
        } catch (error) {
            console.error('Error extending cart:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to extend cart',
                details: error.message 
            });
        }
    }
}

module.exports = PortalController;

