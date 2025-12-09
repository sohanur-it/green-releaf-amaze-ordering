// Public/js/admin/fulfillment-scanning.js
// Package Scanning Interface

let scanningProgress = null;
let websocketConnection = null;

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
 * Utility: Get button by onclick handler name or selector
 */
function getButtonByHandler(handlerName) {
    // Try to find button by onclick attribute
    const buttons = document.querySelectorAll(`button[onclick*="${handlerName}"]`);
    if (buttons.length > 0) return buttons[0];
    
    // Try by class or id
    const byClass = document.querySelector(`.${handlerName}`);
    if (byClass) return byClass;
    
    const byId = document.getElementById(handlerName);
    if (byId) return byId;
    
    return null;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Check invoice status first before initializing scanning
    checkInvoiceStatusBeforeInit();
    setupWebSocket();
    setupScannerInput();
});

/**
 * Check invoice status before initializing scanning
 */
async function checkInvoiceStatusBeforeInit() {
    try {
        const response = await fetch(`/api/v1/invoices/${window.invoiceId}`);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
                const status = data.data.status;
                
                // If invoice has an issue, disable scanning and show message
                if (status === 'Fulfillment_Issue') {
                    disableScanningForIssue();
                    return;
                }
            }
        }
        
        // If no issue, proceed with normal initialization
        initializeScanning();
    } catch (error) {
        console.error('Error checking invoice status:', error);
        // Proceed with initialization anyway - backend will catch it
        initializeScanning();
    }
}

/**
 * Disable scanning interface when invoice has an issue
 */
function disableScanningForIssue() {
    // Disable scanner input
    const scannerInput = document.getElementById('scanner-input');
    if (scannerInput) {
        scannerInput.disabled = true;
        scannerInput.placeholder = 'Cannot scan - invoice has an active issue';
        scannerInput.style.opacity = '0.5';
        scannerInput.style.cursor = 'not-allowed';
    }
    
    // Disable action buttons
    const actionButtons = document.querySelectorAll('.action-buttons button');
    actionButtons.forEach(btn => {
        if (!btn.onclick || !btn.onclick.toString().includes('showIssueModal')) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        }
    });
    
    // Show warning message
    const scanningContent = document.querySelector('.scanning-content');
    if (scanningContent) {
        const warningDiv = document.createElement('div');
        warningDiv.style.cssText = 'padding: 1.5rem; background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; margin-bottom: 1.5rem;';
        warningDiv.innerHTML = `
            <h3 style="margin: 0 0 0.5rem 0; color: #92400e;">
                <i class="fas fa-exclamation-triangle"></i> Invoice Has Active Issue
            </h3>
            <p style="margin: 0; color: #78350f;">
                This invoice has been returned to sales for resolution. Scanning is disabled until the issue is resolved.
            </p>
            <button onclick="window.location.href='/admin/fulfillment/queue'" 
                    style="margin-top: 1rem; padding: 0.5rem 1rem; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Return to Queue
            </button>
        `;
        scanningContent.insertBefore(warningDiv, scanningContent.firstChild);
    }
}

/**
 * Initialize scanning session
 */
async function initializeScanning() {
    try {
        // Start scanning session
        const response = await fetch('/api/v1/fulfillment/scanning/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_id: window.invoiceId,
                websocket_connection_id: 'web-' + Date.now()
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to start scanning session');
        }

        window.sessionId = data.session_id;
        document.getElementById('invoice-number').textContent = `INV-${window.invoiceId}`;

        // Load initial progress
        loadProgress();

        // Auto-refresh progress every 2 seconds
        setInterval(loadProgress, 2000);

    } catch (error) {
        console.error('Error initializing scanning:', error);
        alert(`Error: ${error.message}`);
        window.location.href = '/admin/fulfillment/queue';
    }
}

/**
 * Setup WebSocket connection for real-time updates
 */
function setupWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.hostname}:8080`;

    try {
        websocketConnection = new WebSocket(wsUrl);

        websocketConnection.onopen = () => {
            console.log('WebSocket connected');
        };

        websocketConnection.onmessage = (event) => {
            const message = JSON.parse(event.data);
            handleWebSocketMessage(message);
        };

        websocketConnection.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        websocketConnection.onclose = () => {
            console.log('WebSocket disconnected');
            // Attempt to reconnect after 5 seconds
            setTimeout(setupWebSocket, 5000);
        };
    } catch (error) {
        console.error('Failed to setup WebSocket:', error);
    }
}

/**
 * Handle WebSocket messages
 */
function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'package:locked':
            // Another worker locked a package
            console.log('Package locked by another worker:', message);
            break;
        case 'package:released':
            // Package released
            console.log('Package released:', message);
            break;
        case 'order:claimed':
        case 'order:released':
            // Queue updates
            break;
    }
}

/**
 * Setup scanner input handler
 */
function setupScannerInput() {
    const scannerInput = document.getElementById('scanner-input');
    let scanTimeout = null;

    scannerInput.addEventListener('input', (e) => {
        clearTimeout(scanTimeout);
        
        // Wait for user to finish typing (barcode scanners send data quickly)
        scanTimeout = setTimeout(() => {
            const packageLabel = e.target.value.trim();
            if (packageLabel.length > 0) {
                scanPackage(packageLabel);
                e.target.value = ''; // Clear input
            }
        }, 100);
    });

    scannerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const packageLabel = e.target.value.trim();
            if (packageLabel.length > 0) {
                scanPackage(packageLabel);
                e.target.value = '';
            }
        }
    });
}

/**
 * Scan a package
 */
async function scanPackage(packageLabel) {
    if (!window.sessionId) {
        showScannerStatus('error', 'Scanning session not initialized');
        return;
    }

    const scannerInput = document.getElementById('scanner-input');
    scannerInput.disabled = true;

    try {
        const response = await fetch('/api/v1/fulfillment/scanning/scan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_id: window.sessionId,
                package_label: packageLabel,
                invoice_id: window.invoiceId
            })
        });

        const data = await response.json();

        if (data.requiresConfirmation) {
            // Show rejection alert modal
            showRejectionAlert(data.alert, packageLabel);
            return;
        }

        if (data.requiresRemovalConfirmation) {
            // Show package removal confirmation modal
            showPackageRemovalConfirmation(data.alert, packageLabel);
            return;
        }

        if (!response.ok) {
            throw new Error(data.error || 'Scan failed');
        }

        if (data.duplicate) {
            showScannerStatus('warning', 'Package already scanned (ignored)');
        } else {
            showScannerStatus('success', `Package ${packageLabel} scanned successfully!`);
            loadProgress(); // Refresh progress
        }

    } catch (error) {
        console.error('Error scanning package:', error);
        showScannerStatus('error', error.message);
    } finally {
        scannerInput.disabled = false;
        scannerInput.focus();
    }
}

/**
 * Show scanner status message
 */
function showScannerStatus(type, message) {
    const statusEl = document.getElementById('scanner-status');
    statusEl.className = `scanner-status ${type}`;
    statusEl.textContent = message;
    statusEl.style.display = 'block';

    setTimeout(() => {
        statusEl.style.display = 'none';
    }, 3000);
}

/**
 * Load scanning progress
 */
async function loadProgress() {
    try {
        const response = await fetch(`/api/v1/fulfillment/scanning/progress/${window.invoiceId}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load progress');
        }

        scanningProgress = data;
        renderProgress(data);
        updateOverallProgress(data.overall_progress);
        
        // Check if invoice has issues and show appropriate buttons
        checkInvoiceStatus();

    } catch (error) {
        console.error('Error loading progress:', error);
    }
}

/**
 * Render line items progress
 */
function renderProgress(data) {
    const container = document.getElementById('line-items-container');

    if (data.line_items.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No line items found</p></div>';
        return;
    }

    container.innerHTML = data.line_items.map(item => {
        const percentage = item.quantity_ordered > 0 
            ? Math.round((item.scanned_count / item.quantity_ordered) * 100)
            : 0;

        return `
            <div class="line-item-card">
                <div class="line-item-header">
                    <div class="line-item-title">
                        <h4>${item.product_name}</h4>
                        <p>Batch: ${item.batch_name}</p>
                    </div>
                    <div class="line-item-status ${item.status}">
                        ${item.status.replace('-', ' ').toUpperCase()}
                    </div>
                </div>
                
                <div class="line-item-progress">
                    <div class="line-item-progress-bar">
                        <div class="line-item-progress-fill" style="width: ${percentage}%"></div>
                    </div>
                    <span style="font-weight: 600; color: var(--text-color);">
                        ${item.scanned_count} / ${item.quantity_ordered}
                    </span>
                </div>

                ${item.scanned_packages.length > 0 ? `
                    <div class="scanned-packages">
                        <h5>Scanned Packages</h5>
                        <div class="package-tags">
                            ${item.scanned_packages.map(pkg => `
                                <span class="package-tag">
                                    ${pkg}
                                    <button class="remove-btn" onclick="removePackage(${item.line_item_id}, '${pkg}')" title="Remove">
                                        <i class="fas fa-times"></i>
                                    </button>
                                    <button class="edit-btn" onclick="editPackage(${item.line_item_id}, '${pkg}')" title="Edit" style="margin-left: 4px; background: #3b82f6; color: white; border: none; padding: 2px 6px; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                </span>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

/**
 * Update overall progress
 */
function updateOverallProgress(overall) {
    const progressCount = document.getElementById('progress-count');
    const progressBar = document.getElementById('progress-bar');
    const completeBtn = document.getElementById('btn-complete');

    progressCount.textContent = `${overall.total_packages_scanned} / ${overall.total_packages_needed}`;
    progressBar.style.width = `${overall.percentage}%`;
    progressBar.textContent = `${overall.percentage}%`;

    completeBtn.disabled = !overall.all_complete;
}

/**
 * Show rejection alert modal
 */
function showRejectionAlert(alert, packageLabel) {
    window.currentPackageLabel = packageLabel;
    window.rejectionAlert = alert;

    const modal = document.getElementById('rejection-modal');
    const details = document.getElementById('alert-details');

    details.innerHTML = `
        <p><strong>Manifest:</strong> ${alert.details.manifestNumber || 'N/A'}</p>
        <p><strong>Rejected:</strong> ${new Date(alert.details.rejectionDate).toLocaleDateString()}</p>
        <p><strong>Rejected By:</strong> ${alert.details.rejectedBy || 'N/A'}</p>
        <p><strong>Severity:</strong> ${alert.severity}</p>
    `;

    modal.classList.add('active');
}

/**
 * Verify rejected package
 */
async function verifyRejectedPackage() {
    if (!window.currentPackageLabel) return;

    const button = document.querySelector('button[onclick="verifyRejectedPackage()"]');
    setButtonLoading(button, true);

    try {
        const response = await fetch('/api/v1/fulfillment/scanning/verify-rejected', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                package_label: window.currentPackageLabel,
                notes: 'Verified by fulfillment worker'
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to verify package');
        }

        // Close modal and continue scanning
        document.getElementById('rejection-modal').classList.remove('active');
        
        // Re-scan the package
        scanPackage(window.currentPackageLabel);
        window.currentPackageLabel = null;

    } catch (error) {
        console.error('Error verifying package:', error);
        alert(`Error: ${error.message}`);
    } finally {
        setButtonLoading(button, false);
    }
}

/**
 * Skip rejected package
 */
function skipRejectedPackage() {
    document.getElementById('rejection-modal').classList.remove('active');
    window.currentPackageLabel = null;
    window.rejectionAlert = null;
    
    const scannerInput = document.getElementById('scanner-input');
    scannerInput.focus();
}

/**
 * Show package removal confirmation modal
 * This modal cannot be dismissed - user must acknowledge removal
 */
function showPackageRemovalConfirmation(alert, packageLabel) {
    window.currentPackageLabel = packageLabel;
    window.packageRemovalAlert = alert;

    const modal = document.getElementById('package-removal-modal');
    const details = document.getElementById('removal-details');

    details.innerHTML = `
        <p><strong>Package Label:</strong> ${alert.details.packageLabel}</p>
        <p><strong>Batch:</strong> ${alert.details.batchName}</p>
        <p><strong>Item:</strong> ${alert.details.itemName}</p>
        <p style="margin-top: 1rem; padding: 1rem; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px;">
            <strong>⚠️ Warning:</strong> This package does not belong to this order. You must confirm that you have physically removed this package from the order before continuing.
        </p>
    `;

    modal.classList.add('active');
    
    // Prevent closing modal by clicking outside (on backdrop)
    // Store the handler so we can check if modal is still active
    const backdropClickHandler = function(e) {
        // Only prevent if clicking the backdrop itself, not the content
        if (e.target === modal && modal.classList.contains('active')) {
            e.preventDefault();
            e.stopPropagation();
            // Show visual feedback that clicking outside doesn't work
            const content = modal.querySelector('.rejection-alert-content');
            if (content) {
                content.style.animation = 'shake 0.5s';
                setTimeout(() => {
                    content.style.animation = '';
                }, 500);
            }
        }
    };
    
    // Remove any existing handler first
    modal.removeEventListener('click', window.packageRemovalBackdropHandler);
    window.packageRemovalBackdropHandler = backdropClickHandler;
    modal.addEventListener('click', backdropClickHandler);
    
    // Prevent closing modal with ESC key
    const escHandler = function(e) {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            e.preventDefault();
            e.stopPropagation();
            // Show visual feedback that ESC doesn't work
            const content = modal.querySelector('.rejection-alert-content');
            if (content) {
                content.style.animation = 'shake 0.5s';
                setTimeout(() => {
                    content.style.animation = '';
                }, 500);
            }
        }
    };
    
    // Store handler so we can remove it later
    window.packageRemovalEscHandler = escHandler;
    document.addEventListener('keydown', escHandler);
}

/**
 * Acknowledge package removal
 */
async function acknowledgePackageRemoval() {
    if (!window.currentPackageLabel) return;

    const button = document.querySelector('button[onclick="acknowledgePackageRemoval()"]');
    setButtonLoading(button, true);

    try {
        // Log the acknowledgment
        const response = await fetch('/api/v1/fulfillment/scanning/acknowledge-removal', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_id: window.invoiceId,
                package_label: window.currentPackageLabel,
                session_id: window.sessionId,
                acknowledged: true
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to acknowledge removal');
        }

        // Close modal and continue scanning
        const modal = document.getElementById('package-removal-modal');
        modal.classList.remove('active');
        
        // Remove ESC key handler
        if (window.packageRemovalEscHandler) {
            document.removeEventListener('keydown', window.packageRemovalEscHandler);
            window.packageRemovalEscHandler = null;
        }
        
        // Remove backdrop click handler
        if (window.packageRemovalBackdropHandler) {
            modal.removeEventListener('click', window.packageRemovalBackdropHandler);
            window.packageRemovalBackdropHandler = null;
        }
        
        showScannerStatus('info', `Package ${window.currentPackageLabel} removal acknowledged. Please continue scanning.`);
        window.currentPackageLabel = null;
        window.packageRemovalAlert = null;

        const scannerInput = document.getElementById('scanner-input');
        scannerInput.focus();

    } catch (error) {
        console.error('Error acknowledging package removal:', error);
        alert(`Error: ${error.message}`);
    } finally {
        setButtonLoading(button, false);
    }
}

/**
 * Cancel package removal acknowledgment
 */
function cancelPackageRemoval() {
    document.getElementById('package-removal-modal').classList.remove('active');
    window.currentPackageLabel = null;
    window.packageRemovalAlert = null;
    
    const scannerInput = document.getElementById('scanner-input');
    scannerInput.focus();
}

/**
 * Remove package from line item
 */
async function removePackage(lineItemId, packageLabel) {
    if (!confirm(`Remove package ${packageLabel} from this line item?`)) {
        return;
    }

    try {
        const response = await fetch('/api/v1/fulfillment/admin/sessions/remove-package', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_id: window.invoiceId,
                line_item_id: lineItemId,
                package_label: packageLabel
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to remove package');
        }

        alert('Package removed successfully');
        loadProgress();

    } catch (error) {
        console.error('Error removing package:', error);
        alert(`Error: ${error.message}`);
    }
}

/**
 * Edit package label
 */
async function editPackage(lineItemId, oldPackageLabel) {
    const newPackageLabel = prompt(`Enter new package label for ${oldPackageLabel}:`, oldPackageLabel);
    if (!newPackageLabel || newPackageLabel === oldPackageLabel) {
        return;
    }

    try {
        const response = await fetch('/api/v1/fulfillment/admin/sessions/edit-package', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_id: window.invoiceId,
                line_item_id: lineItemId,
                old_package_label: oldPackageLabel,
                new_package_label: newPackageLabel
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to edit package');
        }

        alert('Package label updated successfully');
        loadProgress();

    } catch (error) {
        console.error('Error editing package:', error);
        alert(`Error: ${error.message}`);
    }
}

/**
 * Complete scanning
 */
async function completeScanning() {
    if (!scanningProgress.overall_progress.all_complete) {
        alert('Please scan all required packages before completing.');
        return;
    }

    if (!confirm('Complete scanning? You will proceed to transportation details entry.')) {
        return;
    }

    const button = document.getElementById('btn-complete');
    setButtonLoading(button, true);

    try {
        // Small delay to show loading state before redirect
        await new Promise(resolve => setTimeout(resolve, 300));
        // Redirect to transportation details page
        window.location.href = `/admin/fulfillment/transportation/${window.invoiceId}`;
    } catch (error) {
        console.error('Error completing scanning:', error);
        setButtonLoading(button, false);
        alert(`Error: ${error.message}`);
    }
}

/**
 * Show issue reporting modal
 */
function showIssueModal() {
    document.getElementById('issue-modal').classList.add('active');
    const form = document.getElementById('issue-form');
    // Remove existing listeners
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    document.getElementById('issue-form').addEventListener('submit', handleIssueReport);
    
    // Populate batch selection
    populateBatchSelection();
}

/**
 * Populate batch selection in issue modal
 */
async function populateBatchSelection() {
    const container = document.getElementById('batch-selection-container');
    const reasonsContainer = document.getElementById('batch-reasons-container');
    
    // Show loading state
    container.innerHTML = '<p style="color: var(--text-light); font-size: 0.875rem; margin: 0.5rem 0;">Loading batches...</p>';
    
    try {
        // Try to use cached scanningProgress first
        let lineItems = null;
        if (scanningProgress && scanningProgress.line_items && scanningProgress.line_items.length > 0) {
            lineItems = scanningProgress.line_items;
        } else {
            // Fetch directly from API if not available
            console.log('[Issue Modal] Fetching line items from API...');
            const response = await fetch(`/api/v1/fulfillment/scanning/progress/${window.invoiceId}`);
            const data = await response.json();
            
            if (response.ok && data.line_items && data.line_items.length > 0) {
                lineItems = data.line_items;
                // Update scanningProgress for future use
                scanningProgress = data;
            }
        }
        
        if (!lineItems || lineItems.length === 0) {
            container.innerHTML = '<p style="color: var(--text-light); font-size: 0.875rem; margin: 0.5rem 0; padding: 1rem; text-align: center;">No line items available for this invoice</p>';
            return;
        }
        
        container.innerHTML = lineItems.map(item => `
            <div class="batch-selection-item" style="padding: 0.75rem; border-bottom: 1px solid var(--border-color, #e5e7eb); transition: background 0.2s;">
                <label style="display: flex; align-items: center; cursor: pointer; gap: 0.75rem;">
                    <input type="checkbox" 
                           class="batch-checkbox" 
                           data-line-item-id="${item.line_item_id}"
                           data-batch-name="${item.batch_name || 'N/A'}"
                           data-product-name="${item.product_name || 'Unknown Product'}"
                           onchange="toggleBatchReason(${item.line_item_id})"
                           style="margin: 0; width: 18px; height: 18px; cursor: pointer;">
                    <div style="flex: 1;">
                        <strong style="color: var(--text-color); display: block; margin-bottom: 0.25rem;">${item.product_name || 'Unknown Product'}</strong>
                        <div style="font-size: 0.875rem; color: var(--text-light);">Batch: ${item.batch_name || 'N/A'}</div>
                        ${item.quantity_ordered ? `<div style="font-size: 0.75rem; color: var(--text-light); margin-top: 0.25rem;">Qty: ${item.quantity_ordered}</div>` : ''}
                    </div>
                </label>
            </div>
        `).join('');
        
        // Add hover effect styles
        const style = document.createElement('style');
        style.textContent = `
            .batch-selection-item:hover {
                background: var(--hover-bg, #f3f4f6);
            }
            .dark-theme .batch-selection-item:hover {
                background: var(--hover-bg, #2d3748);
            }
        `;
        if (!document.getElementById('batch-selection-hover-style')) {
            style.id = 'batch-selection-hover-style';
            document.head.appendChild(style);
        }
        
        reasonsContainer.innerHTML = '';
        
    } catch (error) {
        console.error('Error loading batches for issue report:', error);
        container.innerHTML = '<p style="color: #ef4444; font-size: 0.875rem; margin: 0.5rem 0; padding: 1rem; text-align: center;">Error loading batches. Please try again.</p>';
    }
}

/**
 * Toggle batch reason field when batch is selected/deselected
 */
function toggleBatchReason(lineItemId) {
    const checkbox = document.querySelector(`.batch-checkbox[data-line-item-id="${lineItemId}"]`);
    const reasonsContainer = document.getElementById('batch-reasons-container');
    const batchName = checkbox.getAttribute('data-batch-name');
    const productName = checkbox.getAttribute('data-product-name');
    
    if (checkbox.checked) {
        // Add reason field for this batch
        const reasonDiv = document.createElement('div');
        reasonDiv.id = `batch-reason-${lineItemId}`;
        reasonDiv.style.marginBottom = '1rem';
        reasonDiv.style.padding = '1rem';
        reasonDiv.style.background = 'var(--input-bg, #f9fafb)';
        reasonDiv.style.borderRadius = '6px';
        reasonDiv.style.border = '1px solid var(--border-color, #e5e7eb)';
        reasonDiv.innerHTML = `
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--text-color);">
                Reason for ${productName} (${batchName}) <span style="color: #ef4444;">*</span>
            </label>
            <textarea 
                class="batch-reason" 
                data-line-item-id="${lineItemId}"
                required 
                rows="3" 
                placeholder="Describe the issue with this batch..." 
                style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color, #ddd); border-radius: 6px; resize: vertical; background: var(--card-bg, white); color: var(--text-color);">
            </textarea>
        `;
        reasonsContainer.appendChild(reasonDiv);
    } else {
        // Remove reason field
        const reasonDiv = document.getElementById(`batch-reason-${lineItemId}`);
        if (reasonDiv) {
            reasonDiv.remove();
        }
    }
}

/**
 * Show update issue modal
 */
function showUpdateIssueModal() {
    const modal = document.getElementById('update-issue-modal');
    if (!modal) {
        createUpdateIssueModal();
    }
    document.getElementById('update-issue-modal').classList.add('active');
}

/**
 * Create update issue modal
 */
function createUpdateIssueModal() {
    const modal = document.createElement('div');
    modal.id = 'update-issue-modal';
    modal.className = 'rejection-alert-modal';
    modal.innerHTML = `
        <div class="rejection-alert-content">
            <h3><i class="fas fa-edit"></i> Update Issue</h3>
            <form id="update-issue-form">
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Issue Type</label>
                    <select id="update-issue-type" required style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px;">
                        <option value="batch_unavailable">Batch Unavailable</option>
                        <option value="package_damaged">Package Damaged</option>
                        <option value="package_quantity_mismatch">Quantity Mismatch</option>
                        <option value="package_missing_from_metrc">Package Missing from METRC</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Description <span style="color: #ef4444;">*</span></label>
                    <textarea id="update-issue-description" required rows="4" placeholder="Update issue description..." style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; resize: vertical;"></textarea>
                </div>
                <div class="alert-actions">
                    <button type="button" class="btn-skip" onclick="closeUpdateIssueModal()">Cancel</button>
                    <button type="submit" class="btn-verify">Update Issue</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('update-issue-form').addEventListener('submit', handleUpdateIssue);
}

/**
 * Close update issue modal
 */
function closeUpdateIssueModal() {
    document.getElementById('update-issue-modal').classList.remove('active');
}

/**
 * Handle update issue
 */
async function handleUpdateIssue(e) {
    e.preventDefault();
    
    const issueType = document.getElementById('update-issue-type').value;
    const description = document.getElementById('update-issue-description').value;
    
    try {
        const response = await fetch('/api/v1/fulfillment/issues/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_id: window.invoiceId,
                issue_type: issueType,
                description: description
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to update issue');
        }
        
        alert('Issue updated successfully');
        closeUpdateIssueModal();
        
    } catch (error) {
        console.error('Error updating issue:', error);
        alert(`Error: ${error.message}`);
    }
}

/**
 * Show add note modal
 */
function showAddNoteModal() {
    const modal = document.getElementById('add-note-modal');
    if (!modal) {
        createAddNoteModal();
    }
    document.getElementById('add-note-modal').classList.add('active');
}

/**
 * Create add note modal
 */
function createAddNoteModal() {
    const modal = document.createElement('div');
    modal.id = 'add-note-modal';
    modal.className = 'rejection-alert-modal';
    modal.innerHTML = `
        <div class="rejection-alert-content">
            <h3><i class="fas fa-sticky-note"></i> Add Note to Issue</h3>
            <form id="add-note-form">
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Note <span style="color: #ef4444;">*</span></label>
                    <textarea id="note-text" required rows="4" placeholder="Enter note..." style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; resize: vertical;"></textarea>
                </div>
                <div class="alert-actions">
                    <button type="button" class="btn-skip" onclick="closeAddNoteModal()">Cancel</button>
                    <button type="submit" class="btn-verify">Add Note</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('add-note-form').addEventListener('submit', handleAddNote);
}

/**
 * Close add note modal
 */
function closeAddNoteModal() {
    document.getElementById('add-note-modal').classList.remove('active');
}

/**
 * Handle add note
 */
async function handleAddNote(e) {
    e.preventDefault();
    
    const note = document.getElementById('note-text').value;
    
    try {
        const response = await fetch('/api/v1/fulfillment/issues/add-note', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_id: window.invoiceId,
                note: note
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to add note');
        }
        
        alert('Note added successfully');
        closeAddNoteModal();
        
    } catch (error) {
        console.error('Error adding note:', error);
        alert(`Error: ${error.message}`);
    }
}

/**
 * Cancel issue report
 */
async function cancelIssueReport() {
    const reason = prompt('Enter reason for cancelling this issue report:');
    if (!reason) {
        return;
    }
    
    if (!confirm('Cancel this issue report? The order will return to Fulfillment_Accepted status.')) {
        return;
    }
    
    try {
        const response = await fetch('/api/v1/fulfillment/issues/cancel', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_id: window.invoiceId,
                reason: reason
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to cancel issue');
        }
        
        alert('Issue cancelled successfully. Order returned to Fulfillment_Accepted status.');
        window.location.href = '/admin/fulfillment/queue';
        
    } catch (error) {
        console.error('Error cancelling issue:', error);
        alert(`Error: ${error.message}`);
    }
}

/**
 * Close issue modal
 */
function closeIssueModal() {
    document.getElementById('issue-modal').classList.remove('active');
}

/**
 * Handle issue report submission
 */
async function handleIssueReport(e) {
    e.preventDefault();

    const issueType = document.getElementById('issue-type').value;
    const generalDescription = document.getElementById('issue-description').value;
    
    // Get all selected batches
    const selectedBatches = Array.from(document.querySelectorAll('.batch-checkbox:checked'));
    
    if (selectedBatches.length === 0) {
        alert('Please select at least one batch');
        return;
    }
    
    // Validate that all selected batches have reasons
    const issues = [];
    let allReasonsValid = true;
    
    for (const checkbox of selectedBatches) {
        const lineItemId = parseInt(checkbox.getAttribute('data-line-item-id'));
        const reasonField = document.querySelector(`.batch-reason[data-line-item-id="${lineItemId}"]`);
        
        if (!reasonField || !reasonField.value.trim()) {
            allReasonsValid = false;
            reasonField.style.borderColor = '#ef4444';
            reasonField.focus();
            break;
        } else {
            reasonField.style.borderColor = '#ddd';
        }
        
        issues.push({
            type: issueType,
            line_item_id: lineItemId,
            description: reasonField.value.trim()
        });
    }
    
    if (!allReasonsValid) {
        alert('Please provide a reason for each selected batch');
        return;
    }
    
    // Add general description to the first issue if provided
    if (generalDescription.trim() && issues.length > 0) {
        issues[0].description += `\n\nGeneral Notes: ${generalDescription.trim()}`;
    }

    // Get the submit button and show loading state
    const submitButton = e.target.querySelector('button[type="submit"]') || 
                         document.querySelector('#issue-form button[type="submit"]') ||
                         document.querySelector('.btn-verify');
    if (submitButton) {
        setButtonLoading(submitButton, true);
    }

    try {
        const response = await fetch('/api/v1/fulfillment/issues/report', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invoice_id: window.invoiceId,
                issues: issues
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to report issue');
        }

        alert(`Issue reported successfully for ${issues.length} batch(es). Order returned to sales for resolution.`);
        window.location.href = '/admin/fulfillment/queue';

    } catch (error) {
        console.error('Error reporting issue:', error);
        alert(`Error: ${error.message}`);
        if (submitButton) {
            setButtonLoading(submitButton, false);
        }
    }
}

/**
 * Check invoice status and show/hide issue buttons
 */
async function checkInvoiceStatus() {
    try {
        const response = await fetch(`/api/v1/invoices/${window.invoiceId}`);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
                const status = data.data.status;
                const hasIssue = status === 'Fulfillment_Issue';
                
                const updateBtn = document.getElementById('btn-update-issue');
                const addNoteBtn = document.getElementById('btn-add-note');
                const cancelBtn = document.getElementById('btn-cancel-issue');
                
                if (hasIssue) {
                    if (updateBtn) updateBtn.style.display = 'inline-block';
                    if (addNoteBtn) addNoteBtn.style.display = 'inline-block';
                    if (cancelBtn) cancelBtn.style.display = 'inline-block';
                } else {
                    if (updateBtn) updateBtn.style.display = 'none';
                    if (addNoteBtn) addNoteBtn.style.display = 'none';
                    if (cancelBtn) cancelBtn.style.display = 'none';
                }
            }
        }
    } catch (error) {
        console.error('Error checking invoice status:', error);
    }
}

/**
 * Cancel scanning session
 */
async function cancelScanning() {
    if (!confirm('Cancel scanning? All progress will be lost and order will return to queue.')) {
        return;
    }

    const button = document.querySelector('button[onclick="cancelScanning()"]');
    setButtonLoading(button, true);

    try {
        const response = await fetch(`/api/v1/fulfillment/scanning/cancel/${window.sessionId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                reason: 'Worker cancelled scanning'
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to cancel scanning');
        }

        alert('Scanning cancelled. Order returned to queue.');
        window.location.href = '/admin/fulfillment/queue';

    } catch (error) {
        console.error('Error cancelling scanning:', error);
        alert(`Error: ${error.message}`);
        setButtonLoading(button, false);
    }
}

