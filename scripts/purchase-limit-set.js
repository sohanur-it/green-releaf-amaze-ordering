#!/usr/bin/env node
/**
 * Utility to upsert purchase-limit overrides for a buyer location.
 *
 * Usage:
 *   NODE_ENV=production node scripts/purchase-limit-set.js \
 *     --location 42 \
 *     --order 25000 \
 *     --unshipped 4 \
 *     --unpaid 8 \
 *     --user 17 \
 *     --reason "Approved by CFO on 2025-11-13"
 *
 * Any of --order/--unshipped/--unpaid omitted (or set to "default") will revert to system defaults.
 */

const path = require('path');

// Ensure we load env config relative to repo root
if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'development';
}

// Bootstrap environment configuration (mirrors Server/server.js logic)
const dotenv = require('dotenv');
if (process.env.NODE_ENV === 'production') {
    dotenv.config({ path: path.join(__dirname, '../config/production.env') });
} else {
    dotenv.config({ path: path.join(__dirname, '../config/local.env') });
}

const purchaseLimitService = require('../Server/Services/purchaseLimitService');
const auditLogger = require('../Server/Services/auditLogger');

const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
        const key = arg.replace(/^--/, '');
        const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
        options[key] = value;
    }
}

if (!options.location) {
    console.error('❌ Missing required argument: --location <locationId>');
    process.exit(1);
}

const locationId = parseInt(options.location, 10);
if (Number.isNaN(locationId)) {
    console.error('❌ Invalid location id provided.');
    process.exit(1);
}

const userId = options.user ? parseInt(options.user, 10) : null;
if (!userId || Number.isNaN(userId)) {
    console.error('❌ Missing required argument: --user <adminUserId>');
    process.exit(1);
}

const normaliseNumeric = (value, fallback) => {
    if (value === undefined || value === true || value === null) {
        return fallback;
    }
    if (typeof value === 'string' && value.toLowerCase() === 'default') {
        return fallback;
    }
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
        console.error(`❌ Invalid numeric value "${value}"`);
        process.exit(1);
    }
    return numeric;
};

const limits = {
    max_order_total: normaliseNumeric(options.order, null),
    max_unshipped_orders: normaliseNumeric(options.unshipped, null),
    max_unpaid_invoices: normaliseNumeric(options.unpaid, null)
};

(async () => {
    try {
        console.log('🛠️  Applying purchase limit changes...', {
            locationId,
            limits
        });

        const sanitizedLimits = {
            max_order_total: limits.max_order_total === null ? null : limits.max_order_total,
            max_unshipped_orders: limits.max_unshipped_orders === null ? null : limits.max_unshipped_orders,
            max_unpaid_invoices: limits.max_unpaid_invoices === null ? null : limits.max_unpaid_invoices
        };

        const result = await purchaseLimitService.updatePurchaseLimits(
            locationId,
            sanitizedLimits,
            userId
        );

        if (!result.success) {
            console.error('❌ Failed to set purchase limits:', result.error);
            process.exit(1);
        }

        console.log('✅ Purchase limits updated:', result.limits);

        const reason = options.reason || 'Manual override via CLI';
        await auditLogger.logUserAction(
            userId,
            'purchase_limit_override',
            'Location',
            String(locationId),
            {
                new_limits: result.limits,
                reason,
                node_env: process.env.NODE_ENV
            },
            'success'
        );

        console.log('📝 Audit log recorded with reason:', reason);
        process.exit(0);
    } catch (error) {
        console.error('❌ Unexpected error while updating purchase limits:', error);
        await auditLogger.logUserAction(
            userId,
            'purchase_limit_override',
            'Location',
            String(locationId),
            {
                error: error.message,
                stack: error.stack,
                attempted_limits: limits
            },
            'failure'
        );
        process.exit(1);
    }
})();

