// Public/js/admin/fulfillment-transportation.js
// Transportation Details Form

document.addEventListener('DOMContentLoaded', () => {
    initializeForm();
    loadTransporters();
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
 * Load available transporters
 */
async function loadTransporters() {
    const transporterSelect = document.getElementById('transporter-name');
    const loadingEl = document.getElementById('transporter-loading');

    try {
        const response = await fetch('/api/v1/fulfillment/transporters');
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load transporters');
        }

        loadingEl.style.display = 'none';
        transporterSelect.innerHTML = '<option value="">Select Transporter</option>';

        if (data.transporters && data.transporters.length > 0) {
            data.transporters.forEach(transporter => {
                const option = document.createElement('option');
                option.value = transporter.name;
                option.textContent = `${transporter.name} (${transporter.licenseNumber || 'N/A'})`;
                transporterSelect.appendChild(option);
            });
        } else {
            // If no transporters from API, allow manual entry
            transporterSelect.innerHTML = '<option value="">Enter Transporter Name</option>';
            transporterSelect.style.display = 'none';
            transporterSelect.removeAttribute('required'); // Remove required when hidden
            const manualInput = document.createElement('input');
            manualInput.type = 'text';
            manualInput.id = 'transporter-name-manual';
            manualInput.name = 'transporterName';
            manualInput.required = true;
            manualInput.placeholder = 'Enter Transporter Name';
            manualInput.className = 'form-group input';
            transporterSelect.parentElement.appendChild(manualInput);
        }

    } catch (error) {
        console.error('Error loading transporters:', error);
        loadingEl.innerHTML = `<span style="color: #ef4444;">Error loading transporters: ${error.message}</span>`;
        
        // Allow manual entry
        transporterSelect.style.display = 'none';
        transporterSelect.removeAttribute('required'); // Remove required when hidden
        const manualInput = document.createElement('input');
        manualInput.type = 'text';
        manualInput.id = 'transporter-name-manual';
        manualInput.name = 'transporterName';
        manualInput.required = true;
        manualInput.placeholder = 'Enter Transporter Name';
        manualInput.className = 'form-group input';
        manualInput.style.cssText = 'padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 8px; font-size: 1rem; width: 100%;';
        transporterSelect.parentElement.appendChild(manualInput);
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
        
        // Get transporter name - check both select and manual input
        let transporterName = formData.get('transporterName');
        if (!transporterName) {
            const manualInput = document.getElementById('transporter-name-manual');
            transporterName = manualInput ? manualInput.value : '';
        }
        
        if (!transporterName) {
            throw new Error('Transporter name is required');
        }
        
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
            phoneNumber: formData.get('phoneNumber') || ''
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

