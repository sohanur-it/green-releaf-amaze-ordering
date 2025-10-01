// Admin Table JS - Main table view with inline editing support
// Handles table rendering, sorting, expandable rows

let tableData = [];
let filteredData = [];
let sortColumn = null;
let sortDirection = 'asc';

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadTableData();
    setupTableHandlers();
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

    // Display name (editable)
    const displayName = product.display_item_name || product.original_item_name || product.item_name;

    // Completion badge
    const completionBadge = `<span class="completion-badge ${product.completion_badge_class}">${product.completion_percentage}%</span>`;

    // Has photos icon
    const hasPhotos = product.image_count > 0
        ? '<span class="status-icon status-yes" title="Has photos">✓</span>'
        : '<span class="status-icon status-no" title="No photos">✗</span>';

    // Has description icon
    const hasDescription = product.product_description
        ? '<span class="status-icon status-yes" title="Has description">✓</span>'
        : '<span class="status-icon status-no" title="No description">✗</span>';

    row.innerHTML = `
        <td class="cell-editable" data-field="display_item_name" data-type="text">${escapeHtml(displayName)}</td>
        <td>${escapeHtml(product.original_item_name || product.item_name)}</td>
        <td class="completion-cell">${completionBadge}</td>
        <td class="cell-editable" data-field="category" data-type="select">${escapeHtml(product.category || '')}</td>
        <td class="cell-editable" data-field="brand" data-type="select">${escapeHtml(product.brand || '')}</td>
        <td class="cell-editable" data-field="default_price" data-type="number">${formatPrice(product.default_price)}</td>
        <td class="icons-cell">${hasPhotos}</td>
        <td class="icons-cell cell-editable" data-field="product_description" data-type="modal" title="Double-click to edit description">${hasDescription}</td>
        <td>${product.batch_count || 0}</td>
        <td>${product.total_packages || 0}</td>
        <td class="actions-cell">
            <button class="btn-icon btn-expand" onclick="toggleBatchDetails(this, '${escapeHtml(product.item_name)}')" title="View batches">▼</button>
            <a href="/admin/item/${encodeURIComponent(product.item_name)}" class="btn-icon btn-edit" title="Edit full details">✎</a>
        </td>
    `;

    return row;
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
            case 'packages':
                aVal = a.total_packages || 0;
                bVal = b.total_packages || 0;
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
        button.textContent = '▼';
        return;
    }

    // Expand - fetch batch details
    button.textContent = '▲';

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
        button.textContent = '▼';
    }
}

// Create expandable batch details row
function createBatchDetailsRow(batches) {
    const row = document.createElement('tr');
    row.className = 'batch-details-row';

    const cell = document.createElement('td');
    cell.colSpan = 11;

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

// Expose functions to window for other scripts
window.applyFilters = applyFilters;
window.updateTableRow = updateTableRow;

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
