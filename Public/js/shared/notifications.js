/**
 * Professional Toast Notification System
 * Usage: showNotification('Message', 'success|error|warning|info')
 */

const NotificationSystem = {
    /**
     * Show a toast notification
     * @param {string} message - The message to display
     * @param {string} type - success, error, warning, info
     * @param {number} duration - Duration in milliseconds (default: 3000)
     */
    show: function(message, type = 'info', duration = 3000) {
        // Create notification container if it doesn't exist
        let container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            container.className = 'notification-container';
            document.body.appendChild(container);
        }

        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type} notification-enter`;

        // Icon based on type
        const icons = {
            success: '<i class="fas fa-check-circle"></i>',
            error: '<i class="fas fa-exclamation-circle"></i>',
            warning: '<i class="fas fa-exclamation-triangle"></i>',
            info: '<i class="fas fa-info-circle"></i>'
        };

        notification.innerHTML = `
            ${icons[type] || icons.info}
            <span class="notification-message">${message}</span>
            <button class="notification-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;

        container.appendChild(notification);

        // Trigger enter animation
        setTimeout(() => {
            notification.classList.remove('notification-enter');
        }, 10);

        // Auto remove after duration
        if (duration > 0) {
            setTimeout(() => {
                this.remove(notification);
            }, duration);
        }

        return notification;
    },

    /**
     * Remove a notification with animation
     */
    remove: function(notification) {
        notification.classList.add('notification-exit');
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 300);
    },

    /**
     * Show success notification
     */
    success: function(message, duration = 3000) {
        return this.show(message, 'success', duration);
    },

    /**
     * Show error notification
     */
    error: function(message, duration = 5000) {
        return this.show(message, 'error', duration);
    },

    /**
     * Show warning notification
     */
    warning: function(message, duration = 4000) {
        return this.show(message, 'warning', duration);
    },

    /**
     * Show info notification
     */
    info: function(message, duration = 3000) {
        return this.show(message, 'info', duration);
    },

    /**
     * Show confirmation dialog (replacement for window.confirm)
     */
    confirm: function(message, title = 'Confirm Action') {
        return new Promise((resolve) => {
            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'notification-overlay';
            
            // Create modal
            const modal = document.createElement('div');
            modal.className = 'notification-modal';
            modal.innerHTML = `
                <div class="notification-modal-header">
                    <i class="fas fa-question-circle text-warning"></i>
                    <h3>${title}</h3>
                </div>
                <div class="notification-modal-body">
                    <p>${message}</p>
                </div>
                <div class="notification-modal-footer">
                    <button class="btn btn-secondary notification-cancel">Cancel</button>
                    <button class="btn btn-primary notification-confirm">Confirm</button>
                </div>
            `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            // Trigger animation
            setTimeout(() => overlay.classList.add('active'), 10);

            // Handle buttons
            const remove = () => {
                overlay.classList.remove('active');
                setTimeout(() => overlay.remove(), 300);
            };

            modal.querySelector('.notification-cancel').onclick = () => {
                remove();
                resolve(false);
            };

            modal.querySelector('.notification-confirm').onclick = () => {
                remove();
                resolve(true);
            };

            // Click outside to cancel
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    remove();
                    resolve(false);
                }
            };
        });
    },

    /**
     * Show loading notification (stays until manually removed)
     */
    loading: function(message = 'Loading...') {
        const notification = this.show(
            `<i class="fas fa-spinner fa-spin mr-2"></i>${message}`,
            'info',
            0 // Don't auto-remove
        );
        notification.classList.add('notification-loading');
        return notification;
    }
};

// Expose globally
window.showNotification = NotificationSystem.show.bind(NotificationSystem);
window.notify = NotificationSystem;

