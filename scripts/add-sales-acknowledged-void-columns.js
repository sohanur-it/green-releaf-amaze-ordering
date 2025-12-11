#!/usr/bin/env node

/**
 * Migration: Add sales_acknowledged_void columns to ORDERS-invoices
 *
 * This is a one-time helper script to fix:
 *   column "sales_acknowledged_void" of relation "ORDERS-invoices" does not exist
 *
 * Usage:
 *   NODE_ENV=development node scripts/add-sales-acknowledged-void-columns.js
 *   NODE_ENV=production  node scripts/add-sales-acknowledged-void-columns.js
 */

const path = require('path');
const { Pool } = require('pg');

// Load environment configuration
const envFile =
  process.env.NODE_ENV === 'production'
    ? path.join(__dirname, '../config/production.env')
    : path.join(__dirname, '../config/local.env');

require('dotenv').config({ path: envFile });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'green_releaf_dev',
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : undefined,
});

async function addSalesAcknowledgedVoidColumns() {
  const client = await pool.connect();

  try {
    console.log('🔧 Adding sales_acknowledged_void columns to "ORDERS-invoices"...');
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE "ORDERS-invoices"
        ADD COLUMN IF NOT EXISTS sales_acknowledged_void BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS sales_acknowledged_void_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS sales_acknowledged_void_by INTEGER REFERENCES users(id)
    `);

    await client.query('COMMIT');
    console.log('✅ Columns added (or already existed).');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to add sales_acknowledged_void columns:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

addSalesAcknowledgedVoidColumns().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exitCode = 1;
});


