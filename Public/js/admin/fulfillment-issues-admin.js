// Public/js/admin/fulfillment-issues-admin.js
// Admin Issue Management

let currentFilters = {};
let selectedInvoices = new Set();

document.addEventListener('DOMContentLoaded', () => {
    loadIssues();
});

/**
 * Load issues
 */
async function loadIssues() {
    const tbody = document.getElementById('issues-tbody');
    
    try {
        const params = new URLSearchParams(currentFilters);
        const response = await fetch(`/api/v1/admin/fulfillment/issues?${params}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load issues');
        }

        renderIssues(data.issues || []);

    } catch (error) {
        console.error('Error loading issues:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: #ef4444;">
                    Error: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * Render issues table
 */
function renderIssues(issues) {
    const tbody = document.getElementById('issues-tbody');

    if (issues.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem;">
                    No issues found
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = issues.map(issue => {
        const isSelected = selectedInvoices.has(issue.id);
        return `
            <tr>
                <td>
                    <input type="checkbox" ${isSelected ? 'checked' : ''} 
                           onchange="toggleInvoice(${issue.id}, this.checked)">
                </td>
                <td><strong>${issue.invoice_number}</strong></td>
                <td>${issue.issue_type || 'N/A'}</td>
                <td>${(issue.fulfillment_issue_note || '').substring(0, 100)}${(issue.fulfillment_issue_note || '').length > 100 ? '...' : ''}</td>
                <td>${issue.sales_rep_name || 'Unassigned'}</td>
                <td>${new Date(issue.fulfillment_issue_reported_at).toLocaleString()}</td>
                <td>
                    <button class="btn-action btn-view" onclick="viewInvoice(${issue.id})">
                        <i class="fas fa-eye"></i> View
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    updateBulkActionButtons();
}

/**
 * Toggle invoice selection
 */
function toggleInvoice(invoiceId, checked) {
    if (checked) {
        selectedInvoices.add(invoiceId);
    } else {
        selectedInvoices.delete(invoiceId);
    }
    updateBulkActionButtons();
}

/**
 * Toggle select all
 */
function toggleSelectAll() {
    const checked = document.getElementById('select-all').checked;
    document.getElementById('select-all-header').checked = checked;
    
    const checkboxes = document.querySelectorAll('#issues-tbody input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = checked;
        const invoiceId = parseInt(cb.getAttribute('onchange').match(/\d+/)[0]);
        if (checked) {
            selectedInvoices.add(invoiceId);
        } else {
            selectedInvoices.delete(invoiceId);
        }
    });
    
    updateBulkActionButtons();
}

/**
 * Update bulk action buttons
 */
function updateBulkActionButtons() {
    const hasSelection = selectedInvoices.size > 0;
    document.getElementById('btn-bulk-assign').disabled = !hasSelection;
    document.getElementById('btn-bulk-resolve').disabled = !hasSelection;
}

/**
 * Apply filters
 */
function applyFilters() {
    currentFilters = {
        status: document.getElementById('status-filter').value,
        sales_rep_id: document.getElementById('sales-rep-filter').value,
        date_from: document.getElementById('date-from').value,
        date_to: document.getElementById('date-to').value
    };
    loadIssues();
}

/**
 * Bulk assign
 */
function bulkAssign() {
    if (selectedInvoices.size === 0) {
        alert('Please select at least one issue');
        return;
    }
    document.getElementById('bulk-assign-modal').classList.add('active');
}

/**
 * Close bulk assign modal
 */
function closeBulkAssignModal() {
    document.getElementById('bulk-assign-modal').classList.remove('active');
}

/**
 * Handle bulk assign
 */
document.getElementById('bulk-assign-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const salesRepId = parseInt(document.getElementById('bulk-assign-rep-id').value);
    const invoiceIds = Array.from(selectedInvoices);
    
    try {
        const response = await fetch('/api/v1/admin/fulfillment/issues/bulk-assign', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_ids: invoiceIds,
                sales_rep_id: salesRepId
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to bulk assign');
        }
        
        alert(`${data.updated_count} issue(s) assigned successfully`);
        closeBulkAssignModal();
        selectedInvoices.clear();
        loadIssues();
        
    } catch (error) {
        console.error('Error bulk assigning:', error);
        alert(`Error: ${error.message}`);
    }
});

/**
 * Bulk resolve
 */
async function bulkResolve() {
    if (selectedInvoices.size === 0) {
        alert('Please select at least one issue');
        return;
    }
    
    const resolutionDetails = prompt('Enter resolution details:');
    if (!resolutionDetails) {
        return;
    }
    
    const invoiceIds = Array.from(selectedInvoices);
    
    try {
        const response = await fetch('/api/v1/admin/fulfillment/issues/bulk-resolve', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_ids: invoiceIds,
                resolution_details: resolutionDetails
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to bulk resolve');
        }
        
        alert(`${data.resolved_count} issue(s) resolved successfully`);
        selectedInvoices.clear();
        loadIssues();
        
    } catch (error) {
        console.error('Error bulk resolving:', error);
        alert(`Error: ${error.message}`);
    }
}

/**
 * View invoice
 */
function viewInvoice(invoiceId) {
    window.location.href = `/admin/invoices/${invoiceId}`;
}

