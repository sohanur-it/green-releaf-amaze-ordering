// Public/js/admin/fulfillment-scanning.js
// Package Scanning Interface

let scanningProgress = null;
let websocketConnection = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeScanning();
    setupWebSocket();
    setupScannerInput();
});

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
 * Remove package from line item
 */
async function removePackage(lineItemId, packageLabel) {
    if (!confirm(`Remove package ${packageLabel} from this line item?`)) {
        return;
    }

    try {
        const response = await fetch('/api/v1/admin/fulfillment/sessions/remove-package', {
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
        const response = await fetch('/api/v1/admin/fulfillment/sessions/edit-package', {
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

    // Redirect to transportation details page
    window.location.href = `/admin/fulfillment/transportation/${window.invoiceId}`;
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
    const lineItemId = document.getElementById('issue-line-item').value;
    const description = document.getElementById('issue-description').value;

    if (!description.trim()) {
        alert('Please provide a description');
        return;
    }

    try {
        const issues = [{
            type: issueType,
            line_item_id: lineItemId ? parseInt(lineItemId) : null,
            description: description.trim()
        }];

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

        alert('Issue reported successfully. Order returned to sales for resolution.');
        window.location.href = '/admin/fulfillment/queue';

    } catch (error) {
        console.error('Error reporting issue:', error);
        alert(`Error: ${error.message}`);
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
    }
}

