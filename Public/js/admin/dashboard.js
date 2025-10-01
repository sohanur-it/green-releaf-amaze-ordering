// Dashboard JavaScript
// Fetches and displays admin dashboard statistics

document.addEventListener('DOMContentLoaded', () => {
    loadDashboardStats();
});

/**
 * Load dashboard statistics from API
 */
async function loadDashboardStats() {
    try {
        const response = await fetch('/admin/api/dashboard-stats');
        const result = await response.json();

        if (result.success) {
            updateStatCards(result.data);
        } else {
            console.error('Failed to load dashboard stats:', result.error);
        }
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

/**
 * Update stat card values
 * @param {Object} stats - Statistics data
 */
function updateStatCards(stats) {
    document.getElementById('pending-batches').textContent = stats.pending_batches || 0;
    document.getElementById('products-needing-info').textContent = stats.products_needing_info || 0;
    document.getElementById('sellable-batches').textContent = stats.sellable_batches || 0;
    document.getElementById('on-deck-batches').textContent = stats.on_deck_batches || 0;
    document.getElementById('on-hold-batches').textContent = stats.on_hold_batches || 0;
    document.getElementById('products-complete').textContent = stats.products_complete || 0;
    document.getElementById('products-with-pending-batches').textContent = stats.products_with_pending_batches || 0;
}
