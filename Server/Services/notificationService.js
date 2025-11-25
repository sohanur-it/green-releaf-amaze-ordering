/**
 * Notification Service
 * 
 * Handles notifications for invoice state changes
 * Supports WebSocket (real-time) and can be extended for email/SMS
 */

const { query } = require('../config/database');
const websocketService = require('./websocketService');
const notificationStore = require('./notificationStoreService');
const emailService = require('./emailService');

class NotificationService {
    /**
     * Notify sales rep and sales admins of pending approval
     * @param {number} invoiceId - Invoice ID
     */
    async notifySalesRep(invoiceId) {
        try {
            console.log(`[Notifications] notifySalesRep called for invoice ${invoiceId}`);
            
            // Get invoice details and sales rep info
            const invoice = await query(`
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.fk_buyer_id,
                    i.assigned_sales_rep_id,
                    i.total,
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
            const totalAmount = parseFloat(invoiceData.total || 0).toFixed(2);

            // Get all sales admins - Production database role name is "Sales Admin" (capital S and A)
            const salesAdmins = await query(`
                SELECT DISTINCT u.id, u.email, u.first_name, u.last_name, 
                       r.name as role_name
                FROM users u
                JOIN user_roles ur ON u.id = ur.user_id
                JOIN roles r ON ur.role_id = r.id
                WHERE LOWER(TRIM(r.name)) = 'sales admin'
                AND u.is_active = true
            `);
            
            console.log(`[Notifications] Found ${salesAdmins.rows.length} sales admins for invoice ${invoiceId}`);
            if (salesAdmins.rows.length > 0) {
                console.log(`[Notifications] Sales admin IDs: ${salesAdmins.rows.map(a => `${a.id} (${a.email}, role: ${a.role_name})`).join(', ')}`);
            } else {
                // Debug: Check what roles actually exist
                const allRoles = await query(`
                    SELECT DISTINCT r.name as role_name
                    FROM roles r
                    WHERE LOWER(r.name) LIKE '%sales%'
                       OR LOWER(r.name) LIKE '%admin%'
                `);
                console.log(`[Notifications] Available roles with 'sales' or 'admin': ${allRoles.rows.map(r => r.role_name).join(', ')}`);
            }

            let notifiedUsers = [];

            // Notify assigned sales rep if exists
            if (salesRepId) {
                const isEnabled = await notificationStore.isNotificationEnabled(salesRepId, 'invoice_pending_approval');
                if (isEnabled) {
                    const notification = {
                        type: 'invoice_pending_approval',
                        title: 'New Order Pending Approval',
                        message: `Order ${invoiceData.invoice_number} from ${invoiceData.buyer_name || 'Unknown Buyer'}, Total: $${totalAmount} is pending your approval`,
                        invoice_id: invoiceId,
                        invoice_number: invoiceData.invoice_number,
                        buyer_name: invoiceData.buyer_name,
                        total: totalAmount,
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

                    // Send email notification if enabled
                    if (invoiceData.sales_rep_email) {
                        await emailService.sendEmail({
                            to: invoiceData.sales_rep_email,
                            subject: `New Order Pending Approval: ${invoiceData.invoice_number}`,
                            template: 'pending_approval',
                            data: {
                                invoice_number: invoiceData.invoice_number,
                                buyer_name: invoiceData.buyer_name,
                                invoice_id: invoiceId,
                                total: totalAmount
                            }
                        });
                    }

                    notifiedUsers.push(salesRepId);
                    console.log(`✅ Sales rep ${salesRepId} notified of pending approval for invoice ${invoiceId}`);
                }
            }

            // Notify all sales admins
            for (const admin of salesAdmins.rows) {
                try {
                    // Skip if already notified (assigned sales rep is also a sales admin)
                    if (admin.id === salesRepId) {
                        console.log(`[Notifications] Skipping sales admin ${admin.id} - already notified as assigned sales rep`);
                        continue;
                    }

                    const isEnabled = await notificationStore.isNotificationEnabled(admin.id, 'invoice_pending_approval');
                    if (!isEnabled) {
                        console.log(`[Notifications] Skipping sales admin ${admin.id} - notification preference disabled`);
                        continue;
                    }
                    
                    console.log(`[Notifications] Notifying sales admin ${admin.id} (${admin.email}) for invoice ${invoiceId}`);

                    const notification = {
                        type: 'invoice_pending_approval',
                        title: 'New Order Pending Approval',
                        message: `New order ${invoiceData.invoice_number} from ${invoiceData.buyer_name || 'Unknown Buyer'}, Total: $${totalAmount} is pending approval`,
                        invoice_id: invoiceId,
                        invoice_number: invoiceData.invoice_number,
                        buyer_name: invoiceData.buyer_name,
                        total: totalAmount,
                        timestamp: new Date().toISOString(),
                        priority: 'high'
                    };

                    const record = await notificationStore.createNotification({
                        userId: admin.id,
                        type: notification.type,
                        title: notification.title,
                        message: notification.message,
                        payload: notification,
                        priority: notification.priority,
                        requiresAck: true
                    });

                    await websocketService.sendPersistentNotification(admin.id, {
                        ...notification,
                        id: record.id
                    });

                    // Send email notification if enabled
                    if (admin.email) {
                        await emailService.sendEmail({
                            to: admin.email,
                            subject: `New Order Pending Approval: ${invoiceData.invoice_number}`,
                            template: 'pending_approval',
                            data: {
                                invoice_number: invoiceData.invoice_number,
                                buyer_name: invoiceData.buyer_name,
                                invoice_id: invoiceId,
                                total: totalAmount
                            }
                        });
                    }

                    notifiedUsers.push(admin.id);
                    console.log(`✅ Sales admin ${admin.id} notified of pending approval for invoice ${invoiceId}`);
                } catch (adminError) {
                    console.error(`❌ Error notifying sales admin ${admin.id} (${admin.email}):`, adminError);
                    // Continue with other admins even if one fails
                }
            }

            if (notifiedUsers.length === 0) {
                console.log(`[Notifications] ⚠️ No users notified for invoice ${invoiceId} - no sales rep assigned and no sales admins found/enabled`);
                return { success: true, skipped: true, reason: 'no_users_to_notify' };
            }

            console.log(`[Notifications] ✅ Successfully notified ${notifiedUsers.length} user(s) for invoice ${invoiceId}: ${notifiedUsers.join(', ')}`);
            return { success: true, notified_users: notifiedUsers.length, user_ids: notifiedUsers };
        } catch (error) {
            console.error('Error notifying sales rep and admins:', error);
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
            
            // Send email notification if enabled
            if (invoiceData.contact_email) {
                await emailService.sendEmail({
                    to: invoiceData.contact_email,
                    subject: `Your Order ${invoiceData.invoice_number} Has Been Shipped`,
                    template: 'order_shipped',
                    data: {
                        invoice_number: invoiceData.invoice_number,
                        shipped_at: invoiceData.shipped_at,
                        estimated_delivery: invoiceData.estimated_delivery,
                        invoice_id: invoiceId
                    }
                });
            }

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
     * Notify customer of order approval (external orders only)
     * @param {number} invoiceId - Invoice ID
     */
    async notifyCustomerApproval(invoiceId) {
        try {
            const invoice = await query(`
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.fk_buyer_id,
                    i.source,
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

            // Only notify for external orders
            if (invoiceData.source !== 'External') {
                return { success: true, skipped: true, reason: 'not_external_order' };
            }

            const notification = {
                type: 'invoice_approved',
                title: 'Order Approved',
                message: `Your order ${invoiceData.invoice_number} has been approved and is being prepared`,
                invoice_id: invoiceId,
                invoice_number: invoiceData.invoice_number,
                timestamp: new Date().toISOString()
            };

            console.log(`📧 Customer approval notification prepared for invoice ${invoiceId}`);
            
            // Send email notification if enabled
            if (invoiceData.contact_email) {
                await emailService.sendEmail({
                    to: invoiceData.contact_email,
                    subject: `Order ${invoiceData.invoice_number} Approved`,
                    template: 'order_approved',
                    data: {
                        invoice_number: invoiceData.invoice_number,
                        invoice_id: invoiceId
                    }
                });
            }

            // Log notification for external portal users
            await query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id, modification_type, field_name,
                    old_value, new_value, reason, changed_by_system
                ) VALUES ($1, 'status_changed', 'approval_notification', NULL, $2, 'Customer notified of order approval', true)
            `, [invoiceId, JSON.stringify(notification)]);

            return { success: true, notification };
        } catch (error) {
            console.error('Error notifying customer of approval:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Notify customer and sales rep of delivery
     * @param {number} invoiceId - Invoice ID
     */
    async notifyDelivery(invoiceId) {
        try {
            const invoice = await query(`
                SELECT 
                    i.id,
                    i.invoice_number,
                    i.fk_buyer_id,
                    i.assigned_sales_rep_id,
                    i.source,
                    b.name as buyer_name,
                    bc.email as contact_email,
                    u.email as sales_rep_email,
                    u.first_name || ' ' || u.last_name as sales_rep_name
                FROM "ORDERS-invoices" i
                LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
                LEFT JOIN "ORDERS-buyer_contacts" bc ON bc.orders_buyer_id = i.fk_buyer_id
                LEFT JOIN users u ON i.assigned_sales_rep_id = u.id
                WHERE i.id = $1
                ORDER BY bc.entry_id ASC
                LIMIT 1
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                return { success: false, error: 'Invoice not found' };
            }

            const invoiceData = invoice.rows[0];

            // Notify sales rep
            if (invoiceData.assigned_sales_rep_id) {
                const isEnabled = await notificationStore.isNotificationEnabled(
                    invoiceData.assigned_sales_rep_id, 
                    'invoice_delivered'
                );
                
                if (isEnabled) {
                    const notification = {
                        type: 'invoice_delivered',
                        title: 'Order Delivered',
                        message: `Order ${invoiceData.invoice_number} has been delivered successfully`,
                        invoice_id: invoiceId,
                        invoice_number: invoiceData.invoice_number,
                        buyer_name: invoiceData.buyer_name,
                        timestamp: new Date().toISOString(),
                        priority: 'normal'
                    };

                    const record = await notificationStore.createNotification({
                        userId: invoiceData.assigned_sales_rep_id,
                        type: notification.type,
                        title: notification.title,
                        message: notification.message,
                        payload: notification,
                        priority: notification.priority,
                        requiresAck: false
                    });

                    await websocketService.sendPersistentNotification(invoiceData.assigned_sales_rep_id, {
                        ...notification,
                        id: record.id
                    });

                    console.log(`✅ Sales rep ${invoiceData.assigned_sales_rep_id} notified of delivery for invoice ${invoiceId}`);
                }
            }

            // Notify customer (external orders)
            if (invoiceData.source === 'External') {
                const customerNotification = {
                    type: 'invoice_delivered',
                    title: 'Order Delivered',
                    message: `Order ${invoiceData.invoice_number} delivered successfully`,
                    invoice_id: invoiceId,
                    invoice_number: invoiceData.invoice_number,
                    timestamp: new Date().toISOString()
                };

                console.log(`📧 Customer delivery notification prepared for invoice ${invoiceId}`);
                
                // Send email notification if enabled
                if (invoiceData.contact_email) {
                    await emailService.sendEmail({
                        to: invoiceData.contact_email,
                        subject: `Order ${invoiceData.invoice_number} Delivered`,
                        template: 'order_delivered',
                        data: {
                            invoice_number: invoiceData.invoice_number,
                            invoice_id: invoiceId
                        }
                    });
                }

                // Log notification for external portal users
                await query(`
                    INSERT INTO "ORDERS-invoice-history" (
                        fk_invoice_id, modification_type, field_name,
                        old_value, new_value, reason, changed_by_system
                    ) VALUES ($1, 'status_changed', 'delivery_notification', NULL, $2, 'Customer notified of delivery', true)
                `, [invoiceId, JSON.stringify(customerNotification)]);
            }

            return { success: true };
        } catch (error) {
            console.error('Error notifying delivery:', error);
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
            
            // Send email notification if enabled
            if (invoiceData.contact_email) {
                await emailService.sendEmail({
                    to: invoiceData.contact_email,
                    subject: `Order ${invoiceData.invoice_number} Cancelled`,
                    template: 'order_cancelled',
                    data: {
                        invoice_number: invoiceData.invoice_number,
                        invoice_id: invoiceId
                    }
                });
            }

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

