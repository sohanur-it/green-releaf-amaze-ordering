// Admin Table JS - Main table view with inline editing support
// Handles table rendering, sorting, expandable rows, column resizing, reordering, and visibility

let tableData = [];
let filteredData = [];
let sortColumn = null;
let sortDirection = 'asc';

// Column management
let columnOrder = ['display_name', 'original_name', 'completion', 'category', 'brand', 'price', 'photos', 'description', 'batches', 'full_packages', 'partial_packages', 'actions'];
let hiddenColumns = new Set();
let columnWidths = {}; // Store custom column widths

// SVG Icons
const SVG_ICONS = {
    checkmark: '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    xmark: '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    expand: '<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>',
    collapse: '<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>',
    edit: '<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
    link: '<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    unlink: '<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.84 12.25l1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"></path><path d="M5.17 11.75l-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"></path><line x1="8" y1="2" x2="8" y2="5"></line><line x1="2" y1="8" x2="5" y2="8"></line><line x1="16" y1="19" x2="16" y2="22"></line><line x1="19" y1="16" x2="22" y2="16"></line></svg>',
    crown: '<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>'
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    loadColumnPreferences();
    await loadTableData();
    setupTableHandlers();
    initializeColumnResizing();
    initializeColumnReordering();
    initializeColumnVisibility();
});

// Load table data from API
async function loadTableData() {
    try {
        showLoading();

        const response = await fetch('/admin/api/table-data');
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to load table data');
        }

        tableData = result.data.products;
        filteredData = [...tableData];

        // Initialize filters with options
        if (window.initializeFilters) {
            window.initializeFilters(result.data.filters);
        }

        renderTable();
        updateStats(result.data.stats);

    } catch (error) {
        console.error('Error loading table data:', error);
        showToast('Error loading table data: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Render the table
function renderTable() {
    const tbody = document.getElementById('admin-table-body');

    if (!filteredData || filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="empty-message">No products found</td></tr>';
        return;
    }

    tbody.innerHTML = '';

    filteredData.forEach(product => {
        const row = createTableRow(product);
        tbody.appendChild(row);
    });
}

// Create a table row for a product
function createTableRow(product) {
    const row = document.createElement('tr');
    row.className = 'product-row';
    row.dataset.itemName = product.item_name;

    // Add visual styling for children
    if (product.is_child) {
        row.classList.add('child-product-row');
    }
    if (product.is_master) {
        row.classList.add('master-product-row');
    }

    // Display name (editable for masters only)
    const displayName = product.display_item_name || product.original_item_name || product.item_name;

    // Create display name cell content
    let displayNameContent = '';
    if (product.is_child && product.master_info) {
        // Child product - show linked icon and master's display name
        displayNameContent = `
            <span class="child-product-indicator" title="Paired to ${escapeHtml(product.master_info.display_item_name || product.master_info.item_name)}">
                🔗
            </span>
            <span class="child-display-name">${escapeHtml(product.master_info.display_item_name || product.master_info.item_name)}</span>
        `;
    } else if (product.is_master) {
        // Master product - show display name with badge
        displayNameContent = `
            ${escapeHtml(displayName)}
            <span class="master-badge" title="${product.child_count} product(s) paired">
                👑 Master (${product.child_count})
            </span>
        `;
    } else {
        // Independent product
        displayNameContent = escapeHtml(displayName);
    }

    // Completion badge
    const completionBadge = `<span class="completion-badge ${product.completion_badge_class}">${product.completion_percentage}%</span>`;

    // Has photos icon with SVG
    const hasPhotos = product.image_count > 0
        ? `<span class="status-yes" title="Has photos">${SVG_ICONS.checkmark}</span>`
        : `<span class="status-no" title="No photos">${SVG_ICONS.xmark}</span>`;

    // Has description icon with SVG
    const hasDescription = product.product_description
        ? `<span class="status-yes" title="Has description">${SVG_ICONS.checkmark}</span>`
        : `<span class="status-no" title="No description">${SVG_ICONS.xmark}</span>`;

    // Editable class for display name - not editable for children
    const displayNameEditable = product.is_child ? '' : 'cell-editable';

    row.innerHTML = `
        <td class="${displayNameEditable}" data-field="display_item_name" data-type="text" data-column="display_name">${displayNameContent}</td>
        <td data-column="original_name">${escapeHtml(product.original_item_name || product.item_name)}</td>
        <td class="completion-cell" data-column="completion">${completionBadge}</td>
        <td class="cell-editable" data-field="category" data-type="select" data-column="category">${escapeHtml(product.category || '')}</td>
        <td class="cell-editable" data-field="brand" data-type="select" data-column="brand">${escapeHtml(product.brand || '')}</td>
        <td class="cell-editable" data-field="default_price" data-type="number" data-column="price">${formatPrice(product.default_price)}</td>
        <td class="icons-cell" data-column="photos">${hasPhotos}</td>
        <td class="icons-cell cell-editable" data-field="product_description" data-type="modal" title="Double-click to edit description" data-column="description">${hasDescription}</td>
        <td data-column="batches">${product.batch_count || 0}</td>
        <td data-column="full_packages">${product.total_full_packages || 0}</td>
        <td data-column="partial_packages">${product.total_partial_packages || 0}</td>
        <td class="actions-cell" data-column="actions">
            ${createActionButtons(product)}
        </td>
    `;

    return row;
}

/**
 * Create action buttons based on product type (master/child/independent)
 */
function createActionButtons(product) {
    let buttons = '';

    if (product.is_child) {
        // Child product - show unpair button
        buttons += `<button class="btn-icon btn-unpair" onclick="handleUnpair('${escapeHtml(product.item_name)}')" title="Unpair from master">${SVG_ICONS.unlink}</button>`;
    } else if (product.completion_percentage >= 82) {
        // Product is at least 82% complete (has all required fields except possibly images) - show pair button
        buttons += `<button class="btn-icon btn-pair" onclick="handlePair('${escapeHtml(product.item_name)}')" title="Pair products">${SVG_ICONS.link}</button>`;
    }

    // Standard buttons for all products
    buttons += `
        <button class="btn-icon btn-expand" onclick="toggleBatchDetails(this, '${escapeHtml(product.item_name)}')" title="View batches">${SVG_ICONS.expand}</button>
        <a href="/admin/item/${encodeURIComponent(product.item_name)}" class="btn-icon btn-edit" title="Edit full details">${SVG_ICONS.edit}</a>
    `;

    return buttons;
}

// Setup table event handlers
function setupTableHandlers() {
    // Sorting
    const headers = document.querySelectorAll('.admin-table th[data-sort]');
    headers.forEach(header => {
        header.style.cursor = 'pointer';
        header.addEventListener('click', () => {
            const column = header.dataset.sort;
            handleSort(column);
        });
    });

    // Double-click for inline editing
    document.getElementById('admin-table-body').addEventListener('dblclick', (e) => {
        const cell = e.target.closest('.cell-editable');
        if (cell && window.startInlineEdit) {
            window.startInlineEdit(cell);
        }
    });
}

// Handle column sorting
function handleSort(column) {
    if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortDirection = 'asc';
    }

    // Sort the data
    filteredData.sort((a, b) => {
        let aVal, bVal;

        switch(column) {
            case 'display_name':
                aVal = (a.display_item_name || a.original_item_name || a.item_name).toLowerCase();
                bVal = (b.display_item_name || b.original_item_name || b.item_name).toLowerCase();
                break;
            case 'original_name':
                aVal = (a.original_item_name || a.item_name).toLowerCase();
                bVal = (b.original_item_name || b.item_name).toLowerCase();
                break;
            case 'completion':
                aVal = a.completion_percentage || 0;
                bVal = b.completion_percentage || 0;
                break;
            case 'category':
                aVal = (a.category || '').toLowerCase();
                bVal = (b.category || '').toLowerCase();
                break;
            case 'brand':
                aVal = (a.brand || '').toLowerCase();
                bVal = (b.brand || '').toLowerCase();
                break;
            case 'price':
                aVal = a.default_price || 0;
                bVal = b.default_price || 0;
                break;
            case 'batches':
                aVal = a.batch_count || 0;
                bVal = b.batch_count || 0;
                break;
            case 'full_packages':
                aVal = a.total_full_packages || 0;
                bVal = b.total_full_packages || 0;
                break;
            case 'partial_packages':
                aVal = a.total_partial_packages || 0;
                bVal = b.total_partial_packages || 0;
                break;
            default:
                return 0;
        }

        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    renderTable();
    updateSortIndicators();
}

// Update sort indicators in table headers
function updateSortIndicators() {
    const headers = document.querySelectorAll('.admin-table th[data-sort]');
    headers.forEach(header => {
        const arrow = header.querySelector('.sort-arrow');
        if (arrow) arrow.remove();

        if (header.dataset.sort === sortColumn) {
            const arrow = document.createElement('span');
            arrow.className = 'sort-arrow';
            arrow.textContent = sortDirection === 'asc' ? ' ▲' : ' ▼';
            header.appendChild(arrow);
        }
    });
}

// Toggle batch details expandable row
async function toggleBatchDetails(button, itemName) {
    const row = button.closest('tr');
    const existingDetailsRow = row.nextElementSibling;

    // If already expanded, collapse
    if (existingDetailsRow && existingDetailsRow.classList.contains('batch-details-row')) {
        existingDetailsRow.remove();
        button.innerHTML = SVG_ICONS.expand;
        return;
    }

    // Expand - fetch batch details
    button.innerHTML = SVG_ICONS.collapse;

    try {
        const response = await fetch(`/admin/api/batch-details/${encodeURIComponent(itemName)}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to load batch details');
        }

        const detailsRow = createBatchDetailsRow(result.data);
        row.after(detailsRow);

    } catch (error) {
        console.error('Error loading batch details:', error);
        showToast('Error loading batch details: ' + error.message, 'error');
        button.innerHTML = SVG_ICONS.expand;
    }
}

// Create expandable batch details row
function createBatchDetailsRow(batches) {
    const row = document.createElement('tr');
    row.className = 'batch-details-row';

    const cell = document.createElement('td');
    cell.colSpan = 12;

    if (!batches || batches.length === 0) {
        cell.innerHTML = '<div class="batch-details-content"><p class="empty-message">No batches found</p></div>';
    } else {
        const batchesHTML = batches.map(batch => `
            <div class="batch-item">
                <div class="batch-header">
                    <strong>${escapeHtml(batch.batch_name)}</strong>
                    <span class="batch-license">${escapeHtml(batch.synclicense || '')}</span>
                </div>
                <div class="batch-info">
                    <span>Full Packages: ${batch.full_package_count || 0}</span>
                    <span>Partial Packages: ${batch.partial_package_count || 0}</span>
                    ${batch.thc_percentage ? `<span>THC: ${batch.thc_percentage}%</span>` : ''}
                    ${batch.test_date ? `<span>Test Date: ${formatDate(batch.test_date)}</span>` : ''}
                    ${batch.best_by_date ? `<span>Best By: ${formatDate(batch.best_by_date)}</span>` : ''}
                    ${batch.storage_location ? `<span>Location: ${escapeHtml(batch.storage_location)}</span>` : ''}
                </div>
            </div>
        `).join('');

        cell.innerHTML = `<div class="batch-details-content">${batchesHTML}</div>`;
    }

    row.appendChild(cell);
    return row;
}

// Update stats display
function updateStats(stats) {
    const totalElem = document.getElementById('stat-total');
    const completeElem = document.getElementById('stat-complete');
    const incompleteElem = document.getElementById('stat-incomplete');

    if (totalElem) totalElem.textContent = stats.total || 0;
    if (completeElem) completeElem.textContent = stats.complete || 0;
    if (incompleteElem) incompleteElem.textContent = stats.incomplete || 0;
}

// Apply filters (called from filters.js)
function applyFilters(filters) {
    filteredData = tableData.filter(product => {
        // Completion filter
        if (filters.completion.length > 0) {
            const percentage = product.completion_percentage || 0;
            let matchesCompletion = false;

            filters.completion.forEach(range => {
                if (range === '100' && percentage === 100) matchesCompletion = true;
                if (range === '75-99' && percentage >= 75 && percentage < 100) matchesCompletion = true;
                if (range === '50-74' && percentage >= 50 && percentage < 75) matchesCompletion = true;
                if (range === '25-49' && percentage >= 25 && percentage < 50) matchesCompletion = true;
                if (range === '0-24' && percentage >= 0 && percentage < 25) matchesCompletion = true;
            });

            if (!matchesCompletion) return false;
        }

        // Has photos filter
        if (filters.hasPhotos !== null) {
            const hasPhotos = product.image_count > 0;
            if (filters.hasPhotos && !hasPhotos) return false;
            if (!filters.hasPhotos && hasPhotos) return false;
        }

        // Has description filter
        if (filters.hasDescription !== null) {
            const hasDescription = !!product.product_description;
            if (filters.hasDescription && !hasDescription) return false;
            if (!filters.hasDescription && hasDescription) return false;
        }

        // Category filter
        if (filters.categories.length > 0 && !filters.categories.includes(product.category)) {
            return false;
        }

        // Brand filter
        if (filters.brands.length > 0 && !filters.brands.includes(product.brand)) {
            return false;
        }

        // Search filter
        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            const displayName = (product.display_item_name || product.original_item_name || product.item_name).toLowerCase();
            const originalName = (product.original_item_name || product.item_name).toLowerCase();
            const category = (product.category || '').toLowerCase();
            const brand = (product.brand || '').toLowerCase();

            if (!displayName.includes(searchLower) &&
                !originalName.includes(searchLower) &&
                !category.includes(searchLower) &&
                !brand.includes(searchLower)) {
                return false;
            }
        }

        return true;
    });

    renderTable();
}

// Update a single row after inline edit
function updateTableRow(itemName, updatedData) {
    // Update in tableData
    const index = tableData.findIndex(p => p.item_name === itemName);
    if (index !== -1) {
        tableData[index] = { ...tableData[index], ...updatedData };
    }

    // Update in filteredData
    const filteredIndex = filteredData.findIndex(p => p.item_name === itemName);
    if (filteredIndex !== -1) {
        filteredData[filteredIndex] = { ...filteredData[filteredIndex], ...updatedData };
    }

    // Re-render table
    renderTable();
}

// Utility: format price
function formatPrice(price) {
    if (!price) return '$0.00';
    return '$' + parseFloat(price).toFixed(2);
}

// Utility: format date
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString();
}

// Utility: escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle pairing action
function handlePair(itemName) {
    openPairingModal(itemName, async () => {
        // Reload table data after successful pairing
        await loadTableData();
    });
}

// Handle unpair action
function handleUnpair(itemName) {
    showUnpairConfirmation(itemName, async () => {
        // Reload table data after successful unpair
        await loadTableData();
    });
}

// ========================================
// COLUMN MANAGEMENT FUNCTIONS
// ========================================

/**
 * Load column preferences from localStorage
 */
function loadColumnPreferences() {
    const savedOrder = localStorage.getItem('adminTableColumnOrder');
    const savedHidden = localStorage.getItem('adminTableHiddenColumns');
    const savedWidths = localStorage.getItem('adminTableColumnWidths');

    if (savedOrder) {
        try {
            columnOrder = JSON.parse(savedOrder);
        } catch (e) {
            console.error('Error loading column order:', e);
        }
    }

    if (savedHidden) {
        try {
            hiddenColumns = new Set(JSON.parse(savedHidden));
        } catch (e) {
            console.error('Error loading hidden columns:', e);
        }
    }

    if (savedWidths) {
        try {
            columnWidths = JSON.parse(savedWidths);
        } catch (e) {
            console.error('Error loading column widths:', e);
        }
    }
}

/**
 * Save column preferences to localStorage
 */
function saveColumnPreferences() {
    localStorage.setItem('adminTableColumnOrder', JSON.stringify(columnOrder));
    localStorage.setItem('adminTableHiddenColumns', JSON.stringify([...hiddenColumns]));
    localStorage.setItem('adminTableColumnWidths', JSON.stringify(columnWidths));
}

/**
 * Initialize column resizing functionality
 */
function initializeColumnResizing() {
    const table = document.getElementById('admin-table');
    if (!table) return;

    const headers = table.querySelectorAll('th.resizable');

    headers.forEach((th, index) => {
        const handle = th.querySelector('.resize-handle');
        if (!handle) return;

        const column = th.dataset.column;

        // Apply saved width if exists
        if (columnWidths[column]) {
            th.style.width = columnWidths[column] + 'px';
            th.style.minWidth = columnWidths[column] + 'px';
        }

        let startX, startWidth;

        handle.addEventListener('mousedown', function(e) {
            e.preventDefault();
            e.stopPropagation();

            startX = e.pageX;
            startWidth = th.offsetWidth;

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            table.classList.add('resizing');
        });

        function onMouseMove(e) {
            const diff = e.pageX - startX;
            const newWidth = Math.max(50, startWidth + diff); // Minimum 50px

            th.style.width = newWidth + 'px';
            th.style.minWidth = newWidth + 'px';

            // Apply same width to all cells in this column
            const columnIndex = Array.from(th.parentElement.children).indexOf(th);
            const rows = table.querySelectorAll('tbody tr:not(.batch-details-row)');
            rows.forEach(row => {
                const cell = row.children[columnIndex];
                if (cell) {
                    cell.style.width = newWidth + 'px';
                    cell.style.minWidth = newWidth + 'px';
                }
            });
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            table.classList.remove('resizing');

            // Save the new width
            columnWidths[column] = th.offsetWidth;
            saveColumnPreferences();
        }
    });
}

/**
 * Initialize column reordering functionality
 */
function initializeColumnReordering() {
    const headerRow = document.getElementById('table-header-row');
    if (!headerRow) return;

    let draggedColumn = null;
    let draggedIndex = null;

    headerRow.querySelectorAll('th').forEach((th, index) => {
        // Skip actions column from reordering
        if (th.dataset.column === 'actions') return;

        th.draggable = true;
        th.style.cursor = 'move';

        th.addEventListener('dragstart', function(e) {
            draggedColumn = th;
            draggedIndex = index;
            th.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        th.addEventListener('dragend', function(e) {
            th.classList.remove('dragging');
            document.querySelectorAll('th').forEach(header => {
                header.classList.remove('drag-over');
            });
        });

        th.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            if (draggedColumn !== th) {
                th.classList.add('drag-over');
            }
        });

        th.addEventListener('dragleave', function(e) {
            th.classList.remove('drag-over');
        });

        th.addEventListener('drop', function(e) {
            e.preventDefault();
            th.classList.remove('drag-over');

            if (draggedColumn !== th && draggedColumn) {
                const dropIndex = index;

                // Reorder columns in the DOM
                reorderTableColumns(draggedIndex, dropIndex);

                // Update columnOrder array
                const draggedColName = columnOrder[draggedIndex];
                columnOrder.splice(draggedIndex, 1);
                columnOrder.splice(dropIndex, 0, draggedColName);

                saveColumnPreferences();
            }

            draggedColumn = null;
            draggedIndex = null;
        });
    });
}

/**
 * Reorder columns in the table DOM
 */
function reorderTableColumns(fromIndex, toIndex) {
    const table = document.getElementById('admin-table');
    const headerRow = table.querySelector('thead tr');
    const rows = table.querySelectorAll('tbody tr');

    // Move header
    const headerCells = Array.from(headerRow.children);
    const movedHeader = headerCells[fromIndex];
    headerRow.removeChild(movedHeader);

    if (toIndex >= headerCells.length) {
        headerRow.appendChild(movedHeader);
    } else {
        headerRow.insertBefore(movedHeader, headerCells[toIndex]);
    }

    // Move all body cells
    rows.forEach(row => {
        if (row.classList.contains('batch-details-row')) return;

        const cells = Array.from(row.children);
        const movedCell = cells[fromIndex];
        row.removeChild(movedCell);

        if (toIndex >= cells.length) {
            row.appendChild(movedCell);
        } else {
            row.insertBefore(movedCell, cells[toIndex]);
        }
    });
}

/**
 * Initialize column visibility toggle
 */
function initializeColumnVisibility() {
    const toggleButton = document.getElementById('toggle-column-visibility');
    const menu = document.getElementById('column-visibility-menu');
    const list = document.getElementById('column-visibility-list');

    if (!toggleButton || !menu || !list) return;

    // Populate column list
    const columnLabels = {
        'display_name': 'Display Name',
        'original_name': 'Original Name',
        'completion': 'Completion',
        'category': 'Category',
        'brand': 'Brand',
        'price': 'Price',
        'photos': 'Photos',
        'description': 'Description',
        'batches': '# Batches',
        'full_packages': 'Full Packages',
        'partial_packages': 'Partial Packages'
    };

    list.innerHTML = '';
    columnOrder.forEach(col => {
        if (col === 'actions') return; // Don't allow hiding actions column

        const item = document.createElement('label');
        item.className = 'column-visibility-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !hiddenColumns.has(col);
        checkbox.dataset.column = col;

        checkbox.addEventListener('change', function() {
            toggleColumnVisibility(col, this.checked);
        });

        const label = document.createElement('span');
        label.textContent = columnLabels[col] || col;

        item.appendChild(checkbox);
        item.appendChild(label);
        list.appendChild(item);
    });

    // Toggle menu
    toggleButton.addEventListener('click', function(e) {
        e.stopPropagation();
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });

    // Close menu when clicking outside
    document.addEventListener('click', function(e) {
        if (!menu.contains(e.target) && e.target !== toggleButton) {
            menu.style.display = 'none';
        }
    });
}

/**
 * Toggle column visibility
 */
function toggleColumnVisibility(columnName, visible) {
    const table = document.getElementById('admin-table');
    const headerRow = table.querySelector('thead tr');
    const headers = Array.from(headerRow.querySelectorAll('th'));

    // Find column index
    const columnIndex = headers.findIndex(th => th.dataset.column === columnName);
    if (columnIndex === -1) return;

    // Toggle hidden state
    if (visible) {
        hiddenColumns.delete(columnName);
        headers[columnIndex].style.display = '';

        // Show all cells in this column
        table.querySelectorAll('tbody tr:not(.batch-details-row)').forEach(row => {
            const cell = row.children[columnIndex];
            if (cell) cell.style.display = '';
        });
    } else {
        hiddenColumns.add(columnName);
        headers[columnIndex].style.display = 'none';

        // Hide all cells in this column
        table.querySelectorAll('tbody tr:not(.batch-details-row)').forEach(row => {
            const cell = row.children[columnIndex];
            if (cell) cell.style.display = 'none';
        });
    }

    saveColumnPreferences();
}

/**
 * Close column visibility menu
 */
function closeColumnMenu() {
    const menu = document.getElementById('column-visibility-menu');
    if (menu) menu.style.display = 'none';
}

// Expose functions to window for other scripts
window.applyFilters = applyFilters;
window.updateTableRow = updateTableRow;
window.handlePair = handlePair;
window.handleUnpair = handleUnpair;
window.closeColumnMenu = closeColumnMenu;

// Description Modal Functions
let currentDescriptionCell = null;
let descriptionEditor = null;

function openDescriptionModal(cell) {
    currentDescriptionCell = cell;

    // Get the actual description from the product data
    const row = cell.closest('tr');
    const itemName = row.dataset.itemName;
    const product = tableData.find(p => p.item_name === itemName);
    const description = product?.product_description || '';

    // Show modal first
    document.getElementById('description-modal').style.display = 'flex';

    // Initialize TinyMCE if not already initialized
    if (!descriptionEditor) {
        tinymce.init({
            selector: '#description-editor',
            height: 400,
            menubar: false,
            plugins: 'lists link image code table',
            toolbar: 'undo redo | formatselect | bold italic underline | alignleft aligncenter alignright | bullist numlist | link | code',
            content_style: 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif; font-size: 14px; }',
            setup: function(editor) {
                descriptionEditor = editor;
                editor.on('init', function() {
                    editor.setContent(description);
                });
            }
        });
    } else {
        // Editor already exists, just set content
        descriptionEditor.setContent(description);
    }
}

function closeDescriptionModal() {
    currentDescriptionCell = null;
    document.getElementById('description-modal').style.display = 'none';
}

async function saveDescription() {
    if (!currentDescriptionCell || !descriptionEditor) return;

    // Get content from TinyMCE editor
    const newValue = descriptionEditor.getContent();
    const itemName = currentDescriptionCell.closest('tr').dataset.itemName;
    const fieldName = 'product_description';

    try {
        showLoading();

        const response = await fetch(`/admin/api/inline-edit/${encodeURIComponent(itemName)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fieldName, fieldValue: newValue })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to save description');
        }

        // Update cell display
        const hasContent = newValue && newValue.trim().length > 0;
        currentDescriptionCell.innerHTML = hasContent
            ? '<span class="status-icon status-yes" title="Has description">✓</span>'
            : '<span class="status-icon status-no" title="No description">✗</span>';

        // Update table row with new data
        if (window.updateTableRow) {
            window.updateTableRow(itemName, result.data);
        }

        showToast('Description saved successfully', 'success');
        closeDescriptionModal();

    } catch (error) {
        console.error('Error saving description:', error);
        showToast('Error saving description: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Expose modal functions to window
window.openDescriptionModal = openDescriptionModal;
window.closeDescriptionModal = closeDescriptionModal;
window.saveDescription = saveDescription;
