// Server/Services/manifestVoidingService.js
// Module 5: Manifest Voiding & Updates

const { query, pool } = require('../config/database');
const websocketService = require('./websocketService');
const axios = require('axios');

// METRC API Configuration
const T3_API_BASE_URL = process.env.T3_API_BASE_URL || 'https://api.t3.com';
const METRC_API_TIMEOUT = 30000;

class ManifestVoidingService {
    /**
     * Void a manifest that was created but not yet shipped
     * Phase 1: Single manifest support
     * Phase 2: Will extend for multi-license
     */
    async voidManifest(invoiceId, userId, reason) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get invoice and manifest details
            const invoice = await client.query(`
                SELECT 
                    status,
                    metrc_manifest_numbers,
                    manifest_metrc_ids,
                    fulfillment_accepted_by,
                    invoice_number
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            // Verify status is Manifested (not yet shipped)
            if (inv.status !== 'Manifested') {
                throw new Error(`Cannot void manifest - invoice status is ${inv.status}`);
            }

            const manifestNumbers = inv.metrc_manifest_numbers || [];
            const manifestIds = inv.manifest_metrc_ids || [];

            if (manifestNumbers.length === 0) {
                throw new Error('No manifests to void');
            }

            if (!reason || reason.trim().length === 0) {
                throw new Error('Void reason is required');
            }

            // Verify user has permission
            if (inv.fulfillment_accepted_by !== userId) {
                // TODO: Check user permissions
                // For now, allow if user is admin
                console.warn('User voiding manifest they did not create');
            }

            console.log(`[Void] Voiding manifest for invoice ${inv.invoice_number}`);

            // Phase 1: Void first manifest (single license support)
            // Phase 2: Will loop through all manifests
            const manifestToVoid = manifestIds[0] || { id: null, number: manifestNumbers[0], license: 'CUL000063' };

            if (!manifestToVoid.id) {
                throw new Error('Manifest METRC ID not found');
            }

            // TODO: Implement actual METRC void API call
            // For Phase 1, we'll simulate the structure
            console.log(`[Void] Simulating void for manifest ${manifestToVoid.number}`);

            // Update invoice
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    status = 'Fulfillment_Issue',
                    metrc_manifest_numbers = '[]'::jsonb,
                    manifest_metrc_ids = '[]'::jsonb,
                    voided_manifest_number = $1,
                    voided_manifest_reason = $2,
                    voided_at = NOW(),
                    voided_by = $3,
                    fulfillment_issue_reported_at = NOW(),
                    fulfillment_issue_note = $4,
                    status_updated_at = NOW()
                WHERE id = $5
            `, [
                manifestToVoid.number,
                reason,
                userId,
                `All manifests voided: ${reason}`,
                invoiceId
            ]);

            // Clear assigned packages (allow re-scanning)
            await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET 
                    assigned_package_labels = NULL,
                    quantity_fulfilled = 0
                WHERE fk_invoice_id = $1
            `, [invoiceId]);

            // Update manifest packages table
            await client.query(`
                UPDATE "ORDERS-manifest-packages"
                SET 
                    package_status = 'voided',
                    voided_at = NOW(),
                    voided_by = $1
                WHERE fk_invoice_id = $2
            `, [userId, invoiceId]);

            // Release allocations
            await this.releaseAllocationsForInvoice(invoiceId, client);

            // Log void
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    old_value,
                    new_value,
                    reason,
                    changed_by_user_id,
                    triggered_by_fulfillment_issue,
                    change_details
                ) VALUES ($1, 'manifest_voided', 'metrc_manifest_numbers', 
                          $2, '[]', $3, $4, true, $5)
            `, [
                invoiceId,
                JSON.stringify(manifestNumbers),
                reason,
                userId,
                JSON.stringify({
                    voided_manifests: [manifestToVoid],
                    all_voided: true
                })
            ]);

            await client.query('COMMIT');

            return {
                success: true,
                voided_count: 1,
                voided_manifests: [manifestToVoid.number],
                remaining_manifests: [],
                all_voided: true,
                message: `Manifest ${manifestToVoid.number} voided. Order returned to Fulfillment Issue state.`
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Release all allocations for an invoice
     * Called when manifest is voided
     */
    async releaseAllocationsForInvoice(invoiceId, client) {
        // Get all line items
        const lineItems = await client.query(`
            SELECT 
                li.id,
                li.fk_batch_id,
                li.quantity_allocated
            FROM "ORDERS-invoice-line-items" li
            WHERE li.fk_invoice_id = $1
                AND li.quantity_allocated > 0
        `, [invoiceId]);

        // Release allocations for each line item
        for (const li of lineItems.rows) {
            // Decrement batch allocated_quantity
            await client.query(`
                UPDATE "ORDERS-batches"
                SET allocated_quantity = allocated_quantity - $1
                WHERE id = $2
            `, [li.quantity_allocated, li.fk_batch_id]);

            // Log to batch history
            await client.query(`
                INSERT INTO "ORDERS-batch-history" (
                    batch_id,
                    change_type,
                    field_name,
                    reason,
                    related_invoice_id,
                    changed_by_system,
                    change_details
                ) VALUES ($1, 'allocation_released', 'allocated_quantity',
                         'Manifest voided - Invoice returned to sales', $2, true, $3)
            `, [
                li.fk_batch_id,
                invoiceId,
                JSON.stringify({
                    quantity_released: li.quantity_allocated,
                    reason: 'Manifest voided'
                })
            ]);

            // Reset line item allocation
            await client.query(`
                UPDATE "ORDERS-invoice-line-items"
                SET quantity_allocated = 0
                WHERE id = $1
            `, [li.id]);

            // Broadcast batch update
            const batch = await client.query(`
                SELECT quantity, allocated_quantity
                FROM "ORDERS-batches"
                WHERE id = $1
            `, [li.fk_batch_id]);

            if (batch.rows.length > 0) {
                const b = batch.rows[0];
                websocketService.broadcastBatchInventoryUpdate(
                    li.fk_batch_id,
                    b.quantity - b.allocated_quantity,
                    b.allocated_quantity
                );
            }
        }
    }

    /**
     * Update manifest transportation details
     * Can only update: driver, vehicle, estimated times
     */
    async updateManifest(invoiceId, userId, updates) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Get current manifest
            const invoice = await client.query(`
                SELECT 
                    status,
                    manifest_metrc_ids,
                    transportation_details,
                    fulfillment_accepted_by
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            if (inv.status !== 'Manifested') {
                throw new Error(`Cannot update manifest - invoice status is ${inv.status}`);
            }

            if (!inv.manifest_metrc_ids || inv.manifest_metrc_ids.length === 0) {
                throw new Error('No manifest to update');
            }

            // Verify permission
            if (inv.fulfillment_accepted_by !== userId) {
                // TODO: Check admin permissions
                console.warn('User updating manifest they did not create');
            }

            // Merge updates with current transportation details
            const currentDetails = typeof inv.transportation_details === 'string'
                ? JSON.parse(inv.transportation_details)
                : inv.transportation_details;

            const updatedDetails = {
                ...currentDetails,
                ...updates,
                updatedAt: new Date().toISOString(),
                updatedBy: userId
            };

            // TODO: Implement actual METRC API update call
            // For Phase 1, we'll just update our database

            // Update transportation details in our DB
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET transportation_details = $1, updated_at = NOW()
                WHERE id = $2
            `, [JSON.stringify(updatedDetails), invoiceId]);

            // Log update
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    change_details,
                    changed_by_user_id
                ) VALUES ($1, 'manifest_updated', $2, $3)
            `, [invoiceId, JSON.stringify(updates), userId]);

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Manifest updated successfully'
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new ManifestVoidingService();

