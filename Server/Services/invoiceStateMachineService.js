/**
 * Invoice State Machine Service
 * 
 * Handles state transitions for invoices following Module 4 requirements
 * Ensures all transitions are valid and triggers appropriate side effects
 */

const { query } = require('../config/database');
const { Pool } = require('pg');
const path = require('path');
const websocketService = require('./websocketService');

class InvoiceStateMachineService {
    constructor() {
        // Determine environment
        const nodeEnv = process.env.NODE_ENV || 'development';
        let envPath;

        if (nodeEnv === 'production') {
            envPath = path.join(__dirname, '../../config/production.env');
        } else {
            envPath = path.join(__dirname, '../../config/local.env');
        }

        // Load environment variables
        require('dotenv').config({ path: envPath });

        const isDevelopment = nodeEnv !== 'production';

        this.pool = new Pool({
            user: process.env.DB_USER || 'postgres',
            host: process.env.DB_HOST || 'localhost',
            database: process.env.DB_DATABASE || 'green_releaf_dev',
            password: process.env.DB_PASSWORD || 'postgres',
            port: parseInt(process.env.DB_PORT, 10) || 5432,
            ...(isDevelopment ? {} : {
                ssl: { rejectUnauthorized: false }
            })
        });
    }

    /**
     * Valid invoice state transitions as defined in Module 4 requirements
     */
    static VALID_TRANSITIONS = {
        'Draft': ['Pending_Approval', 'Approved', 'Cancelled'],
        'Pending_Approval': ['Approved', 'Cancelled'],
        'Approved': ['Fulfillment_Accepted', 'Cancelled'],
        'Fulfillment_Accepted': ['Fulfillment_Issue', 'Manifested', 'Cancelled'],
        'Fulfillment_Issue': ['Approved'], // sales fixes, re-submits
        'Manifested': ['Shipped'],
        'Shipped': ['Delivered', 'Cancelled_After_Ship'],
        'Delivered': ['Partially_Rejected', 'Fully_Rejected', 'Issue_After_Shipped', 'Paid'],
        'Partially_Rejected': ['Paid'],
        'Fully_Rejected': [], // terminal state
        'Issue_After_Shipped': ['Paid'],
        'Cancelled': [], // terminal
        'Cancelled_After_Ship': [], // terminal (needs inventory recovery check)
        'Paid': [] // terminal
    };

    /**
     * Transition invoice to a new status
     * 
     * @param {number} invoiceId - Invoice ID
     * @param {string} newStatus - New status
     * @param {number} userId - User performing the transition
     * @param {string} reason - Reason for transition (optional)
     * @returns {Promise<Object>} - Transition result
     */
    async transitionTo(invoiceId, newStatus, userId, reason = null) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Lock the invoice row
            const invoice = await client.query(`
                SELECT status, source FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);
            
            if (invoice.rows.length === 0) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    error: 'Invoice not found'
                };
            }
            
            const currentStatus = invoice.rows[0].status;
            
            // Validate the transition
            const validTransitions = this.constructor.VALID_TRANSITIONS[currentStatus];
            if (!validTransitions || !validTransitions.includes(newStatus)) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    error: `Invalid transition: ${currentStatus} → ${newStatus}`,
                    validTransitions: validTransitions || []
                };
            }
            
            // Execute transition-specific logic
            const transitionResult = await this.executeTransitionLogic(
                invoiceId, currentStatus, newStatus, userId, client
            );
            
            if (!transitionResult.success) {
                await client.query('ROLLBACK');
                return transitionResult;
            }
            
            // Update status
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET status = $1, status_updated_at = NOW()
                WHERE id = $2
            `, [newStatus, invoiceId]);
            
            // Log history
            // If userId is null (e.g., external portal order), mark as system change
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id, modification_type, field_name,
                    old_value, new_value, reason, changed_by_user_id, changed_by_system
                ) VALUES ($1, 'status_changed', 'status', $2, $3, $4, $5, $6)
            `, [invoiceId, currentStatus, newStatus, reason || null, userId, !userId]);
            
            await client.query('COMMIT');
            
            // Trigger side effects (websocket broadcasts, notifications, etc.)
            await this.postTransitionEffects(invoiceId, currentStatus, newStatus);

            const eventName = newStatus === 'Cancelled'
                ? 'invoice_cancelled'
                : 'invoice_status_changed';

            websocketService.broadcastInvoiceEvent(invoiceId, eventName, {
                old_status: currentStatus,
                new_status: newStatus,
                cart_cleared: newStatus === 'Cancelled'
            }).catch(error => {
                console.error('❌ Error broadcasting invoice status change:', error.message);
            });
            
            console.log(`✅ Invoice ${invoiceId}: ${currentStatus} → ${newStatus}`);
            
            return { 
                success: true, 
                oldStatus: currentStatus,
                newStatus: newStatus 
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error transitioning invoice:', error.message);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Execute transition-specific logic
     */
    async executeTransitionLogic(invoiceId, from, to, userId, client) {
        try {
            // Draft -> Pending_Approval (External order submitted)
            if (from === 'Draft' && to === 'Pending_Approval') {
                const validation = await this.validatePurchaseLimits(invoiceId, client);
                if (!validation.success) {
                    return validation;
                }
                // Notification will be sent in postTransitionEffects
            }
            
            // Pending_Approval -> Approved (Sales rep approves)
            if (from === 'Pending_Approval' && to === 'Approved') {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET approved_at = NOW(), approved_by_user_id = $1
                    WHERE id = $2
                `, [userId, invoiceId]);
            }
            
            // Draft -> Approved (Internal order, skip approval)
            if (from === 'Draft' && to === 'Approved') {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET approved_at = NOW(), approved_by_user_id = $1
                    WHERE id = $2
                `, [userId, invoiceId]);
            }
            
            // Approved -> Fulfillment_Accepted
            if (to === 'Fulfillment_Accepted') {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET fulfillment_accepted_at = NOW(), fulfillment_accepted_by = $1
                    WHERE id = $2
                `, [userId, invoiceId]);
            }
            
            // -> Cancelled (before shipping)
            if (to === 'Cancelled') {
                const releaseResult = await this.releaseAllAllocations(invoiceId, client);
                if (!releaseResult.success) {
                    return releaseResult;
                }

                // Immediately expire any associated external cart session so the buyer's cart is cleared
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET cart_expires_at = NOW()
                    WHERE id = $1
                `, [invoiceId]);
            }
            
            // -> Cancelled_After_Ship
            if (to === 'Cancelled_After_Ship') {
                // Flag for inventory recovery check (placeholder for now)
                console.log(`⚠️ Invoice ${invoiceId} cancelled after shipping - requires inventory recovery check`);
            }
            
            // Fulfillment_Issue → Approved (Sales fixed the issue)
            if (from === 'Fulfillment_Issue' && to === 'Approved') {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET fulfillment_issue_reported_at = NULL, fulfillment_issue_note = NULL
                    WHERE id = $1
                `, [invoiceId]);
            }
            
            // -> Shipped
            if (to === 'Shipped') {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET shipped_at = NOW()
                    WHERE id = $1
                `, [invoiceId]);
            }
            
            // -> Delivered
            if (to === 'Delivered') {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET delivered_at = NOW()
                    WHERE id = $1
                `, [invoiceId]);
                // Finalize inventory deductions
                const finalizeResult = await this.finalizeInventoryDeductions(invoiceId, client);
                if (!finalizeResult.success) {
                    return finalizeResult;
                }
            }
            
            // -> Paid
            if (to === 'Paid') {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET paid_at = NOW()
                    WHERE id = $1
                `, [invoiceId]);
                // Update deal flow stage
                const dealFlowResult = await this.updateDealFlowStage(invoiceId, client);
                if (!dealFlowResult.success) {
                    console.error('⚠️ Failed to update deal flow stage:', dealFlowResult.error);
                }
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error in executeTransitionLogic:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Post-transition side effects (notifications, WebSocket broadcasts, etc.)
     */
    async postTransitionEffects(invoiceId, from, to) {
        try {
            // Draft -> Pending_Approval: Notify sales rep
            if (from === 'Draft' && to === 'Pending_Approval') {
                await this.notifySalesRep(invoiceId);
            }
            
            // Approved (from Pending): Notify fulfillment
            if (from === 'Pending_Approval' && to === 'Approved') {
                await this.notifyFulfillment(invoiceId);
            }
            
            // Fulfillment_Accepted: Notify fulfillment team
            if (to === 'Fulfillment_Accepted') {
                console.log(`📦 Invoice ${invoiceId} accepted by fulfillment team`);
            }
            
            // Shipped: Notify customer
            if (to === 'Shipped') {
                await this.notifyCustomerShipment(invoiceId);
            }
            
            // Delivered: Update CRM
            if (to === 'Delivered') {
                console.log(`✅ Invoice ${invoiceId} delivered`);
            }
            
            // Paid: Mark as completed
            if (to === 'Paid') {
                console.log(`💰 Invoice ${invoiceId} marked as paid`);
            }
            
            // Cancelled: Notify if external
            if (to === 'Cancelled') {
                const invoice = await this.pool.query(
                    'SELECT source FROM "ORDERS-invoices" WHERE id = $1', 
                    [invoiceId]
                );
                if (invoice.rows.length > 0 && invoice.rows[0].source === 'External') {
                    const notificationService = require('./notificationService');
                    await notificationService.notifyCustomerCancellation(invoiceId);
                }
            }
        } catch (error) {
            console.error('⚠️ Error in postTransitionEffects:', error.message);
            // Don't fail the transition if side effects fail
        }
    }

    /**
     * Validate purchase limits for external orders
     */
    async validatePurchaseLimits(invoiceId, client) {
        try {
            const invoice = await client.query(`
                SELECT fk_location_id, fk_buyer_id, total
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);
            
            if (invoice.rows.length === 0) {
                return { success: false, error: 'Invoice not found' };
            }
            
            const locationId = invoice.rows[0].fk_location_id;
            const buyerId = invoice.rows[0].fk_buyer_id;
            const total = parseFloat(invoice.rows[0].total || 0);
            
            // Get purchase limits for this location
            const limits = await client.query(`
                SELECT max_order_total, max_unshipped_orders, max_unpaid_invoices
                FROM "ORDERS-purchase-limits"
                WHERE fk_location_id = $1
            `, [locationId]);
            
            const maxOrderTotal = parseFloat(limits.rows[0]?.max_order_total || 20000.00);
            
            // Validate order total
            if (total > maxOrderTotal) {
                return {
                    success: false,
                    error: `Order total $${total} exceeds maximum of $${maxOrderTotal}`
                };
            }
            
            // TODO: Add validation for unshipped orders and unpaid invoices counts
            // This requires checking existing invoices in the database
            
            return { success: true };
        } catch (error) {
            console.error('Error validating purchase limits:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Release all allocations for an invoice
     */
    async releaseAllAllocations(invoiceId, client) {
        try {
            const lineItems = await client.query(`
                SELECT id, fk_batch_id, quantity_allocated
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1 AND quantity_allocated > 0
            `, [invoiceId]);
            
            for (const item of lineItems.rows) {
                const batchId = item.fk_batch_id;
                const quantity = item.quantity_allocated;
                
                // Decrement allocated_quantity
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET allocated_quantity = allocated_quantity - $1
                    WHERE id = $2
                `, [quantity, batchId]);
                
                // Log batch history
                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id, change_type, reason,
                        related_invoice_id, changed_by_system
                    ) VALUES ($1, 'allocation_decreased', 'Invoice cancelled', $2, true)
                `, [batchId, invoiceId]);
                
                // Zero out line item allocation
                await client.query(`
                    UPDATE "ORDERS-invoice-line-items"
                    SET quantity_allocated = 0
                    WHERE id = $1
                `, [item.id]);
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error releasing allocations:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Finalize inventory deductions after delivery
     */
    async finalizeInventoryDeductions(invoiceId, client) {
        try {
            const lineItems = await client.query(`
                SELECT fk_batch_id, quantity_fulfilled
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id = $1
            `, [invoiceId]);
            
            for (const item of lineItems.rows) {
                const batchId = item.fk_batch_id;
                const quantity = item.quantity_fulfilled;
                
                // Decrease actual quantity AND allocated_quantity
                await client.query(`
                    UPDATE "ORDERS-batches"
                    SET quantity = quantity - $1, allocated_quantity = allocated_quantity - $1
                    WHERE id = $2
                `, [quantity, batchId]);
                
                // Log the final deduction
                await client.query(`
                    INSERT INTO "ORDERS-batch-history" (
                        batch_id, change_type, reason,
                        related_invoice_id, changed_by_system
                    ) VALUES ($1, 'quantity_deducted', 'Invoice delivered and finalized', $2, true)
                `, [batchId, invoiceId]);
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error finalizing inventory deductions:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update deal flow stage after payment
     */
    async updateDealFlowStage(invoiceId, client) {
        try {
            // Get the buyer and invoice details
            const invoice = await client.query(`
                SELECT fk_buyer_id, total
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);
            
            if (invoice.rows.length === 0) {
                return { success: false, error: 'Invoice not found' };
            }
            
            const buyerId = invoice.rows[0].fk_buyer_id;
            
            // Use deal flow automation service
            const dealFlowService = require('./dealFlowAutomationService');
            const result = await dealFlowService.updateAfterPayment(buyerId, client);
            
            if (result.success && result.changed) {
                console.log(`✅ Deal flow updated: Buyer ${buyerId} → ${result.new_stage}`);
            }
            
            return result;
        } catch (error) {
            console.error('Error updating deal flow stage:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Notify sales rep of pending approval
     */
    async notifySalesRep(invoiceId) {
        try {
            const notificationService = require('./notificationService');
            return await notificationService.notifySalesRep(invoiceId);
        } catch (error) {
            console.error('Error notifying sales rep:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Notify fulfillment team of approved order
     */
    async notifyFulfillment(invoiceId) {
        try {
            const notificationService = require('./notificationService');
            return await notificationService.notifyFulfillment(invoiceId);
        } catch (error) {
            console.error('Error notifying fulfillment:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Notify customer of shipment
     */
    async notifyCustomerShipment(invoiceId) {
        try {
            const notificationService = require('./notificationService');
            return await notificationService.notifyCustomerShipment(invoiceId);
        } catch (error) {
            console.error('Error notifying customer:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Close database connections
     */
    async close() {
        await this.pool.end();
    }
}

module.exports = new InvoiceStateMachineService();

