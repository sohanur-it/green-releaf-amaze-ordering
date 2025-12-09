// Server/Services/fulfillmentQueueService.js
// Module 5: Fulfillment Queue & Order Management

const { query, pool } = require('../config/database');
const websocketService = require('./websocketService');

class FulfillmentQueueService {
    /**
     * Get all orders ready for fulfillment
     * Sorted by priority, then age (oldest first)
     */
    async getFulfillmentQueue(licenseNumber = null, filters = {}) {
        const {
            status,
            location,
            customer,
            deliveryZone,
            minTotal,
            maxTotal,
            sortBy = 'age',
            sortOrder = 'asc',
            page = 1,
            limit = 25
        } = filters;

        let sql = `
            SELECT 
                i.id,
                i.invoice_number,
                i.fk_buyer_id,
                i.fk_location_id,
                i.total,
                i.created_at,
                i.approved_at,
                i.status,
                i.fulfillment_accepted_by,
                i.fulfillment_accepted_at,
                
                -- Buyer Details
                b.name as buyer_name,
                i.location_license_number as destination_license,
                bl.name as location_name,
                bl.city,
                bl.state,
                bl.delivery_zone,
                
                -- Order Summary
                COUNT(DISTINCT li.id) as line_item_count,
                SUM(li.quantity_ordered) as total_packages_needed,
                
                -- Assigned Worker (if any)
                u.first_name as assigned_worker_firstname,
                u.last_name as assigned_worker_lastname,
                
                -- Priority Flag (future feature)
                FALSE as is_priority
                
            FROM "ORDERS-invoices" i
            LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
            LEFT JOIN "ORDERS-buyer_locations" bl ON i.fk_location_id = bl.entry_id
            LEFT JOIN "ORDERS-invoice-line-items" li ON i.id = li.fk_invoice_id
            LEFT JOIN users u ON i.fulfillment_accepted_by = u.id
            
            WHERE i.status IN ('Approved', 'Fulfillment_Accepted', 'Fulfillment_Issue', 'Manifest_Voided', 'Partially_Voided')
        `;

        const params = [];
        let paramCount = 1;

        // License filter
        if (licenseNumber) {
            sql += ` AND i.location_license_number LIKE $${paramCount}`;
            params.push(`${licenseNumber}%`);
            paramCount++;
        }

        // Status filter
        if (status && Array.isArray(status) && status.length > 0) {
            sql += ` AND i.status = ANY($${paramCount})`;
            params.push(status);
            paramCount++;
        }

        // Location filter
        if (location) {
            sql += ` AND (bl.city ILIKE $${paramCount} OR bl.state ILIKE $${paramCount})`;
            params.push(`%${location}%`);
            paramCount++;
        }

        // Customer filter
        if (customer) {
            sql += ` AND b.name ILIKE $${paramCount}`;
            params.push(`%${customer}%`);
            paramCount++;
        }

        // Delivery zone filter
        if (deliveryZone) {
            sql += ` AND bl.delivery_zone = $${paramCount}`;
            params.push(deliveryZone);
            paramCount++;
        }

        // Value filters
        if (minTotal) {
            sql += ` AND i.total >= $${paramCount}`;
            params.push(minTotal);
            paramCount++;
        }

        if (maxTotal) {
            sql += ` AND i.total <= $${paramCount}`;
            params.push(maxTotal);
            paramCount++;
        }

        // Build count query BEFORE adding GROUP BY, ORDER BY, LIMIT
        // This ensures we get the correct total count of distinct invoices
        let countSql = `
            SELECT COUNT(DISTINCT i.id) as total
            FROM "ORDERS-invoices" i
            LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.entry_id
            LEFT JOIN "ORDERS-buyer_locations" bl ON i.fk_location_id = bl.entry_id
            LEFT JOIN "ORDERS-invoice-line-items" li ON i.id = li.fk_invoice_id
            LEFT JOIN users u ON i.fulfillment_accepted_by = u.id
            WHERE i.status IN ('Approved', 'Fulfillment_Accepted', 'Fulfillment_Issue', 'Manifest_Voided', 'Partially_Voided')
        `;

        // Apply same filters to count query
        let countParamCount = 1;
        const countParams = [];

        if (licenseNumber) {
            countSql += ` AND i.location_license_number LIKE $${countParamCount}`;
            countParams.push(`${licenseNumber}%`);
            countParamCount++;
        }

        if (status && Array.isArray(status) && status.length > 0) {
            countSql += ` AND i.status = ANY($${countParamCount})`;
            countParams.push(status);
            countParamCount++;
        }

        if (location) {
            countSql += ` AND (bl.city ILIKE $${countParamCount} OR bl.state ILIKE $${countParamCount})`;
            countParams.push(`%${location}%`);
            countParamCount++;
        }

        if (customer) {
            countSql += ` AND b.name ILIKE $${countParamCount}`;
            countParams.push(`%${customer}%`);
            countParamCount++;
        }

        if (deliveryZone) {
            countSql += ` AND bl.delivery_zone = $${countParamCount}`;
            countParams.push(deliveryZone);
            countParamCount++;
        }

        if (minTotal) {
            countSql += ` AND i.total >= $${countParamCount}`;
            countParams.push(minTotal);
            countParamCount++;
        }

        if (maxTotal) {
            countSql += ` AND i.total <= $${countParamCount}`;
            countParams.push(maxTotal);
            countParamCount++;
        }

        // Execute count query
        const countResult = await query(countSql, countParams);
        const total = parseInt(countResult.rows[0]?.total || 0);

        // Group by (for main query)
        sql += `
            GROUP BY i.id, i.location_license_number, b.name, bl.name, 
                     bl.city, bl.state, bl.delivery_zone, u.first_name, u.last_name
        `;

        // Sorting
        const sortColumnMap = {
            'age': 'i.approved_at',
            'value': 'i.total',
            'destination': 'bl.city',
            'customer': 'b.name',
            'item_count': 'line_item_count',
            'delivery_zone': 'bl.delivery_zone'
        };

        const sortColumn = sortColumnMap[sortBy] || 'i.approved_at';
        const sortDirection = sortOrder.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
        sql += ` ORDER BY is_priority DESC, ${sortColumn} ${sortDirection}`;

        // Pagination
        const offset = (page - 1) * limit;
        sql += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);

        const result = await query(sql, params);

        // Get summary counts (without filters) for the stat cards
        const summaryCounts = await this.getSummaryCounts(licenseNumber);

        return {
            queue: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / limit)
            },
            summary: summaryCounts
        };
    }

    /**
     * Get summary counts for stat cards (without filters)
     */
    async getSummaryCounts(licenseNumber = null) {
        let sql = `
            SELECT 
                COUNT(*) FILTER (WHERE i.status = 'Approved') as pending,
                COUNT(*) FILTER (WHERE i.status = 'Fulfillment_Accepted') as in_progress,
                COUNT(*) FILTER (WHERE i.status IN ('Fulfillment_Issue', 'Manifest_Voided', 'Partially_Voided')) as issues
            FROM "ORDERS-invoices" i
            WHERE i.status IN ('Approved', 'Fulfillment_Accepted', 'Fulfillment_Issue', 'Manifest_Voided', 'Partially_Voided')
        `;

        const params = [];
        if (licenseNumber) {
            sql += ` AND i.location_license_number LIKE $1`;
            params.push(`${licenseNumber}%`);
        }

        const result = await query(sql, params);
        return {
            pending: parseInt(result.rows[0].pending || 0),
            in_progress: parseInt(result.rows[0].in_progress || 0),
            issues: parseInt(result.rows[0].issues || 0)
        };
    }

    /**
     * Claim an order for fulfillment (with pessimistic locking)
     */
    async claimOrder(invoiceId, userId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Lock the invoice row
            const invoice = await client.query(`
                SELECT 
                    id, status, fulfillment_accepted_by,
                    invoice_number
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            // Validate status - can claim Approved, Manifest_Voided, or Partially_Voided invoices
            const claimableStatuses = ['Approved', 'Manifest_Voided', 'Partially_Voided'];
            if (!claimableStatuses.includes(inv.status)) {
                throw new Error(`Cannot claim order with status: ${inv.status}. Only Approved, Manifest_Voided, or Partially_Voided orders can be claimed.`);
            }

            // Check if already claimed
            if (inv.fulfillment_accepted_by !== null) {
                // Get claiming worker name
                const worker = await client.query(`
                    SELECT first_name, last_name 
                    FROM users 
                    WHERE id = $1
                `, [inv.fulfillment_accepted_by]);

                const workerName = worker.rows[0] 
                    ? `${worker.rows[0].first_name} ${worker.rows[0].last_name}`
                    : 'Unknown';

                throw new Error(`Order already claimed by ${workerName}`);
            }

            // Claim the order
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    status = 'Fulfillment_Accepted',
                    fulfillment_accepted_by = $1,
                    fulfillment_accepted_at = NOW(),
                    status_updated_at = NOW()
                WHERE id = $2
            `, [userId, invoiceId]);

            // Log to invoice history
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    new_value,
                    reason,
                    changed_by_user_id
                ) VALUES ($1, 'status_changed', 'status', 'Fulfillment_Accepted', 
                          'Order claimed by fulfillment worker', $2)
            `, [invoiceId, userId]);

            await client.query('COMMIT');

            // Broadcast order claimed event
            await websocketService.broadcastOrderClaimed(invoiceId, inv.invoice_number, userId);

            return {
                success: true,
                invoice_number: inv.invoice_number
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Release order back to queue
     */
    async releaseOrder(invoiceId, userId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verify user is assigned to this order
            const invoice = await client.query(`
                SELECT 
                    id, status, fulfillment_accepted_by,
                    invoice_number
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            if (inv.fulfillment_accepted_by !== userId) {
                throw new Error('You are not assigned to this order');
            }

            if (inv.status !== 'Fulfillment_Accepted') {
                throw new Error(`Cannot release order with status: ${inv.status}`);
            }

            // Release the order
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    status = 'Approved',
                    fulfillment_accepted_by = NULL,
                    fulfillment_accepted_at = NULL,
                    status_updated_at = NOW()
                WHERE id = $1
            `, [invoiceId]);

            // Log to invoice history
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    old_value,
                    new_value,
                    reason,
                    changed_by_user_id
                ) VALUES ($1, 'status_changed', 'status', 'Fulfillment_Accepted', 
                          'Approved', 'Order released back to queue', $2)
            `, [invoiceId, userId]);

            await client.query('COMMIT');

            // Broadcast order released event
            await websocketService.broadcastOrderReleased(invoiceId, inv.invoice_number);

            return {
                success: true,
                message: 'Order released back to queue'
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Admin override: Re-assign order from one worker to another
     * Can only happen BEFORE scanning starts
     */
    async reassignOrder(invoiceId, fromUserId, toUserId, adminUserId) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Check if scanning has started
            const scanningSession = await client.query(`
                SELECT id FROM "ORDERS-scanning-sessions"
                WHERE fk_invoice_id = $1 AND session_status = 'active'
            `, [invoiceId]);

            if (scanningSession.rows.length > 0) {
                throw new Error('Cannot reassign order - scanning has already started');
            }

            // Verify current assignment
            const invoice = await client.query(`
                SELECT fulfillment_accepted_by, invoice_number
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            if (invoice.rows[0].fulfillment_accepted_by !== fromUserId) {
                throw new Error('Order is not assigned to the specified user');
            }

            // Reassign
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    fulfillment_accepted_by = $1,
                    fulfillment_accepted_at = NOW()
                WHERE id = $2
            `, [toUserId, invoiceId]);

            // Log reassignment
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    field_name,
                    old_value,
                    new_value,
                    reason,
                    changed_by_user_id
                ) VALUES ($1, 'status_changed', 'fulfillment_accepted_by',
                          $2, $3, 'Admin reassignment', $4)
            `, [invoiceId, fromUserId.toString(), toUserId.toString(), adminUserId]);

            await client.query('COMMIT');

            // Notify both workers via websocket
            await websocketService.broadcastOrderReassigned(invoiceId, invoice.rows[0].invoice_number, fromUserId, toUserId);

            return {
                success: true,
                message: 'Order reassigned successfully'
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new FulfillmentQueueService();

