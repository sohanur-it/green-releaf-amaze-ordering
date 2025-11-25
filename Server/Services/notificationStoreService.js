/**
 * Notification Store Service
 *
 * Persists in-app notifications and manages user notification preferences.
 */

const { query, pool } = require('../config/database');

const DEFAULT_NOTIFICATION_SETTINGS = {
    enabled: true,
    send_email: false
};

const normalizeNotificationType = (type) => String(type || '').trim().toLowerCase();

async function createNotification({
    userId,
    type,
    title,
    message,
    payload = null,
    priority = 'normal',
    requiresAck = false
}) {
    if (!userId || !type) {
        throw new Error('userId and notification type are required');
    }

    const normalizedType = normalizeNotificationType(type);

    const result = await query(`
        INSERT INTO user_notifications (
            user_id,
            notification_type,
            title,
            message,
            payload,
            priority,
            requires_ack
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
    `, [
        userId,
        normalizedType,
        title || null,
        message || null,
        payload ? JSON.stringify(payload) : null,
        priority,
        requiresAck
    ]);

    return result.rows[0];
}

async function markNotificationRead(notificationId, userId) {
    await query(`
        UPDATE user_notifications
        SET is_read = true,
            read_at = NOW()
        WHERE id = $1 AND user_id = $2 AND is_read = false
    `, [notificationId, userId]);
}

async function markNotificationAcknowledged(notificationId, userId) {
    await query(`
        UPDATE user_notifications
        SET acknowledged = true,
            acknowledged_at = NOW(),
            is_read = true,
            read_at = COALESCE(read_at, NOW())
        WHERE id = $1 AND user_id = $2
    `, [notificationId, userId]);
}

async function getUserNotifications(userId, {
    limit = 20,
    offset = 0,
    onlyUnread = false
} = {}) {
    const conditions = ['user_id = $1'];
    const params = [userId];

    if (onlyUnread) {
        conditions.push('is_read = false');
    }

    const notifications = await query(`
        SELECT *
        FROM user_notifications
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    // Apply the same filter conditions to the total count query
    const totalResult = await query(`
        SELECT COUNT(*) AS total
        FROM user_notifications
        WHERE ${conditions.join(' AND ')}
    `, [userId]);

    return {
        notifications: notifications.rows,
        total: parseInt(totalResult.rows[0].total, 10)
    };
}

async function getUserNotificationPreferences(userId) {
    const preferences = await query(`
        SELECT notification_type, enabled, send_email
        FROM user_notification_preferences
        WHERE user_id = $1
    `, [userId]);

    return preferences.rows.reduce((acc, pref) => {
        acc[pref.notification_type] = {
            enabled: pref.enabled,
            send_email: pref.send_email
        };
        return acc;
    }, {});
}

async function isNotificationEnabled(userId, type) {
    const normalizedType = normalizeNotificationType(type);
    const preference = await query(`
        SELECT enabled
        FROM user_notification_preferences
        WHERE user_id = $1 AND notification_type = $2
    `, [userId, normalizedType]);

    if (preference.rows.length === 0) {
        return DEFAULT_NOTIFICATION_SETTINGS.enabled;
    }

    return preference.rows[0].enabled;
}

async function upsertNotificationPreference(userId, type, { enabled, send_email }) {
    const normalizedType = normalizeNotificationType(type);

    const result = await query(`
        INSERT INTO user_notification_preferences (
            user_id,
            notification_type,
            enabled,
            send_email,
            created_at,
            updated_at
        ) VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (user_id, notification_type)
        DO UPDATE SET
            enabled = EXCLUDED.enabled,
            send_email = EXCLUDED.send_email,
            updated_at = NOW()
        RETURNING *
    `, [userId, normalizedType, enabled, send_email]);

    return result.rows[0];
}

async function bulkUpdatePreferences(userId, preferences = []) {
    if (!Array.isArray(preferences)) {
        throw new Error('preferences must be an array');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const updated = [];

        for (const pref of preferences) {
            const { notification_type, enabled, send_email } = pref;
            if (!notification_type) {
                continue;
            }

            const normalizedType = normalizeNotificationType(notification_type);
            const result = await client.query(`
                INSERT INTO user_notification_preferences (
                    user_id,
                    notification_type,
                    enabled,
                    send_email,
                    created_at,
                    updated_at
                ) VALUES ($1, $2, $3, $4, NOW(), NOW())
                ON CONFLICT (user_id, notification_type)
                DO UPDATE SET
                    enabled = EXCLUDED.enabled,
                    send_email = EXCLUDED.send_email,
                    updated_at = NOW()
                RETURNING *
            `, [userId, normalizedType, enabled, send_email]);

            updated.push(result.rows[0]);
        }

        await client.query('COMMIT');
        return updated;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    createNotification,
    markNotificationRead,
    markNotificationAcknowledged,
    getUserNotifications,
    getUserNotificationPreferences,
    isNotificationEnabled,
    upsertNotificationPreference,
    bulkUpdatePreferences,
    DEFAULT_NOTIFICATION_SETTINGS
};

