// Frontend Cart Manager
// Maintains cart state in localStorage for instant updates
// Validates against backend inventory on checkout

class CartManager {
    constructor(uuid) {
        this.uuid = uuid;
        this.storageKey = `portal_cart_${uuid}`;
        this.cart = this.loadCart();
        this.inventoryCache = {}; // Cache inventory data from backend
        this.lastBackendSyncAt = 0;
        // Cart expiration tracking
        this.cartExpiresAt = null;
        this.cartStartedAt = null;
        this.extendedUntil = null;
        this.cartExtended = false;
        this.expirationCheckInterval = null;
        this.warningCheckInterval = null;
        // Start expiration checking
        this.startExpirationCheck();
    }

    // Load cart from localStorage
    loadCart() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const cart = JSON.parse(stored);
                // Validate cart structure
                if (!cart.items) cart.items = [];
                if (!cart.subtotal) cart.subtotal = 0;
                if (!cart.total) cart.total = 0;
                return cart;
            }
        } catch (e) {
            console.error('Error loading cart from localStorage:', e);
        }
        return { items: [], subtotal: 0, total: 0 };
    }

    // Save cart to localStorage
    saveCart() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.cart));
            this.updateCartIcon();
            this.notifyCartChanged();
        } catch (e) {
            console.error('Error saving cart to localStorage:', e);
        }
    }

    // Add item to cart (instant, frontend only)
    addItem(batchId, quantity, productData) {
        // Normalize batchId for comparison (handle string/number)
        const normalizedBatchId = String(batchId);
        // Find if item already exists in cart
        const existingIndex = this.cart.items.findIndex(item => String(item.batch_id) === normalizedBatchId);
        
        if (existingIndex >= 0) {
            // Update existing item quantity
            this.cart.items[existingIndex].quantity += quantity;
            this.cart.items[existingIndex].line_total = 
                this.cart.items[existingIndex].quantity * this.cart.items[existingIndex].unit_price;
        } else {
            // Add new item
            const newItem = {
                line_item_id: `temp_${Date.now()}_${batchId}`,
                batch_id: batchId,
                product_id: productData.product_id,
                product_name: productData.product_name,
                batch_name: productData.batch_name,
                brand_name: productData.brand_name,
                cultivar_name: productData.cultivar_name,
                category_name: productData.category_name,
                product_type: productData.product_type,
                unit_size: productData.unit_size,
                unit_measurement_name: productData.unit_measurement_name,
                units_per_case: productData.units_per_case,
                quantity: quantity,
                unit_price: productData.unit_price,
                line_total: productData.unit_price * quantity,
                quantity_available: productData.quantity_available, // Store available inventory
                quantity_allocated: productData.quantity_allocated || 0,
                image_url: productData.image_url || '/public/images/placeholder.jpg'
            };
            this.cart.items.push(newItem);
        }

        this.recalculateTotals();
        this.saveCart();
        return true;
    }

    // Remove item from cart
    removeItem(batchId) {
        // Normalize batchId for comparison
        const normalizedBatchId = String(batchId);
        this.cart.items = this.cart.items.filter(item => String(item.batch_id) !== normalizedBatchId);
        this.recalculateTotals();
        this.saveCart();
    }

    // Update item quantity
    updateQuantity(batchId, newQuantity) {
        // Normalize batchId for comparison
        const normalizedBatchId = String(batchId);
        const item = this.cart.items.find(item => String(item.batch_id) === normalizedBatchId);
        if (item) {
            item.quantity = Math.max(1, newQuantity);
            item.line_total = item.quantity * item.unit_price;
            this.recalculateTotals();
            this.saveCart();
            return true;
        }
        return false;
    }

    // Recalculate cart totals
    recalculateTotals() {
        this.cart.subtotal = this.cart.items.reduce((sum, item) => sum + (item.line_total || 0), 0);
        this.cart.total = this.cart.subtotal; // No discounts/credits in frontend
    }

    // Get total item count
    getItemCount() {
        return this.cart.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
    }

    // Update cart icon count
    updateCartIcon() {
        const count = this.getItemCount();
        const cartBadge = document.getElementById('cart-count-badge');
        if (cartBadge) {
            if (count > 0) {
                cartBadge.textContent = count;
                cartBadge.style.display = 'inline-block';
            } else {
                cartBadge.style.display = 'none';
            }
        }
    }

    // Notify cart changed (for UI updates)
    notifyCartChanged() {
        // Dispatch custom event for other components to listen
        window.dispatchEvent(new CustomEvent('cartChanged', { detail: this.cart }));
    }

    // Clear cart
    clearCart() {
        this.cart = { items: [], subtotal: 0, total: 0 };
        this.cartExpiresAt = null;
        this.cartStartedAt = null;
        this.extendedUntil = null;
        this.cartExtended = false;
        this.saveCart();
        window.dispatchEvent(new CustomEvent('cartChanged'));
    }
    
    // Check if cart has expired
    isCartExpired() {
        if (!this.cartExpiresAt) {
            return false;
        }
        return new Date() >= new Date(this.cartExpiresAt);
    }
    
    // Get hours until expiration
    getHoursUntilExpiration() {
        if (!this.cartExpiresAt) {
            return null;
        }
        const now = new Date();
        const expiresAt = new Date(this.cartExpiresAt);
        const diff = expiresAt.getTime() - now.getTime();
        if (diff <= 0) {
            return 0; // Already expired
        }
        return diff / (1000 * 60 * 60); // Convert to hours
    }
    
    // Check if we should show expiration warning (6 hours or less remaining)
    shouldShowExpirationWarning() {
        // Must have items and expiration time set
        if (!this.cartExpiresAt || !this.cart || !this.cart.items || this.cart.items.length === 0) {
            return false;
        }
        
        // Check if expired - don't show warning if already expired
        if (this.isCartExpired()) {
            return false;
        }
        
        const hoursRemaining = this.getHoursUntilExpiration();
        if (hoursRemaining === null || hoursRemaining <= 0) {
            return false;
        }
        
        // Show warning ONLY when 6 hours or less remain
        // After extension, if new expiry is more than 6 hours, this will return false
        return hoursRemaining <= 6;
    }
    
    // Check if cart can be extended (not already extended, and within 48-hour limit)
    canExtendCart() {
        if (this.cartExtended) {
            return false; // Already extended
        }
        if (!this.extendedUntil) {
            return true; // Can't check limit, allow extension
        }
        const now = new Date();
        const maxExpiry = new Date(this.extendedUntil);
        return now < maxExpiry; // Can extend if we haven't reached max
    }
    
    // Start periodic expiration checking
    startExpirationCheck() {
        // Clear any existing intervals
        if (this.expirationCheckInterval) {
            clearInterval(this.expirationCheckInterval);
        }
        if (this.warningCheckInterval) {
            clearInterval(this.warningCheckInterval);
        }
        
        // Check expiration every 60 seconds
        this.expirationCheckInterval = setInterval(() => {
            this.checkExpiration();
        }, 60000);
        
        // Check warning display every 60 seconds
        this.warningCheckInterval = setInterval(() => {
            this.updateExpirationWarning();
        }, 60000);
        
        // Initial check
        setTimeout(() => {
            this.checkExpiration();
            this.updateExpirationWarning();
        }, 2000);
    }
    
    // Check expiration and clear silently if expired
    async checkExpiration() {
        // Always check backend for latest expiration status
        try {
            const response = await fetch(`/api/portal/${this.uuid}/cart`);
            if (response.ok) {
                const data = await response.json();
                
                // Update expiration data from backend
                if (data.cart_expires_at) {
                    this.cartExpiresAt = new Date(data.cart_expires_at);
                } else {
                    this.cartExpiresAt = null;
                }
                
                if (data.cart_started_at) {
                    this.cartStartedAt = new Date(data.cart_started_at);
                }
                
                if (data.extended_until) {
                    this.extendedUntil = new Date(data.extended_until);
                }
                
                this.cartExtended = data.cart_extended || false;
                
                // Update cart items from backend to ensure we have latest data
                if (data.items && Array.isArray(data.items)) {
                    this.cart.items = data.items;
                }
                
                // Check if expired - clear silently (no warnings, no popups)
                if (this.isCartExpired()) {
                    console.log('Cart expired - clearing silently');
                    this.clearCart();
                    window.dispatchEvent(new CustomEvent('cartExpired', { detail: { silent: true } }));
                    return;
                }
                
                // Update warning after checking expiration
                this.updateExpirationWarning();
            }
        } catch (e) {
            console.error('Error checking cart expiration:', e);
        }
        
        // Also check local expiration
        if (this.isCartExpired()) {
            console.log('Cart expired (local check) - clearing silently');
            this.clearCart();
            window.dispatchEvent(new CustomEvent('cartExpired', { detail: { silent: true } }));
        }
    }
    
    // Update expiration warning display
    updateExpirationWarning() {
        // Only show warning if cart has items and expiration is set
        if (!this.shouldShowExpirationWarning()) {
            // Hide warning (cart empty, no expiration, or more than 6 hours remaining)
            const warningDiv = document.getElementById('cart-expiration-warning');
            if (warningDiv) {
                warningDiv.style.display = 'none';
            }
            return;
        }
        
        const hoursRemaining = this.getHoursUntilExpiration();
        if (hoursRemaining === null || hoursRemaining <= 0) {
            // Hide warning if expired
            const warningDiv = document.getElementById('cart-expiration-warning');
            if (warningDiv) {
                warningDiv.style.display = 'none';
            }
            return;
        }
        
        // Show warning only if 6 hours or less remaining
        // After extension, if new expiry is more than 6 hours, warning will be hidden
        if (hoursRemaining > 6) {
            // More than 6 hours - hide warning
            const warningDiv = document.getElementById('cart-expiration-warning');
            if (warningDiv) {
                warningDiv.style.display = 'none';
            }
            return;
        }
        
        // Show warning (6 hours or less remaining)
        this.renderExpirationWarning(hoursRemaining);
    }
    
    // Render expiration warning in cart UI
    renderExpirationWarning(hoursRemaining) {
        // Find the cart sidebar or cart container
        const cartItemsDiv = document.getElementById('cart-items');
        if (!cartItemsDiv) {
            console.log('Cart items div not found, cannot show warning');
            return;
        }
        
        let warningDiv = document.getElementById('cart-expiration-warning');
        
        if (!warningDiv) {
            // Create warning element if it doesn't exist
            warningDiv = document.createElement('div');
            warningDiv.id = 'cart-expiration-warning';
            warningDiv.className = 'cart-expiration-warning';
            // Insert before cart items
            cartItemsDiv.parentNode.insertBefore(warningDiv, cartItemsDiv);
        }
        
        const hours = Math.floor(hoursRemaining);
        const minutes = Math.floor((hoursRemaining - hours) * 60);
        const hoursText = hours === 1 ? 'hour' : 'hours';
        const minutesText = minutes === 1 ? 'minute' : 'minutes';
        const canExtend = this.canExtendCart();
        
        let timeText = '';
        if (hours > 0 && minutes > 0) {
            timeText = `${hours} ${hoursText} ${minutes} ${minutesText}`;
        } else if (hours > 0) {
            timeText = `${hours} ${hoursText}`;
        } else if (minutes > 0) {
            timeText = `${minutes} ${minutesText}`;
        } else {
            timeText = 'less than a minute';
        }
        
        warningDiv.innerHTML = `
            <div class="expiration-warning-content">
                <div class="expiration-warning-icon">⏰</div>
                <div class="expiration-warning-text">
                    <strong>Cart expires in ${timeText}</strong>
                    <p>Your cart will be cleared automatically when it expires.</p>
                </div>
                ${canExtend ? `
                    <button class="extend-cart-btn" onclick="extendCart()">
                        Extend Cart
                    </button>
                ` : ''}
            </div>
        `;
        warningDiv.style.display = 'block';
        console.log(`⚠️ Showing expiration warning: ${timeText} remaining, can extend: ${canExtend}`);
    }
    
    // Extend cart expiry
    async extendCart() {
        try {
            const response = await fetch(`/api/portal/${this.uuid}/cart/extend`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                // Update expiration time immediately
                if (data.cart_expires_at) {
                    const oldExpiry = this.cartExpiresAt;
                    this.cartExpiresAt = new Date(data.cart_expires_at);
                    this.cartExtended = true;
                    
                    const hoursRemaining = this.getHoursUntilExpiration();
                    console.log(`✅ Cart extended: ${oldExpiry ? oldExpiry.toISOString() : 'N/A'} → ${this.cartExpiresAt.toISOString()} (${hoursRemaining ? hoursRemaining.toFixed(1) : 'N/A'} hours remaining)`);
                    
                    // CRITICAL: Update warning immediately with new expiry time
                    // This ensures warning is hidden if new expiry is > 6 hours
                    this.updateExpirationWarning();
                }
                
                // Reload from backend to get updated data (including extended_until)
                await this.loadFromBackend(true, 0);
                
                // Update warning again after backend sync to ensure consistency
                this.updateExpirationWarning();
                
                // Also trigger a render to update the UI immediately
                window.dispatchEvent(new CustomEvent('cartChanged'));
                
                // Show success notification with new expiry time
                if (typeof window.showNotification === 'function') {
                    const hoursRemaining = this.getHoursUntilExpiration();
                    if (hoursRemaining && hoursRemaining > 6) {
                        // More than 6 hours - warning is hidden, show success message
                        window.showNotification(`Cart extended successfully. Expires in ${Math.floor(hoursRemaining)} hours.`, 'success');
                    } else if (hoursRemaining && hoursRemaining > 0) {
                        // Still within 6 hours - warning will show updated time
                        const hours = Math.floor(hoursRemaining);
                        const minutes = Math.floor((hoursRemaining - hours) * 60);
                        window.showNotification(`Cart extended. Expires in ${hours}h ${minutes}m.`, 'success');
                    } else {
                        window.showNotification('Cart extended successfully', 'success');
                    }
                }
                
                return { success: true };
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to extend cart');
            }
        } catch (e) {
            console.error('Error extending cart:', e);
            if (typeof window.showNotification === 'function') {
                window.showNotification(e.message || 'Failed to extend cart', 'error');
            }
            return { success: false, error: e.message };
        }
    }

    // Get cart data
    getCart() {
        return { ...this.cart };
    }

    // Fetch inventory data from backend (for checkout validation)
    async fetchInventoryData() {
        try {
            const response = await fetch(`/api/portal/${this.uuid}/inventory`);
            if (response.ok) {
                const data = await response.json();
                // Cache inventory by batch_id and update cart items
                if (data.batches) {
                    data.batches.forEach(batch => {
                        this.inventoryCache[batch.batch_id] = batch.quantity_available;
                        
                        // Update quantity_available in cart items
                        const cartItem = this.cart.items.find(item => item.batch_id === batch.batch_id);
                        if (cartItem) {
                            cartItem.quantity_available = batch.quantity_available;
                        }
                    });
                    this.saveCart(); // Save updated inventory data
                }
                return this.inventoryCache;
            }
        } catch (e) {
            console.error('Error fetching inventory:', e);
        }
        return {};
    }

    // Validate cart against inventory (for checkout page)
    // CRITICAL: For items already in cart, quantity_available includes the allocated quantity
    // So we need to check if quantity exceeds what's available for NEW items
    validateCartAgainstInventory() {
        const issues = [];
        this.cart.items.forEach(item => {
            // quantity_available from getCartData already includes allocated quantity for this cart
            // So if item.quantity <= quantity_available, it's valid
            // If item.quantity > quantity_available, it means we're trying to order more than available
            const available = item.quantity_available || 0;
            
            // Only flag as issue if quantity exceeds available
            // Note: quantity_available already accounts for what's allocated to this cart
            if (item.quantity > available) {
                issues.push({
                    batch_id: item.batch_id,
                    line_item_id: item.line_item_id,
                    requested: item.quantity,
                    available: available,
                    exceeded: item.quantity - available
                });
            }
        });
        return issues;
    }

    // Sync cart to backend (only when submitting checkout)
    // CRITICAL: Check if cart already exists in backend before syncing
    // If cart exists, just update quantities; don't create new cart
    async syncToBackend() {
        try {
            // First, check if cart already exists in backend
            const cartCheckResponse = await fetch(`/api/portal/${this.uuid}/cart`);
            let backendCart = null;
            let cartExists = false;
            
            if (cartCheckResponse.ok) {
                const checkData = await cartCheckResponse.json();
                if (checkData.invoice_id && checkData.items && checkData.items.length > 0) {
                    cartExists = true;
                    backendCart = checkData;
                    console.log('Cart already exists in backend, syncing quantities only');
                }
            }
            
            if (cartExists) {
                // Cart exists - update quantities instead of adding new items
                // This prevents creating duplicate line items or new carts
                for (const item of this.cart.items) {
                    // Find matching item in backend cart
                    const backendItem = backendCart.items.find(bi => 
                        String(bi.batch_id) === String(item.batch_id)
                    );
                    
                    if (backendItem) {
                        // Item exists in backend - update quantity if different
                        if (backendItem.quantity !== item.quantity) {
                            const updateResponse = await fetch(`/api/portal/${this.uuid}/cart/update`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    line_item_id: backendItem.line_item_id,
                                    quantity: item.quantity
                                })
                            });
                            
                            if (!updateResponse.ok) {
                                const error = await updateResponse.json();
                                throw new Error(error.error || 'Failed to update item quantity');
                            }
                        }
                    } else {
                        // Item doesn't exist in backend - add it
                        const addResponse = await fetch(`/api/portal/${this.uuid}/cart/add`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                batch_id: item.batch_id,
                                quantity: item.quantity
                            })
                        });
                        
                        if (!addResponse.ok) {
                            const error = await addResponse.json();
                            throw new Error(error.error || 'Failed to add item to backend');
                        }
                    }
                }
                
                // Remove items from backend that are not in frontend cart
                for (const backendItem of backendCart.items) {
                    const frontendItem = this.cart.items.find(fi => 
                        String(fi.batch_id) === String(backendItem.batch_id)
                    );
                    
                    if (!frontendItem) {
                        // Item exists in backend but not in frontend - remove it
                        const removeResponse = await fetch(`/api/portal/${this.uuid}/cart/remove`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                line_item_id: backendItem.line_item_id
                            })
                        });
                        
                        if (!removeResponse.ok) {
                            console.warn('Failed to remove item from backend:', backendItem.line_item_id);
                        }
                    }
                }
            } else {
                // No cart exists - add all items (this will create the cart)
                console.log('No cart exists in backend, creating new cart with items');
                for (const item of this.cart.items) {
                    const response = await fetch(`/api/portal/${this.uuid}/cart/add`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            batch_id: item.batch_id,
                            quantity: item.quantity
                        })
                    });
                    
                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || 'Failed to sync item to backend');
                    }
                }
            }
            
            // After syncing, reload cart from backend to get real line_item_ids
            const cartResponse = await fetch(`/api/portal/${this.uuid}/cart`);
            if (cartResponse.ok) {
                const finalBackendCart = await cartResponse.json();
                // Update frontend cart with backend data (has real line_item_ids)
                this.cart.items = finalBackendCart.items || [];
                this.cart.subtotal = finalBackendCart.subtotal || 0;
                this.cart.total = finalBackendCart.total || 0;
                this.saveCart();
            }
            
            return { success: true };
        } catch (e) {
            console.error('Error syncing cart to backend:', e);
            return { success: false, error: e.message };
        }
    }
    
    // Load cart from backend (for checkout page)
    // @param {boolean} force - If true, always overwrite frontend cart with backend data (for removals)
    // @param {number} lastActionTime - Timestamp of last user action (to detect if items were just added)
    async loadFromBackend(force = false, lastActionTime = 0) {
        const socketConnected = typeof window !== 'undefined' && typeof window.portalWebSocketConnected !== 'undefined'
            ? window.portalWebSocketConnected
            : true;

        if (!socketConnected && !force) {
            console.log('loadFromBackend skipped: WebSocket offline and force=false');
            return false;
        }
        try {
            const response = await fetch(`/api/portal/${this.uuid}/cart`);
            if (response.ok) {
                const data = await response.json();
                const items = Array.isArray(data.items) ? data.items.map(item => ({
                    ...item,
                    quantity_allocated: item.quantity_allocated || 0,
                    image_url: item.image_url || item.primary_image_url || '/public/images/placeholder.jpg'
                })) : [];
                
                // Update expiration data from backend
                if (data.cart_expires_at) {
                    this.cartExpiresAt = new Date(data.cart_expires_at);
                } else {
                    this.cartExpiresAt = null;
                }
                
                if (data.cart_started_at) {
                    this.cartStartedAt = new Date(data.cart_started_at);
                }
                
                if (data.extended_until) {
                    this.extendedUntil = new Date(data.extended_until);
                }
                
                this.cartExtended = data.cart_extended || false;
                
                // Check if expired - clear silently (no warnings, no popups)
                if (this.isCartExpired()) {
                    console.log('Cart expired in backend - clearing silently');
                    this.clearCart();
                    // Update warning display after clearing
                    setTimeout(() => this.updateExpirationWarning(), 100);
                    return true;
                }
                
                // Update warning display after loading cart data
                setTimeout(() => this.updateExpirationWarning(), 100);
                
                const frontendHasItems = this.cart.items && this.cart.items.length > 0;
                const backendHasItems = items && items.length > 0;
                const backendHasInvoice = data.invoice_id !== null && data.invoice_id !== undefined;
                
                // CRITICAL: Backend is the source of truth
                // Only keep frontend cart if:
                // 1. Backend has no invoice (invoice_id is null) AND
                // 2. Frontend has items AND
                // 3. Items were just added (within last 5 seconds) AND
                // 4. Not forcing a reload
                const timeSinceLastAction = Date.now() - lastActionTime;
                const recentlyAddedItems = lastActionTime > 0 && timeSinceLastAction < 5000; // 5 seconds
                const shouldKeepFrontendCart = !force &&
                                               frontendHasItems &&
                                               !backendHasItems &&
                                               (!backendHasInvoice || recentlyAddedItems);
                
                if (shouldKeepFrontendCart) {
                    // Backend hasn't synced yet (no invoice) and items were just added - keep frontend cart temporarily
                    console.log('Backend cart is empty but items were just added - keeping frontend cart temporarily');
                    // Still update totals if backend provides them
                    if (data.subtotal !== undefined) {
                        this.cart.subtotal = data.subtotal;
                    }
                    if (data.total !== undefined) {
                        this.cart.total = data.total;
                    }
                    this.saveCart();
                    this.lastBackendSyncAt = Date.now();
                } else {
                    // CRITICAL: Always use backend data as source of truth
                    // This ensures frontend cart matches backend state
                    // But preserve image_url from frontend if backend doesn't provide it (fallback)
                    const itemsWithPreservedImages = items.map(backendItem => {
                        // If backend doesn't have image_url, try to get it from frontend cart
                        if (!backendItem.image_url || backendItem.image_url === '/public/images/placeholder.jpg') {
                            const frontendItem = this.cart.items.find(fi => 
                                String(fi.batch_id) === String(backendItem.batch_id) ||
                                String(fi.product_id) === String(backendItem.product_id)
                            );
                            if (frontendItem && frontendItem.image_url && frontendItem.image_url !== '/public/images/placeholder.jpg') {
                                backendItem.image_url = frontendItem.image_url;
                            }
                        }
                        return backendItem;
                    });
                    
                    this.cart = {
                        items: itemsWithPreservedImages,
                        subtotal: data.subtotal || 0,
                        total: data.total || 0
                    };
                    this.saveCart();
                    this.lastBackendSyncAt = Date.now();
                    
                    if (frontendHasItems && !backendHasItems && !recentlyAddedItems) {
                        console.log('⚠️ Frontend cart had items but backend is empty - cleared frontend cart to match backend');
                    }
                }
                return true;
            }
            return false;
        } catch (e) {
            console.error('Error loading cart from backend:', e);
            return false;
        }
    }
}

// Global cart manager instance
let cartManager = null;

// Initialize cart manager
function initCartManager(uuid) {
    if (!cartManager) {
        cartManager = new CartManager(uuid);
        cartManager.updateCartIcon();
    }
    return cartManager;
}

// Get cart manager instance
function getCartManager() {
    return cartManager;
}

// Global function to extend cart (called from UI)
if (typeof window !== 'undefined') {
    window.extendCart = async function() {
        const cart = getCartManager();
        if (!cart) {
            console.error('Cart manager not initialized');
            if (typeof window.showNotification === 'function') {
                window.showNotification('Cart not available', 'error');
            }
            return;
        }
        await cart.extendCart();
    };
}

