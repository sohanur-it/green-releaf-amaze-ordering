#!/usr/bin/env node

/**
 * Module 4 Tier 2 Schema Updates
 *
 * - Adds voiding columns to ORDERS-account-credits
 * - Creates orders-account-credit-history table
 * - Extends orders-credit-applications with reversal metadata
 */

/* eslint-disable no-console */

const { query, pool } = require('../Server/config/database');

async function ensureCreditVoidingColumns() {
    const columns = [
        { name: 'is_voided', sql: `ALTER TABLE "ORDERS-account-credits" ADD COLUMN is_voided BOOLEAN DEFAULT false` },
        { name: 'voided_at', sql: `ALTER TABLE "ORDERS-account-credits" ADD COLUMN voided_at TIMESTAMPTZ` },
        { name: 'voided_by', sql: `ALTER TABLE "ORDERS-account-credits" ADD COLUMN voided_by INTEGER REFERENCES users(id)` },
        { name: 'void_reason', sql: `ALTER TABLE "ORDERS-account-credits" ADD COLUMN void_reason TEXT` }
    ];

    for (const column of columns) {
        const exists = await query(`
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'ORDERS-account-credits'
              AND column_name = $1
        `, [column.name]);

        if (exists.rows.length === 0) {
            console.log(`➡️  Adding column ${column.name} to ORDERS-account-credits...`);
            await query(column.sql);
        } else {
            console.log(`✅ Column ${column.name} already exists`);
        }
    }
}

async function ensureCreditHistoryTable() {
    const exists = await query(`
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'orders-account-credit-history'
    `);

    if (exists.rows.length === 0) {
        console.log('➡️  Creating orders-account-credit-history table...');
        await query(`
            CREATE TABLE "orders-account-credit-history" (
                id BIGSERIAL PRIMARY KEY,
                fk_credit_id INTEGER NOT NULL REFERENCES "ORDERS-account-credits"(id) ON DELETE CASCADE,
                action_type VARCHAR(50) NOT NULL,
                amount_change NUMERIC(10, 2),
                balance_before NUMERIC(10, 2),
                balance_after NUMERIC(10, 2),
                related_invoice_id INTEGER REFERENCES "ORDERS-invoices"(id),
                reason TEXT,
                metadata JSONB,
                changed_by_user_id INTEGER REFERENCES users(id),
                changed_by_system BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await query(`CREATE INDEX idx_credit_history_credit ON "orders-account-credit-history"(fk_credit_id)`);
        await query(`CREATE INDEX idx_credit_history_created_at ON "orders-account-credit-history"(created_at DESC)`);
        console.log('✅ orders-account-credit-history table created');
    } else {
        console.log('✅ orders-account-credit-history table already exists');
    }
}

async function ensureCreditApplicationColumns() {
    const columns = [
        { name: 'applied_at', sql: `ALTER TABLE "orders-credit-applications" ADD COLUMN applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` },
        { name: 'is_reversed', sql: `ALTER TABLE "orders-credit-applications" ADD COLUMN is_reversed BOOLEAN NOT NULL DEFAULT false` },
        { name: 'reversed_at', sql: `ALTER TABLE "orders-credit-applications" ADD COLUMN reversed_at TIMESTAMPTZ` },
        { name: 'reversed_by_user_id', sql: `ALTER TABLE "orders-credit-applications" ADD COLUMN reversed_by_user_id INTEGER REFERENCES users(id)` },
        { name: 'reversal_reason', sql: `ALTER TABLE "orders-credit-applications" ADD COLUMN reversal_reason TEXT` }
    ];

    for (const column of columns) {
        const exists = await query(`
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'orders-credit-applications'
              AND column_name = $1
        `, [column.name]);

        if (exists.rows.length === 0) {
            console.log(`➡️  Adding column ${column.name} to orders-credit-applications...`);
            await query(column.sql);
            if (column.name === 'applied_at') {
                await query(`UPDATE "orders-credit-applications" SET applied_at = NOW() WHERE applied_at IS NULL`);
            }
        } else {
            console.log(`✅ Column ${column.name} already exists`);
        }
    }
}

async function run() {
    try {
        console.log('🚀 Starting Module 4 Tier 2 schema upgrade...');
        await ensureCreditVoidingColumns();
        await ensureCreditHistoryTable();
        await ensureCreditApplicationColumns();
        console.log('🎉 Module 4 Tier 2 schema upgrade complete!');
    } catch (error) {
        console.error('❌ Module 4 Tier 2 schema upgrade failed:', error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    run();
}

module.exports = {
    run
};

