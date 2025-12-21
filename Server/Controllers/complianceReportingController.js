// Server/Controllers/complianceReportingController.js
// Module 17: METRC Compliance - Regulatory Reporting

const { query, pool } = require('../config/database');

class ComplianceReportingController {
    /**
     * Section 17.4: Generate rejected package report
     * GET /api/v1/admin/compliance/reports/rejected-packages
     * Query params: date_from, date_to, format (json|csv)
     */
    async getRejectedPackagesReport(req, res) {
        try {
            const { date_from, date_to, format = 'json' } = req.query;
            
            const client = await pool.connect();
            
            try {
                let queryStr = `
                    SELECT 
                        rp.packagelabel,
                        rp.manifestnumber,
                        rp.rejection_date,
                        rp.rejection_reason,
                        rp.synclicense,
                        rp.batch_id,
                        i.invoice_number,
                        i.fk_buyer_id,
                        b.buyer_name,
                        b.buyer_email,
                        b.buyer_phone
                    FROM "ORDERS-rejected_packages" rp
                    LEFT JOIN "ORDERS-invoices" i ON rp.manifestnumber = ANY(
                        SELECT jsonb_array_elements_text(metrc_manifest_numbers)
                        FROM "ORDERS-invoices"
                        WHERE metrc_manifest_numbers IS NOT NULL
                    )
                    LEFT JOIN "ORDERS-buyers" b ON i.fk_buyer_id = b.id
                    WHERE rp.deleted_at IS NULL
                `;
                
                const params = [];
                let paramCount = 1;
                
                if (date_from) {
                    queryStr += ` AND rp.rejection_date >= $${paramCount++}`;
                    params.push(date_from);
                }
                
                if (date_to) {
                    queryStr += ` AND rp.rejection_date <= $${paramCount++}`;
                    params.push(date_to);
                }
                
                queryStr += ` ORDER BY rp.rejection_date DESC`;
                
                const result = await client.query(queryStr, params);
                
                if (format === 'csv') {
                    // Generate CSV
                    const csvRows = [];
                    csvRows.push('Date,Customer,Invoice Number,Package Label,Manifest Number,Reason,Batch ID,License');
                    
                    result.rows.forEach(row => {
                        csvRows.push([
                            row.rejection_date,
                            row.buyer_name || 'N/A',
                            row.invoice_number || 'N/A',
                            row.packagelabel,
                            row.manifestnumber || 'N/A',
                            row.rejection_reason || 'N/A',
                            row.batch_id || 'N/A',
                            row.synclicense || 'N/A'
                        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
                    });
                    
                    res.setHeader('Content-Type', 'text/csv');
                    res.setHeader('Content-Disposition', 'attachment; filename="rejected-packages-report.csv"');
                    res.send(csvRows.join('\n'));
                } else {
                    res.json({
                        success: true,
                        count: result.rows.length,
                        data: result.rows
                    });
                }
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('[Compliance] Error generating rejected packages report:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Section 17.4: Generate voided manifest report
     * GET /api/v1/admin/compliance/reports/voided-manifests
     * Query params: date_from, date_to, format (json|csv)
     */
    async getVoidedManifestsReport(req, res) {
        try {
            const { date_from, date_to, format = 'json' } = req.query;
            
            const client = await pool.connect();
            
            try {
                let queryStr = `
                    SELECT 
                        i.invoice_number,
                        i.voided_manifest_number,
                        i.voided_manifest_reason,
                        i.voided_at,
                        i.voided_by,
                        u.first_name || ' ' || u.last_name as voided_by_name,
                        i.metrc_manifest_numbers,
                        i.manifest_metrc_ids,
                        i.sales_acknowledged_void,
                        i.sales_acknowledged_void_at,
                        i.sales_acknowledged_void_by,
                        sa.first_name || ' ' || sa.last_name as sales_acknowledged_by_name
                    FROM "ORDERS-invoices" i
                    LEFT JOIN users u ON i.voided_by = u.id
                    LEFT JOIN users sa ON i.sales_acknowledged_void_by = sa.id
                    WHERE i.voided_at IS NOT NULL
                `;
                
                const params = [];
                let paramCount = 1;
                
                if (date_from) {
                    queryStr += ` AND i.voided_at >= $${paramCount++}`;
                    params.push(date_from);
                }
                
                if (date_to) {
                    queryStr += ` AND i.voided_at <= $${paramCount++}`;
                    params.push(date_to);
                }
                
                queryStr += ` ORDER BY i.voided_at DESC`;
                
                const result = await client.query(queryStr, params);
                
                if (format === 'csv') {
                    // Generate CSV
                    const csvRows = [];
                    csvRows.push('Date,Invoice Number,Original Manifest Number,Manifest METRC IDs,Void Reason,Voided By,Sales Acknowledged,Sales Acknowledged By,Sales Acknowledged At');
                    
                    result.rows.forEach(row => {
                        const manifestNumbers = Array.isArray(row.metrc_manifest_numbers)
                            ? row.metrc_manifest_numbers.join('; ')
                            : (row.metrc_manifest_numbers ? JSON.stringify(row.metrc_manifest_numbers) : 'N/A');
                        
                        const manifestIds = Array.isArray(row.manifest_metrc_ids)
                            ? row.manifest_metrc_ids.map(m => m.number || m.id || JSON.stringify(m)).join('; ')
                            : (row.manifest_metrc_ids ? JSON.stringify(row.manifest_metrc_ids) : 'N/A');
                        
                        csvRows.push([
                            row.voided_at,
                            row.invoice_number,
                            row.voided_manifest_number || manifestNumbers,
                            manifestIds,
                            row.voided_manifest_reason || 'N/A',
                            row.voided_by_name || 'N/A',
                            row.sales_acknowledged_void ? 'Yes' : 'No',
                            row.sales_acknowledged_by_name || 'N/A',
                            row.sales_acknowledged_void_at || 'N/A'
                        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
                    });
                    
                    res.setHeader('Content-Type', 'text/csv');
                    res.setHeader('Content-Disposition', 'attachment; filename="voided-manifests-report.csv"');
                    res.send(csvRows.join('\n'));
                } else {
                    res.json({
                        success: true,
                        count: result.rows.length,
                        data: result.rows
                    });
                }
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('[Compliance] Error generating voided manifests report:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Section 17.4: Generate destroyed package report
     * GET /api/v1/admin/compliance/reports/destroyed-packages
     * Query params: date_from, date_to, format (json|csv)
     */
    async getDestroyedPackagesReport(req, res) {
        try {
            const { date_from, date_to, format = 'json' } = req.query;
            
            const client = await pool.connect();
            
            try {
                let queryStr = `
                    SELECT 
                        csp.package_label,
                        csp.batch_id,
                        csp.fk_invoice_id,
                        i.invoice_number,
                        b.batch_name,
                        csp.admin_notes,
                        csp.allocation_released_at,
                        csp.allocation_released_by,
                        u.first_name || ' ' || u.last_name as destroyed_by_name,
                        csp.created_at as destroyed_date
                    FROM "ORDERS-cancelled-shipment-packages" csp
                    LEFT JOIN "ORDERS-invoices" i ON csp.fk_invoice_id = i.id
                    LEFT JOIN "ORDERS-batches" b ON csp.batch_id = b.id
                    LEFT JOIN users u ON csp.allocation_released_by = u.id
                    WHERE csp.allocation_released = true
                        AND csp.returned_to_inventory = false
                        AND csp.deleted_at IS NULL
                `;
                
                const params = [];
                let paramCount = 1;
                
                if (date_from) {
                    queryStr += ` AND csp.allocation_released_at >= $${paramCount++}`;
                    params.push(date_from);
                }
                
                if (date_to) {
                    queryStr += ` AND csp.allocation_released_at <= $${paramCount++}`;
                    params.push(date_to);
                }
                
                queryStr += ` ORDER BY csp.allocation_released_at DESC`;
                
                const result = await client.query(queryStr, params);
                
                if (format === 'csv') {
                    // Generate CSV
                    const csvRows = [];
                    csvRows.push('Date,Package Label,Invoice Number,Batch Name,Reason,Destroyed By');
                    
                    result.rows.forEach(row => {
                        const reason = row.admin_notes || 'Package destroyed - cancelled shipment';
                        csvRows.push([
                            row.destroyed_date,
                            row.package_label,
                            row.invoice_number || 'N/A',
                            row.batch_name || 'N/A',
                            reason,
                            row.destroyed_by_name || 'N/A'
                        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
                    });
                    
                    res.setHeader('Content-Type', 'text/csv');
                    res.setHeader('Content-Disposition', 'attachment; filename="destroyed-packages-report.csv"');
                    res.send(csvRows.join('\n'));
                } else {
                    res.json({
                        success: true,
                        count: result.rows.length,
                        data: result.rows
                    });
                }
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('[Compliance] Error generating destroyed packages report:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = new ComplianceReportingController();

