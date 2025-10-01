// Filters Component - Sidebar filters for admin table
// Handles completion %, photos, description, category, brand filters

let activeFilters = {
    completion: [],
    hasPhotos: null,
    hasDescription: null,
    categories: [],
    brands: [],
    search: ''
};

let filterOptions = {
    categories: [],
    brands: []
};

// Initialize filters with options from server
function initializeFilters(options) {
    filterOptions = options;
    renderFilters();
    setupSearchHandler();
}

// Expose to window for admin-table.js
window.initializeFilters = initializeFilters;

// Render all filter sections
function renderFilters() {
    renderCompletionFilters();
    renderHasPhotosFilter();
    renderHasDescriptionFilter();
    renderCategoryFilters();
    renderBrandFilters();
}

// Render completion percentage filters
function renderCompletionFilters() {
    const container = document.getElementById('completion-filters');
    if (!container) return;

    const completionRanges = [
        { value: '100', label: '100% Complete' },
        { value: '75-99', label: '75-99%' },
        { value: '50-74', label: '50-74%' },
        { value: '25-49', label: '25-49%' },
        { value: '0-24', label: '0-24%' }
    ];

    container.innerHTML = '';

    completionRanges.forEach(range => {
        const label = document.createElement('label');
        label.className = 'filter-checkbox';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = range.value;
        checkbox.addEventListener('change', () => toggleCompletionFilter(range.value, checkbox.checked));

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + range.label));
        container.appendChild(label);
    });
}

// Render has photos filter
function renderHasPhotosFilter() {
    const container = document.getElementById('has-photos-filter');
    if (!container) return;

    container.innerHTML = `
        <label class="filter-radio">
            <input type="radio" name="hasPhotos" value="all" checked>
            All
        </label>
        <label class="filter-radio">
            <input type="radio" name="hasPhotos" value="yes">
            Has Photos
        </label>
        <label class="filter-radio">
            <input type="radio" name="hasPhotos" value="no">
            No Photos
        </label>
    `;

    container.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'all') {
                activeFilters.hasPhotos = null;
            } else {
                activeFilters.hasPhotos = e.target.value === 'yes';
            }
            applyAllFilters();
        });
    });
}

// Render has description filter
function renderHasDescriptionFilter() {
    const container = document.getElementById('has-description-filter');
    if (!container) return;

    container.innerHTML = `
        <label class="filter-radio">
            <input type="radio" name="hasDescription" value="all" checked>
            All
        </label>
        <label class="filter-radio">
            <input type="radio" name="hasDescription" value="yes">
            Has Description
        </label>
        <label class="filter-radio">
            <input type="radio" name="hasDescription" value="no">
            No Description
        </label>
    `;

    container.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'all') {
                activeFilters.hasDescription = null;
            } else {
                activeFilters.hasDescription = e.target.value === 'yes';
            }
            applyAllFilters();
        });
    });
}

// Render category filters
function renderCategoryFilters() {
    const container = document.getElementById('category-filters');
    if (!container) return;

    if (!filterOptions.categories || filterOptions.categories.length === 0) {
        container.innerHTML = '<p class="empty-message">No categories</p>';
        return;
    }

    container.innerHTML = '';

    filterOptions.categories.forEach(category => {
        const label = document.createElement('label');
        label.className = 'filter-checkbox';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = category;
        checkbox.addEventListener('change', () => toggleCategoryFilter(category, checkbox.checked));

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + category));
        container.appendChild(label);
    });
}

// Render brand filters
function renderBrandFilters() {
    const container = document.getElementById('brand-filters');
    if (!container) return;

    if (!filterOptions.brands || filterOptions.brands.length === 0) {
        container.innerHTML = '<p class="empty-message">No brands</p>';
        return;
    }

    container.innerHTML = '';

    filterOptions.brands.forEach(brand => {
        const label = document.createElement('label');
        label.className = 'filter-checkbox';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = brand;
        checkbox.addEventListener('change', () => toggleBrandFilter(brand, checkbox.checked));

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + brand));
        container.appendChild(label);
    });
}

// Setup search handler
function setupSearchHandler() {
    const searchInput = document.getElementById('filter-search');
    if (!searchInput) return;

    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            activeFilters.search = e.target.value.trim();
            applyAllFilters();
        }, 300);
    });
}

// Toggle completion filter
function toggleCompletionFilter(value, checked) {
    if (checked) {
        if (!activeFilters.completion.includes(value)) {
            activeFilters.completion.push(value);
        }
    } else {
        activeFilters.completion = activeFilters.completion.filter(v => v !== value);
    }
    applyAllFilters();
}

// Toggle category filter
function toggleCategoryFilter(category, checked) {
    if (checked) {
        if (!activeFilters.categories.includes(category)) {
            activeFilters.categories.push(category);
        }
    } else {
        activeFilters.categories = activeFilters.categories.filter(c => c !== category);
    }
    applyAllFilters();
}

// Toggle brand filter
function toggleBrandFilter(brand, checked) {
    if (checked) {
        if (!activeFilters.brands.includes(brand)) {
            activeFilters.brands.push(brand);
        }
    } else {
        activeFilters.brands = activeFilters.brands.filter(b => b !== brand);
    }
    applyAllFilters();
}

// Clear all filters
function clearAllFilters() {
    activeFilters = {
        completion: [],
        hasPhotos: null,
        hasDescription: null,
        categories: [],
        brands: [],
        search: ''
    };

    // Reset all checkboxes
    document.querySelectorAll('.filter-checkbox input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });

    // Reset radio buttons
    document.querySelectorAll('.filter-radio input[type="radio"][value="all"]').forEach(radio => {
        radio.checked = true;
    });

    // Reset search
    const searchInput = document.getElementById('filter-search');
    if (searchInput) {
        searchInput.value = '';
    }

    applyAllFilters();
}

// Apply all active filters
function applyAllFilters() {
    if (window.applyFilters) {
        window.applyFilters(activeFilters);
    }
    renderActiveFilters();
}

// Render active filter badges
function renderActiveFilters() {
    const container = document.getElementById('active-filters');
    if (!container) return;

    const badges = [];

    // Completion badges
    activeFilters.completion.forEach(range => {
        badges.push({
            type: 'completion',
            value: range,
            label: `Completion: ${range}%`
        });
    });

    // Has photos badge
    if (activeFilters.hasPhotos !== null) {
        badges.push({
            type: 'hasPhotos',
            value: activeFilters.hasPhotos,
            label: activeFilters.hasPhotos ? 'Has Photos' : 'No Photos'
        });
    }

    // Has description badge
    if (activeFilters.hasDescription !== null) {
        badges.push({
            type: 'hasDescription',
            value: activeFilters.hasDescription,
            label: activeFilters.hasDescription ? 'Has Description' : 'No Description'
        });
    }

    // Category badges
    activeFilters.categories.forEach(cat => {
        badges.push({
            type: 'category',
            value: cat,
            label: `Category: ${cat}`
        });
    });

    // Brand badges
    activeFilters.brands.forEach(brand => {
        badges.push({
            type: 'brand',
            value: brand,
            label: `Brand: ${brand}`
        });
    });

    // Search badge
    if (activeFilters.search) {
        badges.push({
            type: 'search',
            value: activeFilters.search,
            label: `Search: "${activeFilters.search}"`
        });
    }

    if (badges.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = '<h4>Active Filters:</h4>';

    badges.forEach(badge => {
        const span = document.createElement('span');
        span.className = 'filter-badge';
        span.innerHTML = `${badge.label} <button onclick="removeFilter('${badge.type}', '${badge.value}')">×</button>`;
        container.appendChild(span);
    });
}

// Remove a specific filter
function removeFilter(type, value) {
    switch(type) {
        case 'completion':
            activeFilters.completion = activeFilters.completion.filter(v => v !== value);
            // Uncheck the checkbox
            document.querySelectorAll('#completion-filters input[type="checkbox"]').forEach(cb => {
                if (cb.value === value) cb.checked = false;
            });
            break;
        case 'hasPhotos':
            activeFilters.hasPhotos = null;
            // Reset radio to "all"
            document.querySelector('input[name="hasPhotos"][value="all"]').checked = true;
            break;
        case 'hasDescription':
            activeFilters.hasDescription = null;
            // Reset radio to "all"
            document.querySelector('input[name="hasDescription"][value="all"]').checked = true;
            break;
        case 'category':
            activeFilters.categories = activeFilters.categories.filter(c => c !== value);
            // Uncheck the checkbox
            document.querySelectorAll('#category-filters input[type="checkbox"]').forEach(cb => {
                if (cb.value === value) cb.checked = false;
            });
            break;
        case 'brand':
            activeFilters.brands = activeFilters.brands.filter(b => b !== value);
            // Uncheck the checkbox
            document.querySelectorAll('#brand-filters input[type="checkbox"]').forEach(cb => {
                if (cb.value === value) cb.checked = false;
            });
            break;
        case 'search':
            activeFilters.search = '';
            const searchInput = document.getElementById('filter-search');
            if (searchInput) searchInput.value = '';
            break;
    }

    applyAllFilters();
}
