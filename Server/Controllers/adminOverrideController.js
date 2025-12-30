// Server/Controllers/adminOverrideController.js
// Module 11: Admin Tools & Overrides

const adminOverrideService = require('../Services/adminOverrideService');
const UserModel = require('../Models/userModel');
const { requireAuth, requireSuperuser } = require('../Middleware/auth');

class AdminOverrideController {
    /**
     * Direct invoice field edit
     * POST /api/v1/admin/override/invoice/:id
     */
    static async overrideInvoiceFields(req, res) {
        try {
            const userId = req.session.userId;
            const invoiceId = parseInt(req.params.id);
            const { 
                status, 
                metrc_manifest_numbers, 
                transportation_details,
                fulfillment_accepted_at,
                fulfillment_issue_requested_at,
                manifest_created_at,
                reason,
                approval_ticket_number
            } = req.body;

            // Validate required fields
            if (!reason || reason.trim().length < 20) {
                return res.status(400).json({
                    error: 'Reason is required and must be at least 20 characters'
                });
            }

            if (!approval_ticket_number || approval_ticket_number.trim().length === 0) {
                return res.status(400).json({
                    error: 'Approval ticket number is required'
                });
            }

            // Verify user is superuser
            const isSuperuser = await UserModel.isSuperuser(userId);
            if (!isSuperuser) {
                // Log failed attempt to security audit
                await adminOverrideService.logSecurityAudit({
                    userId,
                    action: 'admin_override_attempt',
                    resourceType: 'Invoice',
                    resourceId: invoiceId.toString(),
                    status: 'failure',
                    reason: 'Insufficient permissions',
                    sourceIp: req.ip
                });

                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Superuser access required for admin overrides'
                });
            }

            const result = await adminOverrideService.overrideInvoiceFields({
                invoiceId,
                userId,
                fields: {
                    status,
                    metrc_manifest_numbers,
                    transportation_details,
                    fulfillment_accepted_at,
                    fulfillment_issue_requested_at,
                    manifest_created_at
                },
                reason: reason.trim(),
                approvalTicketNumber: approval_ticket_number.trim(),
                sourceIp: req.ip
            });

            if (result.success) {
                res.json({
                    success: true,
                    message: 'Invoice fields updated successfully',
                    changes: result.changes
                });
            } else {
                res.status(400).json({
                    error: result.error || 'Failed to update invoice fields'
                });
            }
        } catch (error) {
            console.error('Admin override error:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    /**
     * Manually add scanned package
     * POST /api/v1/admin/override/invoice/:id/manually-add-package
     */
    static async manuallyAddPackage(req, res) {
        try {
            const userId = req.session.userId;
            const invoiceId = parseInt(req.params.id);
            const { package_label, line_item_id, reason } = req.body;

            // Validate required fields
            if (!package_label || !package_label.match(/^[A-Z0-9]{24}$/)) {
                return res.status(400).json({
                    error: 'Valid package label is required (24 alphanumeric characters)'
                });
            }

            if (!line_item_id) {
                return res.status(400).json({
                    error: 'Line item ID is required'
                });
            }

            if (!reason || reason.trim().length < 20) {
                return res.status(400).json({
                    error: 'Reason is required and must be at least 20 characters'
                });
            }

            // Verify user is superuser
            const isSuperuser = await UserModel.isSuperuser(userId);
            if (!isSuperuser) {
                await adminOverrideService.logSecurityAudit({
                    userId,
                    action: 'manual_package_add_attempt',
                    resourceType: 'Invoice',
                    resourceId: invoiceId.toString(),
                    status: 'failure',
                    reason: 'Insufficient permissions',
                    sourceIp: req.ip
                });

                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Superuser access required'
                });
            }

            const result = await adminOverrideService.manuallyAddPackage({
                invoiceId,
                lineItemId: line_item_id,
                packageLabel: package_label.toUpperCase(),
                userId,
                reason: reason.trim(),
                sourceIp: req.ip
            });

            if (result.success) {
                res.json({
                    success: true,
                    message: 'Package added successfully',
                    package: result.package
                });
            } else {
                res.status(400).json({
                    error: result.error || 'Failed to add package'
                });
            }
        } catch (error) {
            console.error('Manual package add error:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    /**
     * Force release allocation
     * POST /api/v1/admin/override/force-release-allocation
     */
    static async forceReleaseAllocation(req, res) {
        try {
            const userId = req.session.userId;
            const { invoice_id, line_item_id, batch_id, reason } = req.body;

            // Validate required fields
            if (!invoice_id || !line_item_id || !batch_id) {
                return res.status(400).json({
                    error: 'Invoice ID, Line Item ID, and Batch ID are required'
                });
            }

            if (!reason || reason.trim().length < 20) {
                return res.status(400).json({
                    error: 'Reason is required and must be at least 20 characters'
                });
            }

            // Verify user is superuser
            const isSuperuser = await UserModel.isSuperuser(userId);
            if (!isSuperuser) {
                await adminOverrideService.logSecurityAudit({
                    userId,
                    action: 'force_release_attempt',
                    resourceType: 'Invoice',
                    resourceId: invoice_id.toString(),
                    status: 'failure',
                    reason: 'Insufficient permissions',
                    sourceIp: req.ip
                });

                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Superuser access required'
                });
            }

            const result = await adminOverrideService.forceReleaseAllocation({
                invoiceId: invoice_id,
                lineItemId: line_item_id,
                batchId: batch_id,
                userId,
                reason: reason.trim(),
                sourceIp: req.ip
            });

            if (result.success) {
                res.json({
                    success: true,
                    message: 'Allocation released successfully',
                    details: result.details
                });
            } else {
                res.status(400).json({
                    error: result.error || 'Failed to release allocation'
                });
            }
        } catch (error) {
            console.error('Force release allocation error:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    /**
     * Get current invoice state for override preview
     * GET /api/v1/admin/override/invoice/:id/preview
     */
    static async getInvoicePreview(req, res) {
        try {
            const userId = req.session.userId;
            const invoiceId = parseInt(req.params.id);

            // Verify user is superuser
            const isSuperuser = await UserModel.isSuperuser(userId);
            if (!isSuperuser) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Superuser access required'
                });
            }

            const invoice = await adminOverrideService.getInvoiceForOverride(invoiceId);

            if (!invoice) {
                return res.status(404).json({
                    error: 'Invoice not found'
                });
            }

            res.json({
                success: true,
                invoice
            });
        } catch (error) {
            console.error('Get invoice preview error:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
    }
}

module.exports = AdminOverrideController;



