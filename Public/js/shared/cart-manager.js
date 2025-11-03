// Frontend Cart Manager
// Maintains cart state in localStorage for instant updates
// Validates against backend inventory on checkout

class CartManager {
    constructor(uuid) {
        this.uuid = uuid;
        this.storageKey = `portal_cart_${uuid}`;
        this.cart = this.loadCart();
        this.inventoryCache = {}; // Cache inventory data from backend
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
        this.saveCart();
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
    validateCartAgainstInventory() {
        const issues = [];
        this.cart.items.forEach(item => {
            const available = item.quantity_available || 0;
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
    async syncToBackend() {
        try {
            // Add all items to backend cart
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
            
            // After syncing, reload cart from backend to get real line_item_ids
            const cartResponse = await fetch(`/api/portal/${this.uuid}/cart`);
            if (cartResponse.ok) {
                const backendCart = await cartResponse.json();
                // Update frontend cart with backend data (has real line_item_ids)
                this.cart.items = backendCart.items || [];
                this.cart.subtotal = backendCart.subtotal || 0;
                this.cart.total = backendCart.total || 0;
                this.saveCart();
            }
            
            return { success: true };
        } catch (e) {
            console.error('Error syncing cart to backend:', e);
            return { success: false, error: e.message };
        }
    }
    
    // Load cart from backend (for checkout page)
    async loadFromBackend() {
        try {
            const response = await fetch(`/api/portal/${this.uuid}/cart`);
            if (response.ok) {
                const data = await response.json();
                this.cart = {
                    items: data.items || [],
                    subtotal: data.subtotal || 0,
                    total: data.total || 0
                };
                this.saveCart();
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

