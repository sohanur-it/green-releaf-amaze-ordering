// Server/Services/dataValidationService.js
// Module 12: Data Validation & Integrity

const { pool } = require('../config/database');

class DataValidationService {
    /**
     * Run all validation checks
     */
    async runAllValidations() {
        const client = await pool.connect();
        
        try {
            const results = {
                empty_invoices: await this.checkEmptyInvoices(client),
                line_item_totals: await this.checkLineItemTotals(client),
                orphaned_line_items: await this.checkOrphanedLineItems(client),
                orphaned_manifest_packages: await this.checkOrphanedManifestPackages(client),
                cancelled_packages_count: await this.checkCancelledPackagesCount(client),
                batch_allocation_rules: await this.checkBatchAllocationRules(client),
                allocation_tracking_sum: await this.checkAllocationTrackingSum(client),
                fulfilled_quantity: await this.checkFulfilledQuantity(client),
                package_status_sync: await this.checkPackageStatusSync(client),
                manifest_number_uniqueness: await this.checkManifestNumberUniqueness(client),
                invoice_history_completeness: await this.checkInvoiceHistoryCompleteness(client),
                batch_history_completeness: await this.checkBatchHistoryCompleteness(client),
                modification_tracking: await this.checkModificationTracking(client)
            };

            const totalIssues = Object.values(results).reduce((sum, result) => {
                return sum + (result.issues ? result.issues.length : 0);
            }, 0);

            return {
                success: true,
                total_issues: totalIssues,
                results
            };
        } catch (error) {
            console.error('Data validation error:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Check for empty invoices (no line items)
     */
    async checkEmptyInvoices(client) {
        const result = await client.query(`
            SELECT i.id, i.invoice_number, i.status
            FROM "ORDERS-invoices" i
            WHERE i.id NOT IN (
                SELECT DISTINCT fk_invoice_id 
                FROM "ORDERS-invoice-line-items"
                WHERE fk_invoice_id IS NOT NULL
            )
            AND i.status NOT IN ('Draft', 'Cancelled')
        `);

        return {
            name: 'Empty Invoices',
            issues: result.rows,
            count: result.rows.length
        };
    }

    /**
     * Check line item totals sum validation
     */
    async checkLineItemTotals(client) {
        const result = await client.query(`
            SELECT 
                i.id as invoice_id,
                i.invoice_number,
                i.subtotal,
                COALESCE(SUM(li.line_total), 0) as calculated_subtotal
            FROM "ORDERS-invoices" i
            LEFT JOIN "ORDERS-invoice-line-items" li ON i.id = li.fk_invoice_id
            GROUP BY i.id, i.invoice_number, i.subtotal
            HAVING ABS(i.subtotal - COALESCE(SUM(li.line_total), 0)) > 0.01
        `);

        return {
            name: 'Line Item Totals Mismatch',
            issues: result.rows,
            count: result.rows.length
        };
    }

    /**
     * Check for orphaned line items (batch doesn't exist)
     */
    async checkOrphanedLineItems(client) {
        const result = await client.query(`
            SELECT li.id, li.fk_invoice_id, li.fk_batch_id
            FROM "ORDERS-invoice-line-items" li
            WHERE li.fk_batch_id NOT IN (
                SELECT id FROM "ORDERS-batches"
            )
        `);

        return {
            name: 'Orphaned Line Items',
            issues: result.rows,
            count: result.rows.length
        };
    }

    /**
     * Check for orphaned manifest packages
     */
    async checkOrphanedManifestPackages(client) {
        const result = await client.query(`
            SELECT mp.invoice_id, mp.package_label, mp.batch_id
            FROM "ORDERS-manifest-packages" mp
            WHERE mp.batch_id NOT IN (
                SELECT id FROM "ORDERS-batches"
            )
        `);

        return {
            name: 'Orphaned Manifest Packages',
            issues: result.rows,
            count: result.rows.length
        };
    }

    /**
     * Check cancelled packages count validation
     */
    async checkCancelledPackagesCount(client) {
        const result = await client.query(`
            SELECT 
                i.id as invoice_id,
                i.invoice_number,
                COUNT(DISTINCT csp.package_label) as cancelled_count,
                COUNT(DISTINCT mp.package_label) as manifest_count
            FROM "ORDERS-invoices" i
            LEFT JOIN "ORDERS-cancelled-shipment-packages" csp ON i.id = csp.fk_invoice_id
            LEFT JOIN "ORDERS-manifest-packages" mp ON i.id = mp.invoice_id
            WHERE i.status LIKE '%Cancelled%' OR i.status LIKE '%Voided%'
            GROUP BY i.id, i.invoice_number
            HAVING COUNT(DISTINCT csp.package_label) != COUNT(DISTINCT mp.package_label)
        `);

        return {
            name: 'Cancelled Packages Count Mismatch',
            issues: result.rows,
            count: result.rows.length
        };
    }

    /**
     * Check batch allocation rules (allocated > quantity)
     */
    async checkBatchAllocationRules(client) {
        const result = await client.query(`
            SELECT 
                b.id,
                b.batch_name,
                b.quantity,
                b.allocated_quantity
            FROM "ORDERS-batches" b
            WHERE b.allocated_quantity > b.quantity
        `);

        return {
            name: 'Batch Allocation Over-allocation',
            issues: result.rows,
            count: result.rows.length
        };
    }

    /**
     * Check allocation tracking sum validation
     */
    async checkAllocationTrackingSum(client) {
        const result = await client.query(`
            SELECT 
                b.id,
                b.batch_name,
                b.allocated_quantity as batch_allocated,
                COALESCE(SUM(li.quantity_allocated), 0) as line_items_allocated
            FROM "ORDERS-batches" b
            LEFT JOIN "ORDERS-invoice-line-items" li ON b.id = li.fk_batch_id AND li.quantity_allocated > 0
            GROUP BY b.id, b.batch_name, b.allocated_quantity
            HAVING ABS(b.allocated_quantity - COALESCE(SUM(li.quantity_allocated), 0)) > 0.01
        `);

        return {
            name: 'Allocation Tracking Sum Mismatch',
            issues: result.rows,
            count: result.rows.length
        };
    }

    /**
     * Check fulfilled quantity validation
     */
    async checkFulfilledQuantity(client) {
        const result = await client.query(`
            SELECT 
                li.id,
                li.fk_invoice_id,
                li.quantity_ordered,
                li.quantity_allocated,
                li.quantity_fulfilled
            FROM "ORDERS-invoice-line-items" li
            WHERE li.quantity_fulfilled > li.quantity_allocated
        `);

        return {
            name: 'Fulfilled Quantity Exceeds Allocated',
            issues: result.rows,
            count: result.rows.length
        };
    }

    /**
     * Check package status sync (placeholder - requires METRC API)
     */
    async checkPackageStatusSync(client) {
        // This would require METRC API integration
        // Placeholder for now
        return {
            name: 'Package Status Sync',
            issues: [],
            count: 0,
            note: 'Requires METRC API integration'
        };
    }

    /**
     * Check manifest number uniqueness
     */
    async checkManifestNumberUniqueness(client) {
        const result = await client.query(`
            WITH manifest_numbers AS (
                SELECT 
                    id,
                    invoice_number,
                    jsonb_array_elements_text(metrc_manifest_numbers) as manifest_number
                FROM "ORDERS-invoices"
                WHERE metrc_manifest_numbers IS NOT NULL
            )
            SELECT 
                manifest_number,
                COUNT(*) as count,
                array_agg(invoice_number) as invoice_numbers
            FROM manifest_numbers
            GROUP BY manifest_number
            HAVING COUNT(*) > 1
        `);

        return {
            name: 'Duplicate Manifest Numbers',
            issues: result.rows,
            count: result.rows.length
        };
    }

    /**
     * Check invoice history completeness
     */
    async checkInvoiceHistoryCompleteness(client) {
        // Check for invoices with status changes but no history entries
        const result = await client.query(`
            SELECT 
                i.id,
                i.invoice_number,
                i.status,
                COUNT(h.id) as history_count
            FROM "ORDERS-invoices" i
            LEFT JOIN "ORDERS-invoice-history" h ON i.id = h.fk_invoice_id
            WHERE i.status != 'Draft'
            GROUP BY i.id, i.invoice_number, i.status
            HAVING COUNT(h.id) = 0
        `);

        return {
            name: 'Invoices Missing History',
            issues: result.rows,
            count: result.rows.length
        };
    }

    /**
     * Check batch history completeness
     */
    async checkBatchHistoryCompleteness(client) {
        // This is a simplified check - full implementation would verify all quantity changes
        return {
            name: 'Batch History Completeness',
            issues: [],
            count: 0,
            note: 'Requires detailed quantity change tracking'
        };
    }

    /**
     * Check modification tracking
     */
    async checkModificationTracking(client) {
        const result = await client.query(`
            SELECT 
                i.id,
                i.invoice_number,
                i.was_modified,
                COUNT(CASE WHEN h.modification_type != 'invoice_created' THEN 1 END) as modification_count
            FROM "ORDERS-invoices" i
            LEFT JOIN "ORDERS-invoice-history" h ON i.id = h.fk_invoice_id
            WHERE i.status IN ('Approved', 'Fulfillment_Accepted', 'Manifested', 'Shipped', 'Delivered')
            GROUP BY i.id, i.invoice_number, i.was_modified
            HAVING (modification_count > 0 AND i.was_modified = false) 
                OR (modification_count = 0 AND i.was_modified = true)
        `);

        return {
            name: 'Modification Tracking Mismatch',
            issues: result.rows,
            count: result.rows.length
        };
    }
}

module.exports = new DataValidationService();



