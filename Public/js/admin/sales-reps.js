// Public/js/admin/sales-reps.js

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

    // === DOM SELECTORS ===
    const addRepBtn = document.getElementById('addRepBtn');
    const crudModal = document.getElementById('salesRepCrudModal');
    const crudForm = document.getElementById('salesRepCrudForm');
    const tableBody = document.getElementById('reps-table-body');

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
            modalTitle.textContent = 'Add New Rep';
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
                modalTitle.textContent = `Edit ${repName}`;
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
            const action = crudForm.getAttribute('data-action');
            const method = crudForm.getAttribute('data-method');
            const formData = new FormData(crudForm);
            const repData = Object.fromEntries(formData.entries());

            try {
                const response = await fetch(action, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(repData),
                });
                if (!response.ok) throw new Error((await response.json()).message);
                const resultRep = await response.json();

                if (method === 'POST') { // if we added a new one
                    document.getElementById('empty-reps-message')?.remove();
                    const newRow = tableBody.insertRow();
                    newRow.dataset.repId = resultRep.entry_id;
                    newRow.innerHTML = renderRepRow(resultRep);
                } else { // if we edited one
                    const rowToUpdate = tableBody.querySelector(`[data-rep-id="${resultRep.entry_id}"]`);
                    if (rowToUpdate) rowToUpdate.innerHTML = renderRepRow(resultRep);
                }
                closeModal(crudModal);
            } catch (error) {
                formError.textContent = `Error: ${error.message}`;
                formError.style.display = 'block';
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