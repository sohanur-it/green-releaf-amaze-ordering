/**
 * WebSocket Service for Real-Time Inventory Updates
 * 
 * This service handles:
 * - Batch-level inventory subscriptions
 * - Broadcasting inventory availability changes
 * - Auto-promotion notifications
 * - Manual status change broadcasts
 * 
 * Server runs on port 8080 (separate from main Express app on port 3000)
 */

const WebSocket = require('ws');
const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
}

// Get database connection
const { pool } = require('../config/database');

class WebSocketService {
    constructor() {
        this.wss = null;
        this.batchSubscriptions = new Map(); // batchId -> Set of WebSocket connections
        this.userConnections = new Map(); // userId -> WebSocket connection
        this.port = process.env.WEBSOCKET_PORT || 8080;
        this.isRunning = false;
    }

    /**
     * Start the WebSocket server
     */
    start() {
        if (this.isRunning) {
            console.log('⚠️  WebSocket server is already running');
            return;
        }

        this.wss = new WebSocket.Server({ 
            port: this.port,
            perMessageDeflate: false 
        });

        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req);
        });

        this.isRunning = true;
        console.log(`🔌 WebSocket server started on port ${this.port}`);
    }

    /**
     * Handle new WebSocket connection
     */
    handleConnection(ws, req) {
        // Extract user info from request (if using auth)
        const userId = this.extractUserIdFromRequest(req);
        const userType = this.extractUserTypeFromRequest(req);

        ws.userId = userId;
        ws.userType = userType;

        if (userId) {
            this.userConnections.set(userId, ws);
        }

        console.log(`🔌 ${userType} user ${userId || 'anonymous'} connected`);

        // Handle incoming messages
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                this.handleMessage(ws, data);
            } catch (error) {
                console.error('❌ Error parsing WebSocket message:', error.message);
            }
        });

        // Handle connection close
        ws.on('close', () => {
            console.log(`🔌 ${userType} user ${userId || 'anonymous'} disconnected`);
            this.handleDisconnection(ws);
        });

        // Handle errors
        ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error.message);
        });
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleMessage(ws, data) {
        switch (data.type) {
            case 'subscribe_batch':
                this.handleBatchSubscription(ws, data.batch_id);
                break;

            case 'unsubscribe_batch':
                this.handleBatchUnsubscription(ws, data.batch_id);
                break;

            case 'acknowledge_notification':
                this.handleNotificationAcknowledgment(ws, data.notification_id);
                break;

            default:
                console.log('❓ Unknown message type:', data.type);
        }
    }

    /**
     * Handle disconnection cleanup
     */
    handleDisconnection(ws) {
        const userId = ws.userId;

        if (userId) {
            this.userConnections.delete(userId);
        }

        // Remove from all batch subscriptions
        for (const [batchId, clients] of this.batchSubscriptions.entries()) {
            clients.delete(ws);
        }
    }

    /**
     * Client subscribes to batch inventory updates
     */
    handleBatchSubscription(ws, batchId) {
        if (!this.batchSubscriptions.has(batchId)) {
            this.batchSubscriptions.set(batchId, new Set());
        }
        this.batchSubscriptions.get(batchId).add(ws);

        console.log(`📊 Client subscribed to batch ${batchId}`);

        // Send current state immediately
        this.sendCurrentBatchState(ws, batchId);
    }

    /**
     * Client unsubscribes from batch updates
     */
    handleBatchUnsubscription(ws, batchId) {
        if (this.batchSubscriptions.has(batchId)) {
            this.batchSubscriptions.get(batchId).delete(ws);
            console.log(`📊 Client unsubscribed from batch ${batchId}`);
        }
    }

    /**
     * Send current batch state to newly subscribed client
     */
    async sendCurrentBatchState(ws, batchId) {
        try {
            const client = await pool.connect();
            const batch = await client.query(`
                SELECT 
                    quantity - allocated_quantity as available,
                    quantity,
                    allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [batchId]);

            if (batch.rows.length > 0) {
                ws.send(JSON.stringify({
                    type: 'batch_current_state',
                    batch_id: batchId,
                    available_quantity: parseInt(batch.rows[0].available) || 0,
                    total_quantity: parseInt(batch.rows[0].quantity) || 0,
                    allocated_quantity: parseInt(batch.rows[0].allocated_quantity) || 0
                }));
            }

            client.release();
        } catch (error) {
            console.error('❌ Error sending current batch state:', error.message);
        }
    }

    /**
     * Broadcast inventory update to all subscribers
     * Called after any allocation/deallocation
     */
    async broadcastInventoryUpdate(batchId, newAvailableQuantity) {
        if (!this.batchSubscriptions.has(batchId) || this.batchSubscriptions.get(batchId).size === 0) {
            return; // No subscribers
        }

        const message = JSON.stringify({
            type: 'batch_inventory_update',
            batch_id: batchId,
            available_quantity: newAvailableQuantity,
            timestamp: new Date().toISOString()
        });

        const subscribers = this.batchSubscriptions.get(batchId);
        let sentCount = 0;

        for (const client of subscribers) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
                sentCount++;
            }
        }

        console.log(`📡 Broadcasted inventory update for batch ${batchId} to ${sentCount} subscribers`);
    }

    /**
     * Broadcast when On Deck batches are promoted to Sellable
     * Shows notification banner to external buyers
     */
    async broadcastNewInventoryAvailable(inventoryData) {
        const message = JSON.stringify({
            type: 'new_inventory_available',
            data: {
                master_product_id: inventoryData.master_product_id,
                product_name: inventoryData.product_name,
                category: inventoryData.category,
                batch_count: inventoryData.newly_available_batches.length,
                total_quantity: inventoryData.total_quantity_available,
                batches: inventoryData.newly_available_batches.map(b => ({
                    id: b.id,
                    batch_name: b.batch_name,
                    quantity: b.quantity,
                    thc_percentage: b.thc_percentage
                })),
                timestamp: new Date().toISOString()
            }
        });

        let sentCount = 0;

        // Broadcast to all connected clients
        if (this.wss) {
            this.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(message);
                    sentCount++;
                }
            });
        }

        console.log(`📡 Broadcasted new inventory availability for ${inventoryData.product_name} to ${sentCount} clients`);
    }

    /**
     * Broadcast that a package has been locked by fulfillment
     * (For Module 5 - Fulfillment functionality)
     */
    async broadcastPackageLocked(packageLabel, invoiceId, userId) {
        const message = JSON.stringify({
            type: 'package_locked',
            package_label: packageLabel,
            invoice_id: invoiceId,
            locked_by_user_id: userId,
            timestamp: new Date().toISOString()
        });

        if (this.wss) {
            this.wss.clients.forEach(client => {
                if (client.userType === 'fulfillment' && client.readyState === WebSocket.OPEN) {
                    client.send(message);
                }
            });
        }
    }

    /**
     * Broadcast notification to all fulfillment team members
     * @param {Object} notification - Notification object
     */
    async broadcastToFulfillmentTeam(notification) {
        if (!this.wss) return;
        
        const message = JSON.stringify({
            type: 'fulfillment_notification',
            notification: notification,
            timestamp: new Date().toISOString()
        });

        this.wss.clients.forEach(client => {
            if (client.userType === 'fulfillment' && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    /**
     * Send persistent notification to specific user
     */
    async sendPersistentNotification(userId, notification) {
        const connection = this.userConnections.get(userId);

        if (connection && connection.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({
                type: 'persistent_notification',
                notification: notification,
                requires_acknowledgment: true,
                timestamp: new Date().toISOString()
            });
            connection.send(message);
        }
    }

    /**
     * Handle notification acknowledgment
     */
    async handleNotificationAcknowledgment(ws, notificationId) {
        const userId = ws.userId;

        try {
            const client = await pool.connect();
            await client.query(`
                UPDATE user_notifications
                SET 
                    acknowledged = true,
                    acknowledged_at = NOW()
                WHERE id = $1 AND user_id = $2
            `, [notificationId, userId]);

            client.release();
            console.log(`✓ Notification ${notificationId} acknowledged by user ${userId}`);
        } catch (error) {
            console.error('❌ Error acknowledging notification:', error.message);
        }
    }

    /**
     * Get WebSocket server instance
     */
    getServer() {
        return this.wss;
    }

    /**
     * Get connection count
     */
    getConnectionStats() {
        return {
            total_connections: this.wss ? this.wss.clients.size : 0,
            batch_subscriptions: this.batchSubscriptions.size,
            active_batch_subscribers: Array.from(this.batchSubscriptions.values())
                .reduce((sum, set) => sum + set.size, 0),
            user_connections: this.userConnections.size
        };
    }

    /**
     * Extract user ID from request (placeholder - implement based on your auth)
     */
    extractUserIdFromRequest(req) {
        // TODO: Implement actual auth extraction
        // For now, return null
        return null;
    }

    /**
     * Extract user type from request (placeholder - implement based on your auth)
     */
    extractUserTypeFromRequest(req) {
        // TODO: Implement actual user type extraction
        // For now, return 'external'
        return 'external';
    }
}

// Export singleton instance
const websocketService = new WebSocketService();

module.exports = websocketService;

