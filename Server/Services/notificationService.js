/**
 * Notification Service
 * 
 * Handles notifications for invoice state changes
 * Supports WebSocket (real-time) and can be extended for email/SMS
 */

const { query } = require('../config/database');
const websocketService = require('./websocketService');
const notificationStore = require('./notificationStoreService');

class NotificationService {
    /**
     * Notify sales rep of pending approval
     * @param {number} invoiceId - Invoice ID
     */
    async notifySalesRep(invoiceId) {
        try {
            // Get invoice details and sales rep info
            const invoice = await query(`
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.fk_buyer_id,
                    i.assigned_sales_rep_id,
                    b.name as buyer_name,
                    u.email as sales_rep_email,
                    u.first_name || ' ' || u.last_name as sales_rep_name
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                LEFT JOIN users u ON i.assigned_sales_rep_id = u.id
                WHERE i.id = $1
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                console.warn(`Invoice ${invoiceId} not found for sales rep notification`);
                return { success: false, error: 'Invoice not found' };
            }

            const invoiceData = invoice.rows[0];
            const salesRepId = invoiceData.assigned_sales_rep_id;

            if (!salesRepId) {
                console.log(`Invoice ${invoiceId} has no assigned sales rep, skipping notification`);
                return { success: true, skipped: true, reason: 'no_sales_rep' };
            }

            const isEnabled = await notificationStore.isNotificationEnabled(salesRepId, 'invoice_pending_approval');
            if (!isEnabled) {
                return { success: true, skipped: true, reason: 'preference_disabled' };
            }

            const notification = {
                type: 'invoice_pending_approval',
                title: 'New Order Pending Approval',
                message: `Order ${invoiceData.invoice_number} from ${invoiceData.buyer_name || 'Unknown Buyer'} is pending your approval`,
                invoice_id: invoiceId,
                invoice_number: invoiceData.invoice_number,
                buyer_name: invoiceData.buyer_name,
                timestamp: new Date().toISOString(),
                priority: 'high'
            };

            const record = await notificationStore.createNotification({
                userId: salesRepId,
                type: notification.type,
                title: notification.title,
                message: notification.message,
                payload: notification,
                priority: notification.priority,
                requiresAck: true
            });

            await websocketService.sendPersistentNotification(salesRepId, {
                ...notification,
                id: record.id
            });

            console.log(`✅ Sales rep ${salesRepId} notified of pending approval for invoice ${invoiceId}`);
            
            // TODO: Add email notification here if email service is configured
            // if (invoiceData.sales_rep_email) {
            //     await this.sendEmailNotification({
            //         to: invoiceData.sales_rep_email,
            //         subject: `New Order Pending Approval: ${invoiceData.invoice_number}`,
            //         template: 'pending_approval',
            //         data: invoiceData
            //     });
            // }

            return { success: true, notification };
        } catch (error) {
            console.error('Error notifying sales rep:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Notify fulfillment team of new approved order
     * @param {number} invoiceId - Invoice ID
     */
    async notifyFulfillment(invoiceId) {
        try {
            // Get invoice details
            const invoice = await query(`
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.fk_buyer_id,
                    i.fk_location_id,
                    b.name as buyer_name,
                    l.name as location_name
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                LEFT JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                WHERE i.id = $1
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                console.warn(`Invoice ${invoiceId} not found for fulfillment notification`);
                return { success: false, error: 'Invoice not found' };
            }

            const invoiceData = invoice.rows[0];

            // Get fulfillment team users (users with 'Fulfillment' role)
            const fulfillmentUsers = await query(`
                SELECT DISTINCT u.id
                FROM users u
                JOIN user_roles ur ON u.id = ur.user_id
                JOIN roles r ON ur.role_id = r.id
                WHERE LOWER(r.name) = 'fulfillment' 
                   OR LOWER(r.role_name) = 'fulfillment'
            `);

            const notification = {
                type: 'invoice_approved',
                title: 'New Order Ready for Fulfillment',
                message: `Order ${invoiceData.invoice_number} from ${invoiceData.buyer_name || 'Unknown Buyer'} (${invoiceData.location_name || 'Unknown Location'}) is ready for fulfillment`,
                invoice_id: invoiceId,
                invoice_number: invoiceData.invoice_number,
                buyer_name: invoiceData.buyer_name,
                location_name: invoiceData.location_name,
                timestamp: new Date().toISOString(),
                priority: 'medium'
            };

            for (const user of fulfillmentUsers.rows) {
                const enabled = await notificationStore.isNotificationEnabled(user.id, 'invoice_approved');
                if (!enabled) {
                    continue;
                }

                const record = await notificationStore.createNotification({
                    userId: user.id,
                    type: notification.type,
                    title: notification.title,
                    message: notification.message,
                    payload: notification,
                    priority: notification.priority,
                    requiresAck: false
                });

                await websocketService.sendPersistentNotification(user.id, {
                    ...notification,
                    id: record.id
                });
            }

            // Also broadcast to all fulfillment connections
            await websocketService.broadcastToFulfillmentTeam(notification);

            console.log(`✅ Fulfillment team notified of approved order ${invoiceId}`);
            
            return { success: true, notified_users: fulfillmentUsers.rows.length, notification };
        } catch (error) {
            console.error('Error notifying fulfillment team:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Notify customer of shipment
     * @param {number} invoiceId - Invoice ID
     */
    async notifyCustomerShipment(invoiceId) {
        try {
            // Get invoice and buyer details
            const invoice = await query(`
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.fk_buyer_id,
                    i.fk_location_id,
                    i.shipped_at,
                    i.estimated_delivery,
                    b.name as buyer_name,
                    l.name as location_name,
                    bc.email as contact_email
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                LEFT JOIN "ORDERS-buyer_locations" l ON i.fk_location_id = l.entry_id
                LEFT JOIN "ORDERS-buyer_contacts" bc ON bc.orders_buyer_id = i.fk_buyer_id
                WHERE i.id = $1
                ORDER BY bc.entry_id ASC
                LIMIT 1
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                console.warn(`Invoice ${invoiceId} not found for customer notification`);
                return { success: false, error: 'Invoice not found' };
            }

            const invoiceData = invoice.rows[0];

            // For external orders, we can't send WebSocket notifications (no logged-in user)
            // But we can log it and prepare for email notification
            const notification = {
                type: 'invoice_shipped',
                title: 'Order Shipped',
                message: `Your order ${invoiceData.invoice_number} has been shipped`,
                invoice_id: invoiceId,
                invoice_number: invoiceData.invoice_number,
                shipped_at: invoiceData.shipped_at,
                estimated_delivery: invoiceData.estimated_delivery,
                timestamp: new Date().toISOString()
            };

            console.log(`📦 Customer notification prepared for invoice ${invoiceId}`);
            
            // TODO: Add email notification here if email service is configured
            // if (invoiceData.contact_email) {
            //     await this.sendEmailNotification({
            //         to: invoiceData.contact_email,
            //         subject: `Your Order ${invoiceData.invoice_number} Has Been Shipped`,
            //         template: 'order_shipped',
            //         data: invoiceData
            //     });
            // }

            // Log notification for external portal users (they can check order status)
            // Note: Using 'status_changed' as modification_type since 'customer_notified' may not exist in enum
            await query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id, modification_type, field_name,
                    old_value, new_value, reason, changed_by_system
                ) VALUES ($1, 'status_changed', 'shipment_notification', NULL, $2, 'Customer notified of shipment', true)
            `, [invoiceId, JSON.stringify(notification)]);

            return { success: true, notification };
        } catch (error) {
            console.error('Error notifying customer:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Notify customer of order cancellation
     * @param {number} invoiceId - Invoice ID
     */
    async notifyCustomerCancellation(invoiceId) {
        try {
            const invoice = await query(`
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.fk_buyer_id,
                    b.name as buyer_name,
                    bc.email as contact_email
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                LEFT JOIN "ORDERS-buyer_contacts" bc ON bc.orders_buyer_id = i.fk_buyer_id
                WHERE i.id = $1
                ORDER BY bc.entry_id ASC
                LIMIT 1
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                return { success: false, error: 'Invoice not found' };
            }

            const invoiceData = invoice.rows[0];

            const notification = {
                type: 'invoice_cancelled',
                title: 'Order Cancelled',
                message: `Your order ${invoiceData.invoice_number} has been cancelled`,
                invoice_id: invoiceId,
                invoice_number: invoiceData.invoice_number,
                timestamp: new Date().toISOString()
            };

            console.log(`📧 Customer cancellation notification prepared for invoice ${invoiceId}`);
            
            // TODO: Add email notification here
            // if (invoiceData.contact_email) {
            //     await this.sendEmailNotification({
            //         to: invoiceData.contact_email,
            //         subject: `Order ${invoiceData.invoice_number} Cancelled`,
            //         template: 'order_cancelled',
            //         data: invoiceData
            //     });
            // }

            return { success: true, notification };
        } catch (error) {
            console.error('Error notifying customer of cancellation:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Notify buyer contacts that a credit was issued (best-effort)
     */
    async notifyBuyerCreditIssued({ creditId, locationId, amount, reason }) {
        try {
            const result = await query(`
                SELECT 
                    b.entry_id AS buyer_id,
                    b.name AS buyer_name,
                    l.name AS location_name,
                    bc.name AS contact_name,
                    bc.email AS contact_email
                FROM "ORDERS-buyer_locations" l
                LEFT JOIN "ORDERS-buyers" b ON l.orders_buyer_id = b.entry_id
                LEFT JOIN "ORDERS-buyer_contacts" bc ON bc.orders_buyer_id = b.entry_id
                WHERE l.entry_id = $1
                ORDER BY bc.entry_id ASC
                LIMIT 1
            `, [locationId]);

            if (result.rows.length === 0) {
                console.warn(`Unable to notify buyer for credit ${creditId}: location ${locationId} not found`);
                return { success: false, reason: 'no_buyer_info' };
            }

            const buyer = result.rows[0];
            const amountText = Number(amount || 0).toFixed(2);
            const note = `System: Buyer notified of $${amountText} credit (${reason || 'No reason provided'}) for location ${buyer.location_name || 'Unknown Location'}.`;

            if (buyer.buyer_id) {
                await query(`
                    INSERT INTO "ORDERS-buyer_notes" (orders_buyer_id, note)
                    VALUES ($1, $2)
                `, [buyer.buyer_id, note]);
            }

            if (buyer.contact_email) {
                console.log(`📧 Buyer notification queued for ${buyer.contact_email} about credit ${creditId}`);
                // TODO: integrate with email/SMS service
            } else {
                console.log(`ℹ️ Buyer ${buyer.buyer_name || buyer.buyer_id} has no contact email on file for credit notification.`);
            }

            return { success: true };
        } catch (error) {
            console.error('Error notifying buyer about credit issuance:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Notify accounting/finance team of credit events (voids, manual corrections)
     */
    async notifyAccountingCreditEvent({ eventType, creditId, locationId, amount, delta = null, performedBy = null, reason = null }) {
        try {
            const accountingUsers = await query(`
                SELECT DISTINCT u.id
                FROM users u
                JOIN user_roles ur ON u.id = ur.user_id
                JOIN roles r ON ur.role_id = r.id
                WHERE LOWER(r.name) = 'accounting/finance'
                   OR LOWER(r.role_name) = 'accounting/finance'
            `);

            if (accountingUsers.rows.length === 0) {
                return { success: true, skipped: true, reason: 'no_accounting_users' };
            }

            const creditInfoResult = await query(`
                SELECT 
                    b.name AS buyer_name,
                    l.name AS location_name
                FROM "ORDERS-account-credits" c
                LEFT JOIN "ORDERS-buyer_locations" l ON c.fk_location_id = l.entry_id
                LEFT JOIN "ORDERS-buyers" b ON l.orders_buyer_id = b.entry_id
                WHERE c.id = $1
            `, [creditId]);

            const creditInfo = creditInfoResult.rows[0] || {};
            const formattedAmount = Number(amount || 0).toFixed(2);
            const formattedDelta = delta !== null ? Number(delta).toFixed(2) : null;
            const title = eventType === 'credit_voided' ? 'Account Credit Voided' : 'Manual Credit Correction';
            const message = eventType === 'credit_voided'
                ? `Credit #${creditId} for ${creditInfo.buyer_name || 'Buyer'} (${creditInfo.location_name || 'Location'}) was voided.`
                : `Credit #${creditId} balance updated to $${formattedAmount}.`;

            let notified = 0;
            for (const user of accountingUsers.rows) {
                const enabled = await notificationStore.isNotificationEnabled(user.id, 'accounting_credit_event');
                if (!enabled) {
                    continue;
                }

                const payload = {
                    eventType,
                    creditId,
                    locationId,
                    amount: formattedAmount,
                    delta: formattedDelta,
                    buyer_name: creditInfo.buyer_name,
                    location_name: creditInfo.location_name,
                    reason,
                    performed_by: performedBy
                };

                const record = await notificationStore.createNotification({
                    userId: user.id,
                    type: 'accounting_credit_event',
                    title,
                    message,
                    payload,
                    priority: 'high',
                    requiresAck: false
                });

                await websocketService.sendPersistentNotification(user.id, {
                    type: 'accounting_credit_event',
                    title,
                    message,
                    payload,
                    id: record.id,
                    timestamp: record.created_at
                });

                notified += 1;
            }

            return { success: true, notified_users: notified };
        } catch (error) {
            console.error('Error notifying accounting team about credit event:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new NotificationService();

