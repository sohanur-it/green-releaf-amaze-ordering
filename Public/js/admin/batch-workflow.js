// Batch Workflow JavaScript
// Handles the batch workflow tab - product-by-product batch decisions

// State
let currentProduct = null;
let currentBatches = [];
let batchDecisions = new Map(); // batch_name -> { status, custom_batch_name }
let lastCheckTime = new Date();
let pollingInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Set up tab switching
    setupTabs();

    // Load first product
    loadNextProduct();

    // Start polling for new batches
    startPolling();
});

/**
 * Set up tab switching functionality
 */
function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;
            switchTab(tabName);
        });
    });
}

/**
 * Switch between tabs
 * @param {string} tabName - Tab to switch to
 */
function switchTab(tabName) {
    // Update button states
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content visibility
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    if (tabName === 'workflow') {
        document.getElementById('workflow-tab').classList.add('active');
    } else if (tabName === 'view-all') {
        document.getElementById('view-all-tab').classList.add('active');
        // Load the table when switching to this tab
        if (typeof loadAllBatchesTable === 'function') {
            loadAllBatchesTable();
        }
    }
}

/**
 * Load the next product with pending batches
 */
async function loadNextProduct(previousProductName = null) {
    console.log('loadNextProduct called, previous:', previousProductName);
    try {
        console.log('Fetching next product...');
        const response = await fetch('/admin/api/batch-workflow/next');
        const result = await response.json();
        console.log('Next product result:', result);

        if (result.success && result.data) {
            console.log('Got product data:', result.data.product.item_name);

            // Check if we got the same product back (happens when batches were ignored)
            if (previousProductName && result.data.product.item_name === previousProductName) {
                console.log('Same product returned - batches were ignored');
                showWarning('Cannot skip all batches for this product. Please mark at least one batch as Sellable, On Deck, or On Hold.');
                return;
            }

            currentProduct = result.data.product;
            currentBatches = result.data.product.pending_batches;
            batchDecisions.clear();

            displayProduct();
            displayBatches();

            // Show workflow content, hide empty state
            document.getElementById('workflow-content').style.display = 'block';
            document.getElementById('workflow-empty').style.display = 'none';

            // Update remaining count
            const remaining = result.data.remainingCount || 0;
            const remainingEl = document.getElementById('remaining-count');
            if (remaining > 0) {
                remainingEl.textContent = `${remaining} more product(s) with pending batches`;
                remainingEl.style.display = 'block';
            } else {
                remainingEl.style.display = 'none';
            }
        } else {
            console.log('No more products with pending batches');
            // No products with pending batches
            document.getElementById('workflow-content').style.display = 'none';
            document.getElementById('workflow-empty').style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading next product:', error);
        showError('Failed to load next product');
    }
}

/**
 * Display product information
 */
function displayProduct() {
    if (!currentProduct) return;

    const displayName = currentProduct.display_item_name || currentProduct.item_name;
    document.getElementById('product-name').textContent = displayName;
    document.getElementById('product-category').textContent = currentProduct.category || '-';
    document.getElementById('product-brand').textContent = currentProduct.brand || '-';
    document.getElementById('product-price').textContent = currentProduct.default_price ? `$${parseFloat(currentProduct.default_price).toFixed(2)}` : '-';
    document.getElementById('product-weight').textContent = currentProduct.unit_weight ? `${currentProduct.unit_weight}${currentProduct.unit_size_measurement || ''}` : '-';
    document.getElementById('product-packages').textContent = currentProduct.packages_per_case || '-';
}

/**
 * Display batches for current product
 */
function displayBatches() {
    const listEl = document.getElementById('batches-list');
    listEl.innerHTML = '';

    if (!currentBatches || currentBatches.length === 0) {
        listEl.innerHTML = '<p class="empty-message">No pending batches for this product</p>';
        return;
    }

    currentBatches.forEach(batch => {
        const batchCard = createBatchCard(batch);
        listEl.appendChild(batchCard);
    });
}

/**
 * Create a batch card element
 * @param {Object} batch - Batch data
 * @returns {HTMLElement} Batch card element
 */
function createBatchCard(batch) {
    const card = document.createElement('div');
    card.className = 'batch-card';
    card.dataset.batchName = batch.batch_name;

    // Auto-set to "On Hold" if no full packages
    const hasNoFullPackages = !batch.full_package_count || batch.full_package_count === 0;

    // Left side - info
    const leftSide = document.createElement('div');
    leftSide.className = 'batch-card-left';

    // Batch header (name)
    const header = document.createElement('div');
    header.className = 'batch-header';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'batch-name-label';
    nameLabel.textContent = 'Batch:';
    const nameValue = document.createElement('span');
    nameValue.className = 'batch-name-value';
    nameValue.textContent = batch.batch_name;
    header.appendChild(nameLabel);
    header.appendChild(nameValue);

    // Custom name input (compact)
    const customNameGroup = document.createElement('div');
    customNameGroup.className = 'form-group';
    const customNameInput = document.createElement('input');
    customNameInput.type = 'text';
    customNameInput.className = 'form-control';
    customNameInput.placeholder = 'Custom name (optional)';
    customNameInput.dataset.batchName = batch.batch_name;
    customNameInput.style.fontSize = '0.85rem';
    customNameInput.style.padding = '0.4rem';
    customNameGroup.appendChild(customNameInput);

    // Batch details grid
    const details = document.createElement('div');
    details.className = 'batch-details';

    // Full packages
    const fullPackagesEl = document.createElement('div');
    fullPackagesEl.className = 'batch-detail-item';
    fullPackagesEl.innerHTML = `
        <span class="detail-label">Full</span>
        <span class="detail-value clickable" onclick="showFullPackageDetails('${batch.batch_name}')">
            ${batch.full_package_count || 0} 📋
        </span>
    `;
    details.appendChild(fullPackagesEl);

    // Partial packages
    const partialPackagesEl = document.createElement('div');
    partialPackagesEl.className = 'batch-detail-item';
    partialPackagesEl.innerHTML = `<span class="detail-label">Partial</span>`;

    if (batch.partial_package_count > 0 && batch.partial_package_details) {
        const partials = batch.partial_package_details.partial_packages || [];
        const partialList = document.createElement('div');
        partialList.className = 'partial-packages-list';
        partialList.style.fontSize = '0.8rem';
        partialList.style.marginTop = '0.25rem';

        partials.forEach(p => {
            const item = document.createElement('div');
            item.className = 'partial-package-item';
            item.style.marginBottom = '0.15rem';
            item.innerHTML = `<strong>${p.label}:</strong> ${p.quantity}g`;
            partialList.appendChild(item);
        });

        partialPackagesEl.appendChild(partialList);
    } else {
        const valueSpan = document.createElement('span');
        valueSpan.className = 'detail-value';
        valueSpan.textContent = '0';
        partialPackagesEl.appendChild(valueSpan);
    }
    details.appendChild(partialPackagesEl);

    // THC %
    if (batch.thc_percentage) {
        const thcEl = document.createElement('div');
        thcEl.className = 'batch-detail-item';
        thcEl.innerHTML = `
            <span class="detail-label">THC</span>
            <span class="detail-value">${parseFloat(batch.thc_percentage).toFixed(2)}%</span>
        `;
        details.appendChild(thcEl);
    }

    // Test date
    if (batch.test_date) {
        const testDateEl = document.createElement('div');
        testDateEl.className = 'batch-detail-item';
        testDateEl.innerHTML = `
            <span class="detail-label">Test Date</span>
            <span class="detail-value">${formatDate(batch.test_date)}</span>
        `;
        details.appendChild(testDateEl);
    }

    // Best by date
    if (batch.best_by_date) {
        const bestByEl = document.createElement('div');
        bestByEl.className = 'batch-detail-item';
        bestByEl.innerHTML = `
            <span class="detail-label">Best By</span>
            <span class="detail-value">${formatDate(batch.best_by_date)}</span>
        `;
        details.appendChild(bestByEl);
    }

    leftSide.appendChild(header);
    leftSide.appendChild(customNameGroup);
    leftSide.appendChild(details);

    // Right side - action buttons (column)
    const actions = document.createElement('div');
    actions.className = 'batch-actions';

    const sellableBtn = createActionButton('Sellable', 'btn-sellable', batch.batch_name);
    const onDeckBtn = createActionButton('On Deck', 'btn-on-deck', batch.batch_name);
    const onHoldBtn = createActionButton('On Hold', 'btn-on-hold', batch.batch_name);
    const ignoreBtn = createActionButton('Ignore', 'btn-ignore', batch.batch_name);

    // Auto-set to On Hold and disable other options if no full packages
    if (hasNoFullPackages) {
        // Automatically set to "On Hold"
        handleDecision(batch.batch_name, 'On Hold');

        // Disable Sellable and On Deck buttons
        sellableBtn.disabled = true;
        sellableBtn.style.opacity = '0.5';
        sellableBtn.style.cursor = 'not-allowed';
        sellableBtn.title = 'Cannot sell batches with no full packages';

        onDeckBtn.disabled = true;
        onDeckBtn.style.opacity = '0.5';
        onDeckBtn.style.cursor = 'not-allowed';
        onDeckBtn.title = 'Cannot sell batches with no full packages';

        // Disable Ignore button
        ignoreBtn.disabled = true;
        ignoreBtn.style.opacity = '0.5';
        ignoreBtn.style.cursor = 'not-allowed';
        ignoreBtn.title = 'Batches with no full packages must be set to On Hold';
    }

    actions.appendChild(sellableBtn);
    actions.appendChild(onDeckBtn);
    actions.appendChild(onHoldBtn);
    actions.appendChild(ignoreBtn);

    // Assemble card (two columns)
    card.appendChild(leftSide);
    card.appendChild(actions);

    return card;
}

/**
 * Create an action button
 * @param {string} label - Button label
 * @param {string} className - Button class
 * @param {string} batchName - Batch name
 * @returns {HTMLElement} Button element
 */
function createActionButton(label, className, batchName) {
    const btn = document.createElement('button');
    btn.className = `btn ${className}`;
    btn.textContent = label;
    btn.onclick = () => handleDecision(batchName, label);
    return btn;
}

/**
 * Handle batch decision
 * @param {string} batchName - Batch name
 * @param {string} status - Decision status
 */
function handleDecision(batchName, status) {
    // Get custom name input
    const customNameInput = document.querySelector(`input[data-batch-name="${batchName}"]`);
    const customName = customNameInput ? customNameInput.value.trim() : '';

    // Store decision
    batchDecisions.set(batchName, {
        status,
        custom_batch_name: customName || null
    });

    // Update visual feedback
    const card = document.querySelector(`.batch-card[data-batch-name="${batchName}"]`);
    if (card) {
        // Remove previous decision classes
        card.classList.remove('decision-sellable', 'decision-on-deck', 'decision-on-hold', 'decision-ignore');
        // Add new decision class
        card.classList.add(`decision-${status.toLowerCase().replace(' ', '-')}`);
    }

    // Update button states
    updateButtonStates(batchName, status);
}

/**
 * Update button states for a batch
 * @param {string} batchName - Batch name
 * @param {string} activeStatus - Currently selected status
 */
function updateButtonStates(batchName, activeStatus) {
    const card = document.querySelector(`.batch-card[data-batch-name="${batchName}"]`);
    if (!card) return;

    const buttons = card.querySelectorAll('.batch-actions button');
    buttons.forEach(btn => {
        btn.classList.toggle('active', btn.textContent === activeStatus);
    });
}

/**
 * Submit batch decisions
 */
async function submitBatchDecisions() {
    // Check if we have decisions for all batches (including ignored ones)
    if (batchDecisions.size === 0) {
        showWarning('Please make at least one decision before continuing');
        return;
    }

    // Build decisions array (including "Ignore" - backend will filter them out)
    const decisions = [];
    batchDecisions.forEach((decision, batchName) => {
        decisions.push({
            batch_name: batchName,
            item_name: currentProduct.original_item_name,
            product_detail_id: currentProduct.id,
            status: decision.status,
            custom_batch_name: decision.custom_batch_name
        });
    });

    try {
        const response = await fetch('/admin/api/batch-workflow/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decisions })
        });

        const result = await response.json();
        console.log('Submit result:', result);

        if (result.success) {
            // Show appropriate message based on what was saved
            if (result.saved_count === 0) {
                console.log('All batches ignored, attempting to load next product');
                // Don't show success message yet - wait to see if we can move on
            } else {
                console.log('Batches saved, loading next product');
                showSuccess(result.message || 'Batch decisions saved successfully');
            }

            // Update last check time
            lastCheckTime = new Date();

            // Store current product name to detect if we get the same one back
            const previousProductName = currentProduct.item_name;

            // Load next product after short delay
            console.log('Setting timeout to load next product');
            setTimeout(() => {
                console.log('Timeout fired, calling loadNextProduct');
                loadNextProduct(previousProductName);
            }, result.saved_count === 0 ? 0 : 1000); // No delay if ignored
        } else {
            console.error('Submit failed:', result.error);
            showError(result.error || 'Failed to save batch decisions');
        }
    } catch (error) {
        console.error('Error submitting batch decisions:', error);
        showError('Failed to save batch decisions');
    }
}

/**
 * Show full package details modal
 * @param {string} batchName - Batch name
 */
function showFullPackageDetails(batchName) {
    const batch = currentBatches.find(b => b.batch_name === batchName);
    if (!batch || !batch.full_package_details) return;

    const modal = document.getElementById('package-modal');
    const body = document.getElementById('package-modal-body');

    const fullPackages = batch.full_package_details.full_packages || [];

    let html = '<div class="package-list">';
    fullPackages.forEach(pkg => {
        html += `<div class="package-item"><strong>${pkg.label}:</strong> ${pkg.quantity}g</div>`;
    });
    html += '</div>';

    body.innerHTML = html;
    modal.style.display = 'block';
}

/**
 * Close package modal
 */
function closePackageModal() {
    const modal = document.getElementById('package-modal');
    modal.style.display = 'none';
}

/**
 * Start polling for new batches
 */
function startPolling() {
    // Poll every 2 minutes
    pollingInterval = setInterval(() => {
        checkForNewBatches();
    }, 2 * 60 * 1000);
}

/**
 * Check for new batches
 */
async function checkForNewBatches() {
    try {
        const response = await fetch(`/admin/api/batch-workflow/check-new?lastCheck=${lastCheckTime.toISOString()}`);
        const result = await response.json();

        if (result.success && result.data.hasNewBatches) {
            const products = result.data.products;
            const productNames = products.map(p => p.item_name).join(', ');

            showInfo(
                `🔔 New batches detected for: ${productNames}`,
                10000,
                () => {
                    hideNotification();
                    loadNextProduct();
                },
                'View Next'
            );
        }
    } catch (error) {
        console.error('Error checking for new batches:', error);
    }
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
