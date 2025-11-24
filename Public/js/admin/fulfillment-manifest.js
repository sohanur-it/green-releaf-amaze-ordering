// Public/js/admin/fulfillment-manifest.js
// Manifest Creation Interface

document.addEventListener('DOMContentLoaded', () => {
    loadManifestPreview();
});

/**
 * Load manifest preview
 */
async function loadManifestPreview() {
    const content = document.getElementById('manifest-content');
    document.getElementById('invoice-number').textContent = `INV-${window.invoiceId}`;

    try {
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
 * Go back
 */
function goBack() {
    window.location.href = `/admin/fulfillment/transportation/${window.invoiceId}`;
}

