#!/usr/bin/env node

/**
 * Module 4 Tier 3 Schema Updates
 *
 * - Creates user_notifications table (persistent in-app notifications)
 * - Creates user_notification_preferences table (per-user notification toggles)
 * - Adds supporting indexes if missing
 */

/* eslint-disable no-console */

const { query, pool } = require('../Server/config/database');

async function ensureUserNotificationsTable() {
    const exists = await query(`
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'user_notifications'
    `);

    if (exists.rows.length === 0) {
        console.log('➡️  Creating user_notifications table...');
        await query(`
            CREATE TABLE user_notifications (
                id BIGSERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                notification_type VARCHAR(100) NOT NULL,
                title TEXT,
                message TEXT,
                payload JSONB,
                priority VARCHAR(20) DEFAULT 'normal',
                requires_ack BOOLEAN DEFAULT false,
                is_read BOOLEAN DEFAULT false,
                read_at TIMESTAMPTZ,
                acknowledged BOOLEAN DEFAULT false,
                acknowledged_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
    } else {
        console.log('✅ user_notifications table already exists');
    }

    console.log('➡️  Ensuring user_notifications indexes exist...');
    await query(`
        CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
            ON user_notifications (user_id, created_at DESC)
    `);
    await query(`
        CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
            ON user_notifications (user_id, is_read)
            WHERE is_read = false
    `);
    await query(`
        CREATE INDEX IF NOT EXISTS idx_user_notifications_unack
            ON user_notifications (user_id, acknowledged)
            WHERE requires_ack = true AND acknowledged = false
    `);
    console.log('✅ user_notifications indexes ensured');
}

async function ensureUserNotificationPreferencesTable() {
    const exists = await query(`
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'user_notification_preferences'
    `);

    if (exists.rows.length === 0) {
        console.log('➡️  Creating user_notification_preferences table...');
        await query(`
            CREATE TABLE user_notification_preferences (
                id BIGSERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                notification_type VARCHAR(100) NOT NULL,
                enabled BOOLEAN NOT NULL DEFAULT true,
                send_email BOOLEAN NOT NULL DEFAULT false,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(user_id, notification_type)
            )
        `);
    } else {
        console.log('✅ user_notification_preferences table already exists');
    }

    console.log('➡️  Ensuring user_notification_preferences indexes exist...');
    await query(`
        CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_user
            ON user_notification_preferences (user_id)
    `);
    console.log('✅ user_notification_preferences indexes ensured');
}

async function run() {
    try {
        console.log('🚀 Starting Module 4 Tier 3 schema upgrade...');
        await ensureUserNotificationsTable();
        await ensureUserNotificationPreferencesTable();
        console.log('🎉 Module 4 Tier 3 schema upgrade complete!');
    } catch (error) {
        console.error('❌ Module 4 Tier 3 schema upgrade failed:', error.message);
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

