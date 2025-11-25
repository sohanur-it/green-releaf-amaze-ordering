// Public/js/admin/fulfillment-manifest.js
// Manifest Creation Interface

let invoiceStatus = null;
let manifestNumbers = [];

document.addEventListener('DOMContentLoaded', () => {
    loadInvoiceStatus();
    loadManifestPreview();
});

/**
 * Load invoice status to check if manifest exists
 */
async function loadInvoiceStatus() {
    try {
        const response = await fetch(`/api/v1/invoices/${window.invoiceId}`);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
                invoiceStatus = data.data.status;
                manifestNumbers = data.data.metrc_manifest_numbers || [];
            }
        }
    } catch (error) {
        console.error('Error loading invoice status:', error);
    }
}

/**
 * Load manifest preview
 */
async function loadManifestPreview() {
    const content = document.getElementById('manifest-content');
    document.getElementById('invoice-number').textContent = `INV-${window.invoiceId}`;

    try {
        // Check if manifest already exists
        if (invoiceStatus && ['Manifested', 'Shipped', 'Partially_Manifested'].includes(invoiceStatus)) {
            renderManifestedView();
            return;
        }

        // First, get scanning progress to show package count
        const progressResponse = await fetch(`/api/v1/fulfillment/scanning/progress/${window.invoiceId}`);
        const progressData = await progressResponse.json();

        if (!progressResponse.ok) {
            throw new Error(progressData.error || 'Failed to load progress');
        }

        // Get manifest preview
        const previewResponse = await fetch(`/api/v1/fulfillment/manifest/preview/${window.invoiceId}`);
        const previewData = await previewResponse.json();

        if (!previewResponse.ok) {
            throw new Error(previewData.error || 'Failed to load preview');
        }

        renderManifestPreview(progressData, previewData);

    } catch (error) {
        console.error('Error loading manifest preview:', error);
        content.innerHTML = `
            <div class="manifest-preview">
                <h2>Error</h2>
                <p style="color: #ef4444;">${error.message}</p>
                <button class="btn-back" onclick="window.location.href='/admin/fulfillment/queue'">
                    <i class="fas fa-arrow-left"></i> Back to Queue
                </button>
            </div>
        `;
    }
}

/**
 * Render view for already manifested invoices
 */
function renderManifestedView() {
    const content = document.getElementById('manifest-content');
    
    content.innerHTML = `
        <div class="manifest-preview">
            <h2>Manifest Information</h2>
            
            <div class="manifest-summary">
                <div class="summary-item">
                    <label>Status</label>
                    <span>${invoiceStatus}</span>
                </div>
                <div class="summary-item">
                    <label>Manifest Number(s)</label>
                    <span>${manifestNumbers.length > 0 ? manifestNumbers.join(', ') : 'N/A'}</span>
                </div>
            </div>

            <div class="manifest-actions">
                <button class="btn-back" onclick="goBack()">
                    <i class="fas fa-arrow-left"></i> Back
                </button>
                ${['Manifested', 'Shipped', 'Partially_Manifested'].includes(invoiceStatus) ? `
                    <button class="btn-void" onclick="showVoidModal()" style="background: #ef4444;">
                        <i class="fas fa-ban"></i> Void Manifest
                    </button>
                    ${invoiceStatus === 'Manifested' ? `
                        <button class="btn-update" onclick="showUpdateModal()" style="background: #3b82f6;">
                            <i class="fas fa-edit"></i> Update Manifest
                        </button>
                    ` : ''}
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * Render manifest preview
 */
function renderManifestPreview(progress, preview) {
    const content = document.getElementById('manifest-content');
    const overall = progress.overall_progress;

    let warningHtml = '';
    if (preview.requires_multiple_manifests) {
        warningHtml = `
            <div class="manifest-warning">
                <i class="fas fa-exclamation-triangle"></i>
                <strong>Multi-License Order:</strong> This order contains packages from multiple licenses 
                and will require ${preview.manifests_required} separate METRC manifests.
            </div>
        `;
    }

    // Collect all scanned packages
    const allPackages = [];
    progress.line_items.forEach(item => {
        item.scanned_packages.forEach(pkg => {
            allPackages.push({
                label: pkg,
                product: item.product_name,
                batch: item.batch_name
            });
        });
    });

    content.innerHTML = `
        <div class="manifest-preview">
            <h2>Manifest Preview</h2>
            
            ${warningHtml}

            <div class="manifest-summary">
                <div class="summary-item">
                    <label>Total Packages</label>
                    <span>${overall.total_packages_scanned}</span>
                </div>
                <div class="summary-item">
                    <label>Total Value</label>
                    <span id="total-value">Calculating...</span>
                </div>
                <div class="summary-item">
                    <label>Manifests Required</label>
                    <span>${preview.manifests_required || 1}</span>
                </div>
            </div>

            <div class="packages-list">
                <h3>Packages to be Manifested</h3>
                ${allPackages.map(pkg => `
                    <div class="package-item">
                        <span class="package-label">${pkg.label}</span>
                        <div class="package-details">
                            <span>${pkg.product}</span>
                            <span>${pkg.batch}</span>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="manifest-actions">
                <button class="btn-back" onclick="goBack()">
                    <i class="fas fa-arrow-left"></i> Back
                </button>
                <button class="btn-create" onclick="createManifest()">
                    <i class="fas fa-file-export"></i> Create Manifest(s)
                </button>
            </div>
        </div>
    `;

    // Calculate total value (would need invoice data)
    // For now, just show placeholder
    document.getElementById('total-value').textContent = 'N/A';
}

/**
 * Create manifest
 */
async function createManifest() {
    if (!confirm('Create METRC manifest(s)? This action cannot be undone.')) {
        return;
    }

    const createBtn = document.querySelector('.btn-create');
    createBtn.disabled = true;
    createBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating Manifest...';

    try {
        const response = await fetch('/api/v1/fulfillment/manifest/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_id: window.invoiceId
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to create manifest');
        }

        // Show success message
        showManifestSuccess(data);

    } catch (error) {
        console.error('Error creating manifest:', error);
        alert(`Error: ${error.message}`);
        createBtn.disabled = false;
        createBtn.innerHTML = '<i class="fas fa-file-export"></i> Create Manifest(s)';
    }
}

/**
 * Show manifest creation success
 */
function showManifestSuccess(data) {
    const content = document.getElementById('manifest-content');
    
    const manifestNumbers = data.manifests.map(m => m.manifest_number).join(', ');

    content.innerHTML = `
        <div class="manifest-success">
            <h3><i class="fas fa-check-circle"></i> Manifest Created Successfully!</h3>
            <div class="manifest-numbers">${manifestNumbers}</div>
            <p>${data.total_manifests} manifest(s) created for invoice ${data.invoice_number}</p>
            ${data.partial_failure ? `
                <div style="margin-top: 1rem; padding: 1rem; background: #fee2e2; border-radius: 8px; color: #991b1b;">
                    <strong>Warning:</strong> Some manifests failed to create. Please check the order status.
                </div>
            ` : ''}
            <div style="margin-top: 2rem;">
                <button class="btn-create" onclick="window.location.href='/admin/invoices/${window.invoiceId}'">
                    <i class="fas fa-eye"></i> View Invoice
                </button>
                <button class="btn-back" onclick="window.location.href='/admin/fulfillment/queue'">
                    <i class="fas fa-arrow-left"></i> Back to Queue
                </button>
            </div>
        </div>
    `;
}

/**
 * Show void manifest modal
 */
function showVoidModal() {
    const modal = document.getElementById('void-modal');
    if (!modal) {
        createVoidModal();
    }
    document.getElementById('void-modal').classList.add('active');
}

/**
 * Create void manifest modal
 */
function createVoidModal() {
    const modal = document.createElement('div');
    modal.id = 'void-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Void Manifest</h3>
            <form id="void-form">
                <div class="form-group">
                    <label>Reason *</label>
                    <select id="void-reason" required>
                        <option value="">Select reason...</option>
                        <option value="Incorrect Information">Incorrect Information</option>
                        <option value="Customer Requested Cancellation">Customer Requested Cancellation</option>
                        <option value="Fulfillment Error">Fulfillment Error</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Detailed Reason * (min 20 characters)</label>
                    <textarea id="void-details" rows="4" required minlength="20" placeholder="Provide detailed reason for voiding this manifest..."></textarea>
                </div>
                ${manifestNumbers.length > 1 ? `
                    <div class="form-group">
                        <label>Void Target</label>
                        <select id="void-target">
                            <option value="">Void all manifests</option>
                            ${manifestNumbers.map(m => `<option value="${m}">${m}</option>`).join('')}
                        </select>
                    </div>
                ` : ''}
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="void-confirm" required>
                        I understand this will void the manifest in METRC
                    </label>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-back" onclick="closeVoidModal()">Cancel</button>
                    <button type="submit" class="btn-void" style="background: #ef4444;">Void Manifest</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('void-form').addEventListener('submit', handleVoidManifest);
}

/**
 * Close void modal
 */
function closeVoidModal() {
    document.getElementById('void-modal').classList.remove('active');
}

/**
 * Handle void manifest
 */
async function handleVoidManifest(e) {
    e.preventDefault();
    
    const reason = document.getElementById('void-reason').value;
    const details = document.getElementById('void-details').value;
    const target = document.getElementById('void-target')?.value || null;
    
    if (!confirm('Are you sure you want to void this manifest? This action cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch('/api/v1/fulfillment/manifest/void', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_id: window.invoiceId,
                reason: `${reason}: ${details}`,
                target_manifest_or_license: target
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to void manifest');
        }
        
        alert(`Manifest voided successfully. ${data.message}`);
        closeVoidModal();
        loadInvoiceStatus();
        loadManifestPreview();
        
    } catch (error) {
        console.error('Error voiding manifest:', error);
        alert(`Error: ${error.message}`);
    }
}

/**
 * Show update manifest modal
 */
function showUpdateModal() {
    const modal = document.getElementById('update-modal');
    if (!modal) {
        createUpdateModal();
    }
    document.getElementById('update-modal').classList.add('active');
}

/**
 * Create update manifest modal
 */
function createUpdateModal() {
    const modal = document.createElement('div');
    modal.id = 'update-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Update Manifest</h3>
            <form id="update-form">
                <div class="form-group">
                    <label>Driver Name</label>
                    <input type="text" id="update-driver-name" placeholder="Driver name">
                </div>
                <div class="form-group">
                    <label>Vehicle Make</label>
                    <input type="text" id="update-vehicle-make" placeholder="Vehicle make">
                </div>
                <div class="form-group">
                    <label>Vehicle Model</label>
                    <input type="text" id="update-vehicle-model" placeholder="Vehicle model">
                </div>
                <div class="form-group">
                    <label>Vehicle Plate</label>
                    <input type="text" id="update-vehicle-plate" placeholder="License plate">
                </div>
                <div class="form-group">
                    <label>Estimated Departure</label>
                    <input type="datetime-local" id="update-departure">
                </div>
                <div class="form-group">
                    <label>Estimated Arrival</label>
                    <input type="datetime-local" id="update-arrival">
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-back" onclick="closeUpdateModal()">Cancel</button>
                    <button type="submit" class="btn-update" style="background: #3b82f6;">Update Manifest</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('update-form').addEventListener('submit', handleUpdateManifest);
}

/**
 * Close update modal
 */
function closeUpdateModal() {
    document.getElementById('update-modal').classList.remove('active');
}

/**
 * Handle update manifest
 */
async function handleUpdateManifest(e) {
    e.preventDefault();
    
    const updates = {};
    const driverName = document.getElementById('update-driver-name').value;
    const vehicleMake = document.getElementById('update-vehicle-make').value;
    const vehicleModel = document.getElementById('update-vehicle-model').value;
    const vehiclePlate = document.getElementById('update-vehicle-plate').value;
    const departure = document.getElementById('update-departure').value;
    const arrival = document.getElementById('update-arrival').value;
    
    if (driverName) updates.driverName = driverName;
    if (vehicleMake) updates.vehicleMake = vehicleMake;
    if (vehicleModel) updates.vehicleModel = vehicleModel;
    if (vehiclePlate) updates.vehiclePlate = vehiclePlate;
    if (departure) updates.estimatedDeparture = new Date(departure).toISOString();
    if (arrival) updates.estimatedArrival = new Date(arrival).toISOString();
    
    if (Object.keys(updates).length === 0) {
        alert('Please provide at least one field to update');
        return;
    }
    
    try {
        const response = await fetch('/api/v1/fulfillment/manifest/update', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_id: window.invoiceId,
                ...updates
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to update manifest');
        }
        
        alert('Manifest updated successfully');
        closeUpdateModal();
        loadInvoiceStatus();
        loadManifestPreview();
        
    } catch (error) {
        console.error('Error updating manifest:', error);
        alert(`Error: ${error.message}`);
    }
}

/**
 * Go back
 */
function goBack() {
    if (invoiceStatus && ['Manifested', 'Shipped'].includes(invoiceStatus)) {
        window.location.href = `/admin/invoices/${window.invoiceId}`;
    } else {
        window.location.href = `/admin/fulfillment/transportation/${window.invoiceId}`;
    }
}

