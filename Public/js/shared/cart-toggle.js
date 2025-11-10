// Shared Cart Toggle Functionality
// Works on both store and checkout pages

/**
 * Initialize cart toggle functionality
 * This sets up the cart icon click handler and manages cart sidebar open/close state
 */
function initCartToggle() {
    const cartToggleBtn = document.getElementById('cart-toggle');
    const cartOverlay = document.getElementById('cart-overlay');
    const cartEl = document.querySelector('.portal-cart');
    
    if (!cartEl) {
        // Cart sidebar doesn't exist on this page (e.g., checkout page)
        // Just ensure the cart icon is still functional for showing count
        return;
    }
    
    // Initialize cart collapsed state (default hidden)
    const cartCollapsedPref = localStorage.getItem('cartCollapsed');
    if (cartCollapsedPref === null) {
        localStorage.setItem('cartCollapsed', 'true');
    }
    
    // Set initial state
    if (localStorage.getItem('cartCollapsed') === 'true') {
        cartEl.classList.add('collapsed');
        if (cartOverlay) {
            cartOverlay.style.display = 'none';
            cartOverlay.style.opacity = '0';
        }
    } else {
        cartEl.classList.remove('collapsed');
        if (cartOverlay) {
            cartOverlay.style.display = 'block';
            cartOverlay.style.opacity = '1';
        }
    }
    
    /**
     * Toggle cart sidebar
     * @param {boolean} show - Optional: force show (true) or hide (false). If undefined, toggles.
     */
    function toggleCart(show) {
        if (!cartEl) return;
        
        if (show === undefined) {
            // Toggle current state
            const isCurrentlyCollapsed = cartEl.classList.contains('collapsed');
            show = isCurrentlyCollapsed;
        }
        
        if (show) {
            // Open cart
            cartEl.classList.remove('collapsed');
            localStorage.setItem('cartCollapsed', 'false');
            if (cartOverlay) {
                cartOverlay.style.display = 'block';
                setTimeout(() => { cartOverlay.style.opacity = '1'; }, 10);
            }
            window.dispatchEvent(new CustomEvent('cartSidebarOpened'));
        } else {
            // Close cart
            cartEl.classList.add('collapsed');
            localStorage.setItem('cartCollapsed', 'true');
            if (cartOverlay) {
                cartOverlay.style.opacity = '0';
                setTimeout(() => { cartOverlay.style.display = 'none'; }, 300);
            }
            window.dispatchEvent(new CustomEvent('cartSidebarClosed'));
        }
    }
    
    // Cart toggle button click handler
    if (cartToggleBtn) {
        cartToggleBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleCart(); // Toggle state
        });
    }
    
    // Close cart when clicking overlay
    if (cartOverlay) {
        cartOverlay.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleCart(false); // Force close
        });
    }
    
    // Make toggleCart available globally for manual control if needed
    window.toggleCart = toggleCart;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCartToggle);
} else {
    initCartToggle();
}

