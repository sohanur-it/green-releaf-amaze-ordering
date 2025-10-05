// Public/js/admin/buyer-profile.js

document.addEventListener('DOMContentLoaded', () => {
    // === HELPER: Open any modal ===
    const openModal = (modal) => {
        if (!modal) return;
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
    };

    // === HELPER: Close any modal ===
    const closeModal = (modal) => {
        if (!modal) return;
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    };

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
        return `
            <td>${location.name || ''}</td>
            <td>${address}</td>
            <td>${location.state_license || 'N/A'}</td>
            <td class="table-actions">
                <button class="action-btn" data-action="edit-location"
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
                <button class="action-btn" data-action="delete-location"
                    data-location-id="${location.entry_id}"
                    data-location-name="${location.name || ''}">
                    Delete
                </button>
            </td>
        `;
    };

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

                //explicitly set the value for each field using its correct ID.
                //this is more verbose but 100% reliable.
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
            const tableBody = document.querySelector(targetRowSelector)?.closest('tbody');

            try {
                const response = await fetch(action, { method: method });
                if (!response.ok && response.status !== 204) throw new Error('Failed to delete');

                const rowToDelete = document.querySelector(targetRowSelector);
                if (rowToDelete) rowToDelete.remove();

                if (tableBody && tableBody.rows.length === 0) {
                    let emptyMessage = '';
                    let colSpan = 5;
                    if (tableBody.id === 'contacts-table-body') {
                        emptyMessage = `<tr id="empty-contacts-message"><td colspan="${colSpan}" class="empty-state">No contacts found for this buyer.</td></tr>`;
                    } else if (tableBody.id === 'locations-table-body') {
                        colSpan = 4;
                        emptyMessage = `<tr id="empty-locations-message"><td colspan="${colSpan}" class="empty-state">No locations found for this buyer.</td></tr>`;
                    }
                    tableBody.innerHTML = emptyMessage;
                }
                closeModal(document.getElementById('confirmationModal'));
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
        });
    }
});