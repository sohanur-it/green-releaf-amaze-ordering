const express = require('express');
const router = express.Router();

const { requireAuth: auth } = require('../Middleware/auth');
const { auditMiddleware } = require('../Middleware/auditMiddleware');
const notificationStore = require('../Services/notificationStoreService');

/**
 * GET /api/v1/notifications
 * Query params:
 *  - limit (default 20)
 *  - offset (default 0)
 *  - unread (boolean)
 */
router.get('/', auth, async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User not authenticated' });
        }
        
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
        const offset = parseInt(req.query.offset, 10) || 0;
        const onlyUnread = req.query.unread === 'true';

        console.log(`[Notifications] Fetching notifications for user ${userId}, limit: ${limit}, offset: ${offset}, onlyUnread: ${onlyUnread}`);

        const result = await notificationStore.getUserNotifications(userId, {
            limit,
            offset,
            onlyUnread
        });

        console.log(`[Notifications] Found ${result.notifications.length} notifications, total: ${result.total}`);

        res.json({
            success: true,
            notifications: result.notifications,
            total: result.total,
            limit,
            offset
        });
    } catch (error) {
        console.error('[Notifications] Error fetching notifications:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch notifications',
            details: error.message 
        });
    }
});

/**
 * GET /api/v1/notifications/preferences
 */
router.get('/preferences', auth, async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const preferences = await notificationStore.getUserNotificationPreferences(userId);

        res.json({
            success: true,
            preferences
        });
    } catch (error) {
        console.error('Error fetching notification preferences:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch preferences' });
    }
});

/**
 * PUT /api/v1/notifications/preferences
 * Body: { preferences: [{ notification_type, enabled, send_email }] }
 */
router.put('/preferences', auth, auditMiddleware, async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const { preferences } = req.body;

        const updated = await notificationStore.bulkUpdatePreferences(userId, preferences);

        res.json({
            success: true,
            preferences: updated
        });
    } catch (error) {
        console.error('Error updating notification preferences:', error);
        res.status(400).json({ success: false, error: error.message || 'Failed to update preferences' });
    }
});

/**
 * POST /api/v1/notifications/:id/read
 */
router.post('/:id/read', auth, async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const notificationId = parseInt(req.params.id, 10);

        await notificationStore.markNotificationRead(notificationId, userId);

        res.json({ success: true });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ success: false, error: 'Failed to mark notification as read' });
    }
});

/**
 * POST /api/v1/notifications/:id/ack
 */
router.post('/:id/ack', auth, auditMiddleware, async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const notificationId = parseInt(req.params.id, 10);

        await notificationStore.markNotificationAcknowledged(notificationId, userId);

        res.json({ success: true });
    } catch (error) {
        console.error('Error acknowledging notification:', error);
        res.status(500).json({ success: false, error: 'Failed to acknowledge notification' });
    }
});

module.exports = router;

