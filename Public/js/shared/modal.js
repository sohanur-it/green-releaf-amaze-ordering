// Public/js/shared/modal.js

document.addEventListener('DOMContentLoaded', () => {
    //find all buttons that are supposed to open a modal
    const openModalButtons = document.querySelectorAll('[data-modal-target]');
    //find all buttons that are supposed to close a modal
    const closeModalButtons = document.querySelectorAll('[data-close-modal]');
    const overlay = document.querySelector('.modal-overlay');

    //when you click a button to open a modal...
    openModalButtons.forEach(button => {
        button.addEventListener('click', () => {
            const modal = document.querySelector(button.dataset.modalTarget);
            if (modal) {
                openModal(modal, button.dataset);
            }
        });
    });

    // when you click the overlay (the dark background), close the modal
    // Use event delegation to handle all modal overlays
    // Use capture phase to catch events early
    document.addEventListener('click', e => {
        const overlay = e.target.closest('.modal-overlay');
        if (overlay && e.target === overlay) {
            // Check if this modal should not close on outside click
            if (overlay.dataset.noCloseOnOutsideClick === 'true') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return false; // Don't close this modal
            }
            closeModal(overlay);
        }
    }, true); // Use capture phase

    // when you click a close button (like the 'x' or 'cancel')...
    closeModalButtons.forEach(button => {
        button.addEventListener('click', () => {
            const modal = button.closest('.modal-overlay');
            if (modal) {
                // Force close when clicking close button (even for protected modals)
                closeModal(modal, 'force');
            }
        });
    });

    function openModal(modal, dataset) {
        if (modal === null) return;
        // get all the data from the button and put it in the modal
        const modalTitle = modal.querySelector('#modalTitle');
        const modalText = modal.querySelector('#modalText');
        const modalForm = modal.querySelector('#modalConfirmForm');

        //update the modal content based on the button's data attributes. slick.
        if (modalTitle && dataset.modalTitle) modalTitle.textContent = dataset.modalTitle;
        if (modalText && dataset.modalText) modalText.textContent = dataset.modalText;
        if (modalForm && dataset.modalFormAction) modalForm.action = dataset.modalFormAction;

        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
    }

    function closeModal(modal, force = false) {
        if (modal === null) return;
        // Check if this modal should not close on outside click
        if (modal.dataset.noCloseOnOutsideClick === 'true' && force !== 'force') {
            // Don't close if this is a protected modal unless explicitly forced
            return;
        }
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }
});