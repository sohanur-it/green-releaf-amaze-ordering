// Batch Management Table JavaScript
// Handles the "View All Batches" tab

// State
let allBatchesData = [];
let filteredBatches = [];

/**
 * Load all marked batches into the table
 */
async function loadAllBatchesTable() {
    try {
        const response = await fetch('/admin/api/batch-management/marked');
        const result = await response.json();

        if (result.success) {
            allBatchesData = result.data;
            filteredBatches = [...allBatchesData];
            renderBatchTable();
            setupTableFilters();
        } else {
            console.error('Failed to load batches:', result.error);
        }
    } catch (error) {
        console.error('Error loading batch table:', error);
    }
}

/**
 * Render the batch table
 */
function renderBatchTable() {
    const tbody = document.getElementById('all-batches-tbody');
    tbody.innerHTML = '';

    if (filteredBatches.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="8" style="text-align: center;">No batches found</td>';
        tbody.appendChild(row);
        return;
    }

    filteredBatches.forEach(batch => {
        const row = createBatchRow(batch);
        tbody.appendChild(row);
    });
}

/**
 * Create a table row for a batch
 * @param {Object} batch - Batch data
 * @returns {HTMLElement} Table row
 */
function createBatchRow(batch) {
    const row = document.createElement('tr');

    // Product name
    const displayName = batch.display_item_name || batch.product_display_name || batch.item_name;
    const nameCell = document.createElement('td');
    nameCell.textContent = displayName;
    row.appendChild(nameCell);

    // Batch name (custom or original)
    const batchNameCell = document.createElement('td');
    batchNameCell.textContent = batch.custom_batch_name || batch.original_batch_name;
    batchNameCell.title = `Original: ${batch.original_batch_name}`;
    row.appendChild(batchNameCell);

    // Status (inline editable)
    const statusCell = document.createElement('td');
    const statusSelect = document.createElement('select');
    statusSelect.className = 'inline-select';
    statusSelect.innerHTML = `
        <option value="Sellable" ${batch.status === 'Sellable' ? 'selected' : ''}>Sellable</option>
        <option value="On Deck" ${batch.status === 'On Deck' ? 'selected' : ''}>On Deck</option>
        <option value="On Hold" ${batch.status === 'On Hold' ? 'selected' : ''}>On Hold</option>
    `;
    statusSelect.onchange = () => handleInlineStatusChange(batch.batch_name, statusSelect.value, batch.custom_batch_name);
    statusCell.appendChild(statusSelect);
    row.appendChild(statusCell);

    // Full packages
    const fullCell = document.createElement('td');
    fullCell.innerHTML = `<span class="clickable" onclick="showFullPackageDetailsModal('${batch.batch_name}')">${batch.full_package_count || 0} 📋</span>`;
    row.appendChild(fullCell);

    // Partial packages
    const partialCell = document.createElement('td');
    partialCell.textContent = batch.partial_package_count || 0;
    row.appendChild(partialCell);

    // THC %
    const thcCell = document.createElement('td');
    thcCell.textContent = batch.thc_percentage ? `${parseFloat(batch.thc_percentage).toFixed(2)}%` : '-';
    row.appendChild(thcCell);

    // Test date
    const testDateCell = document.createElement('td');
    testDateCell.textContent = batch.test_date ? formatDate(batch.test_date) : '-';
    row.appendChild(testDateCell);

    // Actions
    const actionsCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm btn-secondary';
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => openEditBatchModal(batch);
    actionsCell.appendChild(editBtn);
    row.appendChild(actionsCell);

    return row;
}

/**
 * Handle inline status change
 * @param {string} batchName - Batch name
 * @param {string} newStatus - New status
 * @param {string} customName - Current custom name
 */
async function handleInlineStatusChange(batchName, newStatus, customName) {
    try {
        const response = await fetch(`/admin/api/batch-management/batch/${encodeURIComponent(batchName)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: newStatus,
                custom_batch_name: customName
            })
        });

        const result = await response.json();

        if (result.success) {
            showSuccess('Status updated successfully');
            // Reload table to reflect changes
            setTimeout(() => loadAllBatchesTable(), 500);
        } else {
            showError(result.error || 'Failed to update status');
            loadAllBatchesTable(); // Reload to reset dropdown
        }
    } catch (error) {
        console.error('Error updating status:', error);
        showError('Failed to update status');
        loadAllBatchesTable();
    }
}

/**
 * Open edit batch modal
 * @param {Object} batch - Batch data
 */
function openEditBatchModal(batch) {
    document.getElementById('edit-batch-name').value = batch.batch_name;
    document.getElementById('edit-status').value = batch.status;
    document.getElementById('edit-custom-name').value = batch.custom_batch_name || '';

    const modal = document.getElementById('edit-batch-modal');
    modal.style.display = 'block';
}

/**
 * Close edit batch modal
 */
function closeEditBatchModal() {
    const modal = document.getElementById('edit-batch-modal');
    modal.style.display = 'none';
}

/**
 * Save batch edit
 */
async function saveEditBatch() {
    const batchName = document.getElementById('edit-batch-name').value;
    const newStatus = document.getElementById('edit-status').value;
    const customName = document.getElementById('edit-custom-name').value.trim();

    try {
        const response = await fetch(`/admin/api/batch-management/batch/${encodeURIComponent(batchName)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: newStatus,
                custom_batch_name: customName || null
            })
        });

        const result = await response.json();

        if (result.success) {
            showSuccess('Batch updated successfully');
            closeEditBatchModal();
            loadAllBatchesTable();
        } else {
            showError(result.error || 'Failed to update batch');
        }
    } catch (error) {
        console.error('Error updating batch:', error);
        showError('Failed to update batch');
    }
}

/**
 * Show full package details modal from table
 * @param {string} batchName - Batch name
 */
function showFullPackageDetailsModal(batchName) {
    const batch = allBatchesData.find(b => b.batch_name === batchName);
    if (!batch || !batch.full_package_details) return;

    const modal = document.getElementById('package-modal');
    const body = document.getElementById('package-modal-body');

    const fullPackages = batch.full_package_details.full_packages || [];

    let html = '<div class="package-list">';
    if (fullPackages.length === 0) {
        html += '<p>No full package details available</p>';
    } else {
        fullPackages.forEach(pkg => {
            html += `<div class="package-item"><strong>${pkg.label}:</strong> ${pkg.quantity}g</div>`;
        });
    }
    html += '</div>';

    body.innerHTML = html;
    modal.style.display = 'block';
}

/**
 * Set up table filters
 */
function setupTableFilters() {
    const searchInput = document.getElementById('batch-search');
    const statusFilter = document.getElementById('status-filter');

    searchInput.addEventListener('input', applyFilters);
    statusFilter.addEventListener('change', applyFilters);
}

/**
 * Apply filters to the table
 */
function applyFilters() {
    const searchText = document.getElementById('batch-search').value.toLowerCase();
    const statusFilter = document.getElementById('status-filter').value;

    filteredBatches = allBatchesData.filter(batch => {
        // Search filter
        const displayName = (batch.display_item_name || batch.product_display_name || batch.item_name).toLowerCase();
        const batchName = (batch.custom_batch_name || batch.original_batch_name).toLowerCase();
        const matchesSearch = displayName.includes(searchText) || batchName.includes(searchText);

        // Status filter
        const matchesStatus = !statusFilter || batch.status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    renderBatchTable();
}

/**
 * Format date for display
 * @param {string} dateStr - ISO date string
 * @returns {string} Formatted date
 */
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
