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
const purchaseLimitService = require('./purchaseLimitService');

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
        'Fulfillment_Accepted': ['Fulfillment_Issue', 'Manifested', 'Partially_Manifested', 'Cancelled'],
        'Fulfillment_Issue': ['Approved'], // sales fixes, re-submits
        'Partially_Manifested': ['Manifested', 'Fulfillment_Issue'],
        'Manifested': ['Shipped', 'Fulfillment_Issue'],
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
            // Set statement timeout to prevent hanging (30 seconds)
            await client.query('SET statement_timeout = 30000');
            await client.query('BEGIN');
            
            // Lock the invoice row with NOWAIT to fail fast if locked
            const invoice = await client.query(`
                SELECT status, source FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE NOWAIT
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
            // Special handling for Fulfillment_Issue → Approved: Clear fulfillment assignment
            // so the order can be claimed again by any fulfillment worker
            if (currentStatus === 'Fulfillment_Issue' && newStatus === 'Approved') {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET status = $1, 
                        status_updated_at = NOW(),
                        fulfillment_accepted_by = NULL,
                        fulfillment_accepted_at = NULL
                    WHERE id = $2
                `, [newStatus, invoiceId]);
            } else {
                await client.query(`
                    UPDATE "ORDERS-invoices"
                    SET status = $1, status_updated_at = NOW()
                    WHERE id = $2
                `, [newStatus, invoiceId]);
            }
            
            // Log history
            // Use more descriptive modification_type for specific transitions
            let modificationType = 'status_changed';
            let logReason = reason;
            
            // Fulfillment_Issue → Approved: This is a "kick back to fulfillment"
            if (currentStatus === 'Fulfillment_Issue' && newStatus === 'Approved') {
                modificationType = 'kicked_back_to_fulfillment';
                logReason = reason || 'Sales rep fixed fulfillment issues and kicked back to fulfillment';
            }
            
            // If userId is null (e.g., external portal order), mark as system change
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id, modification_type, field_name,
                    old_value, new_value, reason, changed_by_user_id, changed_by_system
                ) VALUES ($1, $2, 'status', $3, $4, $5, $6, $7)
            `, [invoiceId, modificationType, currentStatus, newStatus, logReason, userId, !userId]);
            
            await client.query('COMMIT');
            
            // Trigger side effects (websocket broadcasts, notifications, etc.)
            // Don't await - run in background to prevent blocking
            this.postTransitionEffects(invoiceId, currentStatus, newStatus).catch(error => {
                console.error('⚠️ Error in postTransitionEffects (non-critical):', error.message);
            });

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
                try {
                    await purchaseLimitService.validatePurchaseLimits(invoiceId, client);
                } catch (error) {
                    // PurchaseLimitError contains detailed violations
                    if (error.violations) {
                        const errorMessages = error.violations.map(v => v.message).join('; ');
                        return {
                            success: false,
                            error: errorMessages,
                            violations: error.violations
                        };
                    }
                    // Re-throw if it's not a PurchaseLimitError
                    throw error;
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

                // Broadcast inventory updates for all affected batches
                // Don't block on WebSocket operations - run in background
                try {
                    const allocationService = require('./allocationService');
                    const lineItems = await client.query(`
                        SELECT DISTINCT fk_batch_id
                        FROM "ORDERS-invoice-line-items"
                        WHERE fk_invoice_id = $1 AND fk_batch_id IS NOT NULL
                    `, [invoiceId]);
                    
                    // Broadcast updates asynchronously (don't await to prevent blocking)
                    Promise.all(lineItems.rows.map(async (item) => {
                        try {
                            const batchId = item.fk_batch_id;
                            const newAvailable = await allocationService.getAvailableQuantity(batchId);
                            await allocationService.broadcastInventoryUpdate(batchId, newAvailable);
                        } catch (wsError) {
                            console.error(`WebSocket broadcast error for batch ${item.fk_batch_id} (non-critical):`, wsError.message);
                        }
                    })).catch(error => {
                        console.error('WebSocket broadcast error (non-critical) during cancellation:', error.message);
                    });
                } catch (wsError) {
                    console.error('Error querying line items for broadcast (non-critical):', wsError.message);
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
                // Validate that changes were made to line items before allowing kick back
                const modifiedLineItems = await client.query(`
                    SELECT COUNT(*) as count
                    FROM "ORDERS-invoice-line-items"
                    WHERE fk_invoice_id = $1 
                    AND (was_modified = true OR fulfillment_issue_modification = true)
                `, [invoiceId]);
                
                const hasModifications = parseInt(modifiedLineItems.rows[0]?.count || 0) > 0;
                
                if (!hasModifications) {
                    return {
                        success: false,
                        error: 'Cannot kick back to fulfillment - no changes have been made to the invoice line items. Please modify at least one line item before returning to fulfillment.'
                    };
                }
                
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
            // Draft -> Pending_Approval: Notify sales rep and sales admins
            if (from === 'Draft' && to === 'Pending_Approval') {
                console.log(`[StateMachine] Draft → Pending_Approval: Triggering notifications for invoice ${invoiceId}`);
                const result = await this.notifySalesRep(invoiceId);
                console.log(`[StateMachine] Notification result:`, result);
            }
            
            // Approved (from Pending or Draft): Notify fulfillment and customer (if external)
            if ((from === 'Pending_Approval' || from === 'Draft') && to === 'Approved') {
                console.log(`[StateMachine] ${from} → Approved: Notifying fulfillment team for invoice ${invoiceId}`);
                await this.notifyFulfillment(invoiceId);
                
                // Notify customer if external order
                const invoice = await this.pool.query(
                    'SELECT source FROM "ORDERS-invoices" WHERE id = $1', 
                    [invoiceId]
                );
                if (invoice.rows.length > 0 && invoice.rows[0].source === 'External') {
                    const notificationService = require('./notificationService');
                    await notificationService.notifyCustomerApproval(invoiceId);
                }
            }
            
            // Fulfillment_Issue → Approved: Notify fulfillment team that issue is resolved and order is ready
            if (from === 'Fulfillment_Issue' && to === 'Approved') {
                console.log(`[StateMachine] Fulfillment_Issue → Approved: Notifying fulfillment team for invoice ${invoiceId}`);
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
            
            // Delivered: Notify sales rep and customer
            if (to === 'Delivered') {
                const notificationService = require('./notificationService');
                await notificationService.notifyDelivery(invoiceId);
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
     * NOTE: This method is deprecated - use purchaseLimitService.validatePurchaseLimits directly
     * Kept for backward compatibility but delegates to the full service
     */
    async validatePurchaseLimits(invoiceId, client) {
        try {
            await purchaseLimitService.validatePurchaseLimits(invoiceId, client);
            return { success: true };
        } catch (error) {
            // PurchaseLimitError contains detailed violations
            if (error.violations) {
                const errorMessages = error.violations.map(v => v.message).join('; ');
                return {
                    success: false,
                    error: errorMessages,
                    violations: error.violations
                };
            }
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
                
                // Get current batch state to validate
                const batch = await client.query(`
                    SELECT quantity, allocated_quantity
                    FROM "ORDERS-batches"
                    WHERE id = $1
                    FOR UPDATE
                `, [batchId]);
                
                if (batch.rows.length === 0) {
                    console.error(`⚠️ Batch ${batchId} not found when finalizing inventory for invoice ${invoiceId}`);
                    continue;
                }
                
                const currentQuantity = parseFloat(batch.rows[0].quantity || 0);
                const currentAllocated = parseFloat(batch.rows[0].allocated_quantity || 0);
                
                // Validate: ensure we don't go negative
                if (currentQuantity < quantity) {
                    console.error(`❌ CRITICAL: Attempting to deduct ${quantity} from batch ${batchId} which only has ${currentQuantity} units. Invoice: ${invoiceId}`);
                    // Use the actual available quantity instead
                    const safeQuantity = Math.max(0, currentQuantity);
                    const safeAllocated = Math.min(quantity, currentAllocated);
                    
                    await client.query(`
                        UPDATE "ORDERS-batches"
                        SET quantity = GREATEST(0, quantity - $1), 
                            allocated_quantity = GREATEST(0, allocated_quantity - $2)
                        WHERE id = $3
                    `, [safeQuantity, safeAllocated, batchId]);
                    
                    console.error(`⚠️ Applied safe deduction: quantity=${safeQuantity}, allocated=${safeAllocated} for batch ${batchId}`);
                } else {
                    // Safe to decrement normally
                    await client.query(`
                        UPDATE "ORDERS-batches"
                        SET quantity = GREATEST(0, quantity - $1), 
                            allocated_quantity = GREATEST(0, allocated_quantity - $1)
                        WHERE id = $2
                    `, [quantity, batchId]);
                }
                
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

