// Notification utility
// Reusable notification banner for displaying messages

/**
 * Show a notification banner
 * @param {string} message - Message to display
 * @param {string} type - Notification type: 'info', 'success', 'warning', 'error'
 * @param {number} duration - Auto-dismiss duration in ms (0 = no auto-dismiss)
 * @param {Function} onAction - Optional callback for action button
 * @param {string} actionText - Text for action button
 */
function showNotification(message, type = 'info', duration = 10000, onAction = null, actionText = 'View Next') {
    const banner = document.getElementById('notification-banner');
    if (!banner) return;

    // Clear existing content
    banner.innerHTML = '';
    banner.className = `notification-banner notification-${type}`;

    // Create message element
    const messageEl = document.createElement('span');
    messageEl.className = 'notification-message';
    messageEl.textContent = message;
    banner.appendChild(messageEl);

    // Create action button if callback provided
    if (onAction) {
        const actionBtn = document.createElement('button');
        actionBtn.className = 'notification-action';
        actionBtn.textContent = actionText;
        actionBtn.onclick = onAction;
        banner.appendChild(actionBtn);
    }

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'notification-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => hideNotification();
    banner.appendChild(closeBtn);

    // Show banner
    banner.style.display = 'flex';

    // Auto-dismiss if duration > 0
    if (duration > 0) {
        setTimeout(() => {
            // Only hide if the banner is still showing the same message
            if (banner.querySelector('.notification-message')?.textContent === message) {
                hideNotification();
                // Leave a small indicator to re-show
                showNotificationIndicator(message, type, onAction, actionText);
            }
        }, duration);
    }
}

/**
 * Hide notification banner
 */
function hideNotification() {
    const banner = document.getElementById('notification-banner');
    if (banner) {
        banner.style.display = 'none';
    }
}

/**
 * Show a small indicator after auto-dismiss
 * @param {string} message - Original message
 * @param {string} type - Notification type
 * @param {Function} onAction - Action callback
 * @param {string} actionText - Action button text
 */
function showNotificationIndicator(message, type, onAction, actionText) {
    const banner = document.getElementById('notification-banner');
    if (!banner) return;

    banner.innerHTML = '';
    banner.className = `notification-banner notification-indicator notification-${type}`;

    const indicatorBtn = document.createElement('button');
    indicatorBtn.className = 'notification-indicator-btn';
    indicatorBtn.textContent = '🔔 New notification';
    indicatorBtn.onclick = () => {
        showNotification(message, type, 0, onAction, actionText);
    };
    banner.appendChild(indicatorBtn);

    banner.style.display = 'flex';
}

/**
 * Show a success message
 * @param {string} message - Success message
 * @param {number} duration - Auto-dismiss duration
 */
function showSuccess(message, duration = 3000) {
    showNotification(message, 'success', duration);
}

/**
 * Show an error message
 * @param {string} message - Error message
 * @param {number} duration - Auto-dismiss duration
 */
function showError(message, duration = 0) {
    showNotification(message, 'error', duration);
}

/**
 * Show a warning message
 * @param {string} message - Warning message
 * @param {number} duration - Auto-dismiss duration
 */
function showWarning(message, duration = 5000) {
    showNotification(message, 'warning', duration);
}

/**
 * Show an info message
 * @param {string} message - Info message
 * @param {number} duration - Auto-dismiss duration
 * @param {Function} onAction - Action callback
 * @param {string} actionText - Action button text
 */
function showInfo(message, duration = 10000, onAction = null, actionText = 'View Next') {
    showNotification(message, 'info', duration, onAction, actionText);
}
