// Admin Cancelled Packages Verification Dashboard
// Module 5: Section 10.7

let selectedPackages = new Set();
let currentFilters = {};
let currentPage = 1;
let currentPackageId = null;

// Load packages on page load
document.addEventListener('DOMContentLoaded', () => {
    loadPackages();
});

// Load packages with filters
async function loadPackages() {
    const filters = {
        invoice: document.getElementById('filterInvoice').value,
        incident_type: document.getElementById('filterIncidentType').value,
        status: document.getElementById('filterStatus').value,
        days: document.getElementById('filterDays').value,
        page: currentPage,
        limit: 25
    };

    currentFilters = filters;

    try {
        const response = await fetch('/api/v1/admin/cancelled-shipments/unverified-packages?' + new URLSearchParams(filters));
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || 'Failed to load packages');

        renderPackages(data.packages || []);
        renderPagination(data.pagination || {});
        updateBulkActions();

    } catch (error) {
        console.error('Error loading packages:', error);
        alert('Error loading packages: ' + error.message);
    }
}

// Render packages table
function renderPackages(packages) {
    const tbody = document.getElementById('packagesTableBody');
    
    if (packages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No packages found</td></tr>';
        return;
    }

    tbody.innerHTML = packages.map(pkg => {
        const daysSince = Math.floor((Date.now() - new Date(pkg.created_at).getTime()) / (1000 * 60 * 60 * 24));
        const status = pkg.returned_to_inventory ? 'verified' : (pkg.allocation_released ? 'missing' : 'unverified');
        const statusBadge = status === 'verified' ? 'success' : (status === 'missing' ? 'danger' : 'warning');
        const statusText = status === 'verified' ? 'Verified' : (status === 'missing' ? 'Missing' : 'Unverified');

        return `
            <tr>
                <td>
                    <input type="checkbox" class="package-checkbox" value="${pkg.id}" 
                           onchange="togglePackage(${pkg.id})" ${selectedPackages.has(pkg.id) ? 'checked' : ''}>
                </td>
                <td>${pkg.invoice_number}</td>
                <td><code>${pkg.package_label}</code></td>
                <td>${pkg.batch_id || 'N/A'}</td>
                <td>${formatIncidentType(pkg.incident_type)}</td>
                <td>${daysSince} days</td>
                <td><span class="badge bg-${statusBadge}">${statusText}</span></td>
                <td>
                    ${status === 'unverified' ? `
                        <button class="btn btn-sm btn-success" onclick="showVerifyModal(${pkg.id}, '${pkg.package_label}', '${pkg.invoice_number}')">
                            <i class="fas fa-check"></i> Verify
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="showMissingModal(${pkg.id}, '${pkg.package_label}', '${pkg.invoice_number}')">
                            <i class="fas fa-times"></i> Missing
                        </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

// Format incident type
function formatIncidentType(type) {
    const types = {
        'customer_cancel': 'Customer Cancel',
        'driver_accident': 'Driver Accident',
        'other': 'Other'
    };
    return types[type] || type;
}

// Render pagination
function renderPagination(pagination) {
    const paginationDiv = document.getElementById('pagination');
    
    if (!pagination || pagination.totalPages <= 1) {
        paginationDiv.innerHTML = '';
        return;
    }

    let html = '<nav><ul class="pagination justify-content-center">';
    
    // Previous button
    html += `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" onclick="changePage(${currentPage - 1}); return false;">Previous</a>
    </li>`;

    // Page numbers
    for (let i = 1; i <= pagination.totalPages; i++) {
        if (i === 1 || i === pagination.totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            html += `<li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link" href="#" onclick="changePage(${i}); return false;">${i}</a>
            </li>`;
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
        }
    }

    // Next button
    html += `<li class="page-item ${currentPage === pagination.totalPages ? 'disabled' : ''}">
        <a class="page-link" href="#" onclick="changePage(${currentPage + 1}); return false;">Next</a>
    </li>`;

    html += '</ul></nav>';
    paginationDiv.innerHTML = html;
}

// Change page
function changePage(page) {
    currentPage = page;
    loadPackages();
}

// Clear filters
function clearFilters() {
    document.getElementById('filterInvoice').value = '';
    document.getElementById('filterIncidentType').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterDays').value = '';
    currentPage = 1;
    loadPackages();
}

// Toggle package selection
function togglePackage(packageId) {
    if (selectedPackages.has(packageId)) {
        selectedPackages.delete(packageId);
    } else {
        selectedPackages.add(packageId);
    }
    updateBulkActions();
}

// Toggle select all
function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll').checked;
    const checkboxes = document.querySelectorAll('.package-checkbox');
    
    checkboxes.forEach(cb => {
        cb.checked = selectAll;
        const packageId = parseInt(cb.value);
        if (selectAll) {
            selectedPackages.add(packageId);
        } else {
            selectedPackages.delete(packageId);
        }
    });
    
    updateBulkActions();
}

// Update bulk actions visibility
function updateBulkActions() {
    const bulkActionsCard = document.getElementById('bulkActionsCard');
    const selectedCount = document.getElementById('selectedCount');
    
    if (selectedPackages.size > 0) {
        bulkActionsCard.style.display = 'block';
        selectedCount.textContent = `${selectedPackages.size} package(s) selected`;
    } else {
        bulkActionsCard.style.display = 'none';
    }
}

// Show verify modal
function showVerifyModal(packageId, packageLabel, invoiceNumber) {
    currentPackageId = packageId;
    document.getElementById('verifyPackageLabel').textContent = packageLabel;
    document.getElementById('verifyInvoiceNumber').textContent = invoiceNumber;
    new bootstrap.Modal(document.getElementById('verifyModal')).show();
}

// Confirm verify
async function confirmVerify() {
    if (!currentPackageId) return;

    try {
        const response = await fetch(`/api/v1/admin/cancelled-shipments/verify-package/${currentPackageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to verify package');

        alert('Package verified successfully');
        bootstrap.Modal.getInstance(document.getElementById('verifyModal')).hide();
        loadPackages();

    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Show missing modal
function showMissingModal(packageId, packageLabel, invoiceNumber) {
    currentPackageId = packageId;
    document.getElementById('missingPackageLabel').textContent = packageLabel;
    document.getElementById('missingInvoiceNumber').textContent = invoiceNumber;
    document.getElementById('missingReason').value = '';
    new bootstrap.Modal(document.getElementById('missingModal')).show();
}

// Confirm mark missing
async function confirmMarkMissing() {
    if (!currentPackageId) return;

    const reason = document.getElementById('missingReason').value.trim();
    if (!reason) {
        alert('Please provide a reason');
        return;
    }

    try {
        const response = await fetch(`/api/v1/admin/cancelled-shipments/mark-missing/${currentPackageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to mark package as missing');

        alert('Package marked as missing');
        bootstrap.Modal.getInstance(document.getElementById('missingModal')).hide();
        loadPackages();

    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Bulk verify
async function bulkVerify() {
    if (selectedPackages.size === 0) return;

    // Module 21.5: Enforce batch size limit
    if (selectedPackages.size > 100) {
        alert('Cannot process more than 100 packages at once. Please select fewer packages.');
        return;
    }

    // Module 21.1: Enhanced confirmation modal
    const packageList = Array.from(selectedPackages).slice(0, 10);
    const moreCount = selectedPackages.size > 10 ? selectedPackages.size - 10 : 0;
    const packageListText = packageList.map(id => {
        const pkg = document.querySelector(`[data-package-id="${id}"]`);
        return pkg ? pkg.dataset.packageLabel : `Package ${id}`;
    }).join(', ');
    
    const confirmMessage = `Verify ${selectedPackages.size} package(s)?\n\n` +
        `Packages: ${packageListText}${moreCount > 0 ? `\n...and ${moreCount} more` : ''}\n\n` +
        `This will verify packages in METRC and release allocations.`;

    if (!confirm(confirmMessage)) return;

    try {
        const response = await fetch('/api/v1/admin/cancelled-shipments/bulk-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ package_ids: Array.from(selectedPackages) })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to verify packages');

        alert(`${data.verified_count || 0} package(s) verified, allocations released`);
        selectedPackages.clear();
        loadPackages();

    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Bulk mark missing
async function bulkMarkMissing() {
    if (selectedPackages.size === 0) return;

    // Module 21.5: Enforce batch size limit
    if (selectedPackages.size > 100) {
        alert('Cannot process more than 100 packages at once. Please select fewer packages.');
        return;
    }

    const reason = prompt('Enter reason for marking packages as missing:');
    if (!reason || reason.trim().length < 10) {
        alert('Reason is required (minimum 10 characters)');
        return;
    }

    try {
        const response = await fetch('/api/v1/admin/cancelled-shipments/bulk-mark-missing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                package_ids: Array.from(selectedPackages),
                reason 
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to mark packages as missing');

        alert(`${data.marked_count || 0} package(s) marked as missing`);
        selectedPackages.clear();
        loadPackages();

    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Module 21.1: Bulk mark as destroyed
async function bulkMarkDestroyed() {
    if (selectedPackages.size === 0) return;

    // Module 21.5: Enforce batch size limit
    if (selectedPackages.size > 100) {
        alert('Cannot process more than 100 packages at once. Please select fewer packages.');
        return;
    }

    // Show destruction modal
    const destructionReason = prompt('Destruction Reason (Fire, Theft, Accident, Other):');
    if (!destructionReason) return;

    const detailedDescription = prompt('Detailed Description (minimum 50 characters):');
    if (!detailedDescription || detailedDescription.trim().length < 50) {
        alert('Detailed description is required (minimum 50 characters)');
        return;
    }

    const confirmMessage = `WARNING: This will permanently destroy ${selectedPackages.size} package(s) and reduce inventory.\n\n` +
        `Destruction Reason: ${destructionReason}\n` +
        `This action CANNOT be undone.\n\n` +
        `Continue?`;

    if (!confirm(confirmMessage)) return;

    try {
        const response = await fetch('/api/v1/admin/cancelled-shipments/bulk-mark-destroyed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                package_ids: Array.from(selectedPackages),
                destruction_reason: destructionReason,
                detailed_description: detailedDescription
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to mark packages as destroyed');

        alert(`${data.destroyed_count || 0} package(s) marked as destroyed. ` +
              `Total value lost: $${(data.total_value_lost || 0).toFixed(2)}. ` +
              `Accounting team notified.`);
        selectedPackages.clear();
        loadPackages();

    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Module 21.1: Bulk export to CSV
async function bulkExport() {
    if (selectedPackages.size === 0) return;

    // Module 21.5: Enforce batch size limit
    if (selectedPackages.size > 100) {
        alert('Cannot export more than 100 packages at once. Please select fewer packages.');
        return;
    }

    try {
        const packageIdsParam = Array.from(selectedPackages).join(',');
        const url = `/api/v1/admin/cancelled-shipments/bulk-export?package_ids=${packageIdsParam}`;
        
        // Trigger download
        window.location.href = url;
        
        // Clear selection after a delay
        setTimeout(() => {
            selectedPackages.clear();
            updateBulkActions();
        }, 1000);

    } catch (error) {
        alert('Error: ' + error.message);
    }
}

