// Checkout Page Inventory Validator
// Validates cart quantities against backend inventory and shows warnings

class CheckoutValidator {
    constructor(uuid) {
        this.uuid = uuid;
        this.inventoryIssues = [];
    }

    // Validate cart against inventory
    async validateCart() {
        const cart = getCartManager();
        if (!cart) {
            return { valid: false, issues: [] };
        }

        // Fetch latest inventory from backend
        await cart.fetchInventoryData();
        
        // Validate each item
        const issues = cart.validateCartAgainstInventory();
        this.inventoryIssues = issues;

        return {
            valid: issues.length === 0,
            issues: issues
        };
    }

    // Render validation warnings on checkout page
    renderWarnings(issues) {
        if (issues.length === 0) return;

        // Show global warning
        const warningBar = document.getElementById('inventory-warning-bar');
        if (warningBar) {
            warningBar.style.display = 'block';
            warningBar.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                <span>Inventory Update Required</span>
                <p>Some items in your cart have limited availability. Please review the highlighted products below and adjust quantities as needed.</p>
            `;
        }

        // Highlight problematic items
        issues.forEach(issue => {
            const row = document.querySelector(`tr[data-line-item-id="${issue.line_item_id}"]`);
            if (row) {
                row.classList.add('inventory-exceeded');
                
                // Add warning message in quantity cell
                const quantityCell = row.querySelector('.item-quantity-cell');
                if (quantityCell && !quantityCell.querySelector('.inventory-warning')) {
                    const warning = document.createElement('div');
                    warning.className = 'inventory-warning';
                    warning.innerHTML = `
                        <div class="warning-banner">
                            <i class="fas fa-exclamation-triangle"></i>
                            <span>Limited Inventory Available</span>
                        </div>
                        <div class="warning-details">
                            Maximum available quantity: <strong>${issue.available}</strong> ${issue.available === 1 ? 'unit' : 'units'}
                        </div>
                    `;
                    quantityCell.appendChild(warning);
                }

                // Disable quantity input if exceeded
                const quantityInput = row.querySelector('input[type="number"]');
                if (quantityInput) {
                    quantityInput.classList.add('quantity-exceeded');
                    quantityInput.max = issue.available;
                    quantityInput.value = issue.available;
                }

                // Disable + button
                const plusBtn = row.querySelector('.quantity-btn:last-child');
                if (plusBtn) {
                    plusBtn.disabled = true;
                    plusBtn.classList.add('disabled');
                }
            }
        });
    }

    // Update quantity input validation
    setupQuantityValidation() {
        const quantityInputs = document.querySelectorAll('.quantity-input-checkout');
        quantityInputs.forEach(input => {
            input.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) || 0;
                const max = parseInt(e.target.dataset.maxAvailable) || 999;
                const row = e.target.closest('tr');
                
                if (value > max) {
                    e.target.classList.add('quantity-exceeded');
                    e.target.value = max;
                    this.showFieldWarning(e.target, max);
                } else {
                    e.target.classList.remove('quantity-exceeded');
                    this.hideFieldWarning(e.target);
                }
            });

            // Disable + button when at max
            const plusBtn = row?.querySelector('.quantity-btn:last-child');
            if (plusBtn) {
                input.addEventListener('input', () => {
                    const value = parseInt(input.value) || 0;
                    const max = parseInt(input.dataset.maxAvailable) || 999;
                    if (value >= max) {
                        plusBtn.disabled = true;
                        plusBtn.classList.add('disabled');
                    } else {
                        plusBtn.disabled = false;
                        plusBtn.classList.remove('disabled');
                    }
                });
            }
        });
    }

    showFieldWarning(input, max) {
        let warning = input.parentElement.querySelector('.field-warning');
        if (!warning) {
            warning = document.createElement('div');
            warning.className = 'field-warning';
            input.parentElement.appendChild(warning);
        }
        warning.textContent = `Max: ${max} units`;
        warning.style.display = 'block';
    }

    hideFieldWarning(input) {
        const warning = input.parentElement.querySelector('.field-warning');
        if (warning) {
            warning.style.display = 'none';
        }
    }
}

// Initialize checkout validator
function initCheckoutValidator(uuid) {
    const validator = new CheckoutValidator(uuid);
    
    // Validate on page load
    validator.validateCart().then(result => {
        if (!result.valid) {
            validator.renderWarnings(result.issues);
        }
        validator.setupQuantityValidation();
    });

    return validator;
}

