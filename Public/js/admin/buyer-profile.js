// Public/js/admin/buyer-profile.js

document.addEventListener('DOMContentLoaded', () => {
    const canManagePurchaseLimits = window.canManagePurchaseLimits === true || window.canManagePurchaseLimits === 'true';
    // === HELPER: Open any modal ===
    const openModal = (modal) => {
        if (!modal) return;
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        modal.style.display = 'flex';
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
                    data-location-state_license="${location.state_license || ''}">
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
            locationFormError.style.display = 'none';
            openModal(locationModal);
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

                document.getElementById('locationName').value = target.dataset.locationName || '';
                document.getElementById('locationLineOne').value = target.dataset.locationLine_one || '';
                document.getElementById('locationLineTwo').value = target.dataset.locationLine_two || '';
                document.getElementById('locationCity').value = target.dataset.locationCity || '';
                document.getElementById('locationState').value = target.dataset.locationState || '';
                document.getElementById('locationZip').value = target.dataset.locationZip || '';
                document.getElementById('locationLicense').value = target.dataset.locationState_license || '';

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

    // === EVENT: Submission of the Add/Edit Location Form ===
    if (locationForm) {
        locationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const action = locationForm.getAttribute('data-action');
            const method = locationForm.getAttribute('data-method');
            const formData = new FormData(locationForm);
            const locationData = Object.fromEntries(formData.entries());

            try {
                const response = await fetch(action, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(locationData),
                });
                if (!response.ok) throw new Error((await response.json()).message);
                const resultLocation = await response.json();

                if (method === 'POST') {
                    const emptyMessage = document.getElementById('empty-locations-message');
                    if (emptyMessage) emptyMessage.remove();
                    const newRow = locationsTableBody.insertRow();
                    newRow.dataset.locationId = resultLocation.entry_id;
                    newRow.innerHTML = renderLocationRow(resultLocation);
                } else {
                    const rowToUpdate = locationsTableBody.querySelector(`[data-location-id="${resultLocation.entry_id}"]`);
                    if (rowToUpdate) rowToUpdate.innerHTML = renderLocationRow(resultLocation);
                }
                closeModal(locationModal);
            } catch (error) {
                locationFormError.textContent = `Error: ${error.message}`;
                locationFormError.style.display = 'block';
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
});