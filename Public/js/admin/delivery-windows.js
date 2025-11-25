// Public/js/admin/delivery-windows.js
// Delivery Windows Management Page

document.addEventListener('DOMContentLoaded', () => {
    loadWindows();
    setupEventListeners();
    
    // Also attach event listeners when windows are loaded (for dynamically created buttons)
    // This is handled in loadWindows() after rendering
});

/**
 * Load delivery windows
 */
async function loadWindows() {
    const list = document.getElementById('windowsList');
    if (!list) return;
    
    list.innerHTML = '<div class="loading" style="text-align: center; padding: 2rem; color: var(--text-light);"><i class="fas fa-spinner fa-spin"></i> Loading windows...</div>';
    
    try {
        const response = await fetch(`/api/crm/locations/${window.locationId}/delivery-windows`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to load delivery windows');
        }
        
        if (!data.windows || data.windows.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-clock" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                    <p>No delivery windows configured.</p>
                    <p style="color: var(--text-light);">Click "Add Window" to create one.</p>
                </div>
            `;
            return;
        }
        
        list.innerHTML = data.windows.map(window => {
            const statusClass = window.is_active ? 'active' : 'inactive';
            const statusBadge = window.is_active 
                ? '<span style="color: #28a745; margin-right: 0.5rem;">●</span>' 
                : '<span style="color: #dc3545; margin-right: 0.5rem;">●</span>';
            const statusText = window.is_active ? 'Active' : 'Inactive';
            const windowDataAttr = encodeURIComponent(JSON.stringify(window));
            
            return `
                <div class="window-item ${statusClass}">
                    <div class="window-info">
                        <h3>${statusBadge}${window.days_display || formatDaysOfWeek(window.days_of_week)}</h3>
                        <div class="window-details">
                            <span><strong>Time:</strong> ${window.start_time} - ${window.end_time}</span>
                            <span><strong>Status:</strong> ${statusText}</span>
                            <span><strong>Sort Order:</strong> ${window.sort_order || 0}</span>
                        </div>
                    </div>
                    <div class="window-actions">
                        <button type="button" class="btn btn-sm btn-secondary edit-window-btn" data-window-id="${window.id}" data-window-data="${windowDataAttr}">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button type="button" class="btn btn-sm btn-danger delete-window-btn" data-window-id="${window.id}">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        // Attach event listeners to edit/delete buttons
        list.querySelectorAll('.edit-window-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const windowData = JSON.parse(decodeURIComponent(btn.dataset.windowData));
                editWindow(btn.dataset.windowId, windowData);
            });
        });
        
        list.querySelectorAll('.delete-window-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                deleteWindow(btn.dataset.windowId);
            });
        });
        
    } catch (error) {
        console.error('Error loading delivery windows:', error);
        list.innerHTML = `<div class="alert alert-danger">Error loading windows: ${error.message}</div>`;
    }
}

/**
 * Format days of week array to readable text
 */
function formatDaysOfWeek(days) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (days.length === 7) return 'Every Day';
    if (days.length === 5 && days.every(d => [1,2,3,4,5].includes(d))) return 'Mon-Fri';
    if (days.length === 2 && days.every(d => [0,6].includes(d))) return 'Sat-Sun';
    return days.map(d => dayNames[d]).join(', ');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    const toggleFormBtn = document.getElementById('toggleFormBtn');
    const cancelFormBtn = document.getElementById('cancelFormBtn');
    const saveWindowBtn = document.getElementById('saveWindowBtn');
    
    if (toggleFormBtn) {
        toggleFormBtn.addEventListener('click', () => {
            showForm();
        });
    }
    
    if (cancelFormBtn) {
        cancelFormBtn.addEventListener('click', () => {
            hideForm();
        });
    }
    
    if (saveWindowBtn) {
        saveWindowBtn.addEventListener('click', saveWindow);
    }
}

/**
 * Show form
 */
function showForm(windowData = null) {
    const form = document.getElementById('windowForm');
    const title = document.getElementById('formTitle');
    const windowId = document.getElementById('windowId');
    const toggleBtn = document.getElementById('toggleFormBtn');
    
    if (!form) return;
    
    if (windowData) {
        title.textContent = 'Edit Delivery Window';
        windowId.value = windowData.id;
        
        // Set days
        document.querySelectorAll('.day-checkbox').forEach(cb => {
            cb.checked = windowData.days_of_week.includes(parseInt(cb.value));
        });
        
        // Set times
        document.getElementById('startTime').value = windowData.start_time;
        document.getElementById('endTime').value = windowData.end_time;
        
        // Set active status
        document.getElementById('isActive').checked = windowData.is_active !== false;
        
        // Set sort order
        document.getElementById('sortOrder').value = windowData.sort_order || 0;
    } else {
        title.textContent = 'Add Delivery Window';
        windowId.value = '';
        document.querySelectorAll('.day-checkbox').forEach(cb => cb.checked = false);
        document.getElementById('startTime').value = '';
        document.getElementById('endTime').value = '';
        document.getElementById('isActive').checked = true;
        document.getElementById('sortOrder').value = 0;
    }
    
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    
    if (toggleBtn) {
        toggleBtn.style.display = 'none';
    }
}

/**
 * Hide form
 */
function hideForm() {
    const form = document.getElementById('windowForm');
    const toggleBtn = document.getElementById('toggleFormBtn');
    
    if (form) form.style.display = 'none';
    if (toggleBtn) toggleBtn.style.display = 'block';
    
    hideMessages();
}

/**
 * Save window
 */
async function saveWindow() {
    const windowId = document.getElementById('windowId').value;
    const selectedDays = Array.from(document.querySelectorAll('.day-checkbox:checked')).map(cb => parseInt(cb.value));
    const startTime = document.getElementById('startTime').value;
    const endTime = document.getElementById('endTime').value;
    const isActive = document.getElementById('isActive').checked;
    const sortOrder = parseInt(document.getElementById('sortOrder').value) || 0;
    
    if (selectedDays.length === 0) {
        showMessage('Please select at least one day of the week', 'error');
        return;
    }
    
    if (!startTime || !endTime) {
        showMessage('Please enter both start and end times', 'error');
        return;
    }
    
    try {
        const url = windowId 
            ? `/api/crm/delivery-windows/${windowId}`
            : `/api/crm/locations/${window.locationId}/delivery-windows`;
        const method = windowId ? 'PATCH' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                daysOfWeek: selectedDays,
                startTime: startTime,
                endTime: endTime,
                isActive: isActive,
                sortOrder: sortOrder
            })
        });
        
        // Handle 204 No Content
        if (response.status === 204) {
            showMessage(windowId ? 'Window updated successfully' : 'Window created successfully', 'success');
            hideForm();
            loadWindows();
            return;
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to save window');
        }
        
        showMessage(windowId ? 'Window updated successfully' : 'Window created successfully', 'success');
        hideForm();
        loadWindows();
        
    } catch (error) {
        console.error('Error saving window:', error);
        showMessage(error.message || 'Failed to save window', 'error');
    }
}

/**
 * Edit window (global function for onclick handlers)
 */
window.editWindow = function(windowId, windowData) {
    if (typeof windowData === 'string') {
        try {
            windowData = JSON.parse(decodeURIComponent(windowData));
        } catch (e) {
            console.error('Error parsing window data:', e);
            return;
        }
    }
    if (!windowData) {
        console.error('Window data is required');
        return;
    }
    showForm(windowData);
};

/**
 * Delete window (global function for onclick handlers)
 */
window.deleteWindow = async function(windowId) {
    if (!confirm('Are you sure you want to delete this delivery window?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/crm/delivery-windows/${windowId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });
        
        // Handle 204 No Content
        if (response.status === 204) {
            showMessage('Window deleted successfully', 'success');
            loadWindows();
            return;
        }
        
        if (!response.ok) {
            const text = await response.text();
            let errorMessage = 'Failed to delete window';
            
            try {
                const data = JSON.parse(text);
                errorMessage = data.error || data.message || errorMessage;
            } catch (e) {
                errorMessage = text || `Server returned ${response.status}`;
            }
            
            throw new Error(errorMessage);
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to delete window');
            }
        }
        
        showMessage('Window deleted successfully', 'success');
        loadWindows();
        
    } catch (error) {
        console.error('Error deleting window:', error);
        showMessage(error.message || 'Failed to delete window', 'error');
    }
};

/**
 * Show message
 */
function showMessage(message, type = 'success') {
    const successDiv = document.getElementById('successMessage');
    const errorDiv = document.getElementById('errorMessage');
    
    if (successDiv) successDiv.style.display = 'none';
    if (errorDiv) errorDiv.style.display = 'none';
    
    if (type === 'success' && successDiv) {
        successDiv.textContent = message;
        successDiv.style.display = 'block';
    } else if (type === 'error' && errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        hideMessages();
    }, 5000);
}

/**
 * Hide messages
 */
function hideMessages() {
    const successDiv = document.getElementById('successMessage');
    const errorDiv = document.getElementById('errorMessage');
    if (successDiv) successDiv.style.display = 'none';
    if (errorDiv) errorDiv.style.display = 'none';
}

