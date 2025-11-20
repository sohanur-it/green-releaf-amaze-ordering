// Server/Controllers/portalController.js

const { query } = require('../config/database');
const cartCleanupService = require('../Services/cartCleanupService');
const websocketService = require('../Services/websocketService');
const lineItemHistoryService = require('../Services/lineItemHistoryService');

// Cache for system user ID (avoids repeated queries)
let cachedSystemUserId = null;
let systemUserIdCacheTime = 0;
const SYSTEM_USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

class PortalController {
    /**
     * Get cart expiry time in seconds from environment variable
     * Reads from CART_EXPIRY_TIME in production.env or local.env
     * Defaults to 86400 seconds (24 hours) if not set
     * @returns {number} Cart expiry time in seconds
     */
    static getCartExpiryTime() {
        const envExpiryTime = process.env.CART_EXPIRY_TIME;
        if (envExpiryTime) {
            const expirySeconds = parseInt(envExpiryTime, 10);
            if (!isNaN(expirySeconds) && expirySeconds > 0) {
                // Log once on first call to show what value is being used
                if (!PortalController._expiryTimeLogged) {
                    const hours = (expirySeconds / 3600).toFixed(1);
                    console.log(`📦 Cart expiry time from CART_EXPIRY_TIME env: ${expirySeconds} seconds (${hours} hours)`);
                    PortalController._expiryTimeLogged = true;
                }
                return expirySeconds;
            } else {
                // Invalid value in env
                if (!PortalController._expiryTimeLogged) {
                    console.warn(`⚠️ CART_EXPIRY_TIME env var is set but invalid (${envExpiryTime}), using default: 86400 seconds (24 hours)`);
                    PortalController._expiryTimeLogged = true;
                }
            }
        } else {
            // Not set in env
            if (!PortalController._expiryTimeLogged) {
                console.log(`📦 CART_EXPIRY_TIME not set in environment, using default: 86400 seconds (24 hours)`);
                PortalController._expiryTimeLogged = true;
            }
        }
        return 86400; // Default: 24 hours
    }
    
    /**
     * Get system user ID with caching
     */
    static async getSystemUserId() {
        const now = Date.now();
        if (cachedSystemUserId && (now - systemUserIdCacheTime) < SYSTEM_USER_CACHE_TTL) {
            return cachedSystemUserId;
        }

        try {
            // Try superuser flag first
            try {
                const superUserResult = await query(`
                    SELECT id FROM users 
                    WHERE is_superadmin = true
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
            
            // Auto-promote On Deck batches for products with 0 sellable inventory
            // This ensures batches are available when users view the catalog
            // IMPORTANT: Wait for all promotions to complete before querying products
            try {
                const batchStatusService = require('../Services/batchStatusService');
                
                // Find all products that have On Deck batches but no sellable inventory
                const productsNeedingPromotion = await query(`
                    SELECT DISTINCT b.fk_master_product_id as product_id
                    FROM "ORDERS-batches" b
                    WHERE b.status = 'On Deck'
                      AND b.fk_master_product_id IS NOT NULL
                      AND (b.quantity - b.allocated_quantity) > 0
                      AND b.full_package_count > 0
                      AND NOT EXISTS (
                          SELECT 1 FROM "ORDERS-batches" b2
                          WHERE b2.fk_master_product_id = b.fk_master_product_id
                          AND b2.status = 'Sellable'
                          AND (b2.quantity - b2.allocated_quantity) > 0
                          AND b2.full_package_count > 0
                      )
                `);
                
                // Auto-promote batches for each product - wait for all to complete
                const promotionPromises = [];
                for (const row of productsNeedingPromotion.rows) {
                    const productId = row.product_id;
                    const promotionPromise = (async () => {
                        try {
                            const isDepleted = await batchStatusService.isInventoryDepleted(productId);
                            if (isDepleted) {
                                console.log(`🔄 Auto-promoting On Deck batches for product ${productId} (catalog load)`);
                                await batchStatusService.promoteBatchesToSellable(productId, null);
                            }
                        } catch (promoError) {
                            console.error(`Error auto-promoting product ${productId}:`, promoError.message);
                            // Continue with other products even if one fails
                        }
                    })();
                    promotionPromises.push(promotionPromise);
                }
                
                // Wait for all promotions to complete before proceeding
                if (promotionPromises.length > 0) {
                    console.log(`⏳ Waiting for ${promotionPromises.length} batch promotion(s) to complete...`);
                    await Promise.allSettled(promotionPromises);
                    console.log(`✅ All batch promotions completed`);
                }
            } catch (autoPromoError) {
                console.error('Error during catalog auto-promotion check:', autoPromoError.message);
                // Continue loading catalog even if auto-promotion check fails
            }
            
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
                    -- Show Sellable batches always, and On Deck batches only if no Sellable batches exist
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
                        AND (
                            -- Always show Sellable batches
                            b.status = 'Sellable'
                            OR
                            -- Show On Deck batches only if no Sellable batches exist
                            (b.status = 'On Deck' AND NOT EXISTS (
                                SELECT 1 FROM "ORDERS-batches" b2
                                WHERE b2.fk_master_product_id = p.entry_id
                                AND b2.status = 'Sellable'
                                AND (b2.quantity - b2.allocated_quantity) > 0
                                AND b2.full_package_count > 0
                            ))
                        )
                        AND (b.quantity - b.allocated_quantity) > 0
                        AND b.full_package_count > 0  -- External portal only shows full packages
                    ) as available_batches
                FROM "ORDERS-products" p
                WHERE p.is_archived = false
                AND EXISTS (
                    SELECT 1 FROM "ORDERS-batches" b
                    WHERE b.fk_master_product_id = p.entry_id
                    AND (
                        -- Always show products with Sellable batches
                        b.status = 'Sellable'
                        OR
                        -- Show products with On Deck batches only if no Sellable batches exist
                        (b.status = 'On Deck' AND NOT EXISTS (
                            SELECT 1 FROM "ORDERS-batches" b2
                            WHERE b2.fk_master_product_id = p.entry_id
                            AND b2.status = 'Sellable'
                            AND (b2.quantity - b2.allocated_quantity) > 0
                            AND b2.full_package_count > 0
                        ))
                    )
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
            
            // Get buyer name and all locations for this buyer
            let buyerName = 'Buyer';
            let buyerLocations = [];
            let buyerInfo = null;
            let currentLocationName = portalAccess.locationName || null;
            
            if (portalAccess.buyerId) {
                try {
                    const buyerResult = await query(`
                        SELECT 
                            b.entry_id,
                            b.name,
                            b.website_url,
                            b.buyer_type
                        FROM "ORDERS-buyers" b
                        WHERE b.entry_id = $1
                    `, [portalAccess.buyerId]);
                    
                    if (buyerResult.rows.length > 0) {
                        buyerInfo = buyerResult.rows[0];
                        buyerName = buyerInfo.name || 'Buyer';
                    }
                    
                    // Get all locations for this buyer
                    const locationsResult = await query(`
                        SELECT 
                            entry_id,
                            name,
                            line_one,
                            line_two,
                            city,
                            state,
                            zip,
                            state_license,
                            access_code
                        FROM "ORDERS-buyer_locations"
                        WHERE orders_buyer_id = $1
                        ORDER BY name
                    `, [portalAccess.buyerId]);
                    
                    const portalAccessResult = await query(`
                        SELECT 
                            fk_location_id,
                            access_uuid,
                            is_active,
                            created_at
                        FROM "ORDERS-portal-access"
                        WHERE fk_buyer_id = $1
                        ORDER BY fk_location_id, created_at DESC
                    `, [portalAccess.buyerId]);
                    
                    const anyAccessByLocation = new Map();
                    const activeAccessByLocation = new Map();
                    
                    for (const row of portalAccessResult.rows) {
                        if (!anyAccessByLocation.has(row.fk_location_id)) {
                            anyAccessByLocation.set(row.fk_location_id, []);
                        }
                        anyAccessByLocation.get(row.fk_location_id).push(row);
                        
                        if (row.is_active && !activeAccessByLocation.has(row.fk_location_id)) {
                            activeAccessByLocation.set(row.fk_location_id, row);
                        }
                    }
                    
                    let systemUserIdForAccess = null;
                    
                    buyerLocations = [];
                    
                    for (const rawLocation of locationsResult.rows || []) {
                        const locationId = rawLocation.entry_id;
                        const hasAnyAccess = anyAccessByLocation.has(locationId);
                        let accessInfo = activeAccessByLocation.get(locationId);
                        
                        if (!hasAnyAccess) {
                            if (systemUserIdForAccess === null) {
                                systemUserIdForAccess = await PortalController.getSystemUserId();
                            }
                            
                            try {
                                // Get the location's access_code from CRM
                                const locationAccessCode = rawLocation.access_code;
                                
                                // Validation: Prevent portal access creation without a valid UUID access_code
                                if (!locationAccessCode) {
                                    console.error(`Location ${locationId} does not have an access_code. Cannot create portal access.`);
                                    continue;
                                }
                                
                                // Validate that access_code is a valid UUID format
                                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                                if (!uuidRegex.test(locationAccessCode)) {
                                    console.error(`Location ${locationId} has an invalid access_code format. Cannot create portal access.`);
                                    continue;
                                }
                                
                                // Create portal access using the location's access_code as UUID
                                const newAccess = await query(`
                                    INSERT INTO "ORDERS-portal-access" (
                                        fk_buyer_id,
                                        fk_location_id,
                                        access_uuid,
                                        is_active,
                                        created_by
                                    ) VALUES ($1, $2, $3, true, $4)
                                    RETURNING access_uuid, is_active
                                `, [portalAccess.buyerId, locationId, locationAccessCode, systemUserIdForAccess]);
                                
                                accessInfo = {
                                    fk_location_id: locationId,
                                    access_uuid: newAccess.rows[0].access_uuid,
                                    is_active: newAccess.rows[0].is_active
                                };
                                
                                activeAccessByLocation.set(locationId, accessInfo);
                                anyAccessByLocation.set(locationId, [accessInfo]);
                            } catch (createErr) {
                                // If it's a unique constraint violation, try to get existing access
                                if (createErr.code === '23505') { // Unique violation
                                    const existingAccess = await query(`
                                        SELECT access_uuid, is_active
                                        FROM "ORDERS-portal-access"
                                        WHERE fk_location_id = $1
                                        ORDER BY created_at DESC
                                        LIMIT 1
                                    `, [locationId]);
                                    
                                    if (existingAccess.rows.length > 0) {
                                        accessInfo = {
                                            fk_location_id: locationId,
                                            access_uuid: existingAccess.rows[0].access_uuid,
                                            is_active: existingAccess.rows[0].is_active
                                        };
                                        activeAccessByLocation.set(locationId, accessInfo);
                                        anyAccessByLocation.set(locationId, [accessInfo]);
                                    }
                                } else {
                                    console.error(`Error creating portal access for location ${locationId}:`, createErr);
                                }
                            }
                        }
                        
                        const portalUrl = accessInfo && accessInfo.is_active
                            ? `/external/store/${accessInfo.access_uuid}`
                            : null;
                        
                        const isCurrentLocation = locationId === portalAccess.locationId;

                        const locationData = {
                            ...rawLocation,
                            access_uuid: accessInfo ? accessInfo.access_uuid : null,
                            portal_is_active: !!(accessInfo && accessInfo.is_active),
                            portal_url: portalUrl,
                            portal_restricted: !portalUrl && (anyAccessByLocation.has(locationId) || hasAnyAccess),
                            is_current: isCurrentLocation
                        };
                        
                        buyerLocations.push(locationData);
                        
                        if (isCurrentLocation && rawLocation.name) {
                            currentLocationName = rawLocation.name;
                        }
                    }
                    
                    if (!currentLocationName && buyerLocations.length > 0) {
                        const currentLocation = buyerLocations.find(loc => loc.entry_id === portalAccess.locationId);
                        currentLocationName = currentLocation?.name || buyerLocations[0].name || currentLocationName;
                    }
                } catch (err) {
                    console.error('Error fetching buyer info:', err);
                }
            }
            
            const websocketPort = process.env.WEBSOCKET_PORT || 8080;
            
            res.render('external/store', {
                title: 'Product Catalog',
                layout: 'layouts/portal',
                products: productsWithImages,
                portalAccess: portalAccess,
                uuid: uuid,
                buyerName: buyerName,
                buyerLocations: buyerLocations,
                buyerInfo: buyerInfo,
                currentLocationName: currentLocationName,
                websocketPort
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
            
            // Get batch availability for all batches
            // CRITICAL: For batches already in cart, we need to include their allocated quantity
            // to show the correct available quantity for validation
            const batches = await query(`
                SELECT 
                    b.id as batch_id,
                    b.quantity,
                    b.allocated_quantity,
                    (b.quantity - b.allocated_quantity)::INTEGER as quantity_available,
                    -- Get quantity allocated to current cart for this batch
                    COALESCE((
                        SELECT SUM(li.quantity_allocated)
                        FROM "ORDERS-invoice-line-items" li
                        INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                        WHERE li.fk_batch_id = b.id
                          AND i.fk_buyer_id = $1
                          AND i.fk_location_id = $2
                          AND i.status = 'Draft'
                          AND i.source = 'External'
                          AND (i.cart_expires_at IS NULL OR i.cart_expires_at > NOW())
                    ), 0)::INTEGER as allocated_to_current_cart,
                    -- Available quantity including what's already in this cart
                    (b.quantity - b.allocated_quantity + COALESCE((
                        SELECT SUM(li.quantity_allocated)
                        FROM "ORDERS-invoice-line-items" li
                        INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                        WHERE li.fk_batch_id = b.id
                          AND i.fk_buyer_id = $1
                          AND i.fk_location_id = $2
                          AND i.status = 'Draft'
                          AND i.source = 'External'
                          AND (i.cart_expires_at IS NULL OR i.cart_expires_at > NOW())
                    ), 0))::INTEGER as quantity_available_for_cart
                FROM "ORDERS-batches" b
                WHERE b.status = 'Sellable'
            `, [portalAccess.buyerId, portalAccess.locationId]);
            
            // Return quantity_available_for_cart for items in cart, quantity_available for others
            const result = batches.rows.map(batch => ({
                batch_id: batch.batch_id,
                quantity_available: batch.allocated_to_current_cart > 0 
                    ? batch.quantity_available_for_cart 
                    : batch.quantity_available
            }));
            
            res.json({
                success: true,
                batches: result
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

            // First, check if there's an expired or cancelled draft cart lingering for this buyer/location
            // CRITICAL: Also check for cancelled invoices (they have cart_expires_at set to NOW())
            let statusCheck = '';
            try {
                const columnCheck = await query(`
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'ORDERS-invoices'
                    AND column_name = 'status'
                    LIMIT 1
                `);
                if (columnCheck.rows.length > 0) {
                    statusCheck = `AND (status = 'Draft' OR status = 'Cancelled')`;
                }
            } catch (err) {
                // Status column doesn't exist, skip status check
            }
            
            const expiredCart = await query(`
                SELECT id, cart_expires_at
                FROM "ORDERS-invoices"
                WHERE fk_buyer_id = $1
                  AND fk_location_id = $2
                  ${statusCheck}
                  AND source = 'External'
                  AND cart_expires_at IS NOT NULL
                  AND cart_expires_at <= NOW()
                ORDER BY cart_expires_at ASC
                LIMIT 1
            `, [portalAccess.buyerId, portalAccess.locationId]);

            if (expiredCart.rows.length > 0) {
                const expiredCartId = expiredCart.rows[0].id;
                try {
                    console.log(`🧹 Detected expired cart ${expiredCartId} during getCart. Deleting immediately...`);
                    const cleanupResult = await cartCleanupService.clearExpiredCart(expiredCartId);
                    if (cleanupResult.success) {
                        console.log(`✅ Expired cart ${expiredCartId} deleted successfully`);
                    } else {
                        console.log(`⏭️  Expired cart ${expiredCartId} cleanup skipped: ${cleanupResult.reason}`);
                    }
                } catch (cleanupError) {
                    console.error(`❌ Failed to delete expired cart ${expiredCartId}:`, cleanupError.message);
                    // Continue gracefully so the user can still view their cart (which will be empty)
                }
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
                        SUM(li.quantity_allocated) as total_allocated,
                        AVG(li.unit_price) as unit_price,
                        SUM(li.line_total) as total_line_total,
                        MAX(li.id) as line_item_id,
                        MAX(li.line_item_order) as line_item_order
                    FROM "ORDERS-invoice-line-items" li
                    INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                    WHERE i.fk_buyer_id = $1
                    AND i.fk_location_id = $2
                    AND i.status = 'Draft'
                    AND i.status != 'Cancelled'
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
                            'quantity_allocated', COALESCE(lia.total_allocated, 0)::INTEGER,
                            'unit_price', lia.unit_price,
                            'line_total', lia.total_line_total,
                            'image_url', COALESCE(
                                (SELECT '/public/' || file_path 
                                 FROM "ORDERS-product-images" pi
                                 WHERE pi.fk_product_id = p.entry_id
                                   AND pi.is_deleted = false
                                   AND pi.is_featured = true
                                 ORDER BY pi.uploaded_at ASC
                                 LIMIT 1),
                                '/public/images/placeholder.jpg'
                            )
                        ) ORDER BY lia.line_item_order
                    ) as items
                FROM "ORDERS-invoices" i
                INNER JOIN line_items_aggregated lia ON i.id = lia.fk_invoice_id
                INNER JOIN "ORDERS-products" p ON lia.fk_master_product_id = p.entry_id
                INNER JOIN "ORDERS-batches" b ON lia.fk_batch_id = b.id
                WHERE i.fk_buyer_id = $1
                AND i.fk_location_id = $2
                AND i.status = 'Draft'
                AND i.status != 'Cancelled'
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
            
            // Get cart expiry information
            const expiryInfo = await query(`
                SELECT cart_expires_at, cart_started_at, extended_until, cart_extended
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoice.invoice_id]);
            
            const expiryData = expiryInfo.rows[0] || {};
            
            return res.json({
                invoice_id: invoice.invoice_id,
                items: invoice.items || [],
                subtotal: parseFloat(invoice.subtotal || 0),
                total: parseFloat(invoice.total || 0),
                cart_expires_at: expiryData.cart_expires_at,
                cart_started_at: expiryData.cart_started_at,
                extended_until: expiryData.extended_until,
                cart_extended: expiryData.cart_extended || false
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
        // Use transaction to ensure atomicity
        const { pool } = require('../config/database');
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const portalAccess = req.session.portalAccess;
            const { batch_id, quantity: quantityParam, client_session_id: clientSessionIdRaw } = req.body;
            const clientSessionId = clientSessionIdRaw ? String(clientSessionIdRaw) : null;
            
            if (!portalAccess) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(401).json({ error: 'Not authenticated' });
            }

            const systemUserId = await PortalController.getSystemUserId();
            
            // Parse and validate quantity - ensure it's an integer
            const quantity = parseInt(quantityParam, 10);
            if (!batch_id || !quantity || isNaN(quantity) || quantity <= 0) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(400).json({ error: 'Invalid batch_id or quantity' });
            }
            
            console.log('addToCart - Request:', { batch_id, quantity, original_quantity: quantityParam, quantity_type: typeof quantityParam });
            
            // Get batch information to find product and price
            // Use FOR UPDATE to lock the batch row and prevent race conditions
            // This ensures availability check and allocation happen atomically
            let batchResult = await client.query(`
                SELECT 
                    b.id,
                    b.fk_master_product_id,
                    b.override_price,
                    b.quantity,
                    b.allocated_quantity,
                    b.status,
                    p.default_price,
                    p.name as product_name
                FROM "ORDERS-batches" b
                INNER JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
                WHERE b.id = $1
                AND b.status = 'Sellable'
                FOR UPDATE
            `, [batch_id]);
            
            // If not found as Sellable, check if batch exists with other status
            if (batchResult.rows.length === 0) {
                const batchCheck = await client.query(`
                    SELECT 
                        b.id,
                        b.fk_master_product_id,
                        b.status,
                        b.quantity,
                        b.allocated_quantity,
                        p.name as product_name
                    FROM "ORDERS-batches" b
                    INNER JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
                    WHERE b.id = $1
                `, [batch_id]);
                
                if (batchCheck.rows.length === 0) {
                    return res.status(404).json({ error: 'Batch not found' });
                }
                
                const batchInfo = batchCheck.rows[0];
                const batchStatus = batchInfo.status;
                const productId = batchInfo.fk_master_product_id;
                
                // If batch is 'On Hold', return clear error
                if (batchStatus === 'On Hold') {
                    return res.status(400).json({ 
                        error: 'Batch is on hold and cannot be added to cart',
                        batch_status: 'On Hold'
                    });
                }
                
                // If batch is 'On Deck', try to auto-promote if no sellable batches available
                if (batchStatus === 'On Deck') {
                    // Check if there are any sellable batches for this product
                    const sellableCheck = await client.query(`
                        SELECT SUM(quantity - allocated_quantity) as available
                        FROM "ORDERS-batches"
                        WHERE fk_master_product_id = $1
                          AND status = 'Sellable'
                    `, [productId]);
                    
                    const availableQty = parseInt(sellableCheck.rows[0].available || 0);
                    
                    // If no sellable inventory, auto-promote this On Deck batch
                    if (availableQty === 0) {
                        console.log(`Auto-promoting On Deck batch ${batch_id} to Sellable (no sellable inventory available)`);
                        
                        // Promote the batch to Sellable
                        await client.query(`
                            UPDATE "ORDERS-batches"
                            SET status = 'Sellable', updated_at = NOW()
                            WHERE id = $1
                        `, [batch_id]);
                        
                        // Log to batch history
                        await client.query(`
                            INSERT INTO "ORDERS-batch-history" (
                                batch_id, change_type, field_name,
                                old_value, new_value, reason,
                                changed_by_system
                            ) VALUES ($1, 'status_changed', 'status', 'On Deck', 'Sellable', 
                                      'Auto-promoted: No sellable inventory available, batch requested via portal', true)
                        `, [batch_id]);
                        
                        // Now fetch the batch as Sellable with FOR UPDATE lock
                        batchResult = await client.query(`
                            SELECT 
                                b.id,
                                b.fk_master_product_id,
                                b.override_price,
                                b.quantity,
                                b.allocated_quantity,
                                b.status,
                                p.default_price,
                                p.name as product_name
                            FROM "ORDERS-batches" b
                            INNER JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
                            WHERE b.id = $1
                            AND b.status = 'Sellable'
                            FOR UPDATE
                        `, [batch_id]);
                    } else {
                        // There are sellable batches available, so don't auto-promote
                        return res.status(400).json({ 
                            error: 'Batch is not yet available for sale. Please select an available batch.',
                            batch_status: 'On Deck',
                            message: 'Sellable batches are still available for this product'
                        });
                    }
                }
                
                // If still not found after promotion attempt, return error
                if (batchResult.rows.length === 0) {
                    return res.status(404).json({ 
                        error: 'Batch not found or not available',
                        batch_status: batchStatus
                    });
                }
            }
            
            const batch = batchResult.rows[0];
            
            // Check availability
            const available = batch.quantity - batch.allocated_quantity;
            if (quantity > available) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(400).json({ error: `Only ${available} cases available` });
            }
            
            // Get or create draft invoice
            // Note: Only reuse Draft invoices. If invoice was checked out, it's now Pending_Approval
            // and we'll create a new Draft invoice for the next cart session
            let invoiceResult;
            try {
                invoiceResult = await client.query(`
                    SELECT id, invoice_number, status
                    FROM "ORDERS-invoices"
                    WHERE fk_buyer_id = $1
                    AND fk_location_id = $2
                    AND status = 'Draft'
                    AND (status IS NULL OR status != 'Cancelled')
                    AND source = 'External'
                    AND (cart_expires_at IS NULL OR cart_expires_at > NOW())
                    ORDER BY created_at DESC
                    LIMIT 1
                `, [portalAccess.buyerId, portalAccess.locationId]);
            } catch (err) {
                // Fallback if 'source' column doesn't exist - check by invoice_number pattern
                if (err.code === '42703') {
                    console.log('Source column not found, using invoice_number pattern fallback');
                    invoiceResult = await client.query(`
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
                    const maxNumberResult = await client.query(`
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
                        const countResult = await client.query(`
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
                    const locationResult = await client.query(`
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
                
                // Set cart expiry from CART_EXPIRY_TIME environment variable
                const expirySeconds = PortalController.getCartExpiryTime();
                const cartExpiresAt = new Date();
                cartExpiresAt.setSeconds(cartExpiresAt.getSeconds() + expirySeconds);
                console.log(`📅 New cart created with expiry: ${cartExpiresAt.toISOString()} (${expirySeconds} seconds from now)`);
                
                const newInvoiceResult = await client.query(`
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
            
            // Check if this is the first item being added (set cart_started_at and extended_until)
            const existingItemsCount = await client.query(`
                SELECT COUNT(*) as count
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [invoiceId]);
            
            const isFirstItem = parseInt(existingItemsCount.rows[0].count) === 0;
            
            if (isFirstItem) {
                // First item: Set cart_started_at and calculate extended_until (48 hours from cart_started_at)
                const now = new Date();
                const extendedUntil = new Date(now);
                extendedUntil.setHours(extendedUntil.getHours() + 48);
                
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET cart_started_at = NOW(),
                        extended_until = $1
                    WHERE id = $2
                `, [extendedUntil, invoiceId]);
                
                console.log('addToCart - First item added, set cart_started_at and extended_until:', { invoiceId, extendedUntil });
            }
            
            // Check if line item already exists for this batch - OPTIMIZED: Single query
            const existingLineItem = await client.query(`
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
            let isNewLineItem = false;
            
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
                await client.query(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET quantity_ordered = $1,
                        unit_price = $2,
                        line_total = $3,
                        updated_at = NOW()
                    WHERE id = $4
                `, [newQuantity, unitPrice, newTotal, lineItemId]);
                
                // Calculate how much additional allocation is needed
                quantityToAllocate = newQuantity - currentAllocated;

                await lineItemHistoryService.addLineItemHistoryEntry({
                    client,
                    lineItemId,
                    modificationType: 'quantity_changed',
                    fieldChanged: 'quantity_ordered',
                    oldValue: currentQty.toString(),
                    newValue: newQuantity.toString(),
                    reason: 'Quantity increased via external cart add',
                    changedByUserId: systemUserId,
                    changedBySystem: true
                });
            } else {
                // Create new line item (without allocation initially)
                const lineItemOrderResult = await client.query(`
                    SELECT COALESCE(MAX(line_item_order), 0) + 1 as next_order
                    FROM "ORDERS-invoice-line-items"
                    WHERE fk_invoice_id = $1
                `, [invoiceId]);
                const lineItemOrder = lineItemOrderResult.rows[0].next_order;
                
                const insertQuantity = parseInt(quantity);
                console.log('addToCart - Creating new line item:', { quantity: insertQuantity, unitPrice, lineTotal });
                const lineItemResult = await client.query(`
                    INSERT INTO "ORDERS-invoice-line-items" (
                        fk_invoice_id, fk_master_product_id, fk_batch_id,
                        quantity_ordered, quantity_allocated, unit_price, line_total, line_item_order
                    ) VALUES ($1, $2, $3, $4, 0, $5, $6, $7)
                    RETURNING id
                `, [invoiceId, batch.fk_master_product_id, batch_id, insertQuantity, unitPrice, lineTotal, lineItemOrder]);
                
                lineItemId = lineItemResult.rows[0].id;
                isNewLineItem = true;

                await lineItemHistoryService.addLineItemHistoryEntry({
                    client,
                    lineItemId,
                    modificationType: 'created',
                    fieldChanged: null,
                    oldValue: null,
                    newValue: JSON.stringify({
                        quantity_ordered: insertQuantity,
                        unit_price: unitPrice,
                        line_total: lineTotal
                    }),
                    reason: 'Line item added via external cart',
                    changedByUserId: systemUserId,
                    changedBySystem: true
                });
            }
            
            // CRITICAL: Allocate inventory according to Module 4 requirements
            // This prevents overselling and updates allocated_quantity immediately
            // Pass the client to use the same transaction
            if (quantityToAllocate > 0) {
                const allocationService = require('../Services/allocationService');
                const allocationResult = await allocationService.allocateBatchToInvoice(
                    batch_id,
                    quantityToAllocate,
                    invoiceId,
                    lineItemId,
                    client // Pass client to use same transaction
                );
                
                if (!allocationResult.success) {
                    // Allocation failed - rollback entire transaction
                    await client.query('ROLLBACK');
                    client.release();
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
            const updateResult = await client.query(`
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
            
            // Fetch latest line item data for response
            const lineItemDataResult = await client.query(`
                SELECT 
                    id,
                    fk_batch_id,
                    quantity_ordered,
                    quantity_allocated,
                    unit_price,
                    line_total
                FROM "ORDERS-invoice-line-items"
                WHERE id = $1
            `, [lineItemId]);
            
            const lineItemData = lineItemDataResult.rows[0] || {
                id: lineItemId,
                fk_batch_id: batch_id,
                quantity_ordered: parseInt(quantity, 10),
                quantity_allocated: existingLineItem.rows.length > 0
                    ? parseInt(existingLineItem.rows[0].quantity_allocated || 0, 10) + Math.max(quantityToAllocate, 0)
                    : parseInt(quantity, 10),
                unit_price: unitPrice,
                line_total: lineTotal
            };

            const availabilitySnapshot = await client.query(`
                SELECT 
                    (quantity - allocated_quantity)::INTEGER AS quantity_available,
                    quantity,
                    allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [batch_id]);

            const batchQuantityAvailable = availabilitySnapshot.rows.length > 0
                ? parseInt(availabilitySnapshot.rows[0].quantity_available || 0, 10)
                : 0;

            const affectedBatch = {
                batch_id: parseInt(batch_id, 10),
                quantity_available: batchQuantityAvailable
            };
            
            console.log('Cart item added:', {
                invoiceId,
                invoiceNumber,
                batchId: batch_id,
                quantity_ordered: parseInt(lineItemData.quantity_ordered, 10),
                quantity_allocated: parseInt(lineItemData.quantity_allocated || 0, 10),
                subtotal,
                total
            });
            
            // Only broadcast to OTHER sessions (internal dashboard, other browser tabs)
            // External portal doesn't need to reload after its own actions
            const eventType = isNewLineItem ? 'line_item_added' : 'line_item_updated';
            websocketService.broadcastInvoiceEvent(invoiceId, eventType, {
                buyer_id: portalAccess.buyerId,
                location_id: portalAccess.locationId,
                triggered_by: 'external_portal', // Mark as external portal action
                triggered_by_session_id: clientSessionId,
                exclude_session: req.sessionID, // Don't send to the session that triggered it
                line_item: {
                    id: lineItemData.id,
                    batch_id: lineItemData.fk_batch_id,
                    quantity_ordered: parseInt(lineItemData.quantity_ordered, 10),
                    quantity_allocated: parseInt(lineItemData.quantity_allocated || 0, 10),
                    unit_price: parseFloat(lineItemData.unit_price || 0),
                    line_total: parseFloat(lineItemData.line_total || 0)
                },
                totals: {
                    subtotal,
                    total
                },
                affected_batches: [affectedBatch]
            }).catch(err => {
                console.error('WebSocket broadcast error (cart add):', err.message);
            });

            // Commit transaction
            await client.query('COMMIT');
            client.release();

            if (affectedBatch && Number.isFinite(affectedBatch.quantity_available)) {
                websocketService.broadcastInventoryUpdate(
                    affectedBatch.batch_id,
                    affectedBatch.quantity_available
                ).catch(err => {
                    console.error('WebSocket inventory broadcast error (cart add):', err.message);
                });
            }
            
            res.json({ 
                success: true, 
                message: 'Item added to cart',
                invoice_id: invoiceId,
                invoice_number: invoiceNumber,
                line_item_id: lineItemData.id,
                line_item: {
                    id: lineItemData.id,
                    batch_id: lineItemData.fk_batch_id,
                    quantity_ordered: parseInt(lineItemData.quantity_ordered, 10),
                    quantity_allocated: parseInt(lineItemData.quantity_allocated || 0, 10),
                    unit_price: parseFloat(lineItemData.unit_price || 0),
                    line_total: parseFloat(lineItemData.line_total || 0)
                },
                totals: {
                    subtotal,
                    total
                },
                is_new_line_item: isNewLineItem,
                batch_availability: affectedBatch
            });
        } catch (error) {
            console.error('Error adding to cart:', error);
            
            // Rollback transaction on any error
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
            client.release();
            
            res.status(500).json({ error: 'Failed to add item to cart', details: error.message });
        }
    }
    
    /**
     * Remove item from cart
     */
    static async removeFromCart(req, res) {
        try {
            const portalAccess = req.session.portalAccess;
            const { line_item_id, batch_id, client_session_id: clientSessionIdRaw } = req.body;
            const clientSessionId = clientSessionIdRaw ? String(clientSessionIdRaw) : null;
            
            if (!portalAccess) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            
            if (!line_item_id) {
                return res.status(400).json({ error: 'Invalid line_item_id' });
            }
            
            // Get the invoice ID, batch ID, allocated quantity, and invoice status
            const lineItemResult = await query(`
                SELECT li.fk_invoice_id, li.fk_batch_id, li.quantity_allocated,
                       i.status, i.cart_expires_at
                FROM "ORDERS-invoice-line-items" li
                INNER JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
                WHERE li.id = $1
            `, [line_item_id]);
            
            if (lineItemResult.rows.length === 0) {
                return res.status(404).json({ error: 'Line item not found' });
            }
            
            const invoiceId = lineItemResult.rows[0].fk_invoice_id;
            const actualBatchId = lineItemResult.rows[0].fk_batch_id;
            const allocatedQuantity = parseInt(lineItemResult.rows[0].quantity_allocated || 0, 10);
            const invoiceStatus = lineItemResult.rows[0].status;
            const cartExpiresAt = lineItemResult.rows[0].cart_expires_at;
            const batchIdToDelete = batch_id || actualBatchId; // Use provided batch_id or the one from the line item
            let affectedBatch = null;
            
            // CRITICAL: Verify invoice is still valid (not cancelled or expired)
            if (invoiceStatus === 'Cancelled') {
                return res.status(400).json({ 
                    error: 'This cart has been cancelled. Please refresh your cart.' 
                });
            }
            
            if (cartExpiresAt && new Date(cartExpiresAt) <= new Date()) {
                return res.status(400).json({ 
                    error: 'This cart has expired. Please refresh your cart.' 
                });
            }
            
            // Verify invoice belongs to this buyer/location
            const invoiceCheck = await query(`
                SELECT id FROM "ORDERS-invoices"
                WHERE id = $1
                AND fk_buyer_id = $2
                AND fk_location_id = $3
                AND (status = 'Draft' OR status IS NULL)
                AND source = 'External'
            `, [invoiceId, portalAccess.buyerId, portalAccess.locationId]);
            
            if (invoiceCheck.rows.length === 0) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
            
            // Get total allocated quantity for this batch before deletion
            // This is needed to deallocate properly
            let totalAllocatedToRelease = 0;
            if (batch_id) {
                // Get sum of all allocated quantities for this batch in this invoice
                const allocatedSumResult = await query(`
                    SELECT COALESCE(SUM(quantity_allocated), 0) as total_allocated
                    FROM "ORDERS-invoice-line-items"
                    WHERE fk_invoice_id = $1 AND fk_batch_id = $2
                `, [invoiceId, batchIdToDelete]);
                totalAllocatedToRelease = parseInt(allocatedSumResult.rows[0].total_allocated || 0, 10);
            } else {
                totalAllocatedToRelease = allocatedQuantity;
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
            const removedLineItemIds = deleteResult.rows.map(row => row.id);
            
            if (deleteResult.rows.length === 0) {
                return res.status(404).json({ error: 'Line item not found or already deleted' });
            }
            
            console.log('removeFromCart - Deleted line items:', { 
                deleted_count: deleteResult.rows.length,
                line_item_id, 
                batch_id: batchIdToDelete,
                invoice_id: invoiceId,
                allocated_to_release: totalAllocatedToRelease
            });
            
            // Deallocate batches - release the allocated quantity
            if (totalAllocatedToRelease > 0) {
                try {
                    const allocationService = require('../Services/allocationService');
                    const deallocationResult = await allocationService.releaseAllocation(
                        batchIdToDelete,
                        totalAllocatedToRelease,
                        invoiceId,
                        'Item removed from cart'
                    );
                    
                    if (!deallocationResult.success) {
                        console.error('Failed to deallocate batch:', deallocationResult.error);
                        // Continue anyway - the line item is deleted
                    } else {
                        console.log('removeFromCart - Successfully deallocated:', {
                            batch_id: batchIdToDelete,
                            quantity: totalAllocatedToRelease
                        });
                    }
                } catch (allocationError) {
                    console.error('Error deallocating batch:', allocationError);
                    // Continue anyway - the line item is deleted
                }
            }

            const availabilitySnapshot = await query(`
                SELECT 
                    (quantity - allocated_quantity)::INTEGER AS quantity_available
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [batchIdToDelete]);

            if (availabilitySnapshot.rows.length > 0) {
                affectedBatch = {
                    batch_id: parseInt(batchIdToDelete, 10),
                    quantity_available: parseInt(availabilitySnapshot.rows[0].quantity_available || 0, 10)
                };
            }
            
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
            
            const remainingCount = parseInt(itemCountResult.rows[0].count);
            if (remainingCount === 0) {
                // CRITICAL: Before deleting invoice, ensure all allocations are released
                // The last item's allocation was already released above, but double-check
                // that all batches are properly updated and inventory is broadcast
                
                // Get any batches that might still have allocations for this invoice
                // (This is a safety check - allocations should already be released)
                const remainingAllocations = await query(`
                    SELECT b.id as batch_id, b.allocated_quantity
                    FROM "ORDERS-batches" b
                    WHERE EXISTS (
                        SELECT 1 FROM "ORDERS-batch-history" bh
                        WHERE bh.batch_id = b.id
                        AND bh.related_invoice_id = $1
                        AND bh.change_type = 'allocation_increased'
                        AND NOT EXISTS (
                            SELECT 1 FROM "ORDERS-batch-history" bh2
                            WHERE bh2.batch_id = b.id
                            AND bh2.related_invoice_id = $1
                            AND bh2.change_type = 'allocation_decreased'
                            AND bh2.id > bh.id
                        )
                    )
                `, [invoiceId]);
                
                // Broadcast inventory updates for any affected batches
                const allocationService = require('../Services/allocationService');
                for (const batch of remainingAllocations.rows) {
                    try {
                        const batchInfo = await query(`
                            SELECT quantity, allocated_quantity
                            FROM "ORDERS-batches"
                            WHERE id = $1
                        `, [batch.batch_id]);
                        
                        if (batchInfo.rows.length > 0) {
                            const newAvailable = batchInfo.rows[0].quantity - batchInfo.rows[0].allocated_quantity;
                            await allocationService.broadcastInventoryUpdate(batch.batch_id, newAvailable);
                        }
                    } catch (err) {
                        console.error(`Failed to broadcast inventory for batch ${batch.batch_id}:`, err);
                    }
                }
                
                // Now delete the invoice (silent - no warnings, just like manual empty)
                await query(`
                    DELETE FROM "ORDERS-invoices"
                    WHERE id = $1
                `, [invoiceId]);
                
                websocketService.broadcastInvoiceEvent(invoiceId, 'invoice_deleted', {
                    buyer_id: portalAccess.buyerId,
                    location_id: portalAccess.locationId,
                    triggered_by: 'external_portal',
                    triggered_by_session_id: clientSessionId,
                    exclude_session: req.sessionID,
                    removed_line_item_ids: removedLineItemIds,
                    cleared: true,
                    ...(affectedBatch ? { affected_batches: [affectedBatch] } : {})
                }).catch(err => {
                    console.error('WebSocket broadcast error (cart remove - deleted):', err.message);
                });
            } else {
                websocketService.broadcastInvoiceEvent(invoiceId, 'line_item_removed', {
                    buyer_id: portalAccess.buyerId,
                    location_id: portalAccess.locationId,
                    triggered_by: 'external_portal',
                    triggered_by_session_id: clientSessionId,
                    exclude_session: req.sessionID,
                    removed_line_item_ids: removedLineItemIds,
                    totals: {
                        subtotal,
                        total
                    },
                    ...(affectedBatch ? { affected_batches: [affectedBatch] } : {})
                }).catch(err => {
                    console.error('WebSocket broadcast error (cart remove):', err.message);
                });
            }
            
            const responsePayload = {
                success: true, 
                message: 'Item removed from cart'
            };

            if (affectedBatch) {
                responsePayload.batch_availability = affectedBatch;
            }

            res.json(responsePayload);

            if (affectedBatch && Number.isFinite(affectedBatch.quantity_available)) {
                websocketService.broadcastInventoryUpdate(
                    affectedBatch.batch_id,
                    affectedBatch.quantity_available
                ).catch(err => {
                    console.error('WebSocket inventory broadcast error (cart update):', err.message);
                });
            }

            if (affectedBatch && Number.isFinite(affectedBatch.quantity_available)) {
                websocketService.broadcastInventoryUpdate(
                    affectedBatch.batch_id,
                    affectedBatch.quantity_available
                ).catch(err => {
                    console.error('WebSocket inventory broadcast error (cart remove):', err.message);
                });
            }
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
            const { line_item_id, quantity, client_session_id: clientSessionIdRaw } = req.body;
            const clientSessionId = clientSessionIdRaw ? String(clientSessionIdRaw) : null;
            
            if (!portalAccess) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            
            if (!line_item_id || !quantity || quantity <= 0) {
                return res.status(400).json({ error: 'Invalid line_item_id or quantity' });
            }
            
            // Get the line item and verify it belongs to this buyer and invoice is still valid
            const lineItemResult = await query(`
                SELECT li.id, li.fk_invoice_id, li.unit_price, li.fk_batch_id, li.fk_master_product_id,
                       li.quantity_ordered, li.quantity_allocated,
                       i.fk_buyer_id, i.fk_location_id, i.status, i.cart_expires_at
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
            
            const systemUserId = await PortalController.getSystemUserId();
            let activeLineItemId = parseInt(line_item_id, 10);
            
            // CRITICAL: Verify invoice is still valid (not cancelled or expired)
            if (lineItem.status === 'Cancelled') {
                return res.status(400).json({ 
                    error: 'This cart has been cancelled. Please refresh your cart.' 
                });
            }
            
            if (lineItem.cart_expires_at && new Date(lineItem.cart_expires_at) <= new Date()) {
                return res.status(400).json({ 
                    error: 'This cart has expired. Please refresh your cart.' 
                });
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
            const currentQuantity = parseInt(lineItem.quantity_ordered || 0, 10);
            const currentAllocated = parseInt(lineItem.quantity_allocated || 0, 10);
            const quantityChange = parseInt(quantity, 10) - currentQuantity;
            let finalAllocated = currentAllocated;
            
            // Calculate available quantity (accounting for current allocation)
            const available = batch.quantity - batch.allocated_quantity + currentAllocated;
            
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
                
                const insertedLineItem = await query(`
                    INSERT INTO "ORDERS-invoice-line-items" (
                        fk_invoice_id, fk_master_product_id, fk_batch_id,
                        quantity_ordered, unit_price, line_total, line_item_order
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING id
                `, [lineItem.fk_invoice_id, lineItem.fk_master_product_id, 
                     lineItem.fk_batch_id, quantity, unitPrice, lineTotal, lineItemOrder]);
                
                activeLineItemId = insertedLineItem.rows[0].id;
                
                console.log('updateCartItem - Merged duplicates and created new item:', {
                    invoice_id: lineItem.fk_invoice_id,
                    batch_id: lineItem.fk_batch_id,
                    quantity,
                    deleted_duplicates: duplicateCount
                });
                
                await lineItemHistoryService.addLineItemHistoryEntry({
                    lineItemId: activeLineItemId,
                    modificationType: 'quantity_changed',
                    fieldChanged: 'quantity_ordered',
                    oldValue: currentQuantity.toString(),
                    newValue: quantity.toString(),
                    reason: 'Quantity updated via external cart (duplicate merged)',
                    changedByUserId: systemUserId,
                    changedBySystem: true
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
                `, [quantity, lineTotal, activeLineItemId]);
                
                console.log('updateCartItem - Updated line item:', {
                    line_item_id: activeLineItemId,
                    quantity
                });

                await lineItemHistoryService.addLineItemHistoryEntry({
                    lineItemId: activeLineItemId,
                    modificationType: 'quantity_changed',
                    fieldChanged: 'quantity_ordered',
                    oldValue: currentQuantity.toString(),
                    newValue: quantity.toString(),
                    reason: 'Quantity updated via external cart',
                    changedByUserId: systemUserId,
                    changedBySystem: true
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
            
            // Handle allocation/deallocation based on quantity change
            if (quantityChange !== 0) {
                try {
                    const allocationService = require('../Services/allocationService');
                    
                    if (quantityChange < 0) {
                        // Quantity decreased - deallocate the difference
                        const quantityToDeallocate = Math.abs(quantityChange);
                        const deallocationResult = await allocationService.releaseAllocation(
                            lineItem.fk_batch_id,
                            quantityToDeallocate,
                            lineItem.fk_invoice_id,
                            'Quantity decreased in cart'
                        );
                        
                        if (!deallocationResult.success) {
                            console.error('Failed to deallocate batch:', deallocationResult.error);
                        } else {
                            // Update quantity_allocated in line item
                            const newAllocated = Math.max(0, currentAllocated - quantityToDeallocate);
                            await query(`
                                UPDATE "ORDERS-invoice-line-items"
                                SET quantity_allocated = $1
                                WHERE id = $2
                            `, [newAllocated, activeLineItemId]);
                            
                            finalAllocated = newAllocated;
                            
                            console.log('updateCartItem - Deallocated:', {
                                batch_id: lineItem.fk_batch_id,
                                quantity: quantityToDeallocate
                            });
                        }
                    } else if (quantityChange > 0) {
                        // Quantity increased - allocate the difference
                        const quantityToAllocate = quantityChange;
                        const allocationResult = await allocationService.allocateBatchToInvoice(
                            lineItem.fk_batch_id,
                            quantityToAllocate,
                            lineItem.fk_invoice_id,
                            activeLineItemId
                        );
                        
                        if (!allocationResult.success) {
                            console.error('Failed to allocate batch:', allocationResult.error);
                            // Rollback quantity change
                            await query(`
                                UPDATE "ORDERS-invoice-line-items"
                                SET quantity_ordered = $1,
                                    line_total = $1 * unit_price,
                                    updated_at = NOW()
                                WHERE id = $2
                            `, [currentQuantity, activeLineItemId]);
                            
                            return res.status(400).json({ 
                                error: allocationResult.error || 'Failed to allocate inventory' 
                            });
                        } else {
                            // Update quantity_allocated in line item
                            const newAllocated = currentAllocated + quantityToAllocate;
                            await query(`
                                UPDATE "ORDERS-invoice-line-items"
                                SET quantity_allocated = $1
                                WHERE id = $2
                            `, [newAllocated, activeLineItemId]);
                            
                            finalAllocated = newAllocated;
                            
                            console.log('updateCartItem - Allocated:', {
                                batch_id: lineItem.fk_batch_id,
                                quantity: quantityToAllocate
                            });
                        }
                    }
                } catch (allocationError) {
                    console.error('Error handling allocation/deallocation:', allocationError);
                    // Continue - the line item is updated
                }
            }
            
            const refreshedLineItemResult = await query(`
                SELECT 
                    id,
                    fk_batch_id,
                    quantity_ordered,
                    quantity_allocated,
                    unit_price,
                    line_total
                FROM "ORDERS-invoice-line-items"
                WHERE id = $1
            `, [activeLineItemId]);

            const refreshedLineItem = refreshedLineItemResult.rows[0];

            const lineItemPayload = {
                id: activeLineItemId,
                batch_id: refreshedLineItem ? refreshedLineItem.fk_batch_id : lineItem.fk_batch_id,
                quantity_ordered: parseInt(
                    refreshedLineItem ? refreshedLineItem.quantity_ordered : quantity,
                    10
                ),
                quantity_allocated: parseInt(
                    refreshedLineItem ? refreshedLineItem.quantity_allocated : finalAllocated || 0,
                    10
                ),
                unit_price: parseFloat(
                    refreshedLineItem ? refreshedLineItem.unit_price : lineItem.unit_price || 0
                ),
                line_total: parseFloat(
                    refreshedLineItem ? refreshedLineItem.line_total :
                        (lineItem.unit_price || 0) * parseInt(quantity, 10)
                )
            };

            const availabilitySnapshot = await query(`
                SELECT 
                    (quantity - allocated_quantity)::INTEGER AS quantity_available
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [lineItemPayload.batch_id]);

            const affectedBatch = availabilitySnapshot.rows.length > 0
                ? {
                    batch_id: parseInt(lineItemPayload.batch_id, 10),
                    quantity_available: parseInt(availabilitySnapshot.rows[0].quantity_available || 0, 10)
                }
                : null;

            websocketService.broadcastInvoiceEvent(lineItem.fk_invoice_id, 'line_item_updated', {
                buyer_id: portalAccess.buyerId,
                location_id: portalAccess.locationId,
                triggered_by: 'external_portal',
                triggered_by_session_id: clientSessionId,
                exclude_session: req.sessionID,
                line_item: lineItemPayload,
                totals: {
                    subtotal,
                    total
                },
                ...(affectedBatch ? { affected_batches: [affectedBatch] } : {})
            }).catch(err => {
                console.error('WebSocket broadcast error (cart update):', err.message);
            });

            const responsePayload = {
                success: true, 
                message: 'Quantity updated',
                subtotal,
                total,
                totals: {
                    subtotal,
                    total
                },
                line_item: lineItemPayload
            };

            if (affectedBatch) {
                responsePayload.batch_availability = affectedBatch;
            }

            res.json(responsePayload);
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
            
            // Get buyer name and all locations for this buyer (same format as store page)
            let buyerName = 'Buyer';
            let buyerLocations = [];
            let buyerInfo = null;
            let currentLocationName = portalAccess.locationName || null;
            
            if (portalAccess.buyerId) {
                try {
                    const buyerResult = await query(`
                SELECT 
                            b.entry_id,
                            b.name,
                            b.website_url,
                            b.buyer_type
                        FROM "ORDERS-buyers" b
                        WHERE b.entry_id = $1
            `, [portalAccess.buyerId]);
                    
                    if (buyerResult.rows.length > 0) {
                        buyerInfo = buyerResult.rows[0];
                        buyerName = buyerInfo.name || 'Buyer';
                    }
                    
                    // Get all locations for this buyer (same logic as store page)
                    const locationsResult = await query(`
                        SELECT 
                            entry_id,
                            name,
                            line_one,
                            line_two,
                            city,
                            state,
                            zip,
                            state_license
                        FROM "ORDERS-buyer_locations"
                        WHERE orders_buyer_id = $1
                        ORDER BY name
                    `, [portalAccess.buyerId]);
                    
                    const portalAccessResult = await query(`
                        SELECT 
                            fk_location_id,
                            access_uuid,
                            is_active,
                            created_at
                        FROM "ORDERS-portal-access"
                        WHERE fk_buyer_id = $1
                        ORDER BY fk_location_id, created_at DESC
                    `, [portalAccess.buyerId]);
                    
                    const anyAccessByLocation = new Map();
                    const activeAccessByLocation = new Map();
                    
                    for (const row of portalAccessResult.rows) {
                        if (!anyAccessByLocation.has(row.fk_location_id)) {
                            anyAccessByLocation.set(row.fk_location_id, []);
                        }
                        anyAccessByLocation.get(row.fk_location_id).push(row);
                        
                        if (row.is_active && !activeAccessByLocation.has(row.fk_location_id)) {
                            activeAccessByLocation.set(row.fk_location_id, row);
                        }
                    }
                    
                    let systemUserIdForAccess = null;
                    
                    buyerLocations = [];
                    
                    for (const rawLocation of locationsResult.rows || []) {
                        const locationId = rawLocation.entry_id;
                        const hasAnyAccess = anyAccessByLocation.has(locationId);
                        let accessInfo = activeAccessByLocation.get(locationId);
                        
                        if (!hasAnyAccess) {
                            if (systemUserIdForAccess === null) {
                                systemUserIdForAccess = await PortalController.getSystemUserId();
                            }
                            
                            try {
                                // Get the location's access_code from CRM
                                const locationAccessCode = rawLocation.access_code;
                                
                                // Validation: Prevent portal access creation without a valid UUID access_code
                                if (!locationAccessCode) {
                                    console.error(`Location ${locationId} does not have an access_code. Cannot create portal access.`);
                                    continue;
                                }
                                
                                // Validate that access_code is a valid UUID format
                                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                                if (!uuidRegex.test(locationAccessCode)) {
                                    console.error(`Location ${locationId} has an invalid access_code format. Cannot create portal access.`);
                                    continue;
                                }
                                
                                // Create portal access using the location's access_code as UUID
                                const newAccess = await query(`
                                    INSERT INTO "ORDERS-portal-access" (
                                        fk_buyer_id,
                                        fk_location_id,
                                        access_uuid,
                                        is_active,
                                        created_by
                                    ) VALUES ($1, $2, $3, true, $4)
                                    RETURNING access_uuid, is_active
                                `, [portalAccess.buyerId, locationId, locationAccessCode, systemUserIdForAccess]);
                                
                                accessInfo = {
                                    fk_location_id: locationId,
                                    access_uuid: newAccess.rows[0].access_uuid,
                                    is_active: newAccess.rows[0].is_active
                                };
                                
                                activeAccessByLocation.set(locationId, accessInfo);
                                anyAccessByLocation.set(locationId, [accessInfo]);
                            } catch (createErr) {
                                // If it's a unique constraint violation, try to get existing access
                                if (createErr.code === '23505') { // Unique violation
                                    const existingAccess = await query(`
                                        SELECT access_uuid, is_active
                                        FROM "ORDERS-portal-access"
                                        WHERE fk_location_id = $1
                                        ORDER BY created_at DESC
                                        LIMIT 1
                                    `, [locationId]);
                                    
                                    if (existingAccess.rows.length > 0) {
                                        accessInfo = {
                                            fk_location_id: locationId,
                                            access_uuid: existingAccess.rows[0].access_uuid,
                                            is_active: existingAccess.rows[0].is_active
                                        };
                                        activeAccessByLocation.set(locationId, accessInfo);
                                        anyAccessByLocation.set(locationId, [accessInfo]);
                                    }
                                } else {
                                    console.error(`Error creating portal access for location ${locationId}:`, createErr);
                                }
                            }
                        }
                        
                        const portalUrl = accessInfo && accessInfo.is_active
                            ? `/external/store/${accessInfo.access_uuid}`
                            : null;
                        
                        const isCurrentLocation = locationId === portalAccess.locationId;

                        const locationData = {
                            ...rawLocation,
                            access_uuid: accessInfo ? accessInfo.access_uuid : null,
                            portal_is_active: !!(accessInfo && accessInfo.is_active),
                            portal_url: portalUrl,
                            portal_restricted: !portalUrl && (anyAccessByLocation.has(locationId) || hasAnyAccess),
                            is_current: isCurrentLocation
                        };
                        
                        buyerLocations.push(locationData);
                        
                        if (isCurrentLocation && rawLocation.name) {
                            currentLocationName = rawLocation.name;
                        }
                    }
                    
                    if (!currentLocationName && buyerLocations.length > 0) {
                        const currentLocation = buyerLocations.find(loc => loc.entry_id === portalAccess.locationId);
                        currentLocationName = currentLocation?.name || buyerLocations[0].name || currentLocationName;
                    }
                } catch (err) {
                    console.error('Error fetching buyer info in checkout:', err);
                }
            }
            
            // Get the current location data for shipping address pre-fill
            const locationData = await query(`
                SELECT 
                    l.name,
                    l.line_one as address,
                    l.line_two,
                    l.city,
                    l.state,
                    l.zip as zip_code,
                    l.state_license
                FROM "ORDERS-buyer_locations" l
                WHERE l.entry_id = $1
            `, [portalAccess.locationId]);
            
            const shippingAddress = locationData.rows[0] || {};
            
            // Get locations for checkout form dropdown (simplified format)
            const allLocations = buyerLocations.map(loc => ({
                location_id: loc.entry_id,
                name: loc.name,
                line_one: loc.line_one,
                line_two: loc.line_two,
                city: loc.city,
                state: loc.state,
                zip: loc.zip,
                state_license: loc.state_license
            }));
            
            console.log('Checkout - Cart data:', {
                buyerId: portalAccess.buyerId,
                locationId: portalAccess.locationId,
                itemCount: cartData.items ? cartData.items.length : 0,
                subtotal: cartData.subtotal,
                total: cartData.total,
                locationsFound: buyerLocations.length
            });
            
            res.render('external/checkout', {
                title: 'Checkout',
                layout: 'layouts/portal',
                cart: cartData,
                portalAccess: portalAccess,
                uuid: uuid,
                shippingAddress: shippingAddress,
                locations: allLocations,
                buyerName: buyerName,
                buyerInfo: buyerInfo,
                buyerLocations: buyerLocations,
                currentLocationName: currentLocationName
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
                    i.subtotal,
                    i.discount_amount,
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
            
            // Invoice structure:
            // - subtotal: sum of line_totals (after discounts, before credits)
            // - discount_amount: total discounts applied
            // - credit_applied: total credits applied
            // - total: subtotal - credit_applied
            // 
            // For display:
            // - Original Subtotal (before discounts) = subtotal + discount_amount
            // - Discounts = discount_amount
            // - Credits Applied = credit_applied
            // - Total = total
            const discountAmount = parseFloat(invoice.discount_amount || 0);
            const creditApplied = parseFloat(invoice.credit_applied || 0);
            const total = parseFloat(invoice.total || 0);
            const storedSubtotal = parseFloat(invoice.subtotal || 0);
            
            // Calculate the original subtotal (before discounts and credits)
            // invoice.subtotal is after discounts but before credits
            // So original subtotal = storedSubtotal + discountAmount
            const originalSubtotal = storedSubtotal + discountAmount;
            
            // Debug logging
            console.log('[showConfirmation] Invoice breakdown:', {
                invoiceId,
                storedSubtotal: 'subtotal (after discounts, before credits)',
                discountAmount,
                creditApplied,
                total,
                originalSubtotal: 'original subtotal (before discounts)',
                verification: `total (${total}) should equal subtotal (${storedSubtotal}) - credits (${creditApplied}) = ${storedSubtotal - creditApplied}`
            });
            
            // Get buyer name and info for header
            let buyerName = 'Buyer';
            let buyerInfo = null;
            if (portalAccess.buyerId) {
                try {
                    const buyerResult = await query(`
                        SELECT 
                            b.entry_id,
                            b.name,
                            b.website_url,
                            b.buyer_type
                        FROM "ORDERS-buyers" b
                        WHERE b.entry_id = $1
                    `, [portalAccess.buyerId]);
                    
                    if (buyerResult.rows.length > 0) {
                        buyerInfo = buyerResult.rows[0];
                        buyerName = buyerInfo.name || 'Buyer';
                    }
                } catch (err) {
                    console.error('Error fetching buyer info in confirmation:', err);
                }
            }
            
            res.render('external/order-confirmation', {
                title: 'Order Confirmation',
                layout: 'layouts/portal',
                uuid: uuid,
                invoiceNumber: invoice.invoice_number,
                subtotal: originalSubtotal,
                discountAmount: discountAmount,
                orderTotal: total,
                creditApplied: creditApplied,
                salesRepName: salesRepName,
                buyerName: buyerName,
                buyerInfo: buyerInfo
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
            
            // First, check if status column exists in ORDERS-invoices table
            let hasStatusColumn = false;
            try {
                const columnCheck = await query(`
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'ORDERS-invoices'
                    AND column_name = 'status'
                    LIMIT 1
                `);
                hasStatusColumn = columnCheck.rows.length > 0;
            } catch (checkError) {
                console.warn('Could not check for status column:', checkError.message);
                // Assume it doesn't exist if check fails
                hasStatusColumn = false;
            }
            
            // Build query conditionally based on whether status column exists
            // Get active draft invoice for this buyer/location
            // OPTIMIZED: Simplified query structure - filter invoice first, then join
            let queryStr = `
                WITH invoice_base AS (
                    SELECT id, subtotal, total
                    FROM "ORDERS-invoices"
                    WHERE fk_buyer_id = $1
                    AND fk_location_id = $2
            `;
            
            if (hasStatusColumn) {
                // CRITICAL: Only get Draft invoices that are NOT cancelled
                queryStr += ` AND status = 'Draft' AND source = 'External' AND status != 'Cancelled'`;
            }
            
            queryStr += `
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
                        SUM(li.quantity_allocated)::INTEGER as total_allocated,
                        AVG(li.unit_price) as unit_price,
                        SUM(li.line_total) as total_line_total,
                        SUM(COALESCE(li.line_discount_amount, 0)) as total_line_discount_amount,
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
                                'quantity_allocated', COALESCE(lia.total_allocated, 0),
                                'unit_price', lia.unit_price,
                                'line_total', lia.total_line_total,
                                'line_discount_amount', COALESCE(lia.total_line_discount_amount, 0),
                                'quantity_available', (
                                    b.quantity - b.allocated_quantity + COALESCE(lia.total_allocated, 0)
                                )::INTEGER,
                                'image_url', COALESCE(
                                (SELECT '/public/' || file_path 
                                 FROM "ORDERS-product-images" pi
                                 WHERE pi.fk_product_id = p.entry_id
                                   AND pi.is_deleted = false
                                   AND pi.is_featured = true
                                 ORDER BY pi.uploaded_at ASC
                                     LIMIT 1
                                    ),
                                    '/public/images/placeholder.jpg'
                                )
                            ) ORDER BY lia.line_item_order
                        ),
                        '[]'::jsonb
                    ) as items
                FROM invoice_base ib
                LEFT JOIN line_items_agg lia ON ib.id = lia.fk_invoice_id
                LEFT JOIN "ORDERS-products" p ON lia.fk_master_product_id = p.entry_id
                LEFT JOIN "ORDERS-batches" b ON lia.fk_batch_id = b.id
                GROUP BY ib.id, ib.subtotal, ib.total
            `;
            
            const draftInvoice = await query(queryStr, [portalAccess.buyerId, portalAccess.locationId]);
            
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
            
            // CRITICAL: Get existing cart data first - DO NOT create new cart
            // Use getCartData which only retrieves existing carts, never creates them
            const cartData = await PortalController.getCartData(portalAccess);
            
            if (!cartData.invoice_id) {
                return res.status(400).json({ error: 'No active cart found. Please add items to your cart first.' });
            }
            
            const invoiceId = cartData.invoice_id;
            
            // Get current invoice location
            const currentInvoice = await query(`
                SELECT fk_location_id 
                FROM "ORDERS-invoices"
                WHERE id = $1 AND status = 'Draft'
            `, [invoiceId]);
            
            if (currentInvoice.rows.length === 0) {
                return res.status(404).json({ error: 'Cart invoice not found or no longer in Draft status' });
            }
            
            const currentLocationId = currentInvoice.rows[0].fk_location_id;
            
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
            
            // Re-fetch cart data after location update (if location changed)
            // This ensures we have the latest cart state
            const finalCartData = await PortalController.getCartData(portalAccess);
            
            if (!finalCartData.invoice_id || finalCartData.invoice_id !== invoiceId) {
                return res.status(400).json({ error: 'Cart invoice mismatch. Please refresh and try again.' });
            }
            
            if (!finalCartData.items || finalCartData.items.length === 0) {
                return res.status(400).json({ error: 'Cart is empty' });
            }
            
            // Update customer notes if provided
            if (notes) {
                await query(`
                    UPDATE "ORDERS-invoices"
                    SET customer_notes = $1
                    WHERE id = $2
                `, [notes, invoiceId]);
            }
            
            // Apply discount builder discounts to invoice line items
            const discountBuilderService = require('../Services/discountBuilderService');
            const discountResult = await discountBuilderService.applyDiscountsToInvoice(
                invoiceId, 
                portalAccess.buyerId
            );
            console.log('Discount builder application result:', discountResult);
            
            // Apply available credits to invoice
            const accountCreditService = require('../Services/accountCreditService');
            const creditResult = await accountCreditService.applyCreditsToInvoice(invoiceId);
            console.log('Credit application result:', creditResult);
            
            // Note: Purchase limit validation happens inside state machine transition
            // No need to validate twice - state machine handles it
            
            // Submit cart for approval using state machine
            // Note: For external portal orders, there's no logged-in user, so pass null for userId
            // The system will record this as a system change
            console.log('Starting state machine transition to Pending_Approval...');
            console.log('Using existing cart invoice:', invoiceId);
            const invoiceStateMachine = require('../Services/invoiceStateMachineService');
            const result = await invoiceStateMachine.transitionTo(
                invoiceId,
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
            
            console.log(`✅ Invoice ${invoiceId} successfully transitioned to Pending_Approval`);
            
            // Return JSON with invoice_id for client redirect
            res.json({ 
                success: true, 
                message: 'Order submitted successfully and pending approval',
                invoice_id: invoiceId,
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

            // Get cart_started_at and extended_until to check 48-hour limit
            const cartInfo = await query(`
                SELECT cart_started_at, extended_until, cart_expires_at
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);

            if (cartInfo.rows.length === 0 || !cartInfo.rows[0].cart_started_at) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Cart start time not found. Cannot extend.' 
                });
            }

            const cartStartedAt = new Date(cartInfo.rows[0].cart_started_at);
            const extendedUntil = cartInfo.rows[0].extended_until 
                ? new Date(cartInfo.rows[0].extended_until) 
                : null;
            const currentExpiresAt = new Date(cartInfo.rows[0].cart_expires_at);

            // Calculate proposed new expiry (current + expiry time from env)
            const expirySeconds = PortalController.getCartExpiryTime();
            const proposedExpiry = new Date(currentExpiresAt);
            proposedExpiry.setSeconds(proposedExpiry.getSeconds() + expirySeconds);

            // Check 48-hour limit: proposed expiry must not exceed extended_until
            const maxExpiry = extendedUntil || (() => {
                // Fallback: calculate 48 hours from cart_started_at
                const max = new Date(cartStartedAt);
                max.setHours(max.getHours() + 48);
                return max;
            })();

            let finalExpiry;
            if (proposedExpiry > maxExpiry) {
                // Can only extend to maxExpiry
                finalExpiry = maxExpiry;
            } else {
                // Can extend by full expiry time
                finalExpiry = proposedExpiry;
            }

            // Extend cart expiry
            const result = await query(`
                UPDATE "ORDERS-invoices"
                SET cart_expires_at = $1,
                    cart_extended = TRUE,
                    updated_at = NOW()
                WHERE id = $2
                RETURNING cart_expires_at
            `, [finalExpiry, invoiceId]);

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
    static async showOrders(req, res) {
        try {
            const portalAccess = req.session.portalAccess;
            if (!portalAccess) {
                return res.redirect('/external/store');
            }

            res.render('external/orders', {
                layout: 'layouts/portal',
                title: 'Your Orders',
                portalAccess
            });
        } catch (error) {
            console.error('Error rendering portal orders page:', error);
            res.status(500).render('external/error', {
                message: 'Unable to load your orders right now.'
            });
        }
    }

    static async getPortalOrders(req, res) {
        try {
            const portalAccess = req.session.portalAccess;
            if (!portalAccess) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const invoices = await query(`
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.status,
                    i.source,
                    i.subtotal,
                    i.discount_amount,
                    i.credit_applied,
                    i.total,
                    i.created_at,
                    i.updated_at
                FROM "ORDERS-invoices" i
                WHERE i.fk_buyer_id = $1
                  AND i.fk_location_id = $2
                ORDER BY i.created_at DESC
                LIMIT 200
            `, [portalAccess.buyerId, portalAccess.locationId]);

            const invoiceIds = invoices.rows.map(inv => inv.id);
            let lineItemsMap = {};

            if (invoiceIds.length > 0) {
                const lineItemsResult = await query(`
                    SELECT 
                        li.fk_invoice_id,
                        li.quantity_ordered as quantity,
                        li.unit_price,
                        li.line_total,
                        li.line_discount_amount,
                        li.specific_package_labels,
                        p.name as product_name,
                        p.brand_name,
                        b.batch_name
                    FROM "ORDERS-invoice-line-items" li
                    INNER JOIN "ORDERS-products" p ON li.fk_master_product_id = p.entry_id
                    INNER JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
                    WHERE li.fk_invoice_id = ANY($1::int[])
                    ORDER BY li.line_item_order
                `, [invoiceIds]);

                lineItemsMap = lineItemsResult.rows.reduce((acc, item) => {
                    if (!acc[item.fk_invoice_id]) acc[item.fk_invoice_id] = [];
                    acc[item.fk_invoice_id].push({
                        product_name: item.product_name,
                        brand_name: item.brand_name,
                        batch_name: item.batch_name,
                        quantity: item.quantity,
                        unit_price: item.unit_price,
                        line_total: item.line_total,
                        line_discount_amount: item.line_discount_amount,
                        specific_package_labels: item.specific_package_labels
                    });
                    return acc;
                }, {});
            }

            const payload = invoices.rows.map(inv => ({
                ...inv,
                line_items: lineItemsMap[inv.id] || []
            }));

            res.json({ success: true, invoices: payload });
        } catch (error) {
            console.error('Error fetching portal orders:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch invoices' });
        }
    }
}

module.exports = PortalController;

