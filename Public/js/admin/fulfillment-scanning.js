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

    // TODO: Implement remove package endpoint
    alert('Remove package functionality coming soon');
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
    document.getElementById('issue-form').addEventListener('submit', handleIssueReport);
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

