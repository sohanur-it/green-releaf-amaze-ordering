// Public/js/admin/sales-reps.js

document.addEventListener('DOMContentLoaded', () => {
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

    // === DOM SELECTORS ===
    const addRepBtn = document.getElementById('addRepBtn');
    const crudModal = document.getElementById('salesRepCrudModal');
    const crudForm = document.getElementById('salesRepCrudForm');
    const tableBody = document.getElementById('reps-table-body');

    // === Handle modal overlay click (close on backdrop) ===
    // This modal should NOT close on outside click - only on Cancel/Close button
    if (crudModal) {
        crudModal.addEventListener('click', (e) => {
            // Only close if clicking directly on the overlay, not the dialog
            if (e.target === crudModal && !e.target.closest('.modal-dialog')) {
                // Prevent closing - this modal is protected
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return false;
            }
        });
    }

    // === Close modal on close button click ===
    // Only attach to buttons within our specific modal to avoid conflicts
    if (crudModal) {
        crudModal.querySelectorAll('[data-close-modal]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Force close when clicking close button (even for protected modals)
                closeModal(crudModal, 'force');
            });
        });
    }

    // === FORM & MODAL FIELDS ===
    const modalTitle = document.getElementById('salesRepCrudModalTitle');
    const formError = document.getElementById('salesRepCrudFormError');
    const repIdField = document.getElementById('repId');
    const repNameField = document.getElementById('repName');
    const repEmailField = document.getElementById('repEmail');
    const repPhoneField = document.getElementById('repPhone');

    // === RENDER FUNCTION ===
    //this makes a new table row or updates an old one. so we dont repeat code.
    const renderRepRow = (rep) => {
        return `
            <td>${rep.name}</td>
            <td>${rep.email || 'N/A'}</td>
            <td>${rep.phone || 'N/A'}</td>
            <td class="table-actions">
                <button class="action-btn" data-action="edit-rep"
                    data-rep-id="${rep.entry_id}"
                    data-rep-name="${rep.name}"
                    data-rep-email="${rep.email || ''}"
                    data-rep-phone="${rep.phone || ''}">
                    Edit
                </button>
                <button class="action-btn" data-action="delete-rep"
                    data-rep-id="${rep.entry_id}"
                    data-rep-name="${rep.name}">
                    Delete
                </button>
            </td>
        `;
    };

    // === EVENT LISTENERS ===

    // Click "Add New Rep"
    if (addRepBtn) {
        addRepBtn.addEventListener('click', () => {
            crudForm.reset();
            const modalTitleText = document.getElementById('modalTitleText');
            const saveButtonText = document.getElementById('saveButtonText');
            const userAccountSection = document.getElementById('userAccountSection');
            
            if (modalTitleText) modalTitleText.textContent = 'Add New Rep';
            if (saveButtonText) saveButtonText.textContent = 'Save Rep';
            
            // Show user account section for new reps
            if (userAccountSection) {
                userAccountSection.style.display = 'block';
            }
            
            crudForm.setAttribute('data-method', 'POST');
            crudForm.setAttribute('data-action', '/api/crm/sales-reps');
            repIdField.value = '';
            formError.style.display = 'none';
            openModal(crudModal);
        });
    }

    // Clicks inside the table (for Edit and Delete)
    if (tableBody) {
        tableBody.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            const repId = target.dataset.repId;
            const repName = target.dataset.repName;

            if (action === 'edit-rep') {
                crudForm.reset();
                const modalTitleText = document.getElementById('modalTitleText');
                const saveButtonText = document.getElementById('saveButtonText');
                const userAccountSection = document.getElementById('userAccountSection');
                
                if (modalTitleText) modalTitleText.textContent = `Edit ${repName}`;
                if (saveButtonText) saveButtonText.textContent = 'Update Rep';
                
                // Hide user account section when editing
                if (userAccountSection) {
                    userAccountSection.style.display = 'none';
                }
                
                crudForm.setAttribute('data-method', 'PATCH');
                crudForm.setAttribute('data-action', `/api/crm/sales-reps/${repId}`);
                repIdField.value = repId;
                repNameField.value = repName;
                repEmailField.value = target.dataset.repEmail;
                repPhoneField.value = target.dataset.repPhone;
                formError.style.display = 'none';
                openModal(crudModal);
            }

            if (action === 'delete-rep') {
                const confirmationModal = document.querySelector('#confirmationModal');
                const modalForm = confirmationModal.querySelector('#modalConfirmForm');
                confirmationModal.querySelector('#modalTitle').textContent = 'Delete Sales Rep?';
                confirmationModal.querySelector('#modalText').textContent = `Are you sure you want to delete ${repName}? This will unassign them from all buyers.`;
                modalForm.action = `/api/crm/sales-reps/${repId}`;
                modalForm.setAttribute('data-method', 'DELETE');
                modalForm.setAttribute('data-target-row', `[data-rep-id="${repId}"]`);
                openModal(confirmationModal);
            }
        });
    }

    // Form submission for Add/Edit
    if (crudForm) {
        crudForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const action = crudForm.getAttribute('data-action');
            const method = crudForm.getAttribute('data-method');
            const formData = new FormData(crudForm);
            const repData = Object.fromEntries(formData.entries());

            // Hide any previous errors
            formError.style.display = 'none';
            formError.textContent = '';

            try {
                const response = await fetch(action, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(repData),
                });
                
                const responseData = await response.json();
                console.log('Sales rep API response:', responseData);
                
                if (!response.ok) {
                    throw new Error(responseData.message || responseData.error || 'Failed to save sales rep');
                }

                // Success - update table and close modal
                if (method === 'POST') { // if we added a new one
                    // Check if response has entry_id
                    if (!responseData.entry_id) {
                        console.warn('Response missing entry_id, reloading page:', responseData);
                        // Reload page to ensure we have the latest data
                        window.location.reload();
                        return;
                    }
                    
                    document.getElementById('empty-reps-message')?.remove();
                    const newRow = tableBody.insertRow();
                    newRow.dataset.repId = responseData.entry_id;
                    newRow.innerHTML = renderRepRow(responseData);
                    
                    // Show success notification
                    if (typeof notify !== 'undefined') {
                        notify.success('Sales rep created successfully!');
                    } else {
                        alert('Sales rep created successfully!');
                    }
                } else { // if we edited one
                    if (!responseData.entry_id) {
                        console.warn('Response missing entry_id, reloading page:', responseData);
                        // Reload page to ensure we have the latest data
                        window.location.reload();
                        return;
                    }
                    
                    const rowToUpdate = tableBody.querySelector(`[data-rep-id="${responseData.entry_id}"]`);
                    if (rowToUpdate) {
                        rowToUpdate.innerHTML = renderRepRow(responseData);
                    } else {
                        // Row not found, reload page to sync
                        console.warn('Row not found for entry_id, reloading page');
                        window.location.reload();
                        return;
                    }
                    
                    // Show success notification
                    if (typeof notify !== 'undefined') {
                        notify.success('Sales rep updated successfully!');
                    } else {
                        alert('Sales rep updated successfully!');
                    }
                }
                
                // Reset form
                crudForm.reset();
                
                // Close modal only on success (force close after successful submission)
                closeModal(crudModal, 'force');
            } catch (error) {
                // Show error but keep modal open
                formError.textContent = `Error: ${error.message || 'An unexpected error occurred'}`;
                formError.style.display = 'block';
                
                // Scroll to error message
                formError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                
                console.error('Error saving sales rep:', error);
            }
        });
    }

    // Generic delete confirmation form
    const confirmationForm = document.getElementById('modalConfirmForm');
    if (confirmationForm) {
        confirmationForm.addEventListener('submit', async (e) => {
            // we only handle the rep deletes here, the other page handles its own stuff
            if (!confirmationForm.action.includes('/api/crm/sales-reps/')) return;

            e.preventDefault();
            const action = confirmationForm.action;
            const targetRowSelector = confirmationForm.dataset.targetRow;
            const itemToDelete = document.querySelector(targetRowSelector);

            try {
                const response = await fetch(action, { method: 'DELETE' });
                if (!response.ok) throw new Error('Failed to delete.');

                itemToDelete?.remove();
                if (tableBody.children.length === 0) {
                    tableBody.innerHTML = `<tr id="empty-reps-message"><td colspan="4" class="empty-state">No sales reps found.</td></tr>`;
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