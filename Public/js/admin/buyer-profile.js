// Public/js/admin/buyer-profile.js

document.addEventListener('DOMContentLoaded', () => {
    const canManagePurchaseLimits = window.canManagePurchaseLimits === true || window.canManagePurchaseLimits === 'true';
    // === HELPER: Open any modal ===
    const openModal = (modal) => {
        if (!modal) return;
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        modal.style.display = 'flex';
        // Prevent background scrolling when modal is open
        document.body.classList.add('modal-open');
    };

    // === HELPER: Close any modal ===
    const closeModal = (modal, force = false) => {
        if (!modal) return;
        // Check if this modal should not close on outside click
        // Only allow closing if explicitly requested (not from outside click)
        if (modal.dataset.noCloseOnOutsideClick === 'true' && force !== 'force') {
            // Don't close if this is a protected modal unless explicitly forced
            return;
        }
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        modal.style.display = 'none';
        // Re-enable background scrolling when modal is closed
        // Check if any other modals are still open
        const openModals = document.querySelectorAll('.modal-overlay.active');
        if (openModals.length === 0) {
            document.body.classList.remove('modal-open');
        }
    };

    // === GLOBAL: Handle modal overlay click (close on backdrop) ===
    window.handleModalOverlayClick = function(event) {
        if (event.target.classList.contains('modal-overlay')) {
            const modal = event.target;
            // Check if this modal should not close on outside click
            if (modal.dataset.noCloseOnOutsideClick === 'true') {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                return; // Don't close this modal
            }
            closeModal(modal);
        }
    };

    // === Close modal on close button click ===
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = btn.closest('.modal-overlay');
            if (modal) {
                // Force close when clicking close button (even for protected modals)
                closeModal(modal, 'force');
            }
        });
    });

    // ========================================================
    // ========== CONTACT CRUD FUNCTIONALITY ==================
    // ========================================================

    // === DOM ELEMENT SELECTORS (Contacts) ===
    const addContactBtn = document.getElementById('addContactBtn');
    const contactModal = document.querySelector('#contactModal');
    const contactForm = document.getElementById('contactForm');
    const contactsTableBody = document.getElementById('contacts-table-body');

    // === MODAL & FORM ELEMENTS (Contacts) ===
    const contactModalTitle = document.getElementById('contactModalTitle');
    const contactFormError = document.getElementById('contactFormError');
    const contactIdField = document.getElementById('contactId');
    const contactNameField = document.getElementById('contactName');
    const contactTitleField = document.getElementById('contactTitle');
    const contactEmailField = document.getElementById('contactEmail');
    const contactPhoneField = document.getElementById('contactPhone');

    // === RENDER FUNCTION: Create or update a contact table row ===
    const renderContactRow = (contact) => {
        return `
            <td>${contact.name || ''}</td>
            <td>${contact.title || 'N/A'}</td>
            <td>${contact.email || 'N/A'}</td>
            <td>${contact.primary_phone || 'N/A'}</td>
            <td class="table-actions">
                <button class="action-btn" data-action="edit"
                    data-contact-id="${contact.entry_id}"
                    data-contact-name="${contact.name || ''}"
                    data-contact-title="${contact.title || ''}"
                    data-contact-email="${contact.email || ''}"
                    data-contact-phone="${contact.primary_phone || ''}">
                    Edit
                </button>
                <button class="action-btn" data-action="delete"
                    data-contact-id="${contact.entry_id}"
                    data-contact-name="${contact.name || ''}">
                    Delete
                </button>
            </td>
        `;
    };

    // === EVENT: Click "Add Contact" button ===
    if (addContactBtn) {
        addContactBtn.addEventListener('click', () => {
            contactForm.reset();
            contactModalTitle.textContent = 'Add New Contact';
            contactForm.setAttribute('data-method', 'POST');
            contactForm.setAttribute('data-action', `/api/crm/buyers/${addContactBtn.dataset.buyerId}/contacts`);
            contactIdField.value = '';
            contactFormError.style.display = 'none';
            openModal(contactModal);
        });
    }

    // === EVENT DELEGATION: Clicks inside the contacts table ===
    if (contactsTableBody) {
        contactsTableBody.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            const contactId = target.dataset.contactId;

            if (action === 'edit') {
                contactForm.reset();
                contactModalTitle.textContent = `Edit ${target.dataset.contactName}`;
                contactForm.setAttribute('data-method', 'PATCH');
                contactForm.setAttribute('data-action', `/api/crm/contacts/${contactId}`);
                contactIdField.value = contactId;
                contactNameField.value = target.dataset.contactName;
                contactTitleField.value = target.dataset.contactTitle;
                contactEmailField.value = target.dataset.contactEmail;
                contactPhoneField.value = target.dataset.contactPhone;
                contactFormError.style.display = 'none';
                openModal(contactModal);
            }

            if (action === 'delete') {
                const confirmationModal = document.querySelector('#confirmationModal');
                const modalTitle = confirmationModal.querySelector('#modalTitle');
                const modalText = confirmationModal.querySelector('#modalText');
                const modalForm = confirmationModal.querySelector('#modalConfirmForm');
                modalTitle.textContent = 'Delete Contact?';
                modalText.textContent = `Are you sure you want to delete ${target.dataset.contactName}? This is permanent.`;
                modalForm.action = `/api/crm/contacts/${contactId}`;
                modalForm.setAttribute('data-method', 'DELETE');
                modalForm.setAttribute('data-target-row', `[data-contact-id="${contactId}"]`);
                openModal(confirmationModal);
            }
        });
    }

    // === EVENT: Submission of the Add/Edit Contact Form ===
    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const action = contactForm.getAttribute('data-action');
            const method = contactForm.getAttribute('data-method');
            const formData = new FormData(contactForm);
            const contactData = Object.fromEntries(formData.entries());

            try {
                const response = await fetch(action, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(contactData),
                });
                if (!response.ok) throw new Error((await response.json()).message);
                const resultContact = await response.json();

                if (method === 'POST') {
                    const emptyMessage = document.getElementById('empty-contacts-message');
                    if (emptyMessage) emptyMessage.remove();
                    const newRow = contactsTableBody.insertRow();
                    newRow.dataset.contactId = resultContact.entry_id;
                    newRow.innerHTML = renderContactRow(resultContact);
                } else {
                    const rowToUpdate = contactsTableBody.querySelector(`[data-contact-id="${resultContact.entry_id}"]`);
                    if (rowToUpdate) rowToUpdate.innerHTML = renderContactRow(resultContact);
                }
                closeModal(contactModal);
            } catch (error) {
                contactFormError.textContent = `Error: ${error.message}`;
                contactFormError.style.display = 'block';
            }
        });
    }

    // ========================================================
    // ========== LOCATION CRUD FUNCTIONALITY =================
    // ========================================================

    // === DOM ELEMENT SELECTORS (Locations) ===
    const addLocationBtn = document.getElementById('addLocationBtn');
    const locationModal = document.getElementById('locationModal');
    const locationForm = document.getElementById('locationForm');
    const locationsTableBody = document.getElementById('locations-table-body');

    // === MODAL & FORM ELEMENTS (Locations) ===
    const locationModalTitle = document.getElementById('locationModalTitle');
    const locationFormError = document.getElementById('locationFormError');
    const locationFormWarning = document.getElementById('locationFormWarning');
    const locationFormWarningText = document.getElementById('locationFormWarningText');
    const locationLicenseInput = document.getElementById('locationLicense');
    const locationIdField = document.getElementById('locationId');

    // === RENDER FUNCTION (Locations) ===
    const renderLocationRow = (location) => {
        const address = `${location.line_one}${location.line_two ? ', ' + location.line_two : ''}, ${location.city}, ${location.state} ${location.zip}`;
        // just addin the new access code to the html string it spits out. easy.
        const limitsButton = canManagePurchaseLimits ? `
                <button type="button" class="action-btn action-btn--secondary always-visible" data-action="manage-limits"
                    data-location-id="${location.entry_id}"
                    data-location-name="${location.name || ''}">
                    Limits
                </button>` : '';

        return `
            <td>${location.name || ''}</td>
            <td>${address}</td>
            <td>${location.state_license || 'N/A'}</td>
            <td>${location.delivery_zone || ''}</td>
            <td><code>${location.access_code || ''}</code></td>
            <td class="table-actions">
                <button type="button" class="action-btn action-btn--primary" data-action="edit-location"
                    data-location-id="${location.entry_id}"
                    data-location-name="${location.name || ''}"
                    data-location-line_one="${location.line_one || ''}"
                    data-location-line_two="${location.line_two || ''}"
                    data-location-city="${location.city || ''}"
                    data-location-state="${location.state || ''}"
                    data-location-zip="${location.zip || ''}"
                    data-location-state_license="${location.state_license || ''}"
                    data-location-delivery_zone="${location.delivery_zone || ''}">
                    Edit
                </button>
                ${limitsButton}
                <button type="button" class="action-btn action-btn--danger" data-action="delete-location"
                    data-location-id="${location.entry_id}"
                    data-location-name="${location.name || ''}">
                    Delete
                </button>
            </td>
        `;
    };

    // Purchase limit modal elements
    const purchaseLimitModal = document.getElementById('purchaseLimitModal');
    const purchaseLimitForm = document.getElementById('purchaseLimitForm');
    const purchaseLimitLocationIdField = document.getElementById('purchaseLimitLocationId');
    const purchaseLimitLocationName = document.getElementById('purchaseLimitLocationName');
    const purchaseLimitMeta = document.getElementById('purchaseLimitMeta');
    const purchaseLimitError = document.getElementById('purchaseLimitError');
    const purchaseLimitSuccess = document.getElementById('purchaseLimitSuccess');
    const limitOrderInput = document.getElementById('limitOrderTotal');
    const limitUnshippedInput = document.getElementById('limitUnshipped');
    const limitUnpaidInput = document.getElementById('limitUnpaid');
    const resetPurchaseLimitBtn = document.getElementById('resetPurchaseLimitBtn');
    const limitOrderDefaultText = document.getElementById('limitOrderDefaultText');
    const limitUnshippedDefaultText = document.getElementById('limitUnshippedDefaultText');
    const limitUnpaidDefaultText = document.getElementById('limitUnpaidDefaultText');

    const formatCurrency = (value) => {
        if (value === null || value === undefined) return 'Default';
        return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const formatInteger = (value) => {
        if (value === null || value === undefined) return 'Default';
        return `${Number(value).toLocaleString()}`;
    };

    const populatePurchaseLimitModal = (payload) => {
        if (!payload || !payload.limits) return;
        const { limits, metadata } = payload;
        const overrides = limits.overrides || {};
        const defaults = limits.defaults || {};

        limitOrderInput.value = overrides.max_order_total ?? '';
        limitOrderInput.placeholder = `Default ${formatCurrency(defaults.max_order_total)}`;
        limitOrderDefaultText.textContent = `Leave blank to use system default (${formatCurrency(defaults.max_order_total)}).`;

        limitUnshippedInput.value = overrides.max_unshipped_orders ?? '';
        limitUnshippedInput.placeholder = `Default ${formatInteger(defaults.max_unshipped_orders)}`;
        limitUnshippedDefaultText.textContent = `Leave blank to use system default (${formatInteger(defaults.max_unshipped_orders)}).`;

        limitUnpaidInput.value = overrides.max_unpaid_invoices ?? '';
        limitUnpaidInput.placeholder = `Default ${formatInteger(defaults.max_unpaid_invoices)}`;
        limitUnpaidDefaultText.textContent = `Leave blank to use system default (${formatInteger(defaults.max_unpaid_invoices)}).`;

        if (metadata && metadata.last_modified_at) {
            const modifiedBy = metadata.last_modified_by ? ` by ${metadata.last_modified_by.name || metadata.last_modified_by.email}` : '';
            purchaseLimitMeta.textContent = `Last updated ${new Date(metadata.last_modified_at).toLocaleString()}${modifiedBy}`;
        } else {
            purchaseLimitMeta.textContent = 'No overrides saved. Using system defaults.';
        }
    };

    const loadPurchaseLimits = async (locationId) => {
        console.log('[purchase-limits] loading limits for location', locationId);
        purchaseLimitError.style.display = 'none';
        purchaseLimitSuccess.style.display = 'none';
        purchaseLimitMeta.textContent = 'Loading current limits...';
        try {
            const response = await fetch(`/api/crm/locations/${locationId}/purchase-limits`, {
                credentials: 'same-origin'
            });
            console.log('[purchase-limits] fetch status', response.status);
            if (!response.ok) {
                throw new Error((await response.json()).error || 'Failed to load purchase limits');
            }
            const data = await response.json();
            console.log('[purchase-limits] fetch success payload', data);
            populatePurchaseLimitModal(data);
        } catch (error) {
            purchaseLimitMeta.textContent = 'Unable to load limits.';
            purchaseLimitError.textContent = error.message;
            purchaseLimitError.style.display = 'block';
            console.error('[purchase-limits] error loading limits', error);
        }
    };

    const handleManageLimitsClick = (locationId, locationName) => {
        console.log('[purchase-limits] handleManageLimitsClick', { locationId, locationName, modalExists: !!purchaseLimitModal });
        if (!purchaseLimitModal) {
            console.warn('[purchase-limits] modal element missing');
            return;
        }
        purchaseLimitForm.reset();
        purchaseLimitError.style.display = 'none';
        purchaseLimitSuccess.style.display = 'none';
        purchaseLimitLocationIdField.value = locationId;
        purchaseLimitLocationName.textContent = locationName || 'Location';
        console.log('[purchase-limits] opening modal');
        openModal(purchaseLimitModal);
        loadPurchaseLimits(locationId);
    };

    // Attach click handlers to existing Limit buttons (server-rendered)
    document.querySelectorAll('[data-action="manage-limits"]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            const locationId = btn.dataset.locationId;
            if (!locationId) return;
            document.body.classList.add('modal-open');
            handleManageLimitsClick(locationId, btn.dataset.locationName);
        });
    });

    // === EVENT: Click "Add Location" button ===
    if (addLocationBtn) {
        addLocationBtn.addEventListener('click', () => {
            locationForm.reset();
            locationModalTitle.textContent = 'Add New Location';
            locationForm.setAttribute('data-method', 'POST');
            locationForm.setAttribute('data-action', `/api/crm/buyers/${addLocationBtn.dataset.buyerId}/locations`);
            locationIdField.value = '';
            // Hide delivery windows section for new locations
            const deliveryWindowsSection = document.getElementById('deliveryWindowsSection');
            if (deliveryWindowsSection) {
                deliveryWindowsSection.style.display = 'none';
            }

            locationFormError.style.display = 'none';
            locationFormWarning.style.display = 'none';
            locationForm.dataset.targetBuyerId = addLocationBtn.dataset.buyerId;
            locationForm.dataset.existingLocationId = ''; // Will be set if DIS belongs to another buyer
            openModal(locationModal);
        });
    }

    // === DELIVERY WINDOWS MANAGEMENT ===
    
    // Load delivery windows preview
    async function loadDeliveryWindowsPreview(locationId) {
        const preview = document.getElementById('deliveryWindowsPreview');
        if (!preview) return;

        try {
            const response = await fetch(`/api/crm/locations/${locationId}/delivery-windows`);
            const data = await response.json();
            
            if (data.success && data.windows && data.windows.length > 0) {
                const windowsHtml = data.windows.map(w => {
                    const daysText = w.days_display || formatDaysOfWeek(w.days_of_week);
                    const timeText = `${w.start_time} - ${w.end_time}`;
                    const statusBadge = w.is_active 
                        ? '<span style="color: #28a745;">●</span>' 
                        : '<span style="color: #dc3545;">●</span>';
                    return `<div style="margin-bottom: 0.5rem;">${statusBadge} ${daysText}: ${timeText}</div>`;
                }).join('');
                preview.innerHTML = windowsHtml;
            } else {
                preview.innerHTML = '<em>No delivery windows configured</em>';
            }
        } catch (error) {
            console.error('Error loading delivery windows:', error);
            preview.innerHTML = '<em style="color: #dc3545;">Error loading windows</em>';
        }
    }

    // Format days of week array to readable text
    function formatDaysOfWeek(days) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        if (days.length === 7) return 'Every Day';
        if (days.length === 5 && days.every(d => [1,2,3,4,5].includes(d))) return 'Mon-Fri';
        if (days.length === 2 && days.every(d => [0,6].includes(d))) return 'Sat-Sun';
        return days.map(d => dayNames[d]).join(', ');
    }

    // Handle "Manage Windows" button click - navigate to dedicated page
    const manageDeliveryWindowsBtn = document.getElementById('manageDeliveryWindowsBtn');
    if (manageDeliveryWindowsBtn) {
        manageDeliveryWindowsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const locationId = manageDeliveryWindowsBtn.dataset.locationId;
            if (locationId) {
                window.location.href = `/admin/crm/locations/${locationId}/delivery-windows`;
            }
        });
    }

    // === EVENT: Click "Merge Location" button ===
    const mergeLocationBtn = document.getElementById('mergeLocationBtn');
    if (mergeLocationBtn) {
        mergeLocationBtn.addEventListener('click', () => {
            const mergeModal = document.getElementById('mergeLocationModal');
            const mergeDisInput = document.getElementById('mergeDisNumber');
            const mergeWarning = document.getElementById('mergeLocationWarning');
            const mergeWarningText = document.getElementById('mergeLocationWarningText');
            const mergeError = document.getElementById('mergeLocationError');
            const confirmMergeBtn = document.getElementById('confirmMergeLocationBtn');
            const targetBuyerId = mergeLocationBtn.dataset.buyerId;
            
            // Reset modal state
            mergeDisInput.value = '';
            mergeWarning.style.display = 'none';
            mergeError.style.display = 'none';
            confirmMergeBtn.disabled = true;
            confirmMergeBtn.dataset.targetBuyerId = targetBuyerId;
            confirmMergeBtn.dataset.sourceLocationId = '';
            
            // Remove any existing event listeners by cloning the input
            const newMergeDisInput = mergeDisInput.cloneNode(true);
            mergeDisInput.parentNode.replaceChild(newMergeDisInput, mergeDisInput);
            
            // Check DIS number as user types
            let checkTimeout;
            newMergeDisInput.addEventListener('input', () => {
                clearTimeout(checkTimeout);
                const disNumber = newMergeDisInput.value.trim();
                
                if (!disNumber) {
                    mergeWarning.style.display = 'none';
                    mergeError.style.display = 'none';
                    confirmMergeBtn.disabled = true;
                    confirmMergeBtn.dataset.sourceLocationId = '';
                    return;
                }
                
                checkTimeout = setTimeout(async () => {
                    try {
                        const response = await fetch(`/api/crm/locations/check-dis?disNumber=${encodeURIComponent(disNumber)}`);
                        const data = await response.json();
                        
                        if (data.success && data.exists) {
                            const location = data.location;
                            if (Number(location.buyer_id) === Number(targetBuyerId)) {
                                mergeWarning.style.display = 'block';
                                mergeWarningText.textContent = `This DIS number already belongs to a location in this buyer's account.`;
                                confirmMergeBtn.disabled = true;
                                confirmMergeBtn.dataset.sourceLocationId = '';
                            } else {
                                mergeWarning.style.display = 'block';
                                mergeWarningText.textContent = `This licence/DIS number is allocated to another buyer: "${location.buyer_name}". Do you want to move it to this buyer?`;
                                confirmMergeBtn.disabled = false;
                                confirmMergeBtn.dataset.sourceLocationId = location.location_id;
                            }
                            mergeError.style.display = 'none';
                        } else {
                            mergeWarning.style.display = 'none';
                            mergeError.style.display = 'block';
                            mergeError.textContent = 'DIS number not found. Please check the number and try again.';
                            confirmMergeBtn.disabled = true;
                            confirmMergeBtn.dataset.sourceLocationId = '';
                        }
                    } catch (err) {
                        console.error('Error checking DIS number:', err);
                        mergeError.style.display = 'block';
                        mergeError.textContent = 'Failed to check DIS number. Please try again.';
                        confirmMergeBtn.disabled = true;
                        confirmMergeBtn.dataset.sourceLocationId = '';
                    }
                }, 500);
            });
            
            openModal(mergeModal);
            // Focus the input field
            setTimeout(() => newMergeDisInput.focus(), 100);
        });
    }

    // === EVENT DELEGATION: Clicks inside the locations table ===
    if (locationsTableBody) {
        locationsTableBody.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            const locationId = target.dataset.locationId;

            if (action === 'edit-location') {
                locationForm.reset();
                locationModalTitle.textContent = `Edit ${target.dataset.locationName}`;
                locationForm.setAttribute('data-method', 'PATCH');
                locationForm.setAttribute('data-action', `/api/crm/locations/${locationId}`);
                locationIdField.value = locationId;

                // Check if user is fulfillment user (read-only mode)
                const isFulfillmentUser = window.isFulfillmentUser === true || window.isFulfillmentUser === 'true';
                
                // Populate all fields
                document.getElementById('locationName').value = target.dataset.locationName || '';
                document.getElementById('locationLineOne').value = target.dataset.locationLine_one || '';
                document.getElementById('locationLineTwo').value = target.dataset.locationLine_two || '';
                document.getElementById('locationCity').value = target.dataset.locationCity || '';
                document.getElementById('locationState').value = target.dataset.locationState || '';
                document.getElementById('locationZip').value = target.dataset.locationZip || '';
                document.getElementById('locationLicense').value = target.dataset.locationState_license || '';
                document.getElementById('locationDeliveryZone').value = target.dataset.locationDelivery_zone || '';
                
                // Make all fields except delivery_zone read-only for fulfillment users
                if (isFulfillmentUser) {
                    document.getElementById('locationName').readOnly = true;
                    document.getElementById('locationLineOne').readOnly = true;
                    document.getElementById('locationLineTwo').readOnly = true;
                    document.getElementById('locationCity').readOnly = true;
                    document.getElementById('locationState').readOnly = true;
                    document.getElementById('locationZip').readOnly = true;
                    document.getElementById('locationLicense').readOnly = true;
                    // locationDeliveryZone remains editable
                    
                    // Show read-only notice
                    let notice = document.getElementById('locationFulfillmentNotice');
                    if (!notice) {
                        notice = document.createElement('div');
                        notice.id = 'locationFulfillmentNotice';
                        notice.style.cssText = 'padding: 1rem; background: #e3f2fd; color: #1976d2; border-radius: 4px; margin-bottom: 1rem; font-size: 0.9rem;';
                        notice.innerHTML = '<i class="fas fa-info-circle"></i> <strong>Read-Only Mode:</strong> Fulfillment users can only edit the Delivery Zone field.';
                        const modalBody = document.querySelector('#locationModal .modal-body');
                        if (modalBody) {
                            modalBody.insertBefore(notice, modalBody.firstChild);
                        }
                    }
                    notice.style.display = 'block';
                } else {
                    // Remove read-only restrictions for non-fulfillment users
                    document.getElementById('locationName').readOnly = false;
                    document.getElementById('locationLineOne').readOnly = false;
                    document.getElementById('locationLineTwo').readOnly = false;
                    document.getElementById('locationCity').readOnly = false;
                    document.getElementById('locationState').readOnly = false;
                    document.getElementById('locationZip').readOnly = false;
                    document.getElementById('locationLicense').readOnly = false;
                    
                    // Hide notice if it exists
                    const notice = document.getElementById('locationFulfillmentNotice');
                    if (notice) {
                        notice.style.display = 'none';
                    }
                }

                // Show delivery windows section for existing locations
                const deliveryWindowsSection = document.getElementById('deliveryWindowsSection');
                const manageWindowsBtn = document.getElementById('manageDeliveryWindowsBtn');
                if (deliveryWindowsSection && manageWindowsBtn) {
                    deliveryWindowsSection.style.display = 'block';
                    manageWindowsBtn.dataset.locationId = locationId;
                    manageWindowsBtn.href = `/admin/crm/locations/${locationId}/delivery-windows`;
                    loadDeliveryWindowsPreview(locationId);
                }

                locationFormError.style.display = 'none';
                openModal(locationModal);
            }

            if (action === 'manage-limits') {
                document.body.classList.add('modal-open');
                handleManageLimitsClick(locationId, target.dataset.locationName);
            }

            if (action === 'delete-location') {
                const confirmationModal = document.querySelector('#confirmationModal');
                const modalTitle = confirmationModal.querySelector('#modalTitle');
                const modalText = confirmationModal.querySelector('#modalText');
                const modalForm = confirmationModal.querySelector('#modalConfirmForm');

                modalTitle.textContent = 'Delete Location?';
                modalText.textContent = `Are you sure you want to delete the "${target.dataset.locationName}" location?`;
                modalForm.action = `/api/crm/locations/${locationId}`;
                modalForm.setAttribute('data-method', 'DELETE');
                modalForm.setAttribute('data-target-row', `[data-location-id="${locationId}"]`);
                openModal(confirmationModal);
            }
        });
    }

    // === EVENT: Confirm Merge Location Button ===
    const confirmMergeLocationBtn = document.getElementById('confirmMergeLocationBtn');
    if (confirmMergeLocationBtn) {
        confirmMergeLocationBtn.addEventListener('click', async () => {
            // Use sourceLocationId from the DIS check (the location that will be moved)
            const locationId = confirmMergeLocationBtn.dataset.sourceLocationId;
            const targetBuyerId = confirmMergeLocationBtn.dataset.targetBuyerId;
            const mergeDisInput = document.getElementById('mergeDisNumber');
            const mergeError = document.getElementById('mergeLocationError');
            const mergeWarning = document.getElementById('mergeLocationWarning');
            const mergeModal = document.getElementById('mergeLocationModal');
            
            // If mergeDisInput was replaced, get the new one
            const disInput = mergeDisInput || document.getElementById('mergeDisNumber');
            const disNumber = disInput ? disInput.value.trim() : '';
            
            if (!disNumber) {
                mergeError.style.display = 'block';
                mergeError.textContent = 'Please enter a DIS number';
                return;
            }
            
            if (!locationId || !targetBuyerId) {
                mergeError.style.display = 'block';
                mergeError.textContent = 'Missing location or buyer information. Please check the DIS number again.';
                return;
            }
            
            // Disable button during request
            confirmMergeLocationBtn.disabled = true;
            confirmMergeLocationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Moving...';
            mergeError.style.display = 'none';
            
            try {
                const response = await fetch(`/api/crm/locations/${locationId}/move`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        targetBuyerId: targetBuyerId,
                        disNumber: disNumber
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Show success message
                    if (typeof showNotification !== 'undefined') {
                        showNotification(data.message || 'Location moved successfully', 'success');
                    } else {
                        alert(data.message || 'Location moved successfully');
                    }
                    
                    // Close modal
                    closeModal(mergeModal, 'force');
                    
                    // Reload page to show updated locations
                    window.location.reload();
                } else {
                    mergeError.style.display = 'block';
                    mergeError.textContent = data.message || data.error || 'Failed to move location';
                    confirmMergeLocationBtn.disabled = false;
                    confirmMergeLocationBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> Move Location';
                }
            } catch (err) {
                console.error('Error moving location:', err);
                mergeError.style.display = 'block';
                mergeError.textContent = 'Failed to move location. Please try again.';
                confirmMergeLocationBtn.disabled = false;
                confirmMergeLocationBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> Move Location';
            }
        });
    }

    // === EVENT: Check DIS number when typing in location license field ===
    if (locationLicenseInput) {
        let checkDisTimeout;
        locationLicenseInput.addEventListener('input', () => {
            clearTimeout(checkDisTimeout);
            const disNumber = locationLicenseInput.value.trim();
            const method = locationForm.getAttribute('data-method');
            
            // Only check for new locations (POST), not edits
            if (method !== 'POST' || !disNumber) {
                locationFormWarning.style.display = 'none';
                locationForm.dataset.existingLocationId = '';
                return;
            }
            
            checkDisTimeout = setTimeout(async () => {
                try {
                    const response = await fetch(`/api/crm/locations/check-dis?disNumber=${encodeURIComponent(disNumber)}`);
                    const data = await response.json();
                    
                    if (data.success && data.exists) {
                        const location = data.location;
                        const targetBuyerId = locationForm.dataset.targetBuyerId;
                        
                        if (Number(location.buyer_id) === Number(targetBuyerId)) {
                            locationFormWarning.style.display = 'block';
                            locationFormWarningText.textContent = `This DIS number already belongs to a location in this buyer's account.`;
                            locationForm.dataset.existingLocationId = '';
                        } else {
                            locationFormWarning.style.display = 'block';
                            locationFormWarningText.textContent = `This licence/DIS number is allocated to another buyer: "${location.buyer_name}". If you continue, this location will be moved to this buyer.`;
                            locationForm.dataset.existingLocationId = location.location_id;
                        }
                    } else {
                        locationFormWarning.style.display = 'none';
                        locationForm.dataset.existingLocationId = '';
                    }
                } catch (err) {
                    console.error('Error checking DIS number:', err);
                    // Don't show error, just continue
                }
            }, 500);
        });
    }

    // === EVENT: Submission of the Add/Edit Location Form ===
    if (locationForm) {
        locationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const action = locationForm.getAttribute('data-action');
            const method = locationForm.getAttribute('data-method');
            const formData = new FormData(locationForm);
            const locationData = Object.fromEntries(formData.entries());
            const existingLocationId = locationForm.dataset.existingLocationId;
            const targetBuyerId = locationForm.dataset.targetBuyerId;

            // If creating new location and DIS belongs to another buyer, move it instead
            if (method === 'POST' && existingLocationId && targetBuyerId) {
                const disNumber = locationData.state_license?.trim();
                if (disNumber) {
                    // Show confirmation
                    const confirmed = confirm(
                        `This DIS number belongs to another buyer. Do you want to move that location to this buyer?\n\n` +
                        `This will move the location and all associated data (invoices, sales reps, etc.) to this buyer.`
                    );
                    
                    if (!confirmed) {
                        return; // User cancelled
                    }
                    
                    // Move the existing location instead of creating new one
                    try {
                        const moveResponse = await fetch(`/api/crm/locations/${existingLocationId}/move`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                targetBuyerId: targetBuyerId,
                                disNumber: disNumber
                            })
                        });
                        
                        const moveData = await moveResponse.json();
                        
                        if (moveData.success) {
                            if (typeof showNotification !== 'undefined') {
                                showNotification(moveData.message || 'Location moved successfully', 'success');
                            } else {
                                alert(moveData.message || 'Location moved successfully');
                            }
                            
                            closeModal(locationModal);
                            window.location.reload();
                            return;
                        } else {
                            throw new Error(moveData.message || moveData.error || 'Failed to move location');
                        }
                    } catch (error) {
                        locationFormError.textContent = `Error: ${error.message}`;
                        locationFormError.style.display = 'block';
                        return;
                    }
                }
            }

            // Normal create/update flow
            try {
                // Remove locationId from data if it's an update (it's in the URL)
                const dataToSend = { ...locationData };
                if (method === 'PATCH') {
                    delete dataToSend.locationId;
                }
                
                const response = await fetch(action, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dataToSend),
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: 'Failed to save location' }));
                    throw new Error(errorData.message || errorData.error || 'Failed to save location');
                }
                
                const resultLocation = await response.json();

                if (method === 'POST') {
                    const emptyMessage = document.getElementById('empty-locations-message');
                    if (emptyMessage) emptyMessage.remove();
                    const newRow = locationsTableBody.insertRow();
                    newRow.dataset.locationId = resultLocation.entry_id;
                    newRow.innerHTML = renderLocationRow(resultLocation);
                } else {
                    const rowToUpdate = locationsTableBody.querySelector(`[data-location-id="${resultLocation.entry_id}"]`);
                    if (rowToUpdate) {
                        rowToUpdate.innerHTML = renderLocationRow(resultLocation);
                    } else {
                        // If row not found, reload page to show updated data
                        window.location.reload();
                        return;
                    }
                }
                closeModal(locationModal);
            } catch (error) {
                console.error('Error saving location:', error);
                locationFormError.textContent = `Error: ${error.message}`;
                locationFormError.style.display = 'block';
                // Scroll to error message
                locationFormError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    }

    if (resetPurchaseLimitBtn) {
        resetPurchaseLimitBtn.addEventListener('click', () => {
            limitOrderInput.value = '';
            limitUnshippedInput.value = '';
            limitUnpaidInput.value = '';
            purchaseLimitError.style.display = 'none';
            purchaseLimitSuccess.style.display = 'none';
        });
    }

    if (purchaseLimitForm) {
        purchaseLimitForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            purchaseLimitError.style.display = 'none';
            purchaseLimitSuccess.style.display = 'none';

            const locationId = purchaseLimitLocationIdField.value;
            if (!locationId) {
                purchaseLimitError.textContent = 'Missing location identifier.';
                purchaseLimitError.style.display = 'block';
                return;
            }

        const payload = {
            max_order_total: limitOrderInput.value === '' ? null : parseInt(limitOrderInput.value, 10),
            max_unshipped_orders: limitUnshippedInput.value === '' ? null : parseInt(limitUnshippedInput.value, 10),
            max_unpaid_invoices: limitUnpaidInput.value === '' ? null : parseInt(limitUnpaidInput.value, 10)
        };

            try {
                const response = await fetch(`/api/crm/locations/${locationId}/purchase-limits`, {
                    method: 'PUT',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Failed to update purchase limits');
                }

                populatePurchaseLimitModal(data);
                purchaseLimitSuccess.textContent = 'Purchase limits updated successfully.';
                purchaseLimitSuccess.style.display = 'block';

                setTimeout(() => {
                    closeModal(purchaseLimitModal, 'force');
                    document.body.classList.remove('modal-open');
                }, 800);

                if (typeof showNotification === 'function') {
                    showNotification('Purchase limits saved', 'success');
                }
            } catch (error) {
                purchaseLimitError.textContent = error.message;
                purchaseLimitError.style.display = 'block';
                console.error('[purchase-limits] error saving limits', error);
                document.body.classList.remove('modal-open');
            }
        });
    }

    // ========================================================
    // ========== NOTE CRUD FUNCTIONALITY =====================
    // ========================================================

    // === DOM ELEMENT SELECTORS (Notes) ===
    const addNoteBtn = document.getElementById('addNoteBtn');
    const noteModal = document.getElementById('noteModal');
    const noteForm = document.getElementById('noteForm');
    const notesList = document.getElementById('notes-list');

    // === MODAL & FORM ELEMENTS (Notes) ===
    const noteModalTitle = document.getElementById('noteModalTitle');
    const noteFormError = document.getElementById('noteFormError');
    const noteIdField = document.getElementById('noteId');
    const noteTitleField = document.getElementById('noteTitle');
    const noteTextField = document.getElementById('noteText');

    // === RENDER FUNCTION (Notes) ===
    const renderNoteListItem = (note) => {
        const formattedDate = new Date(note.created_at).toLocaleString();
        const formattedText = (note.text || '').replace(/\r\n|\r|\n/g, '<br>');
        return `
            <div class="note-header">
                <strong>${note.title || 'Note'}</strong>
                <div class="note-meta">
                    <span class="note-date">${formattedDate}</span>
                    <div class="note-actions">
                        <button class="action-btn" data-action="edit-note"
                            data-note-id="${note.entry_id}"
                            data-note-title="${note.title || ''}"
                            data-note-text="${note.text || ''}">
                            Edit
                        </button>
                        <button class="action-btn" data-action="delete-note"
                            data-note-id="${note.entry_id}"
                            data-note-title="${note.title || 'Note'}">
                            Delete
                        </button>
                    </div>
                </div>
            </div>
            <p class="note-text">${formattedText}</p>
        `;
    };

    // === EVENT: Click "Add Note" button ===
    if (addNoteBtn) {
        addNoteBtn.addEventListener('click', () => {
            noteForm.reset();
            noteModalTitle.textContent = 'Add New Note';
            noteForm.setAttribute('data-method', 'POST');
            noteForm.setAttribute('data-action', `/api/crm/buyers/${addNoteBtn.dataset.buyerId}/notes`);
            noteIdField.value = '';
            noteFormError.style.display = 'none';
            openModal(noteModal);
        });
    }

    // === EVENT DELEGATION: Clicks inside the notes list ===
    if (notesList) {
        notesList.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            const noteId = target.dataset.noteId;

            if (action === 'edit-note') {
                noteForm.reset();
                noteModalTitle.textContent = 'Edit Note';
                noteForm.setAttribute('data-method', 'PATCH');
                noteForm.setAttribute('data-action', `/api/crm/notes/${noteId}`);
                noteIdField.value = noteId;
                noteTitleField.value = target.dataset.noteTitle;
                noteTextField.value = target.dataset.noteText;
                noteFormError.style.display = 'none';
                openModal(noteModal);
            }

            if (action === 'delete-note') {
                const confirmationModal = document.querySelector('#confirmationModal');
                const modalTitle = confirmationModal.querySelector('#modalTitle');
                const modalText = confirmationModal.querySelector('#modalText');
                const modalForm = confirmationModal.querySelector('#modalConfirmForm');

                modalTitle.textContent = 'Delete Note?';
                modalText.textContent = `Are you sure you want to delete the note titled "${target.dataset.noteTitle}"?`;
                modalForm.action = `/api/crm/notes/${noteId}`;
                modalForm.setAttribute('data-method', 'DELETE');
                modalForm.setAttribute('data-target-row', `[data-note-id="${noteId}"]`);
                openModal(confirmationModal);
            }
        });
    }

    // === EVENT: Submission of the Add/Edit Note Form ===
    if (noteForm) {
        noteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const action = noteForm.getAttribute('data-action');
            const method = noteForm.getAttribute('data-method');
            const formData = new FormData(noteForm);
            const noteData = Object.fromEntries(formData.entries());

            try {
                const response = await fetch(action, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(noteData),
                });
                if (!response.ok) throw new Error((await response.json()).message);
                const resultNote = await response.json();

                if (method === 'POST') {
                    const emptyMessage = document.getElementById('empty-notes-message');
                    if (emptyMessage) {
                        emptyMessage.remove();
                        notesList.style.display = '';
                    }
                    const newListItem = document.createElement('li');
                    newListItem.className = 'note-item';
                    newListItem.dataset.noteId = resultNote.entry_id;
                    newListItem.innerHTML = renderNoteListItem(resultNote);
                    notesList.prepend(newListItem);
                } else {
                    const itemToUpdate = notesList.querySelector(`[data-note-id="${resultNote.entry_id}"]`);
                    if (itemToUpdate) itemToUpdate.innerHTML = renderNoteListItem(resultNote);
                }
                closeModal(noteModal);
            } catch (error) {
                noteFormError.textContent = `Error: ${error.message}`;
                noteFormError.style.display = 'block';
            }
        });
    }


    // ========================================================
    // ========== TAG CRUD FUNCTIONALITY ======================
    // ========================================================

    // === DOM SELECTORS (Tags) ===
    const addTagBtn = document.getElementById('addTagBtn');
    const tagModal = document.getElementById('tagModal');
    const tagForm = document.getElementById('tagForm');
    const tagsContainer = document.getElementById('tags-container');

    // === MODAL & FORM FIELDS (Tags) ===
    const tagModalTitle = document.getElementById('tagModalTitle');
    const tagFormError = document.getElementById('tagFormError');
    const tagIdField = document.getElementById('tagId');
    const tagNameField = document.getElementById('tagName');
    const tagColorField = document.getElementById('tagColor');
    const tagBgColorField = document.getElementById('tagBackgroundColor');

    // === RENDER FUNCTION (Tags) ===
    const renderTagPill = (tag) => {
        return `
            <span class="tag-pill" style="background-color: ${tag.background_color || '#e1e4e8'}; color: ${tag.color || '#000'};">
                ${tag.name}
            </span>
            <div class="tag-actions">
                <button class="action-btn" data-action="edit-tag"
                    data-tag-id="${tag.entry_id}"
                    data-tag-name="${tag.name}"
                    data-tag-color="${tag.color || '#000000'}"
                    data-tag-background_color="${tag.background_color || '#e1e4e8'}">
                    Edit
                </button>
                <button class="action-btn" data-action="delete-tag"
                    data-tag-id="${tag.entry_id}"
                    data-tag-name="${tag.name}">
                    Del
                </button>
            </div>
        `;
    };

    // === EVENT: Click "Add Tag" button ===
    if (addTagBtn) {
        addTagBtn.addEventListener('click', () => {
            tagForm.reset();
            tagModalTitle.textContent = 'Add New Tag';
            tagForm.setAttribute('data-method', 'POST');
            tagForm.setAttribute('data-action', `/api/crm/buyers/${addTagBtn.dataset.buyerId}/tags`);
            tagIdField.value = '';
            tagFormError.style.display = 'none';
            openModal(tagModal);
        });
    }

    // === EVENT DELEGATION: Clicks inside the tags container ===
    if (tagsContainer) {
        tagsContainer.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            const tagId = target.dataset.tagId;

            if (action === 'edit-tag') {
                tagForm.reset();
                tagModalTitle.textContent = `Edit ${target.dataset.tagName}`;
                tagForm.setAttribute('data-method', 'PATCH');
                tagForm.setAttribute('data-action', `/api/crm/tags/${tagId}`);
                tagIdField.value = tagId;
                tagNameField.value = target.dataset.tagName;
                tagColorField.value = target.dataset.tagColor;
                tagBgColorField.value = target.dataset.tagBackground_color;
                tagFormError.style.display = 'none';
                openModal(tagModal);
            }

            if (action === 'delete-tag') {
                const confirmationModal = document.querySelector('#confirmationModal');
                const modalForm = confirmationModal.querySelector('#modalConfirmForm');
                confirmationModal.querySelector('#modalTitle').textContent = 'Delete Tag?';
                confirmationModal.querySelector('#modalText').textContent = `Are you sure you want to remove the "${target.dataset.tagName}" tag?`;
                modalForm.action = `/api/crm/tags/${tagId}`;
                modalForm.setAttribute('data-method', 'DELETE');
                modalForm.setAttribute('data-target-row', `[data-tag-id="${tagId}"]`);
                openModal(confirmationModal);
            }
        });
    }

    // === EVENT: Submission of Add/Edit Tag Form ===
    if (tagForm) {
        tagForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const action = tagForm.getAttribute('data-action');
            const method = tagForm.getAttribute('data-method');
            const formData = new FormData(tagForm);
            const tagData = Object.fromEntries(formData.entries());

            try {
                const response = await fetch(action, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(tagData),
                });
                if (!response.ok) throw new Error((await response.json()).message);
                const resultTag = await response.json();

                if (method === 'POST') {
                    document.getElementById('empty-tags-message')?.remove();
                    const newPill = document.createElement('div');
                    newPill.className = 'tag-pill-wrapper';
                    newPill.dataset.tagId = resultTag.entry_id;
                    newPill.innerHTML = renderTagPill(resultTag);
                    tagsContainer.appendChild(newPill);
                } else {
                    const pillToUpdate = tagsContainer.querySelector(`[data-tag-id="${resultTag.entry_id}"]`);
                    if (pillToUpdate) pillToUpdate.innerHTML = renderTagPill(resultTag);
                }
                closeModal(tagModal);
            } catch (error) {
                tagFormError.textContent = `Error: ${error.message}`;
                tagFormError.style.display = 'block';
            }
        });
    }


    // ========================================================
    // ========== SALES REP CRUD FUNCTIONALITY ==============
    // ========================================================

    // === DOM ELEMENT SELECTORS (Sales Reps) ===
    const assignRepBtn = document.getElementById('assignRepBtn');
    const salesRepModal = document.getElementById('salesRepModal');
    const salesRepForm = document.getElementById('salesRepForm');
    const salesRepsTableBody = document.getElementById('sales-reps-table-body');

    // === MODAL & FORM ELEMENTS (Sales Reps) ===
    const salesRepFormError = document.getElementById('salesRepFormError');

    // === PREVENT OUTSIDE CLICK CLOSING FOR SALES REP MODAL ===
    // Sales rep modal should only close on Cancel button click, not on outside click
    if (salesRepModal) {
        // Set attribute to prevent closing on outside click (handled by modal.js and handleModalOverlayClick)
        salesRepModal.setAttribute('data-no-close-on-outside-click', 'true');
        
        // Multiple layers of protection: prevent any click events on the overlay from closing
        // Use capture phase to catch event before other handlers
        salesRepModal.addEventListener('click', (e) => {
            if (e.target === salesRepModal) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return false; // Prevent default behavior
            }
        }, true); // Capture phase - runs before bubbling phase
        
        // Also prevent in bubbling phase as backup
        salesRepModal.addEventListener('click', (e) => {
            if (e.target === salesRepModal) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return false;
            }
        }, false); // Bubbling phase
    }

    // === RENDER FUNCTION (Sales Reps) ===
    const renderSalesRepRow = (rep) => {
        // this rep object is the result from the API after assigning
        return `
            <td>${rep.name || ''}</td>
            <td>${rep.email || 'N/A'}</td>
            <td>${rep.phone || 'N/A'}</td>
            <td class="table-actions">
                <button class="action-btn" data-action="unassign-rep"
                    data-assignment-id="${rep.assignment_id}"
                    data-rep-name="${rep.name || ''}">
                    Delete
                </button>
            </td>
        `;
    };

    // === EVENT: Click "Assign Rep" button ===
    if (assignRepBtn) {
        assignRepBtn.addEventListener('click', async () => {
            salesRepFormError.style.display = 'none';
            salesRepFormError.textContent = '';
            
            const buyerId = assignRepBtn.dataset.buyerId;
            
            // Set form action first
            salesRepForm.setAttribute('data-action', `/api/crm/locations/assign-sales-rep`);
            
            // Open modal first so the select element is accessible
            openModal(salesRepModal);
            
            // Wait a bit for modal to be fully rendered
            await new Promise(resolve => setTimeout(resolve, 150));
            
            // Load locations using EXACT same pattern as portal-access page
            // Get select element from WITHIN the sales rep modal (not the hidden input from location modal)
            const locationSelect = salesRepModal.querySelector('select#locationId');
            if (!locationSelect) {
                console.error('Location select element not found in sales rep modal!');
                if (salesRepFormError) {
                    salesRepFormError.textContent = 'Error: Location dropdown not found';
                    salesRepFormError.style.display = 'block';
                }
                return;
            }
            
            // Reset sales rep select
            const salesRepIdSelect = salesRepModal.querySelector('select#salesRepId');
            if (salesRepIdSelect) {
                salesRepIdSelect.value = '';
            }
            
            // EXACT same code as portal-access loadLocations function
            locationSelect.innerHTML = '<option value="">Loading locations...</option>';
            locationSelect.disabled = true;
            
            if (!buyerId) {
                locationSelect.innerHTML = '<option value="">Select a location...</option>';
                locationSelect.disabled = true;
                return;
            }
            
            try {
                console.log(`Fetching locations for buyer ${buyerId}...`);
                const response = await fetch(`/admin/api/portal-access/buyers/${buyerId}/locations`);
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const data = await response.json();
                console.log('Locations API response:', data);
                
                // Get fresh reference to select element from WITHIN the sales rep modal
                const salesRepModal = document.getElementById('salesRepModal');
                if (!salesRepModal) {
                    console.error('Sales rep modal not found!');
                    return;
                }
                
                // Find the select element within the modal (not the hidden input from location modal)
                const freshLocationSelect = salesRepModal.querySelector('select#locationId');
                if (!freshLocationSelect) {
                    console.error('Location select element not found in sales rep modal!');
                    return;
                }
                
                // Verify it's actually a select element
                if (freshLocationSelect.tagName !== 'SELECT') {
                    console.error('locationId element is not a SELECT element:', freshLocationSelect.tagName);
                    return;
                }
                
                // Use innerHTML approach exactly like portal-access.ejs
                freshLocationSelect.innerHTML = '<option value="">Select a location...</option>';
                
                if (data.success && data.locations && Array.isArray(data.locations) && data.locations.length > 0) {
                    console.log(`Loading ${data.locations.length} locations into dropdown`);
                    
                    // Build options HTML string
                    let optionsHTML = '<option value="">Select a location...</option>';
                    data.locations.forEach(location => {
                        if (location && location.id) {
                            let displayText = location.name || 'Unnamed Location';
                            if (location.state_license) {
                                displayText += ` | ${location.state_license}`;
                            }
                            optionsHTML += `<option value="${location.id}">${displayText}</option>`;
                        }
                    });
                    
                    // Set all options at once using innerHTML
                    freshLocationSelect.innerHTML = optionsHTML;
                    
                    // Enable the select
                    freshLocationSelect.disabled = false;
                    freshLocationSelect.removeAttribute('disabled');
                    
                    // Verify options were added (use querySelectorAll as fallback)
                    let optionsCount = 0;
                    try {
                        if (freshLocationSelect.options && freshLocationSelect.options.length) {
                            optionsCount = freshLocationSelect.options.length;
                        } else {
                            const optionElements = freshLocationSelect.querySelectorAll('option');
                            optionsCount = optionElements ? optionElements.length : 0;
                        }
                        console.log('Locations loaded successfully. Total options:', optionsCount);
                        
                        if (optionsCount > 0 && freshLocationSelect.options) {
                            try {
                                const optionsArray = Array.from(freshLocationSelect.options);
                                console.log('Options array:', optionsArray.map(opt => ({value: opt.value, text: opt.textContent})));
                            } catch (e) {
                                console.warn('Could not log options array:', e);
                            }
                        }
                    } catch (e) {
                        console.warn('Error checking options:', e);
                        // Just count the options we added
                        optionsCount = data.locations.length + 1; // +1 for the default option
                    }
                    
                    // Ensure the first option (placeholder) is selected
                    if (optionsCount > 0) {
                        try {
                            freshLocationSelect.selectedIndex = 0;
                        } catch (e) {
                            console.warn('Could not set selectedIndex:', e);
                        }
                        // Force a repaint
                        freshLocationSelect.style.display = 'none';
                        freshLocationSelect.offsetHeight; // Trigger reflow
                        freshLocationSelect.style.display = '';
                    }
                } else {
                    console.warn('No locations found for buyer. Data:', data);
                    freshLocationSelect.innerHTML = '<option value="">No locations found for this buyer</option>';
                    freshLocationSelect.disabled = true;
                }
            } catch (error) {
                console.error('Error loading locations:', error);
                const errorModal = document.getElementById('salesRepModal');
                if (errorModal) {
                    const errorLocationSelect = errorModal.querySelector('select#locationId');
                    if (errorLocationSelect) {
                        errorLocationSelect.innerHTML = '<option value="">Error loading locations</option>';
                        errorLocationSelect.disabled = true;
                    }
                }
                if (salesRepFormError) {
                    salesRepFormError.textContent = `Failed to load locations: ${error.message || 'Unknown error'}`;
                    salesRepFormError.style.display = 'block';
                }
            }
        });
    }

    // === EVENT DELEGATION: Clicks inside the sales reps table ===
    if (salesRepsTableBody) {
        salesRepsTableBody.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action="unassign-rep"]');
            if (!target) return;

            const assignmentId = target.dataset.assignmentId;
            const assignmentType = target.dataset.assignmentType || 'buyer';
            const locationId = target.dataset.locationId;
            const repName = target.dataset.repName;

            const confirmationModal = document.querySelector('#confirmationModal');
            const modalTitle = confirmationModal.querySelector('#modalTitle');
            const modalText = confirmationModal.querySelector('#modalText');
            const modalForm = confirmationModal.querySelector('#modalConfirmForm');

            modalTitle.textContent = 'Unassign Sales Rep?';
            modalText.textContent = `Are you sure you want to unassign ${repName} from this ${assignmentType === 'location' ? 'location' : 'buyer'}?`;
            
            // For location assignments, we need to clear the assigned_sales_rep_id from the location
            // For buyer assignments, we delete from the assignments table
            if (assignmentType === 'location' && locationId) {
                modalForm.action = `/api/crm/locations/${locationId}/unassign-sales-rep`;
            } else {
                modalForm.action = `/api/crm/sales-reps/assignments/${assignmentId}`;
            }
            modalForm.setAttribute('data-method', 'DELETE');
            modalForm.setAttribute('data-target-row', `[data-assignment-id="${assignmentId}"]`);
            modalForm.setAttribute('data-assignment-type', assignmentType);
            openModal(confirmationModal);
        });
    }

    // === EVENT: Submission of the Assign Rep Form ===
    if (salesRepForm) {
        salesRepForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const action = salesRepForm.getAttribute('data-action');
            const formData = new FormData(salesRepForm);
            const assignmentData = Object.fromEntries(formData.entries());

            // Validate location and sales rep are selected
            if (!assignmentData.locationId) {
                salesRepFormError.textContent = 'Please select a location';
                salesRepFormError.style.display = 'block';
                return;
            }

            if (!assignmentData.salesRepId) {
                salesRepFormError.textContent = 'Please select a sales representative';
                salesRepFormError.style.display = 'block';
                return;
            }

            try {
                const response = await fetch(action, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(assignmentData),
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Failed to assign rep to location.');
                }

                const result = await response.json();

                // Show success message and reload page to see updated assignments
                alert('Sales representative assigned to location successfully!');
                closeModal(salesRepModal, 'force');
                window.location.reload();
            } catch (error) {
                salesRepFormError.textContent = `Error: ${error.message}`;
                salesRepFormError.style.display = 'block';
            }
        });
    }

    // ========================================================
    // ========== GENERIC DELETE CONFIRMATION =================
    // ========================================================
    const confirmationForm = document.getElementById('modalConfirmForm');
    if (confirmationForm) {
        confirmationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const action = confirmationForm.action;
            const method = confirmationForm.dataset.method;
            const targetRowSelector = confirmationForm.dataset.targetRow;
            const itemToDelete = document.querySelector(targetRowSelector);
            const container = itemToDelete?.parentElement;

            try {
                const response = await fetch(action, { method: method });
                if (!response.ok && response.status !== 204) throw new Error('Failed to delete');

                if (itemToDelete) itemToDelete.remove();

                if (container && container.children.length === 0) {
                    if (container.id === 'contacts-table-body') {
                        container.innerHTML = `<tr id="empty-contacts-message"><td colspan="5" class="empty-state">No contacts found for this buyer.</td></tr>`;
                    } else if (container.id === 'locations-table-body') {
                        container.innerHTML = `<tr id="empty-locations-message"><td colspan="5" class="empty-state">No locations found for this buyer.</td></tr>`;
                    } else if (container.id === 'sales-reps-table-body') {
                        // gotta handle the empty state for reps too
                        container.innerHTML = `<tr id="empty-reps-message"><td colspan="4" class="empty-state">No sales reps assigned.</td></tr>`;
                    } else if (container.id === 'notes-list') {
                        const cardBody = container.closest('.card-body');
                        cardBody.innerHTML = `<div id="empty-notes-message"><p class="empty-state">No notes found for this buyer.</p></div><ul class="notes-list" id="notes-list" style="display: none;"></ul>`;
                    }
                }
                closeModal(document.getElementById('confirmationModal'));
            } catch (error) {
                if (typeof notify !== 'undefined') {
                    notify.error(`Error: ${error.message}`);
                } else {
                    alert(`Error: ${error.message}`);
                }
            }
        });
    }

    // === DISCOUNT ASSIGNMENTS FUNCTIONALITY ===
    const buyerId = document.querySelector('[data-buyer-id]')?.dataset?.buyerId || 
                    window.location.pathname.match(/\/buyers\/(\d+)/)?.[1];
    
    if (buyerId) {
        // Initialize drag-and-drop for discount assignments
        const assignmentsContainer = document.getElementById('discountAssignmentsContainer');
        if (assignmentsContainer) {
            initAssignmentDragAndDrop(assignmentsContainer, buyerId);
        }

        // Handle assign discount button
        const assignDiscountBtn = document.getElementById('assignDiscountBtn');
        const assignDiscountSelect = document.getElementById('assignDiscountSelect');
        if (assignDiscountBtn && assignDiscountSelect) {
            assignDiscountBtn.addEventListener('click', async () => {
                await assignDiscountToBuyer(buyerId);
            });
        }

        // Handle edit assignment button clicks - need to get discount ID from assignment card
        document.querySelectorAll('[data-edit-assignment]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const assignmentId = btn.dataset.editAssignment;
                const discountId = btn.dataset.assignmentDiscountId;
                const name = btn.dataset.assignmentName;
                if (!discountId) {
                    if (typeof notify !== 'undefined') {
                        notify.error('Discount ID not found');
                    } else {
                        alert('Discount ID not found');
                    }
                    return;
                }
                await openEditAssignmentModal(buyerId, assignmentId, discountId, name);
            });
        });

        // Handle unassign assignment button clicks
        document.querySelectorAll('[data-unassign-assignment]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const assignmentId = btn.dataset.unassignAssignment;
                const assignmentName = btn.dataset.assignmentName;
                confirmUnassignAssignment(buyerId, assignmentId, assignmentName);
            });
        });

        // Handle edit assignment form submission
        const editAssignmentForm = document.getElementById('editAssignmentForm');
        if (editAssignmentForm) {
            editAssignmentForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await saveRule(buyerId);
            });
        }
        
        // Handle applies_to change
        const editRuleAppliesTo = document.getElementById('editRuleAppliesTo');
        if (editRuleAppliesTo) {
            editRuleAppliesTo.addEventListener('change', (e) => {
                handleEditRuleAppliesChange(e.target.value);
            });
        }

        // Close modal handlers
        document.querySelectorAll('[data-close-modal]').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = document.getElementById('editAssignmentModal');
                if (modal) closeModal(modal);
            });
        });
    }

    async function assignDiscountToBuyer(buyerId) {
        const select = document.getElementById('assignDiscountSelect');
        const discountId = parseInt(select.value, 10);
        
        if (!discountId) {
            if (typeof notify !== 'undefined') {
                notify.error('Please select a discount to assign');
            } else {
                alert('Please select a discount to assign');
            }
            return;
        }

        try {
            const res = await fetch(`/api/v1/discounts/buyers/${buyerId}/assignments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ discount_id: discountId })
            });
            
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to assign discount');
            }
            
            // Reset select and reload page to show new assignment
            select.value = '';
            window.location.reload();
        } catch (error) {
            console.error('Error assigning discount:', error);
            if (typeof notify !== 'undefined') {
                notify.error(error.message || 'Failed to assign discount');
            } else {
                alert(error.message || 'Failed to assign discount');
            }
        }
    }

    async function openEditAssignmentModal(buyerId, assignmentId, discountId, name) {
        const modal = document.getElementById('editAssignmentModal');
        if (!modal) return;
        
        document.getElementById('editAssignmentId').value = assignmentId;
        document.getElementById('editDiscountId').value = discountId;
        document.getElementById('editAssignmentName').value = name;
        document.getElementById('editAssignmentError').style.display = 'none';
        
        // Fetch discount details with rules
        try {
            const res = await fetch(`/api/v1/discounts/codes/${discountId}`);
            const data = await res.json();
            if (!data.success || !data.discount) {
                throw new Error('Failed to load discount details');
            }
            
            const discount = data.discount;
            const rules = discount.rules || [];
            
            // If discount has rules, edit the first one (or we could show a list)
            if (rules.length > 0) {
                const rule = rules[0]; // Edit first rule
                populateRuleModal(rule);
            } else {
                // No rules, show empty form
                resetRuleModal();
            }
            
            openModal(modal);
        } catch (error) {
            console.error('Error loading discount:', error);
            if (typeof notify !== 'undefined') {
                notify.error('Failed to load discount details');
            } else {
                alert('Failed to load discount details');
            }
        }
    }
    
    function populateRuleModal(rule) {
        document.getElementById('editRuleId').value = rule.id || '';
        document.getElementById('editRuleAppliesTo').value = rule.applies_to || 'Entire_Order';
        document.getElementById('editRuleAction').value = rule.action || 'Percentage_Off';
        document.getElementById('editRuleValue').value = rule.value || '';
        
        if (rule.category_name) {
            document.getElementById('editRuleCategory').value = rule.category_name;
        }
        if (rule.fk_master_product_id) {
            document.getElementById('editRuleProduct').value = rule.fk_master_product_id;
        }
        if (rule.metadata) {
            const metadataValue = typeof rule.metadata === 'string' ? rule.metadata : JSON.stringify(rule.metadata);
            document.getElementById('editRuleMetadata').value = metadataValue;
        }
        
        // Handle applies_to change to show/hide fields
        handleEditRuleAppliesChange(rule.applies_to);
        
        // Populate dropdowns
        populateEditRuleDropdowns();
    }
    
    function resetRuleModal() {
        document.getElementById('editRuleId').value = '';
        document.getElementById('editRuleAppliesTo').value = 'Entire_Order';
        document.getElementById('editRuleAction').value = 'Percentage_Off';
        document.getElementById('editRuleValue').value = '';
        document.getElementById('editRuleCategory').value = '';
        document.getElementById('editRuleProduct').value = '';
        document.getElementById('editRuleMetadata').value = '';
        handleEditRuleAppliesChange('Entire_Order');
        populateEditRuleDropdowns();
    }
    
    function handleEditRuleAppliesChange(value) {
        const appliesTo = value || document.getElementById('editRuleAppliesTo').value;
        document.getElementById('editRuleCategoryField').style.display = appliesTo === 'Specific_Category' ? 'block' : 'none';
        document.getElementById('editRuleProductField').style.display = appliesTo === 'Specific_Product' ? 'block' : 'none';
    }
    
    function populateEditRuleDropdowns() {
        const crmData = window.CRM_DISCOUNT_DATA || {};
        const categories = crmData.categories || [];
        const products = crmData.products || [];
        
        const categorySelect = document.getElementById('editRuleCategory');
        if (categorySelect) {
            categorySelect.innerHTML = '<option value="">Select category…</option>' + 
                categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
        }
        
        const productSelect = document.getElementById('editRuleProduct');
        if (productSelect) {
            productSelect.innerHTML = '<option value="">Select product…</option>' + 
                products.map(p => `<option value="${p.product_id}">${p.name || p.product_id}</option>`).join('');
        }
    }

    async function saveRule(buyerId) {
        const ruleId = document.getElementById('editRuleId').value;
        const discountId = document.getElementById('editDiscountId').value;
        const errorDiv = document.getElementById('editAssignmentError');
        
        if (!discountId) {
            errorDiv.textContent = 'Discount ID is missing';
            errorDiv.style.display = 'block';
            return;
        }
        
        const formData = new FormData(document.getElementById('editAssignmentForm'));
        const payload = {
            applies_to: formData.get('applies_to'),
            action: formData.get('action'),
            value: parseFloat(formData.get('value')),
            category_name: formData.get('category_name') || null,
            fk_master_product_id: formData.get('fk_master_product_id') || null,
            metadata: formData.get('metadata') || null
        };
        
        if (Number.isNaN(payload.value)) {
            errorDiv.textContent = 'Value must be a number';
            errorDiv.style.display = 'block';
            return;
        }
        
        if (payload.metadata) {
            try {
                payload.metadata = JSON.parse(payload.metadata);
            } catch (err) {
                errorDiv.textContent = 'Metadata must be valid JSON';
                errorDiv.style.display = 'block';
                return;
            }
        }
        
        if (payload.fk_master_product_id) {
            payload.fk_master_product_id = parseInt(payload.fk_master_product_id, 10);
        }

        try {
            let res;
            if (ruleId) {
                // Update existing rule
                res = await fetch(`/api/v1/discounts/rules/${ruleId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } else {
                // Create new rule
                res = await fetch(`/api/v1/discounts/codes/${discountId}/rules`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            }
            
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to save rule');
            }
            
            // Reload the page to show updated data
            window.location.reload();
        } catch (error) {
            errorDiv.textContent = error.message || 'Failed to save rule';
            errorDiv.style.display = 'block';
        }
    }

    function initAssignmentDragAndDrop(container, buyerId) {
        let draggedElement = null;
        
        container.querySelectorAll('.assignment-card').forEach((item) => {
            item.addEventListener('dragstart', (e) => {
                draggedElement = item;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            
            item.addEventListener('dragend', async () => {
                item.classList.remove('dragging');
                if (draggedElement) {
                    await saveAssignmentOrder(container, buyerId);
                }
                draggedElement = null;
            });
            
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                
                const afterElement = getDragAfterElement(container, e.clientY, '.assignment-card');
                if (afterElement == null) {
                    container.appendChild(draggedElement);
                } else {
                    container.insertBefore(draggedElement, afterElement);
                }
            });
            
            item.addEventListener('drop', (e) => {
                e.preventDefault();
            });
        });
    }

    function getDragAfterElement(container, y, selector) {
        const draggableElements = [...container.querySelectorAll(`${selector}:not(.dragging)`)];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    async function saveAssignmentOrder(container, buyerId) {
        const assignments = Array.from(container.querySelectorAll('.assignment-card'));
        const ordering = assignments.map(card => parseInt(card.dataset.assignmentId, 10));
        
        try {
            const res = await fetch(`/api/v1/discounts/buyers/${buyerId}/assignments/reorder`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ordering })
            });
            
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to reorder assignments');
            }
            
            // Reload to show updated priorities
            window.location.reload();
        } catch (error) {
            console.error('Error saving assignment order:', error);
            if (typeof notify !== 'undefined') {
                notify.error('Failed to save order. Please refresh the page.');
            } else {
                alert('Failed to save order. Please refresh the page.');
            }
        }
    }

    function confirmUnassignAssignment(buyerId, assignmentId, assignmentName) {
        if (!confirm(`Are you sure you want to unassign "${assignmentName}" from this buyer?`)) {
            return;
        }
        
        unassignDiscount(buyerId, assignmentId);
    }

    async function unassignDiscount(buyerId, assignmentId) {
        try {
            const res = await fetch(`/api/v1/discounts/buyers/${buyerId}/assignments/${assignmentId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to unassign discount');
            }
            
            // Reload page to show updated assignments
            window.location.reload();
        } catch (error) {
            console.error('Error unassigning discount:', error);
            if (typeof notify !== 'undefined') {
                notify.error(error.message || 'Failed to unassign discount');
            } else {
                alert(error.message || 'Failed to unassign discount');
            }
        }
    }

    // === DELIVERY WINDOWS MANAGEMENT ===
    // Note: Delivery windows management is now handled on a dedicated page
    // This function only loads the preview for the location modal
});