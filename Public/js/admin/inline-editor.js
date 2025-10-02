// Inline Editor - Handles double-click cell editing
// Supports text, number, dropdown, and checkbox types

let currentEditingCell = null;
let originalValue = null;

// Constants from server (will be loaded)
let CATEGORIES = [];
let BRANDS = [];
let STRAIN_TYPES = [];
let UNIT_SIZE_MEASUREMENTS = [];

// Load constants on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadConstants();
});

// Load constants from API
async function loadConstants() {
    try {
        const response = await fetch('/api/constants');
        const result = await response.json();

        if (result.success) {
            CATEGORIES = result.data.categories || [];
            BRANDS = result.data.brands || [];
            STRAIN_TYPES = result.data.strain_types || [];
            UNIT_SIZE_MEASUREMENTS = result.data.unit_size_measurements || [];
        }
    } catch (error) {
        console.error('Error loading constants:', error);
    }
}

// Start inline editing
function startInlineEdit(cell) {
    const fieldName = cell.dataset.field;
    const row = cell.closest('tr');
    const itemName = row.dataset.itemName;

    // Check if this row is a child product
    if (row.classList.contains('child-product-row')) {
        // Get product data from table
        const product = tableData ? tableData.find(p => p.item_name === itemName) : null;
        const masterName = product && product.master_info ?
            (product.master_info.display_item_name || product.master_info.item_name) : 'master product';

        // Show message with option to unpair
        if (confirm(`This product is paired to "${masterName}".\n\nYou cannot edit paired products directly. Would you like to unpair this product?`)) {
            handleUnpair(itemName);
        }
        return;
    }

    // Special handling for product_description - open modal instead
    if (fieldName === 'product_description') {
        if (window.openDescriptionModal) {
            window.openDescriptionModal(cell);
        }
        return;
    }

    // If already editing another cell, cancel it
    if (currentEditingCell && currentEditingCell !== cell) {
        cancelEdit();
    }

    currentEditingCell = cell;
    originalValue = cell.textContent.trim();

    const fieldType = cell.dataset.type;

    cell.classList.add('cell-editing');

    switch(fieldType) {
        case 'text':
            renderTextInput(cell, originalValue);
            break;
        case 'number':
            renderNumberInput(cell, originalValue);
            break;
        case 'select':
            renderSelectInput(cell, originalValue, fieldName);
            break;
        case 'checkbox':
            renderCheckboxInput(cell, originalValue);
            break;
        default:
            renderTextInput(cell, originalValue);
    }
}

// Render text input
function renderTextInput(cell, value) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.className = 'inline-edit-input';

    setupInputHandlers(input, cell);

    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();
}

// Render number input
function renderNumberInput(cell, value) {
    // Strip currency symbols
    const numericValue = value.replace(/[^0-9.]/g, '');

    const input = document.createElement('input');
    input.type = 'number';
    input.value = numericValue;
    input.step = '0.01';
    input.min = '0';
    input.className = 'inline-edit-input';

    setupInputHandlers(input, cell);

    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();
}

// Render select dropdown
function renderSelectInput(cell, value, fieldName) {
    const select = document.createElement('select');
    select.className = 'inline-edit-select';

    let options = [];
    switch(fieldName) {
        case 'category':
            options = CATEGORIES;
            break;
        case 'brand':
            options = BRANDS;
            break;
        case 'strain_type':
            options = STRAIN_TYPES;
            break;
        case 'unit_size_measurement':
            options = UNIT_SIZE_MEASUREMENTS;
            break;
        default:
            options = [value];
    }

    // Add empty option
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '-- Select --';
    select.appendChild(emptyOption);

    // Add options
    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        if (opt === value) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    setupInputHandlers(select, cell);

    cell.textContent = '';
    cell.appendChild(select);
    select.focus();
}

// Render checkbox input
function renderCheckboxInput(cell, value) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = value.toLowerCase() === 'yes' || value === 'true' || value === '✓';
    checkbox.className = 'inline-edit-checkbox';

    // Checkbox saves immediately on change
    checkbox.addEventListener('change', () => {
        saveEdit(cell, checkbox.checked);
    });

    cell.textContent = '';
    cell.appendChild(checkbox);
    checkbox.focus();
}

// Setup input event handlers
function setupInputHandlers(input, cell) {
    // Enter key - save
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEdit(cell, input.value);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
        }
    });

    // Click outside - cancel (don't save)
    document.addEventListener('click', function clickOutsideHandler(e) {
        if (!cell.contains(e.target)) {
            cancelEdit();
            document.removeEventListener('click', clickOutsideHandler);
        }
    });

    // Blur - cancel
    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (currentEditingCell === cell) {
                cancelEdit();
            }
        }, 200);
    });
}

// Save edit
async function saveEdit(cell, newValue) {
    const row = cell.closest('tr');
    const itemName = row.dataset.itemName;
    const fieldName = cell.dataset.field;

    // Check if value changed
    if (newValue.toString().trim() === originalValue) {
        cancelEdit();
        return;
    }

    try {
        showLoading();

        const response = await fetch(`/admin/api/inline-edit/${encodeURIComponent(itemName)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fieldName,
                fieldValue: newValue
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to save changes');
        }

        showToast('Changes saved successfully', 'success');

        // Update the cell display
        cell.classList.remove('cell-editing');
        cell.textContent = formatCellValue(fieldName, newValue);

        // Update the entire row with new data
        if (window.updateTableRow) {
            window.updateTableRow(itemName, result.data);
        }

        currentEditingCell = null;
        originalValue = null;

    } catch (error) {
        console.error('Error saving edit:', error);
        showToast('Error saving changes: ' + error.message, 'error');
        cancelEdit();
    } finally {
        hideLoading();
    }
}

// Cancel edit
function cancelEdit() {
    if (!currentEditingCell) return;

    currentEditingCell.classList.remove('cell-editing');
    currentEditingCell.textContent = originalValue;

    currentEditingCell = null;
    originalValue = null;
}

// Format cell value for display
function formatCellValue(fieldName, value) {
    switch(fieldName) {
        case 'default_price':
            return formatPrice(value);
        case 'list_to_buyers':
        case 'featured_product':
            return value ? '✓' : '✗';
        default:
            return value || '';
    }
}

// Format price
function formatPrice(price) {
    if (!price) return '$0.00';
    return '$' + parseFloat(price).toFixed(2);
}

// Expose to window for admin-table.js
window.startInlineEdit = startInlineEdit;
