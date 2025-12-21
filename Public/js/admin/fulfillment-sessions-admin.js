// Public/js/admin/fulfillment-sessions-admin.js
// Admin Session Management

let currentFilters = {
    worker_id: '',
    duration_min: '',
    sortBy: 'last_activity', // 3.6.3: Add sort options
    sortOrder: 'desc'
};
let currentSessionId = null;
let currentJsonSessionId = null;

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
        
        // 3.4.3: Update abandoned sessions count
        if (data.abandoned_sessions_count !== undefined) {
            document.getElementById('stat-abandoned-sessions').textContent = data.abandoned_sessions_count;
        }
        document.getElementById('stat-active-sessions').textContent = data.sessions?.length || 0;

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
                    <button class="btn-action btn-view" onclick="viewSession(${session.id || session.session_id})">
                        <i class="fas fa-eye"></i> View
                    </button>
                    <button class="btn-action btn-force-complete" onclick="showForceCompleteModal(${session.id || session.session_id})">
                        <i class="fas fa-ban"></i> Force Complete
                    </button>
                    <!-- 3.6.4: Add JSON editor button -->
                    <button class="btn-action" style="background: #8b5cf6; color: white;" onclick="showJsonEditorModal(${session.id || session.session_id})" title="Edit Session Data">
                        <i class="fas fa-code"></i> Edit JSON
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
        duration_min: document.getElementById('duration-filter').value,
        sortBy: document.getElementById('sort-by')?.value || 'last_activity', // 3.6.3
        sortOrder: document.getElementById('sort-order')?.value || 'desc'
    };
    loadSessions();
}

/**
 * View session details
 */
async function viewSession(sessionId) {
    try {
        // Get invoice ID from session
        const response = await fetch(`/api/v1/admin/fulfillment/sessions`);
        const data = await response.json();
        
        if (response.ok && data.sessions) {
            const session = data.sessions.find(s => (s.id || s.session_id) === sessionId);
            if (session && session.invoice_id) {
                window.location.href = `/admin/fulfillment/scanning/${session.invoice_id}`;
                return;
            }
        }
        
        // Fallback: try to use sessionId as invoiceId (for backward compatibility)
        window.location.href = `/admin/fulfillment/scanning/${sessionId}`;
    } catch (error) {
        console.error('Error getting session details:', error);
        // Fallback: try to use sessionId as invoiceId
        window.location.href = `/admin/fulfillment/scanning/${sessionId}`;
    }
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

/**
 * 3.6.4: Show JSON editor modal
 */
async function showJsonEditorModal(sessionId) {
    currentJsonSessionId = sessionId;
    
    try {
        // Fetch current session data
        const response = await fetch(`/api/v1/admin/fulfillment/sessions`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to load session data');
        }
        
        const session = data.sessions?.find(s => s.id === sessionId);
        if (!session) {
            throw new Error('Session not found');
        }
        
        // Populate form
        document.getElementById('json-session-id').value = sessionId;
        document.getElementById('json-locked-packages').value = JSON.stringify(
            session.currently_locked_packages || [], 
            null, 
            2
        );
        document.getElementById('json-adjustment-reason').value = '';
        
        // Show modal
        document.getElementById('json-editor-modal').classList.add('active');
        
        // Setup form handler
        const form = document.getElementById('json-editor-form');
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        document.getElementById('json-editor-form').addEventListener('submit', handleJsonEditorSubmit);
        
    } catch (error) {
        console.error('Error loading session for JSON editor:', error);
        alert(`Error: ${error.message}`);
    }
}

/**
 * 3.6.4: Close JSON editor modal
 */
function closeJsonEditorModal() {
    document.getElementById('json-editor-modal').classList.remove('active');
    currentJsonSessionId = null;
}

/**
 * 3.6.4 & 3.6.6: Validate JSON editor input
 */
function validateJsonEditor() {
    const jsonText = document.getElementById('json-locked-packages').value.trim();
    const textarea = document.getElementById('json-locked-packages');
    
    try {
        const parsed = JSON.parse(jsonText);
        
        if (!Array.isArray(parsed)) {
            throw new Error('JSON must be an array');
        }
        
        // 3.6.6: Package label format validation
        const invalidLabels = [];
        for (let i = 0; i < parsed.length; i++) {
            const label = parsed[i];
            if (typeof label !== 'string' || !/^[A-Z0-9]{24}$/.test(label)) {
                invalidLabels.push(`Index ${i}: "${label}"`);
            }
        }
        
        if (invalidLabels.length > 0) {
            throw new Error(`Invalid package labels (must be 24 alphanumeric characters):\n${invalidLabels.join('\n')}`);
        }
        
        // Valid JSON
        textarea.style.borderColor = '#10b981';
        textarea.style.borderWidth = '2px';
        alert('✅ JSON is valid!');
        
        setTimeout(() => {
            textarea.style.borderColor = '';
            textarea.style.borderWidth = '';
        }, 2000);
        
    } catch (error) {
        textarea.style.borderColor = '#ef4444';
        textarea.style.borderWidth = '2px';
        alert(`❌ Invalid JSON: ${error.message}`);
        
        setTimeout(() => {
            textarea.style.borderColor = '';
            textarea.style.borderWidth = '';
        }, 3000);
    }
}

/**
 * 3.6.4: Handle JSON editor form submission
 */
async function handleJsonEditorSubmit(e) {
    e.preventDefault();
    
    const jsonText = document.getElementById('json-locked-packages').value.trim();
    const reason = document.getElementById('json-adjustment-reason').value.trim();
    
    if (!reason) {
        alert('Please provide a reason for this adjustment');
        return;
    }
    
    // Validate JSON first
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
        if (!Array.isArray(parsed)) {
            throw new Error('JSON must be an array');
        }
        
        // Validate package labels
        for (const label of parsed) {
            if (typeof label !== 'string' || !/^[A-Z0-9]{24}$/.test(label)) {
                throw new Error(`Invalid package label: "${label}" (must be 24 alphanumeric characters)`);
            }
        }
    } catch (error) {
        alert(`Invalid JSON: ${error.message}\n\nPlease fix the JSON before saving.`);
        return;
    }
    
    // Show confirmation (3.6.5: Validation warning)
    if (!confirm('⚠️ WARNING: This bypasses normal validation. Are you sure you want to save these changes?')) {
        return;
    }
    
    const button = e.target.querySelector('button[type="submit"]');
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }
    
    try {
        const response = await fetch(`/api/v1/admin/fulfillment/sessions/${currentJsonSessionId}/adjust`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                adjustments: {
                    currently_locked_packages: parsed
                },
                reason: reason
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to save adjustments');
        }
        
        alert('Session data updated successfully');
        closeJsonEditorModal();
        loadSessions();
        
    } catch (error) {
        console.error('Error saving JSON adjustments:', error);
        alert(`Error: ${error.message}`);
        if (button) {
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-save"></i> Save Changes';
        }
    }
}

