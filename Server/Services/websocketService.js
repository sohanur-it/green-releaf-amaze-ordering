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
const notificationStore = require('./notificationStoreService');

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

        try {
            this.wss = new WebSocket.Server({ 
                port: this.port,
                perMessageDeflate: false,
                clientTracking: true
            });

            // Handle server errors
            this.wss.on('error', (error) => {
                console.error('❌ WebSocket server error:', error.message);
                if (error.code === 'EADDRINUSE') {
                    console.error(`❌ Port ${this.port} is already in use. Please free the port or change WEBSOCKET_PORT in your .env file.`);
                }
                this.isRunning = false;
            });

            this.wss.on('connection', (ws, req) => {
                this.handleConnection(ws, req);
            });

            // WebSocket.Server starts immediately, so mark as running
            // The 'listening' event doesn't exist for WebSocket.Server
            this.isRunning = true;
            console.log(`🔌 WebSocket server started successfully on port ${this.port}`);
            
            // Verify server is actually listening
            this.wss.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    console.error(`❌ Port ${this.port} is already in use. Please free the port or change WEBSOCKET_PORT in your .env file.`);
                    this.isRunning = false;
                }
            });

        } catch (error) {
            console.error('❌ Failed to start WebSocket server:', error.message);
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Port ${this.port} is already in use. Please free the port or change WEBSOCKET_PORT in your .env file.`);
            }
            this.isRunning = false;
            throw error;
        }
    }

    /**
     * Handle new WebSocket connection
     */
    handleConnection(ws, req) {
        // Extract user info from request (if using auth)
        const userId = this.extractUserIdFromRequest(req);
        const userType = this.extractUserTypeFromRequest(req);
        
        // Extract session ID from cookies or query params for external portal
        const sessionId = this.extractSessionIdFromRequest(req);

        ws.userId = userId;
        ws.userType = userType;
        ws.sessionId = sessionId; // Store session ID to filter self-broadcasts

        if (userId) {
            this.userConnections.set(userId, ws);
        }

        console.log(`🔌 ${userType} user ${userId || 'anonymous'} connected (session: ${sessionId || 'none'})`);

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
     * Section 10.3.2: Add disconnection cleanup - Release locks held by disconnected user, broadcast release events
     */
    async handleDisconnection(ws) {
        const userId = ws.userId;

        if (userId) {
            this.userConnections.delete(userId);
            
            // Section 10.3.2: Release locks held by disconnected user
            try {
                await this.releaseLocksForDisconnectedUser(userId);
            } catch (error) {
                console.error(`[WebSocket] Error releasing locks for disconnected user ${userId}:`, error.message);
            }
        }

        // Remove from all batch subscriptions
        for (const [batchId, clients] of this.batchSubscriptions.entries()) {
            clients.delete(ws);
        }
    }
    
    /**
     * Section 10.3.2: Release locks held by disconnected user
     */
    async releaseLocksForDisconnectedUser(userId) {
        const client = await pool.connect();
        
        try {
            // Find all active scanning sessions for this user
            const sessions = await client.query(`
                SELECT 
                    id,
                    fk_invoice_id,
                    currently_locked_packages
                FROM "ORDERS-scanning-sessions"
                WHERE fk_user_id = $1
                    AND session_status = 'active'
                    AND currently_locked_packages IS NOT NULL
                    AND jsonb_array_length(currently_locked_packages::jsonb) > 0
            `, [userId]);
            
            for (const session of sessions.rows) {
                const lockedPackages = Array.isArray(session.currently_locked_packages)
                    ? session.currently_locked_packages
                    : JSON.parse(session.currently_locked_packages || '[]');
                
                if (lockedPackages.length > 0) {
                    // Clear locked packages from session
                    await client.query(`
                        UPDATE "ORDERS-scanning-sessions"
                        SET currently_locked_packages = '[]'::jsonb
                        WHERE id = $1
                    `, [session.id]);
                    
                    // Broadcast release events
                    await this.broadcastPackageReleased(lockedPackages, session.fk_invoice_id);
                    
                    console.log(`[WebSocket] Released ${lockedPackages.length} package(s) for disconnected user ${userId} (session ${session.id})`);
                }
            }
        } catch (error) {
            console.error(`[WebSocket] Error in releaseLocksForDisconnectedUser:`, error.message);
            throw error;
        } finally {
            client.release();
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
        const message = JSON.stringify({
            type: 'batch_inventory_update',
            batch_id: batchId,
            available_quantity: newAvailableQuantity,
            timestamp: new Date().toISOString()
        });

        const targets = new Set();

        if (this.wss) {
            this.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    targets.add(client);
                }
            });
        }

        if (this.batchSubscriptions.has(batchId)) {
            const subscribers = this.batchSubscriptions.get(batchId);
            for (const client of subscribers) {
                if (client.readyState === WebSocket.OPEN) {
                    targets.add(client);
                }
            }
        }

        let sentCount = 0;
        targets.forEach(client => {
            try {
                client.send(message);
                sentCount++;
            } catch (error) {
                console.error('❌ Failed to send inventory update:', error.message);
            }
        });

        console.log(`📡 Broadcasted inventory update for batch ${batchId} to ${sentCount} clients`);
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
     * Section 10.2: Add WebSocket acknowledgment handler - emit notification:acknowledged event
     */
    async handleNotificationAcknowledgment(ws, notificationId) {
        const userId = ws.userId;

        try {
            await notificationStore.markNotificationAcknowledged(notificationId, userId);
            console.log(`✓ Notification ${notificationId} acknowledged by user ${userId}`);
            
            // Section 10.2: Emit notification:acknowledged event via WebSocket
            const message = JSON.stringify({
                type: 'notification:acknowledged',
                notification_id: notificationId,
                success: true,
                timestamp: new Date().toISOString()
            });
            
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        } catch (error) {
            console.error('❌ Error acknowledging notification:', error.message);
            
            // Section 10.2: Send error response via WebSocket
            const errorMessage = JSON.stringify({
                type: 'notification:acknowledged',
                notification_id: notificationId,
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(errorMessage);
            }
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

    /**
     * Extract session ID from request (for filtering self-broadcasts)
     */
    extractSessionIdFromRequest(req) {
        // Try to get session ID from cookies
        if (req.headers.cookie) {
            const cookies = req.headers.cookie.split(';').reduce((acc, cookie) => {
                const [key, value] = cookie.trim().split('=');
                acc[key] = value;
                return acc;
            }, {});
            
            // Common session cookie names
            if (cookies['connect.sid']) {
                return cookies['connect.sid'].replace('s:', '').split('.')[0];
            }
            if (cookies['sessionId']) {
                return cookies['sessionId'];
            }
        }
        
        // Try query parameter
        if (req.url) {
            const url = new URL(req.url, `http://${req.headers.host}`);
            if (url.searchParams.get('sessionId')) {
                return url.searchParams.get('sessionId');
            }
        }
        
        return null;
    }

    /**
     * Broadcast JSON payload to all connected clients
     * @param {Object} payload 
     * @param {string} excludeSessionId - Optional: Don't send to this session (prevents self-broadcasts)
     */
    broadcastJson(payload, excludeSessionId = null) {
        if (!this.wss || !payload) {
            return;
        }

        const message = JSON.stringify(payload);
        let sentCount = 0;
        let skippedCount = 0;

        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                // Skip if this is the session that triggered the event
                if (excludeSessionId && client.sessionId === excludeSessionId) {
                    skippedCount++;
                    return;
                }
                
                client.send(message);
                sentCount++;
            }
        });

        if (excludeSessionId) {
            console.log(`📡 Broadcasted to ${sentCount} clients (skipped ${skippedCount} self-broadcast)`);
        }
    }

    /**
     * Broadcast invoice-related event to all clients
     * @param {number} invoiceId 
     * @param {string} event 
     * @param {Object} extra 
     */
    async broadcastInvoiceEvent(invoiceId, event, extra = {}) {
        if (!this.wss || this.wss.clients.size === 0) {
            return;
        }

        let invoiceRecord = null;
        let metadata = { ...extra };

        try {
            const client = await pool.connect();
            const result = await client.query(`
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.status,
                    i.source,
                    i.subtotal,
                    i.total,
                    i.cart_expires_at,
                    i.created_at,
                    i.updated_at,
                    i.fk_buyer_id,
                    i.fk_location_id,
                    COALESCE(b.name, 'Unknown Buyer') as buyer_name,
                    COALESCE(l.name, 'Unknown Location') as location_name
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                LEFT JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                WHERE i.id = $1
            `, [invoiceId]);

            if (result.rows.length > 0) {
                const record = result.rows[0];
                invoiceRecord = {
                    id: record.id,
                    invoice_number: record.invoice_number,
                    status: record.status,
                    source: record.source,
                    subtotal: parseFloat(record.subtotal || 0),
                    total: parseFloat(record.total || 0),
                    cart_expires_at: record.cart_expires_at,
                    created_at: record.created_at,
                    updated_at: record.updated_at,
                    buyer_id: record.fk_buyer_id,
                    buyer_name: record.buyer_name,
                    location_id: record.fk_location_id,
                    location_name: record.location_name
                };

                metadata.buyer_id = metadata.buyer_id ?? record.fk_buyer_id;
                metadata.location_id = metadata.location_id ?? record.fk_location_id;
            } else {
                metadata.buyer_id = metadata.buyer_id ?? null;
                metadata.location_id = metadata.location_id ?? null;
            }

            client.release();
        } catch (error) {
            console.error('❌ Error fetching invoice for WebSocket broadcast:', error.message);
        }

        const payload = {
            type: 'invoice_sync',
            event: event,
            invoice_id: invoiceId,
            invoice: invoiceRecord,
            buyer_id: metadata.buyer_id ?? null,
            location_id: metadata.location_id ?? null,
            triggered_by: metadata.triggered_by || null, // Track who triggered this
            triggered_by_session_id: metadata.triggered_by_session_id || null,
            metadata,
            timestamp: new Date().toISOString()
        };

        // Exclude the session that triggered this event (prevents self-broadcasts)
        const excludeSessionId = metadata.exclude_session || null;
        this.broadcastJson(payload, excludeSessionId);
    }

    /**
     * Module 5: Broadcast package locked event
     * @param {string} packageLabel 
     * @param {number} invoiceId 
     * @param {number} userId 
     */
    async broadcastPackageLocked(packageLabel, invoiceId, userId) {
        if (!this.wss) return;

        try {
            // Get user name
            const client = await pool.connect();
            const userResult = await client.query(`
                SELECT first_name, last_name FROM users WHERE id = $1
            `, [userId]);
            client.release();

            const userName = userResult.rows[0] 
                ? `${userResult.rows[0].first_name} ${userResult.rows[0].last_name}`
                : 'Unknown';

            // Get invoice number
            const invClient = await pool.connect();
            const invResult = await invClient.query(`
                SELECT invoice_number FROM "ORDERS-invoices" WHERE id = $1
            `, [invoiceId]);
            invClient.release();

            const invoiceNumber = invResult.rows[0]?.invoice_number || 'Unknown';

            const payload = {
                type: 'package:locked',
                package_label: packageLabel,  // Section 10.1: Use consistent naming
                locked_by_user_id: userId,
                locked_by_user_name: userName,  // Section 10.1: Include user name for UI display
                invoice_id: invoiceId,
                invoice_number: invoiceNumber,
                timestamp: new Date().toISOString()
            };

            this.broadcastJson(payload);
        } catch (error) {
            console.error('Error broadcasting package locked:', error);
        }
    }

    /**
     * Module 5: Broadcast package released event
     * @param {string|string[]} packageLabels 
     * @param {number} invoiceId 
     */
    broadcastPackageReleased(packageLabels, invoiceId = null) {
        if (!this.wss) return;

        const labels = Array.isArray(packageLabels) ? packageLabels : [packageLabels];

        const payload = {
            type: 'package:released',
            packageLabels: labels,
            invoiceId,
            timestamp: new Date().toISOString()
        };

        this.broadcastJson(payload);
    }

    /**
     * Module 5: Broadcast order claimed event
     * @param {number} invoiceId 
     * @param {string} invoiceNumber 
     * @param {number} userId 
     */
    async broadcastOrderClaimed(invoiceId, invoiceNumber, userId) {
        if (!this.wss) return;

        try {
            const client = await pool.connect();
            const result = await client.query(`
                SELECT first_name, last_name FROM users WHERE id = $1
            `, [userId]);
            client.release();

            const userName = result.rows[0] 
                ? `${result.rows[0].first_name} ${result.rows[0].last_name}`
                : 'Unknown';

            const payload = {
                type: 'order:claimed',
                invoice_id: invoiceId,
                invoice_number: invoiceNumber,
                worker_id: userId,
                worker_name: userName,
                timestamp: new Date().toISOString()
            };

            this.broadcastJson(payload);
        } catch (error) {
            console.error('Error broadcasting order claimed:', error);
        }
    }

    /**
     * Module 5: Broadcast order released event
     * @param {number} invoiceId 
     * @param {string} invoiceNumber 
     */
    broadcastOrderReleased(invoiceId, invoiceNumber) {
        if (!this.wss) return;

        const payload = {
            type: 'order:released',
            invoice_id: invoiceId,
            invoice_number: invoiceNumber,
            timestamp: new Date().toISOString()
        };

        this.broadcastJson(payload);
    }

    /**
     * Module 5: Broadcast order reassigned event
     * @param {number} invoiceId 
     * @param {string} invoiceNumber 
     * @param {number} fromUserId 
     * @param {number} toUserId 
     */
    async broadcastOrderReassigned(invoiceId, invoiceNumber, fromUserId, toUserId) {
        if (!this.wss) return;

        try {
            const client = await pool.connect();
            const fromResult = await client.query(`
                SELECT first_name, last_name FROM users WHERE id = $1
            `, [fromUserId]);
            const toResult = await client.query(`
                SELECT first_name, last_name FROM users WHERE id = $1
            `, [toUserId]);
            client.release();

            const fromUserName = fromResult.rows[0] 
                ? `${fromResult.rows[0].first_name} ${fromResult.rows[0].last_name}`
                : 'Unknown';
            const toUserName = toResult.rows[0] 
                ? `${toResult.rows[0].first_name} ${toResult.rows[0].last_name}`
                : 'Unknown';

            const payload = {
                type: 'order:reassigned',
                invoice_id: invoiceId,
                invoice_number: invoiceNumber,
                from_user_id: fromUserId,
                from_user_name: fromUserName,
                to_user_id: toUserId,
                to_user_name: toUserName,
                timestamp: new Date().toISOString()
            };

            this.broadcastJson(payload);
        } catch (error) {
            console.error('Error broadcasting order reassigned:', error);
        }
    }

    /**
     * Module 5: Send persistent notification to specific user
     * @param {number} userId 
     * @param {Object} notification 
     */
    async sendPersistentNotification(userId, notification) {
        if (!this.wss) return;

        // Store notification in database first
        try {
            const client = await pool.connect();
            await client.query(`
                INSERT INTO user_notifications (
                    user_id, notification_type, title, message, payload, 
                    priority, requires_ack, is_read, acknowledged
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, false)
            `, [
                userId,
                notification.type || 'fulfillment_notification',
                notification.title || 'Fulfillment Notification',
                notification.message || '',
                JSON.stringify(notification.payload || {}),
                notification.priority || 'normal',
                notification.requiresAck || false
            ]);
            client.release();
        } catch (error) {
            console.error('Error storing persistent notification:', error);
        }

        // Send to user if connected
        const payload = {
            type: 'notification:persistent',
            userId,
            notification: {
                ...notification,
                timestamp: new Date().toISOString()
            }
        };

        // Send to specific user's connections
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.userId === userId) {
                client.send(JSON.stringify(payload));
            }
        });
    }

    /**
     * Module 5: Broadcast batch inventory update
     * @param {number} batchId 
     * @param {number} availableQuantity 
     * @param {number} allocatedQuantity 
     */
    broadcastBatchInventoryUpdate(batchId, availableQuantity, allocatedQuantity) {
        if (!this.wss) return;

        const payload = {
            type: 'batch:updated',
            batchId,
            availableQuantity,
            allocatedQuantity,
            lastUpdated: new Date().toISOString()
        };

        this.broadcastJson(payload);
    }

    /**
     * Module 5: Broadcast order approved event
     * Called when an invoice transitions to Approved status
     * @param {number} invoiceId 
     * @param {string} invoiceNumber 
     */
    async broadcastOrderApproved(invoiceId, invoiceNumber) {
        if (!this.wss) return;

        try {
            const client = await pool.connect();
            const result = await client.query(`
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.status,
                    i.approved_at,
                    i.fk_buyer_id,
                    i.fk_location_id,
                    b.name as buyer_name,
                    bl.name as location_name,
                    bl.city,
                    bl.state,
                    bl.delivery_zone
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                LEFT JOIN "ORDERS-buyer_locations" bl ON i.fk_location_id = bl.entry_id
                WHERE i.id = $1
            `, [invoiceId]);
            client.release();

            if (result.rows.length === 0) {
                console.warn(`Invoice ${invoiceId} not found for broadcast`);
                return;
            }

            const invoice = result.rows[0];
            const payload = {
                type: 'order:approved',
                invoice_id: invoiceId,
                invoice_number: invoiceNumber || invoice.invoice_number,
                invoice: {
                    id: invoice.id,
                    invoice_number: invoice.invoice_number,
                    status: invoice.status,
                    approved_at: invoice.approved_at,
                    buyer_id: invoice.fk_buyer_id,
                    buyer_name: invoice.buyer_name,
                    location_id: invoice.fk_location_id,
                    location_name: invoice.location_name,
                    city: invoice.city,
                    state: invoice.state,
                    delivery_zone: invoice.delivery_zone
                },
                timestamp: new Date().toISOString()
            };

            this.broadcastJson(payload);
            console.log(`📡 Broadcasted order approved: ${invoiceNumber || invoice.invoice_number}`);
        } catch (error) {
            console.error('Error broadcasting order approved:', error);
        }
    }
}

// Export singleton instance
const websocketService = new WebSocketService();

module.exports = websocketService;

