// Public/js/admin/fulfillment-queue.js
// Fulfillment Queue Management

let currentPage = 1;
let totalPages = 1;
let currentFilters = {
    status: '',
    location: '',
    customer: '',
    sortBy: 'age',
    sortOrder: 'asc'
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadQueue();
    
    // Set up auto-refresh every 30 seconds
    setInterval(() => {
        loadQueue();
    }, 30000);
});

/**
 * Load fulfillment queue
 */
async function loadQueue() {
    const queueList = document.getElementById('queue-list');
    queueList.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i><p>Loading queue...</p></div>';

    try {
        const params = new URLSearchParams({
            page: currentPage,
            limit: 25,
            ...currentFilters
        });

        const response = await fetch(`/api/v1/fulfillment/queue?${params}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load queue');
        }

        renderQueue(data.queue);
        updateStats(data.queue);
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

        return `
            <div class="order-card ${statusClass}" data-invoice-id="${order.id}">
                <div class="order-header">
                    <div class="order-title">
                        <h3>${order.invoice_number}</h3>
                        <p>${order.buyer_name} • ${order.location_name || 'N/A'}</p>
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
                    ${canClaim ? `
                        <button class="btn-claim" onclick="claimOrder(${order.id})">
                            <i class="fas fa-hand-paper"></i> Claim Order
                        </button>
                    ` : ''}
                    ${isAssignedToMe ? `
                        <button class="btn-view" onclick="startScanning(${order.id})">
                            <i class="fas fa-barcode"></i> Start Scanning
                        </button>
                        <button class="btn-view" style="background: #ef4444;" onclick="releaseOrder(${order.id})">
                            <i class="fas fa-undo"></i> Release
                        </button>
                    ` : ''}
                    ${window.isAdmin || window.isFulfillmentAdmin ? `
                        <button class="btn-view" style="background: #8b5cf6;" onclick="reassignOrder(${order.id})">
                            <i class="fas fa-user-exchange"></i> Reassign
                        </button>
                    ` : ''}
                    <button class="btn-view" onclick="viewOrder(${order.id})">
                        <i class="fas fa-eye"></i> View Details
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Update statistics
 */
function updateStats(orders) {
    const pending = orders.filter(o => o.status === 'Approved').length;
    const inProgress = orders.filter(o => o.status === 'Fulfillment_Accepted').length;
    const issues = orders.filter(o => o.status === 'Fulfillment_Issue').length;

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
        sortBy: document.getElementById('sort-by').value,
        sortOrder: 'asc'
    };
    
    currentPage = 1;
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
async function claimOrder(invoiceId) {
    if (!confirm('Claim this order for fulfillment?')) {
        return;
    }

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
    }
}

