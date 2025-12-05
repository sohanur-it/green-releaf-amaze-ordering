// Public/js/admin/fulfillment-transportation.js
// Transportation Details Form

document.addEventListener('DOMContentLoaded', () => {
    initializeForm();
    loadRecipients();
    loadTransporters(); // Re-enabled - transporter is required by METRC
    setupFormValidation();
    setupDeliveryWindowValidation();
});

/**
 * Initialize form
 */
function initializeForm() {
    document.getElementById('invoice-number').textContent = `INV-${window.invoiceId}`;
    
    // Set default departure time to now
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30); // 30 minutes from now
    const departureInput = document.getElementById('estimated-departure');
    departureInput.value = formatDateTimeLocal(now);
    
    // Set default arrival time to 6 hours from departure
    const arrival = new Date(now);
    arrival.setHours(arrival.getHours() + 6);
    const arrivalInput = document.getElementById('estimated-arrival');
    arrivalInput.value = formatDateTimeLocal(arrival);
}

/**
 * Format date for datetime-local input
 */
function formatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Load available recipients from METRC T3 API
 */
async function loadRecipients() {
    const recipientSelect = document.getElementById('recipient-facility');
    const recipientIdInput = document.getElementById('recipient-id');
    const loadingEl = document.getElementById('recipient-loading');

    if (!recipientSelect || !recipientIdInput) {
        console.error('Recipient elements not found');
        return;
    }

    try {
        console.log('[Recipients] Fetching recipients from API...');
        const response = await fetch('/api/v1/fulfillment/recipients');
        const data = await response.json();

        console.log('[Recipients] API response:', data);

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load recipients');
        }

        loadingEl.style.display = 'none';
        recipientSelect.innerHTML = '<option value="">Select Recipient Facility</option>';

        if (data.recipients && data.recipients.length > 0) {
            console.log(`[Recipients] ✅ Loaded ${data.recipients.length} recipient(s) from METRC API`);
            
            data.recipients.forEach(recipient => {
                const option = document.createElement('option');
                option.value = recipient.id; // Store the numeric ID as value
                option.textContent = recipient.displayName || `${recipient.name} (${recipient.licenseNumber})`;
                option.setAttribute('data-license', recipient.licenseNumber);
                option.setAttribute('data-name', recipient.name);
                recipientSelect.appendChild(option);
            });

            // Handle recipient selection - log when selected
            recipientSelect.addEventListener('change', (e) => {
                const selectedOption = e.target.options[e.target.selectedIndex];
                const recipientId = e.target.value;
                const licenseNumber = selectedOption.getAttribute('data-license');
                const name = selectedOption.getAttribute('data-name');
                
                if (recipientId) {
                    recipientIdInput.value = recipientId;
                    console.log(`[Recipients] ✅ Recipient selected:`, {
                        id: recipientId,
                        licenseNumber: licenseNumber,
                        name: name,
                        displayName: selectedOption.textContent
                    });
                    console.log(`[Recipients] ✅ Valid recipient ID retrieved from T3 API: ${recipientId}`);
                } else {
                    recipientIdInput.value = '';
                    console.log(`[Recipients] ⚠️ No recipient selected`);
                }
            });
        } else {
            console.warn('[Recipients] ⚠️ No recipients found in API response');
            recipientSelect.innerHTML = '<option value="">No recipients available</option>';
            loadingEl.innerHTML = `<span style="color: #ef4444;">No recipients found. Please ensure you have valid recipient facilities in METRC.</span>`;
        }

    } catch (error) {
        console.error('[Recipients] ❌ Error loading recipients:', error);
        loadingEl.innerHTML = `<span style="color: #ef4444;">Error loading recipients: ${error.message}</span>`;
        recipientSelect.innerHTML = '<option value="">Error loading recipients</option>';
    }
}

/**
 * Load available transporters from METRC T3 API
 */
async function loadTransporters() {
    const transporterSelect = document.getElementById('transporter-name');
    const transporterIdInput = document.getElementById('transporter-id');
    const loadingEl = document.getElementById('transporter-loading');

    if (!transporterSelect || !transporterIdInput) {
        console.error('Transporter elements not found');
        return;
    }

    try {
        console.log('[Transporters] Fetching transporters from API...');
        const response = await fetch('/api/v1/fulfillment/transporters');
        const data = await response.json();

        console.log('[Transporters] API response:', data);

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load transporters');
        }

        loadingEl.style.display = 'none';
        transporterSelect.innerHTML = '<option value="">Select Transporter Facility</option>';

        if (data.transporters && data.transporters.length > 0) {
            console.log(`[Transporters] ✅ Loaded ${data.transporters.length} transporter(s) from METRC API`);
            
            data.transporters.forEach(transporter => {
                const option = document.createElement('option');
                option.value = transporter.id; // Store the numeric ID as value
                option.textContent = transporter.displayName || `${transporter.name} (${transporter.licenseNumber})`;
                option.setAttribute('data-license', transporter.licenseNumber);
                option.setAttribute('data-name', transporter.name);
                transporterSelect.appendChild(option);
            });

            // Handle transporter selection - log when selected
            transporterSelect.addEventListener('change', (e) => {
                const selectedOption = e.target.options[e.target.selectedIndex];
                const transporterId = e.target.value;
                const licenseNumber = selectedOption.getAttribute('data-license');
                const name = selectedOption.getAttribute('data-name');
                
                if (transporterId) {
                    transporterIdInput.value = transporterId;
                    console.log(`[Transporters] ✅ Transporter selected:`, {
                        id: transporterId,
                        licenseNumber: licenseNumber,
                        name: name,
                        displayName: selectedOption.textContent
                    });
                    console.log(`[Transporters] ✅ Valid transporter ID retrieved from T3 API: ${transporterId}`);
                } else {
                    transporterIdInput.value = '';
                    console.log(`[Transporters] ⚠️ No transporter selected`);
                }
            });
        } else {
            console.warn('[Transporters] ⚠️ No transporters found in API response');
            transporterSelect.innerHTML = '<option value="">No transporters available</option>';
            loadingEl.innerHTML = `<span style="color: #ef4444;">No transporters found. Please ensure you have valid transporter facilities in METRC.</span>`;
        }

    } catch (error) {
        console.error('[Transporters] ❌ Error loading transporters:', error);
        loadingEl.innerHTML = `<span style="color: #ef4444;">Error loading transporters: ${error.message}</span>`;
        transporterSelect.innerHTML = '<option value="">Error loading transporters</option>';
    }
}

/**
 * Setup form validation
 */
function setupFormValidation() {
    const form = document.getElementById('transportation-form');
    
    if (!form) {
        console.error('Transportation form not found!');
        return;
    }
    
    const arrivalInput = document.getElementById('estimated-arrival');
    const departureInput = document.getElementById('estimated-departure');

    if (!arrivalInput || !departureInput) {
        console.error('Date inputs not found!');
        return;
    }

    // Validate arrival is after departure
    function validateTimes() {
        if (!departureInput.value || !arrivalInput.value) {
            return true; // Let HTML5 validation handle empty fields
        }
        
        const departure = new Date(departureInput.value);
        const arrival = new Date(arrivalInput.value);

        if (arrival <= departure) {
            arrivalInput.setCustomValidity('Arrival time must be after departure time');
            return false;
        } else {
            arrivalInput.setCustomValidity('');
            return true;
        }
    }

    departureInput.addEventListener('change', validateTimes);
    arrivalInput.addEventListener('change', validateTimes);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('Form submit event triggered');

        // Check if form is valid
        if (!form.checkValidity()) {
            console.log('Form validation failed');
            form.reportValidity();
            return;
        }

        if (!validateTimes()) {
            alert('Please ensure arrival time is after departure time.');
            return;
        }

        console.log('Submitting transportation details...');
        await submitTransportationDetails();
    });
    
    console.log('Form validation setup complete');
}

/**
 * Submit transportation details
 */
async function submitTransportationDetails() {
    const form = document.getElementById('transportation-form');
    
    if (!form) {
        console.error('Form not found!');
        alert('Error: Form not found. Please refresh the page.');
        return;
    }
    
    if (!window.invoiceId) {
        console.error('Invoice ID not set!');
        alert('Error: Invoice ID not found. Please refresh the page.');
        return;
    }
    
    const submitBtn = form.querySelector('button[type="submit"]');
    if (!submitBtn) {
        console.error('Submit button not found!');
        alert('Error: Submit button not found. Please refresh the page.');
        return;
    }
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
        const formData = new FormData(form);
        
        // Get recipient ID from hidden input (REQUIRED)
        const recipientId = document.getElementById('recipient-id')?.value;
        const recipientSelect = document.getElementById('recipient-facility');
        const selectedRecipient = recipientSelect?.options[recipientSelect.selectedIndex];
        
        if (!recipientId) {
            throw new Error('Please select a recipient facility');
        }

        console.log('[Transportation] Submitting with recipient ID:', recipientId);
        console.log('[Transportation] Selected recipient:', selectedRecipient?.textContent);

        // Get transporter ID from hidden input (REQUIRED - from dropdown selection)
        const transporterIdInput = document.getElementById('transporter-id');
        const transporterId = transporterIdInput?.value || null;
        const transporterSelect = document.getElementById('transporter-name');
        const selectedTransporter = transporterSelect?.options[transporterSelect.selectedIndex];
        
        if (!transporterId) {
            throw new Error('Please select a transporter facility');
        }

        // Get transporter name from selected option
        const transporterName = selectedTransporter?.textContent || formData.get('transporterName') || 'Unknown';
        
        console.log('[Transportation] Submitting with transporter ID:', transporterId);
        console.log('[Transportation] Selected transporter:', selectedTransporter?.textContent);

        const data = {
            invoice_id: window.invoiceId,
            driverName: formData.get('driverName'),
            driverLicense: formData.get('driverLicense'),
            driverOccupationalLicense: formData.get('driverOccupationalLicense') || '',
            vehicleMake: formData.get('vehicleMake'),
            vehicleModel: formData.get('vehicleModel'),
            vehiclePlate: formData.get('vehiclePlate'),
            estimatedDeparture: new Date(formData.get('estimatedDeparture')).toISOString(),
            estimatedArrival: new Date(formData.get('estimatedArrival')).toISOString(),
            transporterName: transporterName,
            transporterId: transporterId, // Required - from dropdown selection
            phoneNumber: formData.get('phoneNumber') || '',
            recipientId: recipientId // Required - recipient ID from dropdown
        };
        
        console.log('Submitting data:', data);

        const response = await fetch('/api/v1/fulfillment/transportation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        console.log('Response:', result);

        if (!response.ok) {
            throw new Error(result.error || 'Failed to save transportation details');
        }

        // Redirect to manifest creation
        console.log('Redirecting to manifest page...');
        window.location.href = `/admin/fulfillment/manifest/${window.invoiceId}`;

    } catch (error) {
        console.error('Error submitting transportation details:', error);
        alert(`Error: ${error.message}`);
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Save & Continue to Manifest';
    }
}

/**
 * Go back
 */
function goBack() {
    if (confirm('Go back? Unsaved changes will be lost.')) {
        window.location.href = `/admin/fulfillment/scanning/${window.invoiceId}`;
    }
}

/**
 * Setup delivery window validation
 */
function setupDeliveryWindowValidation() {
    const arrivalInput = document.getElementById('estimated-arrival');
    const warningDiv = document.getElementById('delivery-window-warning');
    const warningText = document.getElementById('delivery-window-warning-text');
    
    if (!arrivalInput || !warningDiv || !window.locationId) {
        return; // No location ID, skip validation
    }
    
    let validationTimeout;
    
    arrivalInput.addEventListener('change', () => {
        clearTimeout(validationTimeout);
        
        const arrivalValue = arrivalInput.value;
        if (!arrivalValue) {
            warningDiv.style.display = 'none';
            return;
        }
        
        // Debounce validation
        validationTimeout = setTimeout(async () => {
            try {
                const arrivalDate = new Date(arrivalValue);
                const response = await fetch(`/api/crm/locations/${window.locationId}/validate-delivery-time`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        deliveryDateTime: arrivalDate.toISOString()
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    if (!result.isValid) {
                        warningText.textContent = result.message || 'Delivery time falls outside active delivery windows';
                        warningDiv.style.display = 'block';
                        warningDiv.className = 'alert alert-warning';
                    } else {
                        warningDiv.style.display = 'none';
                    }
                }
            } catch (error) {
                console.error('Error validating delivery window:', error);
                // Don't show error to user, just log it
            }
        }, 500);
    });
}

