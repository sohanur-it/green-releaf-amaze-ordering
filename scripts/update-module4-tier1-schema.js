#!/usr/bin/env node

/**
 * Module 4 Tier 1 Schema Updates
 *
 * - Adds missing invoice_status enum values
 * - Hardens ORDERS-invoices financial constraints and location FK
 * - Creates ORDERS-invoice-line-items-history table with indexes
 */

/* eslint-disable no-console */

const { query, pool } = require('../Server/config/database');

async function addEnumValues() {
    console.log('➡️  Ensuring invoice_status enum contains Partially_Manifested...');
    await query(`ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Partially_Manifested';`);
    console.log('✅ invoice_status enum up to date');
}

async function ensureLocationForeignKey() {
    const constraintName = 'orders_invoices_fk_location_id_fkey';
    const existing = await query(
        `SELECT 1 
         FROM pg_constraint 
         WHERE conname = $1`,
        [constraintName]
    );

    if (existing.rows.length > 0) {
        console.log('✅ Foreign key on ORDERS-invoices.fk_location_id already exists');
        return;
    }

    console.log('➡️  Adding foreign key constraint to ORDERS-invoices.fk_location_id...');
    await query(`
        ALTER TABLE "ORDERS-invoices"
        ADD CONSTRAINT ${constraintName}
        FOREIGN KEY (fk_location_id)
        REFERENCES "ORDERS-buyer_locations"(entry_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
    `);
    console.log('✅ Foreign key constraint added');
}

async function ensureFinancialConstraints() {
    console.log('➡️  Validating invoice financial data before adding constraints...');
    const negativeCheck = await query(`
        SELECT COUNT(*) AS invalid_count
        FROM "ORDERS-invoices"
        WHERE subtotal < 0
           OR discount_amount < 0
           OR credit_applied < 0
           OR total < 0
    `);

    if (parseInt(negativeCheck.rows[0].invalid_count, 10) > 0) {
        throw new Error('Cannot add non-negative constraint: found invoices with negative financial values');
    }

    const equalityCheck = await query(`
        SELECT COUNT(*) AS mismatch_count
        FROM "ORDERS-invoices"
        WHERE total <> subtotal - discount_amount - credit_applied
    `);

    if (parseInt(equalityCheck.rows[0].mismatch_count, 10) > 0) {
        throw new Error('Cannot add total consistency constraint: found invoices where total != subtotal - discount_amount - credit_applied');
    }

    const constraints = [
        {
            name: 'orders_invoices_financials_nonnegative',
            sql: `
                ALTER TABLE "ORDERS-invoices"
                ADD CONSTRAINT orders_invoices_financials_nonnegative
                CHECK (
                    subtotal >= 0
                    AND discount_amount >= 0
                    AND credit_applied >= 0
                    AND total >= 0
                )
            `
        },
        {
            name: 'orders_invoices_total_consistency',
            sql: `
                ALTER TABLE "ORDERS-invoices"
                ADD CONSTRAINT orders_invoices_total_consistency
                CHECK (total = subtotal - discount_amount - credit_applied)
            `
        }
    ];

    for (const constraint of constraints) {
        const exists = await query(
            `SELECT 1 FROM pg_constraint WHERE conname = $1`,
            [constraint.name]
        );

        if (exists.rows.length > 0) {
            console.log(`✅ Constraint ${constraint.name} already exists`);
            continue;
        }

        console.log(`➡️  Adding constraint ${constraint.name}...`);
        await query(constraint.sql);
        console.log(`✅ Constraint ${constraint.name} added`);
    }
}

async function ensureLineItemHistoryTable() {
    console.log('➡️  Ensuring ORDERS-invoice-line-items-history table exists...');
    await query(`
        CREATE TABLE IF NOT EXISTS "ORDERS-invoice-line-items-history" (
            id BIGSERIAL PRIMARY KEY,
            line_item_id INTEGER NOT NULL REFERENCES "ORDERS-invoice-line-items"(id) ON DELETE CASCADE,
            modification_type VARCHAR(50) NOT NULL,
            field_changed VARCHAR(50),
            old_value TEXT,
            new_value TEXT,
            reason TEXT,
            changed_by_user_id INTEGER REFERENCES users(id),
            changed_by_system BOOLEAN DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_invoice_line_items_history_item
        ON "ORDERS-invoice-line-items-history"(line_item_id)
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_invoice_line_items_history_ts
        ON "ORDERS-invoice-line-items-history"(created_at DESC)
    `);

    console.log('✅ ORDERS-invoice-line-items-history is ready');
}

async function run() {
    try {
        console.log('🚀 Starting Module 4 Tier 1 schema upgrade...');
        await addEnumValues();
        await ensureLocationForeignKey();
        await ensureFinancialConstraints();
        await ensureLineItemHistoryTable();
        console.log('🎉 Module 4 Tier 1 schema upgrade complete!');
    } catch (error) {
        console.error('❌ Module 4 Tier 1 schema upgrade failed:', error.message);
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

