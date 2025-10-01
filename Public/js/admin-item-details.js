//admin item details list page JS
//handles displaying batches grouped by item with details status

let batchesData = null;

//load batches on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadBatches();
});

//fetch batches from API
async function loadBatches() {
    try {
        showLoading();

        const response = await fetch('/admin/api/batches');
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to load batches');
        }

        batchesData = result.data;

        //update stats
        document.getElementById('total-items').textContent = result.data.total_items;
        document.getElementById('items-with-details').textContent = result.data.items_with_details;
        document.getElementById('items-without-details').textContent = result.data.items_without_details;

        //render lists
        renderBatchList('without-details-list', result.data.without_details, false);
        renderBatchList('with-details-list', result.data.with_details, true);

    } catch (error) {
        console.error('Error loading batches:', error);
        showToast('Error loading batches: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

//render batch list
function renderBatchList(containerId, items, hasDetails) {
    const container = document.getElementById(containerId);

    if (!items || items.length === 0) {
        container.innerHTML = '<p class="empty-message">No items to display</p>';
        return;
    }

    container.innerHTML = '';

    items.forEach(item => {
        const itemCard = createItemCard(item, hasDetails);
        container.appendChild(itemCard);
    });
}

//create item card element
function createItemCard(item, hasDetails) {
    const card = document.createElement('div');
    card.className = 'item-card';

    const header = document.createElement('div');
    header.className = 'item-card-header';
    header.innerHTML = `
        <div class="item-card-title">
            <h3>${escapeHtml(item.item_name)}</h3>
            <span class="badge ${hasDetails ? 'badge-success' : 'badge-warning'}">
                ${hasDetails ? 'Has Details' : 'Missing Details'}
            </span>
        </div>
        <div class="item-card-stats">
            <span class="stat-badge">📦 ${item.total_full_packages} packages</span>
            <span class="stat-badge">🏷️ ${item.batches.length} batches</span>
        </div>
        <button class="btn-toggle" onclick="toggleCard(this)">▼</button>
    `;

    const content = document.createElement('div');
    content.className = 'item-card-content';
    content.style.display = 'none';

    //if has details, show them
    if (hasDetails && item.details) {
        const detailsHtml = `
            <div class="details-summary">
                <div class="detail-row">
                    <span class="detail-label">Category:</span>
                    <span class="detail-value">${escapeHtml(item.details.category || 'N/A')}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Brand:</span>
                    <span class="detail-value">${escapeHtml(item.details.brand || 'N/A')}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Price:</span>
                    <span class="detail-value">${formatPrice(item.details.default_price)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Strain Type:</span>
                    <span class="detail-value">${escapeHtml(item.details.strain_type || 'N/A')}</span>
                </div>
            </div>
        `;
        content.innerHTML = detailsHtml;
    }

    //show batches
    const batchesHtml = `
        <div class="batches-list">
            <h4>Batches:</h4>
            ${item.batches.map(batch => `
                <div class="batch-item">
                    <span class="batch-name">${escapeHtml(batch.batch_name)}</span>
                    <span class="batch-qty">${batch.full_package_count} full packages</span>
                    ${batch.thc_percentage ? `<span class="batch-thc">THC: ${batch.thc_percentage}%</span>` : ''}
                </div>
            `).join('')}
        </div>
    `;

    content.innerHTML += batchesHtml;

    //action buttons
    const actions = document.createElement('div');
    actions.className = 'item-card-actions';
    actions.innerHTML = `
        <a href="/admin/item/${encodeURIComponent(item.item_name)}" class="btn btn-primary">
            ${hasDetails ? 'Edit Details' : 'Add Details'}
        </a>
    `;

    content.appendChild(actions);
    card.appendChild(header);
    card.appendChild(content);

    return card;
}

//toggle card expansion
function toggleCard(button) {
    const card = button.closest('.item-card');
    const content = card.querySelector('.item-card-content');

    if (content.style.display === 'none') {
        content.style.display = 'block';
        button.textContent = '▲';
    } else {
        content.style.display = 'none';
        button.textContent = '▼';
    }
}

//toggle entire section
function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    const cards = section.querySelectorAll('.item-card-content');
    const buttons = section.querySelectorAll('.btn-toggle');

    const allCollapsed = Array.from(cards).every(c => c.style.display === 'none');

    cards.forEach((content, i) => {
        if (allCollapsed) {
            content.style.display = 'block';
            buttons[i].textContent = '▲';
        } else {
            content.style.display = 'none';
            buttons[i].textContent = '▼';
        }
    });
}

//html escape utility
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}