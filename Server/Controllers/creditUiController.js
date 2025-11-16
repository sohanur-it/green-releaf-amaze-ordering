const { query } = require('../config/database');

class CreditUiController {
    async listCredits(req, res) {
        const viewDefaults = {
            title: 'Account Credits',
            layout: 'layouts/main'
        };

        try {
            const tableCheck = await query(`
                SELECT 1 
                FROM information_schema.tables
                WHERE table_name = 'ORDERS-account-credits'
                    AND table_schema = 'public'
                LIMIT 1
            `);

            if (tableCheck.rowCount === 0) {
                return res.render('admin/credits/index', {
                    ...viewDefaults,
                    credits: [],
                    summary: { totalIssued: 0, totalRemaining: 0, activeCredits: 0 },
                    schemaMissing: true
                });
            }

            const creditsResult = await query(`
                SELECT 
                    ac.id,
                    ac.fk_location_id,
                    ac.credit_amount,
                    ac.remaining_balance,
                    ac.reason,
                    ac.internal_notes,
                    ac.void_reason,
                    ac.related_invoice_id,
                    ac.expires_at,
                    ac.is_voided,
                    ac.is_fully_used,
                    ac.is_expired,
                    ac.issued_at,
                    ac.issued_by,
                    ac.voided_at,
                    ac.voided_by,
                    vb.username AS voided_by_username,
                    l.name AS location_name,
                    b.name AS buyer_name,
                    l.orders_buyer_id AS buyer_id
                FROM "ORDERS-account-credits" ac
                LEFT JOIN "ORDERS-buyer_locations" l ON ac.fk_location_id = l.entry_id
                LEFT JOIN "ORDERS-buyers" b ON l.orders_buyer_id = b.entry_id
                LEFT JOIN users vb ON ac.voided_by = vb.id
                ORDER BY ac.issued_at DESC
                LIMIT 500
            `);

            const summary = creditsResult.rows.reduce((acc, credit) => {
                acc.totalIssued += Number(credit.credit_amount ?? 0);
                acc.totalRemaining += Number(credit.remaining_balance || 0);
                if (!credit.is_voided && !credit.is_fully_used) {
                    acc.activeCredits += 1;
                }
                return acc;
            }, { totalIssued: 0, totalRemaining: 0, activeCredits: 0 });

            res.render('admin/credits/index', {
                ...viewDefaults,
                credits: creditsResult.rows,
                summary,
                schemaMissing: false,
                error: null
            });
        } catch (error) {
            console.error('Error loading credits UI:', error);
            res.status(500).render('admin/credits/index', {
                ...viewDefaults,
                credits: [],
                summary: { totalIssued: 0, totalRemaining: 0, activeCredits: 0 },
                schemaMissing: false,
                error: 'Failed to load account credits.'
            });
        }
    }
}

module.exports = new CreditUiController();

