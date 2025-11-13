/**
 * Account Credit Service
 *
 * Provides issuance, application, voiding, correction, and reversal of account credits.
 */

const { query, pool } = require('../config/database');

const roundToCurrency = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const ensureReason = (reason, minLength, label) => {
    if (!reason || reason.trim().length < minLength) {
        return `${label} must be at least ${minLength} characters long.`;
    }
    return null;
};

const getExecutor = (client) => (client ? client.query.bind(client) : query);

async function addCreditHistoryEntry({
    client = null,
    creditId,
    actionType,
    amountChange = null,
    balanceBefore = null,
    balanceAfter = null,
    relatedInvoiceId = null,
    reason = null,
    metadata = null,
    changedByUserId = null,
    changedBySystem = false
}) {
    const exec = getExecutor(client);
    await exec(`
        INSERT INTO "orders-account-credit-history" (
            fk_credit_id,
            action_type,
            amount_change,
            balance_before,
            balance_after,
            related_invoice_id,
            reason,
            metadata,
            changed_by_user_id,
            changed_by_system
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
        creditId,
        actionType,
        amountChange,
        balanceBefore,
        balanceAfter,
        relatedInvoiceId,
        reason,
        metadata ? JSON.stringify(metadata) : null,
        changedByUserId,
        changedBySystem
    ]);
}

class AccountCreditService {
    async issueCredit(creditData, userId) {
        try {
            const result = await query(`
                INSERT INTO "ORDERS-account-credits" (
                    fk_location_id,
                    credit_amount,
                    remaining_balance,
                    issued_by,
                    reason,
                    related_invoice_id,
                    expires_at
                ) VALUES ($1, $2, $2, $3, $4, $5, $6)
                RETURNING *
            `, [
                creditData.fk_location_id,
                creditData.amount,
                creditData.amount,
                userId,
                creditData.reason,
                creditData.related_invoice_id || null,
                creditData.expires_at || null
            ]);

            const credit = result.rows[0];

            await addCreditHistoryEntry({
                creditId: credit.id,
                actionType: 'issued',
                amountChange: roundToCurrency(credit.credit_amount),
                balanceBefore: 0,
                balanceAfter: roundToCurrency(credit.remaining_balance),
                reason: creditData.reason,
                changedByUserId: userId,
                metadata: {
                    related_invoice_id: credit.related_invoice_id || null
                }
            });

            return { success: true, credit };
        } catch (error) {
            console.error('Error issuing credit:', error);
            return { success: false, error: error.message };
        }
    }

    async applyCreditsToInvoice(invoiceId, client = null) {
        const exec = getExecutor(client);

        try {
            const invoice = await exec(`
                SELECT
                    id,
                    fk_location_id,
                    COALESCE(credit_applied, 0) AS current_credit_applied
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                return { success: false, error: 'Invoice not found' };
            }

            const invoiceData = invoice.rows[0];
            const lineItems = await exec(`
                SELECT id, line_total, credit_portion
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [invoiceId]);

            if (lineItems.rows.length === 0) {
                return { success: false, error: 'Invoice has no line items' };
            }

            const actualSubtotal = lineItems.rows.reduce((sum, item) => {
                const original = parseFloat(item.line_total) + parseFloat(item.credit_portion || 0);
                return sum + original;
            }, 0);

            const currentCredit = parseFloat(invoiceData.current_credit_applied);
            const balanceNeeded = roundToCurrency(actualSubtotal - currentCredit);

            if (balanceNeeded <= 0) {
                return { success: true, applied: 0, message: 'Invoice already covered by credits' };
            }

            const credits = await exec(`
                SELECT *
                FROM "ORDERS-account-credits"
                WHERE fk_location_id = $1
                  AND remaining_balance > 0
                  AND is_expired = false
                  AND is_fully_used = false
                  AND is_voided = false
                  AND (expires_at IS NULL OR expires_at > NOW())
                ORDER BY issued_at ASC
            `, [invoiceData.fk_location_id]);

            if (credits.rows.length === 0) {
                return { success: true, applied: 0, message: 'No available credits' };
            }

            let totalApplied = 0;
            const applications = [];

            for (const credit of credits.rows) {
                if (totalApplied >= balanceNeeded) break;

                const available = parseFloat(credit.remaining_balance);
                const stillNeeded = balanceNeeded - totalApplied;
                const toApply = roundToCurrency(Math.min(available, stillNeeded));

                const newBalance = roundToCurrency(available - toApply);
                await exec(`
                    UPDATE "ORDERS-account-credits"
                    SET remaining_balance = $1,
                        is_fully_used = $2,
                        fully_used_at = CASE WHEN $2 THEN NOW() ELSE NULL END
                    WHERE id = $3
                `, [newBalance, newBalance === 0, credit.id]);

                await addCreditHistoryEntry({
                    client,
                    creditId: credit.id,
                    actionType: 'applied_to_invoice',
                    amountChange: -toApply,
                    balanceBefore: available,
                    balanceAfter: newBalance,
                    relatedInvoiceId: invoiceId,
                    reason: 'Credit applied to invoice',
                    changedBySystem: true
                });

                applications.push({ credit_id: credit.id, amount: toApply });
                totalApplied = roundToCurrency(totalApplied + toApply);
            }

            if (totalApplied === 0) {
                return { success: true, applied: 0, message: 'No credits applied (insufficient balances)' };
            }

            const originalTotals = lineItems.rows.map((item) => ({
                id: item.id,
                originalTotal: roundToCurrency(parseFloat(item.line_total) + parseFloat(item.credit_portion || 0))
            }));

            const subtotal = originalTotals.reduce((sum, item) => sum + item.originalTotal, 0);

            let allocated = 0;
            for (let i = 0; i < originalTotals.length; i++) {
                const { id, originalTotal } = originalTotals[i];
                let creditShare = 0;

                if (i === originalTotals.length - 1) {
                    creditShare = roundToCurrency(totalApplied - allocated);
                } else if (subtotal > 0) {
                    creditShare = roundToCurrency(totalApplied * (originalTotal / subtotal));
                    allocated = roundToCurrency(allocated + creditShare);
                }

                const newLineTotal = roundToCurrency(originalTotal - creditShare);
                await exec(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET line_total = $1,
                        credit_portion = $2
                    WHERE id = $3
                `, [newLineTotal, creditShare, id]);
            }

            await exec(`
                UPDATE "ORDERS-invoices"
                SET
                    subtotal = $1,
                    credit_applied = COALESCE(credit_applied, 0) + $2,
                    total = $1 - (COALESCE(credit_applied, 0) + $2),
                    updated_at = NOW()
                WHERE id = $3
            `, [subtotal, totalApplied, invoiceId]);

            for (const app of applications) {
                await exec(`
                    INSERT INTO "orders-credit-applications" (
                        fk_credit_id,
                        fk_invoice_id,
                        amount_applied
                    ) VALUES ($1, $2, $3)
                `, [app.credit_id, invoiceId, app.amount]);
            }

            await exec(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    old_value,
                    new_value,
                    reason,
                    changed_by_system
                ) VALUES ($1, 'credit_applied', 'credit_applied', $2, $3, 'Account credit applied automatically', true)
            `, [
                invoiceId,
                currentCredit.toString(),
                (currentCredit + totalApplied).toString()
            ]);

            return {
                success: true,
                applied: totalApplied,
                credits_used: applications.length
            };
        } catch (error) {
            console.error('Error applying credits to invoice:', error);
            return { success: false, error: error.message };
        }
    }

    async getAvailableCredits(locationId) {
        try {
            const result = await query(`
                SELECT
                    c.*,
                    b.name AS buyer_name,
                    l.name AS location_name,
                    u.username AS issued_by_username
                FROM "ORDERS-account-credits" c
                INNER JOIN "ORDERS-buyer_locations" l ON c.fk_location_id = l.id
                INNER JOIN "ORDERS-buyers" b ON l.orders_buyer_id = b.entry_id
                LEFT JOIN users u ON c.issued_by = u.id
                WHERE c.fk_location_id = $1
                ORDER BY c.issued_at DESC
            `, [locationId]);

            return result.rows;
        } catch (error) {
            console.error('Error getting available credits:', error);
            return [];
        }
    }

    async expireCredits() {
        try {
            const result = await query(`
                UPDATE "ORDERS-account-credits"
                SET is_expired = true
                WHERE is_expired = false
                  AND expires_at IS NOT NULL
                  AND expires_at < NOW()
                RETURNING id, fk_location_id, remaining_balance
            `);

            console.log(`Expired ${result.rows.length} credits`);
            return { success: true, expired_count: result.rows.length };
        } catch (error) {
            console.error('Error expiring credits:', error);
            return { success: false, error: error.message };
        }
    }

    async voidCredit(creditId, reason, userId) {
        const reasonError = ensureReason(reason, 20, 'Void reason');
        if (reasonError) {
            return { success: false, error: reasonError };
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const creditResult = await client.query(`
                SELECT *
                FROM "ORDERS-account-credits"
                WHERE id = $1
                FOR UPDATE
            `, [creditId]);

            if (creditResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Credit not found' };
            }

            const credit = creditResult.rows[0];

            if (credit.is_voided) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Credit is already voided' };
            }

            if (credit.is_fully_used && roundToCurrency(credit.remaining_balance) === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Cannot void a fully used credit' };
            }

            const paidCheck = await client.query(`
                SELECT COUNT(*) AS count
                FROM "orders-credit-applications" app
                INNER JOIN "ORDERS-invoices" i ON app.fk_invoice_id = i.id
                WHERE app.fk_credit_id = $1
                  AND app.is_reversed = false
                  AND i.status = 'Paid'
            `, [creditId]);

            if (parseInt(paidCheck.rows[0].count, 10) > 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Cannot void credit applied to a paid invoice' };
            }

            const balanceBefore = roundToCurrency(credit.remaining_balance);

            await client.query(`
                UPDATE "ORDERS-account-credits"
                SET remaining_balance = 0,
                    is_fully_used = true,
                    fully_used_at = NOW(),
                    is_voided = true,
                    voided_at = NOW(),
                    voided_by = $2,
                    void_reason = $3
                WHERE id = $1
            `, [creditId, userId, reason]);

            await addCreditHistoryEntry({
                client,
                creditId,
                actionType: 'voided',
                amountChange: -balanceBefore,
                balanceBefore,
                balanceAfter: 0,
                reason,
                changedByUserId: userId
            });

            await client.query('COMMIT');
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error voiding credit:', error);
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    }

    async correctCreditBalance(creditId, newAmount, reason, userId) {
        const reasonError = ensureReason(reason, 50, 'Correction reason');
        if (reasonError) {
            return { success: false, error: reasonError };
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const creditResult = await client.query(`
                SELECT *
                FROM "ORDERS-account-credits"
                WHERE id = $1
                FOR UPDATE
            `, [creditId]);

            if (creditResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Credit not found' };
            }

            const credit = creditResult.rows[0];

            if (credit.is_voided) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Cannot correct a voided credit' };
            }

            const originalAmount = parseFloat(credit.credit_amount);
            const clampedAmount = roundToCurrency(Number(newAmount));

            if (Number.isNaN(clampedAmount) || clampedAmount < 0 || clampedAmount > originalAmount) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    error: `New remaining balance must be between 0 and ${originalAmount.toFixed(2)}`
                };
            }

            const balanceBefore = roundToCurrency(credit.remaining_balance);
            const balanceAfter = clampedAmount;

            await client.query(`
                UPDATE "ORDERS-account-credits"
                SET remaining_balance = $1,
                    is_fully_used = $2,
                    fully_used_at = CASE WHEN $2 THEN NOW() ELSE NULL END
                WHERE id = $3
            `, [balanceAfter, balanceAfter === 0, creditId]);

            await addCreditHistoryEntry({
                client,
                creditId,
                actionType: 'manual_correction',
                amountChange: balanceAfter - balanceBefore,
                balanceBefore,
                balanceAfter,
                reason,
                changedByUserId: userId
            });

            await client.query('COMMIT');
            return { success: true, remaining_balance: balanceAfter };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error correcting credit balance:', error);
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    }

    async unapplyCreditsFromInvoice(invoiceId, { creditIds = null, reason, userId }) {
        const reasonError = ensureReason(reason, 10, 'Reversal reason');
        if (reasonError) {
            return { success: false, error: reasonError };
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const invoiceResult = await client.query(`
                SELECT id, status
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoiceResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Invoice not found' };
            }

            if (invoiceResult.rows[0].status === 'Paid') {
                await client.query('ROLLBACK');
                return { success: false, error: 'Cannot unapply credits from a paid invoice' };
            }

            const appsQuery = `
                SELECT *
                FROM "orders-credit-applications"
                WHERE fk_invoice_id = $1
                  AND is_reversed = false
                  ${creditIds && creditIds.length ? 'AND fk_credit_id = ANY($2)' : ''}
                ORDER BY applied_at ASC
            `;

            const appsParams = creditIds && creditIds.length ? [invoiceId, creditIds] : [invoiceId];
            const applications = await client.query(appsQuery, appsParams);

            if (applications.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'No credit applications to reverse for this invoice' };
            }

            let totalReversed = 0;

            for (const app of applications.rows) {
                const creditResult = await client.query(`
                    SELECT *
                    FROM "ORDERS-account-credits"
                    WHERE id = $1
                    FOR UPDATE
                `, [app.fk_credit_id]);

                const credit = creditResult.rows[0];

                if (!credit) {
                    await client.query('ROLLBACK');
                    return { success: false, error: `Credit ${app.fk_credit_id} not found` };
                }

                if (credit.is_voided) {
                    await client.query('ROLLBACK');
                    return { success: false, error: 'Cannot unapply credit that has been voided' };
                }

                const amount = roundToCurrency(app.amount_applied);
                const balanceBefore = roundToCurrency(credit.remaining_balance);
                const balanceAfter = roundToCurrency(balanceBefore + amount);

                await client.query(`
                    UPDATE "ORDERS-account-credits"
                    SET remaining_balance = $1,
                        is_fully_used = $2,
                        fully_used_at = CASE WHEN $2 THEN NOW() ELSE NULL END
                    WHERE id = $3
                `, [balanceAfter, balanceAfter === 0, app.fk_credit_id]);

                await client.query(`
                    UPDATE "orders-credit-applications"
                    SET is_reversed = true,
                        reversed_at = NOW(),
                        reversed_by_user_id = $2,
                        reversal_reason = $3
                    WHERE id = $1
                `, [app.id, userId, reason]);

                await addCreditHistoryEntry({
                    client,
                    creditId: app.fk_credit_id,
                    actionType: 'unapplied_from_invoice',
                    amountChange: amount,
                    balanceBefore,
                    balanceAfter,
                    relatedInvoiceId: invoiceId,
                    reason,
                    changedByUserId: userId
                });

                totalReversed = roundToCurrency(totalReversed + amount);
            }

            const lineItems = await client.query(`
                SELECT id, line_total, credit_portion
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [invoiceId]);

            const originalTotals = lineItems.rows.map((item) => ({
                id: item.id,
                originalTotal: roundToCurrency(parseFloat(item.line_total) + parseFloat(item.credit_portion || 0))
            }));

            for (const item of originalTotals) {
                await client.query(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET line_total = $1,
                        credit_portion = 0
                    WHERE id = $2
                `, [item.originalTotal, item.id]);
            }

            const subtotal = originalTotals.reduce((sum, item) => sum + item.originalTotal, 0);

            const activeCreditsResult = await client.query(`
                SELECT COALESCE(SUM(amount_applied), 0) AS total_active
                FROM "orders-credit-applications"
                WHERE fk_invoice_id = $1
                  AND is_reversed = false
            `, [invoiceId]);

            const activeTotal = roundToCurrency(activeCreditsResult.rows[0].total_active || 0);

            let allocated = 0;
            for (let i = 0; i < originalTotals.length; i++) {
                const { id, originalTotal } = originalTotals[i];
                let creditShare = 0;

                if (i === originalTotals.length - 1) {
                    creditShare = roundToCurrency(activeTotal - allocated);
                } else if (subtotal > 0) {
                    creditShare = roundToCurrency(activeTotal * (originalTotal / subtotal));
                    allocated = roundToCurrency(allocated + creditShare);
                }

                const newLineTotal = roundToCurrency(originalTotal - creditShare);
                await client.query(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET line_total = $1,
                        credit_portion = $2
                    WHERE id = $3
                `, [newLineTotal, creditShare, id]);
            }

            const creditApplied = Math.min(activeTotal, subtotal);

            await client.query(`
                UPDATE "ORDERS-invoices"
                SET subtotal = $1,
                    credit_applied = $2,
                    total = $1 - $2,
                    updated_at = NOW()
                WHERE id = $3
            `, [subtotal, creditApplied, invoiceId]);

            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    old_value,
                    new_value,
                    reason,
                    changed_by_user_id
                ) VALUES ($1, 'credits_unapplied', 'credit_applied', $2, $3, $4, $5)
            `, [
                invoiceId,
                (creditApplied + totalReversed).toFixed(2),
                creditApplied.toFixed(2),
                reason,
                userId
            ]);

            await client.query('COMMIT');
            return { success: true, reversed: totalReversed };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error unappling credits:', error);
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    }
}

module.exports = new AccountCreditService();

