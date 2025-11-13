/**
 * Line Item History Service
 *
 * Persists detailed line item change history entries to
 * "ORDERS-invoice-line-items-history".
 */

const { query } = require('../config/database');

function getExecutor(client) {
    if (client && typeof client.query === 'function') {
        return client.query.bind(client);
    }
    return query;
}

/**
 * Insert a history entry for an invoice line item.
 *
 * @param {Object} params
 * @param {number} params.lineItemId - Target line item ID
 * @param {string} params.modificationType - e.g. 'created', 'quantity_changed'
 * @param {string} [params.fieldChanged] - Name of the field that changed
 * @param {string|null} [params.oldValue] - Previous value (stringified)
 * @param {string|null} [params.newValue] - New value (stringified)
 * @param {string|null} [params.reason] - Reason for change
 * @param {number|null} [params.changedByUserId] - User responsible for change
 * @param {boolean} [params.changedBySystem=false] - Flag for system-triggered change
 * @param {Object} [params.client] - Optional PG client (for transactions)
 * @returns {Promise<void>}
 */
async function addLineItemHistoryEntry({
    lineItemId,
    modificationType,
    fieldChanged = null,
    oldValue = null,
    newValue = null,
    reason = null,
    changedByUserId = null,
    changedBySystem = false,
    client = null
}) {
    if (!lineItemId || !modificationType) {
        throw new Error('lineItemId and modificationType are required to log line item history');
    }

    const exec = getExecutor(client);

    await exec(`
        INSERT INTO "ORDERS-invoice-line-items-history" (
            line_item_id,
            modification_type,
            field_changed,
            old_value,
            new_value,
            reason,
            changed_by_user_id,
            changed_by_system
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
        lineItemId,
        modificationType,
        fieldChanged,
        oldValue,
        newValue,
        reason,
        changedByUserId,
        changedBySystem
    ]);
}

module.exports = {
    addLineItemHistoryEntry
};

