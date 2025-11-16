#!/usr/bin/env node

/**
 * Migration: Add is_superadmin column to users table
 *
 * - Adds BOOLEAN column is_superadmin (default false)
 * - Backfills existing rows where is_admin = true
 * - Ensures column exists in both production and local databases
 */

const path = require('path');
const { Pool } = require('pg');

// Load environment configuration (default to production when NODE_ENV=production)
const envFile = process.env.NODE_ENV === 'production'
    ? path.join(__dirname, '../config/production.env')
    : path.join(__dirname, '../config/local.env');
require('dotenv').config({ path: envFile });

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

async function columnExists(client) {
    const result = await client.query(
        `
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'is_superadmin'
        `
    );
    return result.rows.length > 0;
}

async function ensureColumn() {
    const client = await pool.connect();
    try {
        const alreadyExists = await columnExists(client);
        if (alreadyExists) {
            console.log('⚠️  Column "is_superadmin" already exists; skipping.');
            return;
        }

        console.log('➕ Adding "is_superadmin" column to users table...');
        await client.query('BEGIN');
        await client.query(`
            ALTER TABLE users
            ADD COLUMN is_superadmin BOOLEAN NOT NULL DEFAULT false
        `);

        console.log('🔄 Backfilling existing admins as superadmins...');
        await client.query(`
            UPDATE users
            SET is_superadmin = true
            WHERE is_admin = true
        `);

        await client.query('COMMIT');
        console.log('✅ "is_superadmin" column added and backfilled successfully.');
    } catch (error) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('❌ Failed to add "is_superadmin" column:', error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

ensureColumn().catch((err) => {
    console.error('❌ Unexpected error while adding "is_superadmin" column:', err);
    process.exitCode = 1;
});


