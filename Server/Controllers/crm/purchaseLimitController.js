const { query } = require('../../config/database');
const purchaseLimitService = require('../../Services/purchaseLimitService');
const auditLogger = require('../../Services/auditLogger');

const DEFAULT_LIMITS = Object.freeze({
    max_order_total: 20000,
    max_unshipped_orders: 3,
    max_unpaid_invoices: 6
});

const normalizeLimits = (row) => {
    if (!row) {
        return null;
    }

    return {
        max_order_total: row.max_order_total !== null && row.max_order_total !== undefined
            ? parseFloat(row.max_order_total)
            : null,
        max_unshipped_orders: row.max_unshipped_orders !== null && row.max_unshipped_orders !== undefined
            ? parseInt(row.max_unshipped_orders, 10)
            : null,
        max_unpaid_invoices: row.max_unpaid_invoices !== null && row.max_unpaid_invoices !== undefined
            ? parseInt(row.max_unpaid_invoices, 10)
            : null
    };
};

const fetchLimitPayload = async (locationId) => {
    const effective = await purchaseLimitService.getPurchaseLimits(locationId);

    const overridesResult = await query(`
        SELECT
            max_order_total,
            max_unshipped_orders,
            max_unpaid_invoices,
            last_modified_by,
            last_modified_at
        FROM "ORDERS-purchase-limits"
        WHERE fk_location_id = $1
    `, [locationId]);

    const overridesRow = overridesResult.rows[0] || null;

    let lastModifiedBy = null;
    if (overridesRow?.last_modified_by) {
        const userResult = await query(`
            SELECT id, first_name, last_name, email
            FROM users
            WHERE id = $1
            LIMIT 1
        `, [overridesRow.last_modified_by]);

        if (userResult.rows.length > 0) {
            const user = userResult.rows[0];
            lastModifiedBy = {
                id: user.id,
                name: `${user.first_name} ${user.last_name}`.trim(),
                email: user.email
            };
        }
    }

    return {
        location_id: locationId,
        limits: {
            defaults: DEFAULT_LIMITS,
            overrides: normalizeLimits(overridesRow),
            effective
        },
        metadata: {
            last_modified_at: overridesRow?.last_modified_at || null,
            last_modified_by: lastModifiedBy
        }
    };
};

const parseNumericField = (value, options = {}) => {
    const { allowNull = true, fieldName = 'value', integer = false, min = 0 } = options;

    if (value === '' || value === null || value === undefined) {
        if (allowNull) {
            return null;
        }
        throw new Error(`${fieldName} is required`);
    }

    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
        throw new Error(`${fieldName} must be a valid number`);
    }

    if (numericValue < min) {
        throw new Error(`${fieldName} must be at least ${min}`);
    }

    return integer ? Math.floor(numericValue) : numericValue;
};

const getLocationLimits = async (req, res) => {
    try {
        const locationId = parseInt(req.params.locationId, 10);

        if (Number.isNaN(locationId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid location id'
            });
        }

        const payload = await fetchLimitPayload(locationId);

        return res.json({
            success: true,
            ...payload
        });
    } catch (error) {
        console.error('Error fetching purchase limits:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to load purchase limits'
        });
    }
};

const updateLocationLimits = async (req, res) => {
    try {
        const locationId = parseInt(req.params.locationId, 10);

        if (Number.isNaN(locationId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid location id'
            });
        }

        const { max_order_total, max_unshipped_orders, max_unpaid_invoices } = req.body || {};

        let sanitizedLimits;
        try {
            sanitizedLimits = {
                max_order_total: parseNumericField(max_order_total, {
                    allowNull: true,
                    fieldName: 'Max order total',
                    integer: false,
                    min: 0
                }),
                max_unshipped_orders: parseNumericField(max_unshipped_orders, {
                    allowNull: true,
                    fieldName: 'Max unshipped orders',
                    integer: true,
                    min: 0
                }),
                max_unpaid_invoices: parseNumericField(max_unpaid_invoices, {
                    allowNull: true,
                    fieldName: 'Max unpaid invoices',
                    integer: true,
                    min: 0
                })
            };
        } catch (validationError) {
            return res.status(400).json({
                success: false,
                error: validationError.message
            });
        }

        const userId = req.session.userId;

        const updateResult = await purchaseLimitService.updatePurchaseLimits(
            locationId,
            sanitizedLimits,
            userId
        );

        if (!updateResult.success) {
            return res.status(500).json({
                success: false,
                error: updateResult.error || 'Failed to update purchase limits'
            });
        }

        await auditLogger.logUserAction(
            userId,
            'purchase_limits_updated',
            'Location',
            String(locationId),
            {
                new_limits: sanitizedLimits,
                ip: req.ip
            },
            'success',
            req.ip
        );

        const payload = await fetchLimitPayload(locationId);

        return res.json({
            success: true,
            message: 'Purchase limits updated',
            ...payload
        });
    } catch (error) {
        console.error('Error updating purchase limits:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update purchase limits'
        });
    }
};

module.exports = {
    getLocationLimits,
    updateLocationLimits
};


