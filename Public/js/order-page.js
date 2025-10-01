//order page JS - e-commerce mockup with functioning cart
//includes real-time filtering, cart management, localStorage persistence

let allProducts = [];
let filteredProducts = [];
let cart = [];
let activeFilters = {
    categories: [],
    brands: [],
    strainTypes: [],
    search: ''
};

//initialize page
document.addEventListener('DOMContentLoaded', async () => {
    loadCartFromStorage();
    await loadProducts();
    await loadFilters();
    setupSearchHandler();
    updateCartDisplay();
});

//load products from API
async function loadProducts() {
    try {
        document.getElementById('products-loading').style.display = 'flex';

        const response = await fetch('/order/api/products');
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to load products');
        }

        allProducts = result.data.in_stock.concat(result.data.out_of_stock);
        filteredProducts = [...allProducts];

        renderProducts(result.data.in_stock, result.data.out_of_stock);

    } catch (error) {
        console.error('Error loading products:', error);
        showToast('Error loading products: ' + error.message, 'error');
    } finally {
        document.getElementById('products-loading').style.display = 'none';
    }
}

//load filter options from API
async function loadFilters() {
    try {
        const response = await fetch('/order/api/filters');
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to load filters');
        }

        renderFilters('category-filters', result.data.categories, 'categories');
        renderFilters('brand-filters', result.data.brands, 'brands');
        renderFilters('strain-type-filters', result.data.strain_types, 'strainTypes');

    } catch (error) {
        console.error('Error loading filters:', error);
    }
}

//render filter checkboxes
function renderFilters(containerId, options, filterKey) {
    const container = document.getElementById(containerId);

    if (!options || options.length === 0) {
        container.innerHTML = '<p class="empty-message">No options</p>';
        return;
    }

    container.innerHTML = '';

    options.forEach(option => {
        const label = document.createElement('label');
        label.className = 'filter-checkbox';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = option;
        checkbox.addEventListener('change', () => toggleFilter(filterKey, option, checkbox.checked));

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + option));

        container.appendChild(label);
    });
}

//toggle filter on/off
function toggleFilter(filterKey, value, checked) {
    if (checked) {
        if (!activeFilters[filterKey].includes(value)) {
            activeFilters[filterKey].push(value);
        }
    } else {
        activeFilters[filterKey] = activeFilters[filterKey].filter(v => v !== value);
    }

    applyFilters();
    renderActiveFilters();
}

//apply all active filters
function applyFilters() {
    filteredProducts = allProducts.filter(product => {
        //category filter
        if (activeFilters.categories.length > 0 && !activeFilters.categories.includes(product.category)) {
            return false;
        }

        //brand filter
        if (activeFilters.brands.length > 0 && !activeFilters.brands.includes(product.brand)) {
            return false;
        }

        //strain type filter
        if (activeFilters.strainTypes.length > 0 && !activeFilters.strainTypes.includes(product.strain_type)) {
            return false;
        }

        //search filter
        if (activeFilters.search) {
            const searchLower = activeFilters.search.toLowerCase();
            const nameMatch = product.item_name.toLowerCase().includes(searchLower);
            const categoryMatch = product.category.toLowerCase().includes(searchLower);
            const brandMatch = product.brand && product.brand.toLowerCase().includes(searchLower);

            if (!nameMatch && !categoryMatch && !brandMatch) {
                return false;
            }
        }

        return true;
    });

    //separate in stock from out of stock
    const inStock = filteredProducts.filter(p => p.total_quantity_available > 0);
    const outOfStock = filteredProducts.filter(p => p.total_quantity_available === 0);

    renderProducts(inStock, outOfStock);
}

//render active filters badges
function renderActiveFilters() {
    const container = document.getElementById('active-filters');
    const allActiveFilters = [
        ...activeFilters.categories,
        ...activeFilters.brands,
        ...activeFilters.strainTypes
    ];

    if (allActiveFilters.length === 0 && !activeFilters.search) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = '<h4>Active Filters:</h4>';

    allActiveFilters.forEach(filter => {
        const badge = document.createElement('span');
        badge.className = 'filter-badge';
        badge.innerHTML = `${filter} <button onclick="removeFilter('${filter}')">×</button>`;
        container.appendChild(badge);
    });

    if (activeFilters.search) {
        const badge = document.createElement('span');
        badge.className = 'filter-badge';
        badge.innerHTML = `Search: "${activeFilters.search}" <button onclick="clearSearch()">×</button>`;
        container.appendChild(badge);
    }
}

//remove individual filter
function removeFilter(value) {
    //find and uncheck the checkbox
    const checkboxes = document.querySelectorAll('.filter-checkbox input');
    checkboxes.forEach(cb => {
        if (cb.value === value) {
            cb.checked = false;

            //determine which filter key
            const container = cb.closest('.filter-options');
            let filterKey = '';
            if (container.id === 'category-filters') filterKey = 'categories';
            else if (container.id === 'brand-filters') filterKey = 'brands';
            else if (container.id === 'strain-type-filters') filterKey = 'strainTypes';

            if (filterKey) {
                activeFilters[filterKey] = activeFilters[filterKey].filter(v => v !== value);
            }
        }
    });

    applyFilters();
    renderActiveFilters();
}

//clear all filters
function clearAllFilters() {
    activeFilters = {
        categories: [],
        brands: [],
        strainTypes: [],
        search: ''
    };

    //uncheck all checkboxes
    document.querySelectorAll('.filter-checkbox input').forEach(cb => cb.checked = false);

    //clear search
    document.getElementById('product-search').value = '';

    applyFilters();
    renderActiveFilters();
}

//clear search
function clearSearch() {
    activeFilters.search = '';
    document.getElementById('product-search').value = '';
    applyFilters();
    renderActiveFilters();
}

//setup search handler
function setupSearchHandler() {
    const searchInput = document.getElementById('product-search');
    let searchTimeout;

    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            activeFilters.search = e.target.value.trim();
            applyFilters();
            renderActiveFilters();
        }, 300); //debounce 300ms
    });
}

//render products grid
function renderProducts(inStockProducts, outOfStockProducts) {
    const inStockGrid = document.getElementById('products-grid');
    const outOfStockGrid = document.getElementById('out-of-stock-grid');

    //in stock products
    if (inStockProducts.length === 0) {
        inStockGrid.innerHTML = '<p class="empty-message">No products in stock match your filters</p>';
    } else {
        inStockGrid.innerHTML = '';
        inStockProducts.forEach(product => {
            inStockGrid.appendChild(createProductCard(product, false));
        });
    }

    //out of stock products
    if (outOfStockProducts.length === 0) {
        outOfStockGrid.innerHTML = '<p class="empty-message">No out of stock products</p>';
    } else {
        outOfStockGrid.innerHTML = '';
        outOfStockProducts.forEach(product => {
            outOfStockGrid.appendChild(createProductCard(product, true));
        });
    }
}

//create product card
function createProductCard(product, isOutOfStock) {
    const card = document.createElement('div');
    card.className = 'product-card' + (isOutOfStock ? ' out-of-stock' : '');

    // Create card structure
    card.innerHTML = `
        <div class="product-image-container">
            ${product.featured_product ? '<span class="badge-featured">⭐ Featured</span>' : ''}
            ${isOutOfStock ? '<span class="badge-out-of-stock">Out of Stock</span>' : ''}
        </div>
        <div class="product-info">
            <h3 class="product-name">${escapeHtml(product.item_name)}</h3>
            <div class="product-meta">
                <span class="product-category">${escapeHtml(product.category)}</span>
                <span class="product-brand">${escapeHtml(product.brand)}</span>
            </div>
            <div class="product-details">
                <span class="product-strain">${product.strain_type || ''}</span>
                <span class="product-qty">${product.total_quantity_available} available</span>
            </div>
            <div class="product-price">
                ${formatPrice(product.default_price)} <span class="price-unit">per case</span>
            </div>
            ${!isOutOfStock ? `
                <button class="btn btn-add-to-cart" onclick="addToCart('${escapeHtml(product.item_name)}')">
                    Add to Cart
                </button>
            ` : `
                <button class="btn btn-request-more" disabled>
                    Request More?
                </button>
            `}
        </div>
    `;

    // Add carousel to image container
    const imageContainer = card.querySelector('.product-image-container');
    if (window.createProductCarousel) {
        window.createProductCarousel(imageContainer, product, {
            showArrows: false, // No arrows in product cards
            showDots: product.images && product.images.length > 1, // Only show dots if multiple images
            cycleDelay: 6000
        });
    } else {
        // Fallback if carousel not loaded
        const fallbackImage = product.images && product.images.length > 0
            ? `<img src="/${product.images[0].file_path}" alt="${escapeHtml(product.item_name)}">`
            : `<div class="product-image-placeholder">
                <span class="placeholder-icon">📦</span>
                <span class="placeholder-text">No Image Available</span>
               </div>`;
        imageContainer.innerHTML += fallbackImage;
    }

    //click card to view details (TODO: implement modal)
    card.addEventListener('click', (e) => {
        if (!e.target.classList.contains('btn')) {
            showProductDetail(product);
        }
    });

    return card;
}

//show product detail modal (TODO: implement)
function showProductDetail(product) {
    //not implemented yet - just show alert
    console.log('Product details:', product);
}

//cart management
//add item to cart
function addToCart(itemName) {
    const product = allProducts.find(p => p.item_name === itemName);

    if (!product) {
        showToast('Product not found', 'error');
        return;
    }

    //check if already in cart
    const existingItem = cart.find(item => item.item_name === itemName);

    if (existingItem) {
        //increment quantity
        if (existingItem.quantity < product.total_quantity_available) {
            existingItem.quantity++;
            showToast(`Added another ${product.item_name} to cart`, 'success');
        } else {
            showToast('Maximum available quantity reached', 'warning');
            return;
        }
    } else {
        //add new item
        cart.push({
            item_name: product.item_name,
            category: product.category,
            brand: product.brand,
            price: product.default_price,
            quantity: 1,
            max_quantity: product.total_quantity_available
        });
        showToast(`Added ${product.item_name} to cart`, 'success');
    }

    saveCartToStorage();
    updateCartDisplay();
}

//remove from cart
function removeFromCart(itemName) {
    cart = cart.filter(item => item.item_name !== itemName);
    saveCartToStorage();
    updateCartDisplay();
    showToast('Item removed from cart', 'success');
}

//update item quantity in cart
function updateCartQuantity(itemName, newQuantity) {
    const item = cart.find(i => i.item_name === itemName);

    if (!item) return;

    if (newQuantity <= 0) {
        removeFromCart(itemName);
        return;
    }

    if (newQuantity > item.max_quantity) {
        showToast('Maximum available quantity reached', 'warning');
        newQuantity = item.max_quantity;
    }

    item.quantity = newQuantity;
    saveCartToStorage();
    updateCartDisplay();
}

//update cart UI
function updateCartDisplay() {
    //update cart count badge
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    document.getElementById('cart-count').textContent = totalItems;

    //update cart items list
    const cartItemsContainer = document.getElementById('cart-items');

    if (cart.length === 0) {
        cartItemsContainer.innerHTML = '<p class="empty-cart">Your cart is empty</p>';
    } else {
        cartItemsContainer.innerHTML = '';

        cart.forEach(item => {
            const cartItem = document.createElement('div');
            cartItem.className = 'cart-item';

            cartItem.innerHTML = `
                <div class="cart-item-info">
                    <h4>${escapeHtml(item.item_name)}</h4>
                    <p class="cart-item-meta">${escapeHtml(item.category)} | ${escapeHtml(item.brand)}</p>
                    <p class="cart-item-price">${formatPrice(item.price)}</p>
                </div>
                <div class="cart-item-controls">
                    <div class="quantity-controls">
                        <button onclick="updateCartQuantity('${escapeHtml(item.item_name)}', ${item.quantity - 1})">-</button>
                        <input type="number" value="${item.quantity}" min="1" max="${item.max_quantity}"
                               onchange="updateCartQuantity('${escapeHtml(item.item_name)}', parseInt(this.value))">
                        <button onclick="updateCartQuantity('${escapeHtml(item.item_name)}', ${item.quantity + 1})">+</button>
                    </div>
                    <button class="btn-remove" onclick="removeFromCart('${escapeHtml(item.item_name)}')">Remove</button>
                </div>
            `;

            cartItemsContainer.appendChild(cartItem);
        });
    }

    //update totals
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    document.getElementById('cart-subtotal').textContent = formatPrice(subtotal);
    document.getElementById('cart-total').textContent = formatPrice(subtotal);
}

//toggle cart sidebar
function toggleCart() {
    const sidebar = document.getElementById('cart-sidebar');
    const overlay = document.getElementById('cart-overlay');

    const isOpen = sidebar.classList.contains('open');

    if (isOpen) {
        sidebar.classList.remove('open');
        overlay.style.display = 'none';
    } else {
        sidebar.classList.add('open');
        overlay.style.display = 'block';
    }
}

//proceed to checkout (mockup)
function proceedToCheckout() {
    if (cart.length === 0) {
        showToast('Your cart is empty', 'warning');
        return;
    }

    //TODO: implement checkout flow
    //for now just show alert
    alert('🚧 MOCKUP CHECKOUT 🚧\n\nThis is a mockup. No actual order is placed.\n\nTo implement:\n- Create order record in database\n- Deduct inventory\n- Send confirmation email\n- Process payment\n- Generate invoice');

    showToast('This is a mockup - no order was placed', 'info');
}

//localStorage persistence
function saveCartToStorage() {
    localStorage.setItem('greenreleaf-cart', JSON.stringify(cart));
}

function loadCartFromStorage() {
    const stored = localStorage.getItem('greenreleaf-cart');
    if (stored) {
        try {
            cart = JSON.parse(stored);
        } catch (e) {
            console.error('Error loading cart from storage:', e);
            cart = [];
        }
    }
}

//utility
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}