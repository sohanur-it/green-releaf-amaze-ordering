// Public/js/admin/fulfillment-sessions-admin.js
// Admin Session Management

let currentFilters = {
    worker_id: '',
    duration_min: ''
};
let currentSessionId = null;

document.addEventListener('DOMContentLoaded', () => {
    loadSessions();
    setInterval(loadSessions, 30000); // Auto-refresh every 30 seconds
});

/**
 * Load active sessions
 */
async function loadSessions() {
    const tbody = document.getElementById('sessions-tbody');
    
    try {
        const params = new URLSearchParams(currentFilters);
        const response = await fetch(`/api/v1/admin/fulfillment/sessions?${params}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load sessions');
        }

        renderSessions(data.sessions || []);

    } catch (error) {
        console.error('Error loading sessions:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 2rem; color: #ef4444;">
                    Error: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * Render sessions table
 */
function renderSessions(sessions) {
    const tbody = document.getElementById('sessions-tbody');

    if (sessions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 2rem;">
                    No active scanning sessions
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = sessions.map(session => {
        const duration = Math.round(parseFloat(session.session_duration_minutes) || 0);
        const progress = session.total_packages_scanned && session.total_packages_needed
            ? `${session.total_packages_scanned} / ${session.total_packages_needed}`
            : 'N/A';
        const progressPercent = session.total_packages_needed > 0
            ? Math.round((session.total_packages_scanned / session.total_packages_needed) * 100)
            : 0;

        return `
            <tr>
                <td><strong>${session.invoice_number}</strong></td>
                <td>${session.worker_name || 'Unknown'}</td>
                <td>${duration} min</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span>${progress}</span>
                        <div style="width: 100px; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
                            <div style="width: ${progressPercent}%; height: 100%; background: #3b82f6;"></div>
                        </div>
                    </div>
                </td>
                <td>${new Date(session.last_activity).toLocaleString()}</td>
                <td>
                    <button class="btn-action btn-view" onclick="viewSession(${session.session_id})">
                        <i class="fas fa-eye"></i> View
                    </button>
                    <button class="btn-action btn-force-complete" onclick="showForceCompleteModal(${session.session_id})">
                        <i class="fas fa-ban"></i> Force Complete
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Apply filters
 */
function applyFilters() {
    currentFilters = {
        worker_id: document.getElementById('worker-filter').value,
        duration_min: document.getElementById('duration-filter').value
    };
    loadSessions();
}

/**
 * View session details
 */
function viewSession(sessionId) {
    window.location.href = `/admin/fulfillment/scanning/${sessionId}`;
}

/**
 * Show force complete modal
 */
function showForceCompleteModal(sessionId) {
    currentSessionId = sessionId;
    document.getElementById('force-complete-modal').classList.add('active');
    const form = document.getElementById('force-complete-form');
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    document.getElementById('force-complete-form').addEventListener('submit', handleForceComplete);
}

/**
 * Close force complete modal
 */
function closeForceCompleteModal() {
    document.getElementById('force-complete-modal').classList.remove('active');
    currentSessionId = null;
}

/**
 * Handle force complete
 */
async function handleForceComplete(e) {
    e.preventDefault();
    
    const reason = document.getElementById('force-complete-reason').value;
    
    if (!reason.trim()) {
        alert('Please provide a reason');
        return;
    }
    
    try {
        const response = await fetch(`/api/v1/admin/fulfillment/sessions/${currentSessionId}/force-complete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                reason: reason
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to force complete session');
        }
        
        alert('Session force-completed successfully');
        closeForceCompleteModal();
        loadSessions();
        
    } catch (error) {
        console.error('Error force completing session:', error);
        alert(`Error: ${error.message}`);
    }
}

