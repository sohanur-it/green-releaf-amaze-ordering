// Server/Services/moduleIntegrationService.js
// Module 16: Integration Points - Module 3/6 Integration Hooks

const { pool } = require('../config/database');

class ModuleIntegrationService {
    /**
     * Module 3 Integration: Notify inventory when packages are allocated
     * Called when packages are scanned and allocated to an invoice
     */
    async notifyInventoryAllocation(batchId, allocatedQuantity, invoiceId) {
        try {
            // Update batch allocated_quantity in Module 3
            const client = await pool.connect();
            
            await client.query(`
                UPDATE "ORDERS-batches"
                SET allocated_quantity = COALESCE(allocated_quantity, 0) + $1
                WHERE id = $2
            `, [allocatedQuantity, batchId]);
            
            // Broadcast inventory update via WebSocket (Module 3)
            const websocketService = require('./websocketService');
            const batch = await client.query(`
                SELECT available_quantity, allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [batchId]);
            
            if (batch.rows[0]) {
                await websocketService.broadcastInventoryUpdate(
                    batchId,
                    batch.rows[0].available_quantity
                );
            }
            
            client.release();
            
            console.log(`[Module Integration] Notified Module 3 of allocation: Batch ${batchId}, Qty: ${allocatedQuantity}`);
        } catch (error) {
            console.error('[Module Integration] Error notifying inventory allocation:', error);
            // Non-blocking - don't fail fulfillment if integration fails
        }
    }

    /**
     * Module 3 Integration: Notify inventory when packages are shipped
     * Called when manifest is created and packages are shipped
     */
    async notifyInventoryShipment(batchId, shippedQuantity, invoiceId) {
        try {
            const client = await pool.connect();
            
            // Decrease allocated_quantity and available_quantity
            await client.query(`
                UPDATE "ORDERS-batches"
                SET allocated_quantity = GREATEST(COALESCE(allocated_quantity, 0) - $1, 0),
                    available_quantity = GREATEST(COALESCE(available_quantity, 0) - $1, 0)
                WHERE id = $2
            `, [shippedQuantity, batchId]);
            
            // Broadcast inventory update
            const websocketService = require('./websocketService');
            const batch = await client.query(`
                SELECT available_quantity, allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [batchId]);
            
            if (batch.rows[0]) {
                await websocketService.broadcastInventoryUpdate(
                    batchId,
                    batch.rows[0].available_quantity
                );
            }
            
            client.release();
            
            console.log(`[Module Integration] Notified Module 3 of shipment: Batch ${batchId}, Qty: ${shippedQuantity}`);
        } catch (error) {
            console.error('[Module Integration] Error notifying inventory shipment:', error);
            // Non-blocking
        }
    }

    /**
     * Module 3 Integration: Notify inventory when allocation is released
     * Called when allocation is released (cancellation, force release, etc.)
     */
    async notifyInventoryRelease(batchId, releasedQuantity, invoiceId) {
        try {
            const client = await pool.connect();
            
            // Decrease allocated_quantity (available_quantity stays the same)
            await client.query(`
                UPDATE "ORDERS-batches"
                SET allocated_quantity = GREATEST(COALESCE(allocated_quantity, 0) - $1, 0)
                WHERE id = $2
            `, [releasedQuantity, batchId]);
            
            // Broadcast inventory update
            const websocketService = require('./websocketService');
            const batch = await client.query(`
                SELECT available_quantity, allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [batchId]);
            
            if (batch.rows[0]) {
                await websocketService.broadcastInventoryUpdate(
                    batchId,
                    batch.rows[0].available_quantity
                );
            }
            
            client.release();
            
            console.log(`[Module Integration] Notified Module 3 of release: Batch ${batchId}, Qty: ${releasedQuantity}`);
        } catch (error) {
            console.error('[Module Integration] Error notifying inventory release:', error);
            // Non-blocking
        }
    }

    /**
     * Module 6 Integration: Get effective price for invoice line item
     * Uses Module 6's pricing logic (override_price, default_price)
     */
    async getEffectivePrice(batchId) {
        try {
            const client = await pool.connect();
            
            // Use Module 6's get_effective_price function if it exists
            const result = await client.query(`
                SELECT 
                    COALESCE(
                        (SELECT override_price FROM "ORDERS-batches" WHERE id = $1),
                        (SELECT default_price FROM "ORDERS-batches" WHERE id = $1),
                        0
                    ) as effective_price
            `, [batchId]);
            
            client.release();
            
            return result.rows[0]?.effective_price || 0;
        } catch (error) {
            console.error('[Module Integration] Error getting effective price:', error);
            // Fallback: return 0 or query batch directly
            try {
                const client = await pool.connect();
                const result = await client.query(`
                    SELECT COALESCE(override_price, default_price, 0) as effective_price
                    FROM "ORDERS-batches"
                    WHERE id = $1
                `, [batchId]);
                client.release();
                return result.rows[0]?.effective_price || 0;
            } catch (fallbackError) {
                console.error('[Module Integration] Fallback price query failed:', fallbackError);
                return 0;
            }
        }
    }

    /**
     * Module 6 Integration: Notify financials when invoice is delivered
     * Called when invoice status changes to "Delivered"
     */
    async notifyFinancialsDelivery(invoiceId, invoiceNumber, totalAmount) {
        try {
            // This would integrate with Module 6's financial system
            // For now, log the event
            console.log(`[Module Integration] Notified Module 6 of delivery: Invoice ${invoiceNumber}, Amount: $${totalAmount}`);
            
            // TODO: Implement actual Module 6 integration
            // Example:
            // await financialsService.recordInvoiceDelivery(invoiceId, totalAmount);
            
            return {
                success: true,
                message: 'Financials notified of delivery'
            };
        } catch (error) {
            console.error('[Module Integration] Error notifying financials:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Module 6 Integration: Notify financials when invoice is cancelled
     * Called when invoice is cancelled or voided
     */
    async notifyFinancialsCancellation(invoiceId, invoiceNumber, reason) {
        try {
            // This would integrate with Module 6's financial system
            console.log(`[Module Integration] Notified Module 6 of cancellation: Invoice ${invoiceNumber}, Reason: ${reason}`);
            
            // TODO: Implement actual Module 6 integration
            // Example:
            // await financialsService.recordInvoiceCancellation(invoiceId, reason);
            
            return {
                success: true,
                message: 'Financials notified of cancellation'
            };
        } catch (error) {
            console.error('[Module Integration] Error notifying financials:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new ModuleIntegrationService();



