// Public/js/admin/fulfillment-queue.js
// Fulfillment Queue Management

let currentPage = 1;
let totalPages = 1;
let pageSize = 25; // Default page size
let currentFilters = {
    status: '',
    location: '',
    customer: '',
    deliveryZone: '',
    sortBy: 'age',
    sortOrder: 'asc'
};

/**
 * Utility: Show loading state on button
 */
function setButtonLoading(button, isLoading) {
    if (!button) return;
    
    if (isLoading) {
        button.classList.add('btn-loading');
        button.disabled = true;
        button.dataset.originalText = button.innerHTML;
        // Keep the button text structure but make it transparent
        const icon = button.querySelector('i');
        if (icon) {
            icon.style.opacity = '0';
        }
    } else {
        button.classList.remove('btn-loading');
        button.disabled = false;
        if (button.dataset.originalText) {
            button.innerHTML = button.dataset.originalText;
            delete button.dataset.originalText;
        }
        const icon = button.querySelector('i');
        if (icon) {
            icon.style.opacity = '1';
        }
    }
}

/**
 * Utility: Get button by event or selector
 */
function getButtonFromEvent(event, selector) {
    if (event && event.target) {
        return event.target.closest('button') || event.target;
    }
    if (selector) {
        return document.querySelector(selector);
    }
    return null;
}


// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadDeliveryZones();
    
    // Set initial page size from select element if it exists
    const pageSizeSelect = document.getElementById('page-size-select');
    if (pageSizeSelect) {
        pageSize = parseInt(pageSizeSelect.value) || 25;
    }
    
    loadQueue();
    
    // Set up auto-refresh every 30 seconds
    setInterval(() => {
        loadQueue();
    }, 30000);
});

/**
 * Load delivery zones for filter dropdown
 */
async function loadDeliveryZones() {
    const deliveryZoneFilter = document.getElementById('delivery-zone-filter');
    if (!deliveryZoneFilter) {
        return;
    }

    try {
        const response = await fetch('/api/crm/delivery-zones');
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to load delivery zones');
        }

        // Clear existing options except "All Zones"
        deliveryZoneFilter.innerHTML = '<option value="">All Zones</option>';

        // Add zones to dropdown
        if (data.zones && data.zones.length > 0) {
            data.zones.forEach(zone => {
                const option = document.createElement('option');
                option.value = zone;
                option.textContent = zone;
                deliveryZoneFilter.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading delivery zones:', error);
        // Keep the default "All Zones" option if loading fails
    }
}

/**
 * Load fulfillment queue
 */
async function loadQueue() {
    const queueList = document.getElementById('queue-list');
    queueList.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i><p>Loading queue...</p></div>';

    try {
        const params = new URLSearchParams({
            page: currentPage,
            limit: pageSize,
            ...currentFilters
        });

        const response = await fetch(`/api/v1/fulfillment/queue?${params}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load queue');
        }

        renderQueue(data.queue);
        // Always use summary counts from API (they are static and not affected by filters)
        if (data.summary) {
            updateStats(data.summary);
        } else {
            console.warn('Summary counts not provided by API, using fallback calculation');
            updateStats(data.queue);
        }
        updatePagination(data.pagination);

    } catch (error) {
        console.error('Error loading queue:', error);
        queueList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Error Loading Queue</h3>
                <p>${error.message}</p>
            </div>
        `;
    }
}

/**
 * Render queue items
 */
function renderQueue(orders) {
    const queueList = document.getElementById('queue-list');

    if (orders.length === 0) {
        queueList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <h3>No Orders in Queue</h3>
                <p>All orders have been claimed or there are no orders ready for fulfillment.</p>
            </div>
        `;
        return;
    }

    queueList.innerHTML = orders.map(order => {
        const statusClass = order.status === 'Approved' ? 'available' : 
                          order.status === 'Fulfillment_Accepted' ? 'claimed' : 'issue';
        const statusText = order.status === 'Approved' ? 'Available' :
                          order.status === 'Fulfillment_Accepted' ? 'In Progress' : 'Issue';
        
        const canClaim = order.status === 'Approved' && !order.fulfillment_accepted_by;
        const isAssignedToMe = order.fulfillment_accepted_by === window.currentUserId;
        const isSalesUserReadOnly = window.isSalesUser && !window.isFulfillmentUser;

        return `
            <div class="order-card ${statusClass}" data-invoice-id="${order.id}">
                <div class="order-header">
                    <div class="order-title">
                        <h3>${order.invoice_number}</h3>
                        <p>${order.buyer_name} • ${order.location_name || 'N/A'}${order.delivery_zone ? ` • Zone: ${order.delivery_zone}` : ''}</p>
                    </div>
                    <div class="order-status ${order.status.toLowerCase().replace('_', '-')}">
                        ${statusText}
                    </div>
                </div>
                
                <div class="order-details">
                    <div class="order-detail">
                        <label>Destination</label>
                        <span>${order.city || 'N/A'}, ${order.state || 'N/A'}</span>
                    </div>
                    ${order.delivery_zone ? `
                    <div class="order-detail">
                        <label>Delivery Zone</label>
                        <span>${order.delivery_zone}</span>
                    </div>
                    ` : ''}
                    <div class="order-detail">
                        <label>Total Value</label>
                        <span>$${parseFloat(order.total || 0).toFixed(2)}</span>
                    </div>
                    <div class="order-detail">
                        <label>Packages Needed</label>
                        <span>${order.total_packages_needed || 0}</span>
                    </div>
                    <div class="order-detail">
                        <label>Line Items</label>
                        <span>${order.line_item_count || 0}</span>
                    </div>
                    ${order.assigned_worker_firstname ? `
                    <div class="order-detail">
                        <label>Assigned To</label>
                        <span>${order.assigned_worker_firstname} ${order.assigned_worker_lastname}</span>
                    </div>
                    ` : ''}
                </div>

                <div class="order-actions">
                    ${!isSalesUserReadOnly && canClaim ? `
                        <button class="btn-claim" onclick="claimOrder(${order.id})">
                            <i class="fas fa-hand-paper"></i> Claim Order
                        </button>
                    ` : ''}
                    ${!isSalesUserReadOnly && isAssignedToMe ? `
                        <button class="btn-view" onclick="startScanning(${order.id})" ${order.status === 'Fulfillment_Issue' ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} title="${order.status === 'Fulfillment_Issue' ? 'Cannot start scanning - invoice has an issue' : ''}">
                            <i class="fas fa-barcode"></i> Start Scanning
                        </button>
                        <button class="btn-view" style="background: #ef4444;" onclick="releaseOrder(${order.id})">
                            <i class="fas fa-undo"></i> Release
                        </button>
                    ` : ''}
                    ${!isSalesUserReadOnly && (window.isAdmin || window.isFulfillmentAdmin) ? `
                        <button class="btn-view" style="background: #8b5cf6;" onclick="reassignOrder(${order.id})">
                            <i class="fas fa-user-exchange"></i> Reassign
                        </button>
                    ` : ''}
                    <button class="btn-view" onclick="viewOrder(${order.id})">
                        <i class="fas fa-eye"></i> View Details
                    </button>
                    ${isSalesUserReadOnly ? `
                        <span style="color: var(--text-light); font-size: 0.875rem; margin-left: 1rem; display: inline-flex; align-items: center;">
                            <i class="fas fa-lock" style="margin-right: 0.25rem;"></i> Read-Only
                        </span>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Update statistics
 */
/**
 * Update summary statistics
 * @param {Object|Array} data - Either summary object with {pending, in_progress, issues} or array of orders
 */
function updateStats(data) {
    let pending, inProgress, issues;
    
    // Check if data is a summary object (from API) or array of orders (fallback)
    if (data && typeof data === 'object' && !Array.isArray(data) && 'pending' in data) {
        // Use summary counts from API (unfiltered)
        pending = data.pending || 0;
        inProgress = data.in_progress || 0;
        issues = data.issues || 0;
    } else {
        // Fallback: calculate from filtered orders array
        const orders = Array.isArray(data) ? data : [];
        pending = orders.filter(o => o.status === 'Approved').length;
        inProgress = orders.filter(o => o.status === 'Fulfillment_Accepted').length;
        issues = orders.filter(o => o.status === 'Fulfillment_Issue').length;
    }

    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-in-progress').textContent = inProgress;
    document.getElementById('stat-issues').textContent = issues;
}

/**
 * Update pagination
 */
function updatePagination(pagination) {
    const paginationEl = document.getElementById('pagination');
    const pageInfo = document.getElementById('page-info');
    
    if (pagination.totalPages <= 1) {
        paginationEl.style.display = 'none';
        return;
    }

    paginationEl.style.display = 'block';
    pageInfo.textContent = `Page ${pagination.page} of ${pagination.totalPages}`;
    
    document.getElementById('prev-page').disabled = pagination.page === 1;
    document.getElementById('next-page').disabled = pagination.page === pagination.totalPages;
    
    totalPages = pagination.totalPages;
}

/**
 * Apply filters
 */
function applyFilters() {
    currentFilters = {
        status: document.getElementById('status-filter').value,
        location: document.getElementById('location-filter').value,
        customer: document.getElementById('customer-filter').value,
        deliveryZone: document.getElementById('delivery-zone-filter')?.value || '',
        sortBy: document.getElementById('sort-by').value,
        sortOrder: 'asc'
    };
    
    // Update page size if changed
    const newPageSize = parseInt(document.getElementById('page-size-select')?.value || pageSize);
    if (newPageSize !== pageSize) {
        pageSize = newPageSize;
        currentPage = 1; // Reset to first page when page size changes
    }
    
    currentPage = 1;
    loadQueue();
}

/**
 * Handle page size change
 */
function changePageSize(newSize) {
    pageSize = parseInt(newSize);
    currentPage = 1; // Reset to first page
    loadQueue();
}

/**
 * Change page
 */
function changePage(delta) {
    const newPage = currentPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        loadQueue();
    }
}

/**
 * Refresh queue
 */
function refreshQueue() {
    loadQueue();
}

/**
 * Claim an order
 */
/**
 * Claim an order
 */
async function claimOrder(invoiceId) {
    if (!confirm('Claim this order for fulfillment?')) {
        return;
    }

    // Find the button that triggered this action
    const button = document.querySelector(`button[onclick*="claimOrder(${invoiceId})"]`) ||
                   document.querySelector(`button[onclick*="claimOrder('${invoiceId}')"]`);
    setButtonLoading(button, true);

    try {
        const response = await fetch('/api/v1/fulfillment/queue/claim', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ invoice_id: invoiceId })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to claim order');
        }

        alert(`Order ${data.invoice_number} claimed successfully!`);
        loadQueue();

    } catch (error) {
        console.error('Error claiming order:', error);
        alert(`Error: ${error.message}`);
        setButtonLoading(button, false);
    }
}

/**
 * Start scanning session
 */
function startScanning(invoiceId) {
    window.location.href = `/admin/fulfillment/scanning/${invoiceId}`;
}

/**
 * View order details
 */
function viewOrder(invoiceId) {
    window.location.href = `/admin/invoices/${invoiceId}`;
}

/**
 * Release order back to queue
 */
async function releaseOrder(invoiceId) {
    if (!confirm('Release this order back to the queue?')) {
        return;
    }

    // Find the button that triggered this action
    const button = document.querySelector(`button[onclick*="releaseOrder(${invoiceId})"]`) ||
                   document.querySelector(`button[onclick*="releaseOrder('${invoiceId}')"]`);
    setButtonLoading(button, true);

    try {
        const response = await fetch('/api/v1/fulfillment/queue/release', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ invoice_id: invoiceId })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to release order');
        }

        alert('Order released successfully');
        loadQueue();

    } catch (error) {
        console.error('Error releasing order:', error);
        alert(`Error: ${error.message}`);
        setButtonLoading(button, false);
    }
}

/**
 * Admin reassign order
 */
async function reassignOrder(invoiceId) {
    const newWorkerId = prompt('Enter new worker user ID:');
    if (!newWorkerId) {
        return;
    }

    // Find the button that triggered this action
    const button = document.querySelector(`button[onclick*="reassignOrder(${invoiceId})"]`) ||
                   document.querySelector(`button[onclick*="reassignOrder('${invoiceId}')"]`);
    setButtonLoading(button, true);

    try {
        const response = await fetch('/api/v1/fulfillment/admin/reassign', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_id: invoiceId,
                to_user_id: parseInt(newWorkerId)
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to reassign order');
        }

        alert('Order reassigned successfully');
        loadQueue();

    } catch (error) {
        console.error('Error reassigning order:', error);
        alert(`Error: ${error.message}`);
        setButtonLoading(button, false);
    }
}

// Make functions globally accessible for onclick handlers
window.claimOrder = claimOrder;
window.releaseOrder = releaseOrder;
window.reassignOrder = reassignOrder;
window.startScanning = startScanning;
window.viewOrder = viewOrder;
window.refreshQueue = refreshQueue;
window.applyFilters = applyFilters;
window.changePageSize = changePageSize;
window.changePage = changePage;

