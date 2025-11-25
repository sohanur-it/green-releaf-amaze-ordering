// Server/Controllers/fulfillmentController.js
// Module 5: Fulfillment Controller

const fulfillmentQueueService = require('../Services/fulfillmentQueueService');
const scanningSessionService = require('../Services/scanningSessionService');
const packageScanService = require('../Services/packageScanService');
const transportationDetailsService = require('../Services/transportationDetailsService');
const manifestCreationService = require('../Services/manifestCreationService');
const fulfillmentIssueService = require('../Services/fulfillmentIssueService');
const manifestVoidingService = require('../Services/manifestVoidingService');
const cancelledShipmentService = require('../Services/cancelledShipmentService');
const adminSessionService = require('../Services/adminSessionService');
const manifestStatusTrackingService = require('../Services/manifestStatusTrackingService');

class FulfillmentController {
    /**
     * Get fulfillment queue
     * GET /api/v1/fulfillment/queue
     */
    async getQueue(req, res) {
        try {
            const licenseNumber = req.query.license || null;
            const filters = {
                status: req.query.status ? (Array.isArray(req.query.status) ? req.query.status : [req.query.status]) : null,
                location: req.query.location || null,
                customer: req.query.customer || null,
                minTotal: req.query.minTotal ? parseFloat(req.query.minTotal) : null,
                maxTotal: req.query.maxTotal ? parseFloat(req.query.maxTotal) : null,
                sortBy: req.query.sortBy || 'age',
                sortOrder: req.query.sortOrder || 'asc',
                page: parseInt(req.query.page) || 1,
                limit: parseInt(req.query.limit) || 25
            };

            const result = await fulfillmentQueueService.getFulfillmentQueue(licenseNumber, filters);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error getting queue:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Claim order
     * POST /api/v1/fulfillment/queue/claim
     */
    async claimOrder(req, res) {
        try {
            const { invoice_id } = req.body;
            const userId = req.user.id;

            if (!invoice_id) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            const result = await fulfillmentQueueService.claimOrder(invoice_id, userId);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error claiming order:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Release order
     * POST /api/v1/fulfillment/queue/release
     */
    async releaseOrder(req, res) {
        try {
            const { invoice_id } = req.body;
            const userId = req.user.id;

            if (!invoice_id) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            const result = await fulfillmentQueueService.releaseOrder(invoice_id, userId);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error releasing order:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Admin reassign order
     * POST /api/v1/fulfillment/admin/reassign
     */
    async reassignOrder(req, res) {
        try {
            const { invoice_id, from_user_id, to_user_id } = req.body;
            const adminUserId = req.user.id;

            if (!invoice_id || !from_user_id || !to_user_id) {
                return res.status(400).json({ error: 'invoice_id, from_user_id, and to_user_id are required' });
            }

            const result = await fulfillmentQueueService.reassignOrder(invoice_id, from_user_id, to_user_id, adminUserId);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error reassigning order:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Start scanning session
     * POST /api/v1/fulfillment/scanning/start
     */
    async startScanningSession(req, res) {
        try {
            const { invoice_id, websocket_connection_id } = req.body;
            const userId = req.user.id;

            if (!invoice_id) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            const result = await scanningSessionService.startScanningSession(invoice_id, userId, websocket_connection_id);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error starting scanning session:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Scan package
     * POST /api/v1/fulfillment/scanning/scan
     */
    async scanPackage(req, res) {
        try {
            const { session_id, package_label, invoice_id } = req.body;
            const userId = req.user.id;

            if (!session_id || !package_label || !invoice_id) {
                return res.status(400).json({ error: 'session_id, package_label, and invoice_id are required' });
            }

            const result = await packageScanService.validateAndProcessScan(session_id, package_label, invoice_id, userId);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error scanning package:', error);
            
            if (error.name === 'ValidationError') {
                return res.status(400).json({
                    error: error.message,
                    code: error.code,
                    details: error.details
                });
            }

            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Get scanning progress
     * GET /api/v1/fulfillment/scanning/progress/:invoiceId
     */
    async getScanningProgress(req, res) {
        try {
            const invoiceId = parseInt(req.params.invoiceId);
            const result = await scanningSessionService.getScanningProgress(invoiceId);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error getting scanning progress:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Verify rejected package
     * POST /api/v1/fulfillment/scanning/verify-rejected
     */
    async verifyRejectedPackage(req, res) {
        try {
            const { package_label, notes } = req.body;
            const userId = req.user.id;

            if (!package_label) {
                return res.status(400).json({ error: 'package_label is required' });
            }

            const result = await packageScanService.confirmRejectedPackageVerified(package_label, userId, notes);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error verifying rejected package:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Cancel scanning session
     * POST /api/v1/fulfillment/scanning/cancel/:sessionId
     */
    async cancelScanningSession(req, res) {
        try {
            const sessionId = parseInt(req.params.sessionId);
            const { reason } = req.body;
            const userId = req.user.id;

            const result = await scanningSessionService.cancelScanningSession(sessionId, userId, reason);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error cancelling scanning session:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Get available transporters
     * GET /api/v1/fulfillment/transporters
     */
    async getTransporters(req, res) {
        try {
            const result = await transportationDetailsService.getAvailableTransporters();
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error getting transporters:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Enter transportation details
     * POST /api/v1/fulfillment/transportation
     */
    async enterTransportationDetails(req, res) {
        try {
            const { invoice_id, ...transportationData } = req.body;
            const userId = req.user.id;

            if (!invoice_id) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            const result = await transportationDetailsService.captureTransportationDetails(invoice_id, userId, transportationData);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error entering transportation details:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Get manifest preview
     * GET /api/v1/fulfillment/manifest/preview/:invoiceId
     */
    async getManifestPreview(req, res) {
        try {
            const invoiceId = parseInt(req.params.invoiceId);
            
            // TODO: Implement manifest preview generation
            // For Phase 1, return basic structure
            
            res.json({
                invoice_id: invoiceId,
                requires_multiple_manifests: false,
                manifests_required: 1,
                message: 'Manifest preview not yet implemented'
            });
        } catch (error) {
            console.error('[Fulfillment] Error getting manifest preview:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Create manifest
     * POST /api/v1/fulfillment/manifest/create
     */
    async createManifest(req, res) {
        const startTime = Date.now();
        try {
            const { invoice_id } = req.body;
            const userId = req.user.id;

            console.log(`[Fulfillment] Manifest creation request: invoice_id=${invoice_id}, user_id=${userId}`);

            if (!invoice_id) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            // Add timeout wrapper
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Manifest creation timeout after 60 seconds')), 60000);
            });

            const result = await Promise.race([
                manifestCreationService.createManifest(invoice_id, userId),
                timeoutPromise
            ]);

            const duration = Date.now() - startTime;
            console.log(`[Fulfillment] Manifest creation completed in ${duration}ms`);
            res.json(result);
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[Fulfillment] Error creating manifest (after ${duration}ms):`, error);
            console.error(`[Fulfillment] Stack:`, error.stack);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Report fulfillment issue
     * POST /api/v1/fulfillment/issues/report
     */
    async reportIssue(req, res) {
        try {
            const { invoice_id, issues } = req.body;
            const userId = req.user.id;

            if (!invoice_id || !issues || !Array.isArray(issues)) {
                return res.status(400).json({ error: 'invoice_id and issues array are required' });
            }

            const result = await fulfillmentIssueService.reportIssue(invoice_id, userId, issues);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error reporting issue:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Sales requests global issue
     * POST /api/v1/fulfillment/issues/request-global
     */
    async requestGlobalIssue(req, res) {
        try {
            const { invoice_id, reason } = req.body;
            const salesRepId = req.user.id;

            if (!invoice_id || !reason) {
                return res.status(400).json({ error: 'invoice_id and reason are required' });
            }

            const result = await fulfillmentIssueService.requestGlobalIssueReport(invoice_id, salesRepId, reason);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error requesting global issue:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Fulfillment acknowledges global issue
     * POST /api/v1/fulfillment/issues/acknowledge-global/:invoiceId
     */
    async acknowledgeGlobalIssue(req, res) {
        try {
            const invoiceId = parseInt(req.params.invoiceId);
            const userId = req.user.id;

            const result = await fulfillmentIssueService.acknowledgeGlobalIssueRequest(invoiceId, userId);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error acknowledging global issue:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Void manifest
     * POST /api/v1/fulfillment/manifest/void
     */
    async voidManifest(req, res) {
        try {
            const { invoice_id, reason, target_manifest_or_license } = req.body;
            const userId = req.user.id;

            if (!invoice_id || !reason) {
                return res.status(400).json({ error: 'invoice_id and reason are required' });
            }

            const result = await manifestVoidingService.voidManifest(
                invoice_id, 
                userId, 
                reason,
                target_manifest_or_license || null
            );
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error voiding manifest:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Update manifest
     * PATCH /api/v1/fulfillment/manifest/update
     */
    async updateManifest(req, res) {
        try {
            const { invoice_id, ...updates } = req.body;
            const userId = req.user.id;

            if (!invoice_id) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            const result = await manifestVoidingService.updateManifest(invoice_id, userId, updates);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error updating manifest:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Update issue details
     * POST /api/v1/fulfillment/issues/update
     */
    async updateIssueDetails(req, res) {
        try {
            const { invoice_id, ...updates } = req.body;
            const userId = req.user.id;

            if (!invoice_id) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            const result = await fulfillmentIssueService.updateIssueDetails(invoice_id, userId, updates);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error updating issue:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Add note to issue
     * POST /api/v1/fulfillment/issues/add-note
     */
    async addNoteToIssue(req, res) {
        try {
            const { invoice_id, note } = req.body;
            const userId = req.user.id;

            if (!invoice_id || !note) {
                return res.status(400).json({ error: 'invoice_id and note are required' });
            }

            const result = await fulfillmentIssueService.addNoteToIssue(invoice_id, userId, note);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error adding note:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Cancel issue report
     * POST /api/v1/fulfillment/issues/cancel
     */
    async cancelIssueReport(req, res) {
        try {
            const { invoice_id, reason } = req.body;
            const userId = req.user.id;

            if (!invoice_id) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            const result = await fulfillmentIssueService.cancelIssueReport(invoice_id, userId, reason);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error cancelling issue:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Process cancellation
     * POST /api/v1/fulfillment/cancelled-shipments/cancel
     */
    async processCancellation(req, res) {
        try {
            const { invoice_id, cancellation_reason, incident_type } = req.body;
            const userId = req.user.id;

            if (!invoice_id || !cancellation_reason) {
                return res.status(400).json({ error: 'invoice_id and cancellation_reason are required' });
            }

            const result = await cancelledShipmentService.processCancellation(
                invoice_id, 
                userId, 
                cancellation_reason,
                incident_type || 'other'
            );
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error processing cancellation:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Confirm packages returned
     * POST /api/v1/fulfillment/cancelled-shipments/confirm-return
     */
    async confirmPackagesReturned(req, res) {
        try {
            const { invoice_id } = req.body;
            const userId = req.user.id;

            if (!invoice_id) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            const result = await cancelledShipmentService.confirmPackagesReturned(invoice_id, userId);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error confirming returns:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Report driver incident
     * POST /api/v1/fulfillment/cancelled-shipments/report-incident
     */
    async reportDriverIncident(req, res) {
        try {
            const { invoice_id, incident_details } = req.body;
            const userId = req.user.id;

            if (!invoice_id || !incident_details) {
                return res.status(400).json({ error: 'invoice_id and incident_details are required' });
            }

            const result = await cancelledShipmentService.reportDriverIncident(
                invoice_id, 
                userId, 
                incident_details
            );
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error reporting incident:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Get all active sessions (admin)
     * GET /api/v1/admin/fulfillment/sessions
     */
    async getAllActiveSessions(req, res) {
        try {
            const filters = {
                worker_id: req.query.worker_id ? parseInt(req.query.worker_id) : null,
                duration_min: req.query.duration_min ? parseInt(req.query.duration_min) : null
            };

            const result = await adminSessionService.getAllActiveSessions(filters);
            res.json(result);
        } catch (error) {
            console.error('[Admin] Error getting sessions:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Force complete session (admin)
     * POST /api/v1/admin/fulfillment/sessions/:sessionId/force-complete
     */
    async forceCompleteSession(req, res) {
        try {
            const { sessionId } = req.params;
            const { reason } = req.body;
            const userId = req.user.id;

            if (!reason) {
                return res.status(400).json({ error: 'reason is required' });
            }

            const result = await adminSessionService.forceCompleteSession(
                parseInt(sessionId), 
                userId, 
                reason
            );
            res.json(result);
        } catch (error) {
            console.error('[Admin] Error force completing session:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Remove scanned package (admin)
     * POST /api/v1/admin/fulfillment/sessions/remove-package
     */
    async removeScannedPackage(req, res) {
        try {
            const { invoice_id, line_item_id, package_label } = req.body;
            const userId = req.user.id;

            if (!invoice_id || !line_item_id || !package_label) {
                return res.status(400).json({ error: 'invoice_id, line_item_id, and package_label are required' });
            }

            const result = await adminSessionService.removeScannedPackage(
                invoice_id,
                line_item_id,
                package_label,
                userId
            );
            res.json(result);
        } catch (error) {
            console.error('[Admin] Error removing package:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Edit scanned package label (admin)
     * POST /api/v1/admin/fulfillment/sessions/edit-package
     */
    async editScannedPackage(req, res) {
        try {
            const { invoice_id, line_item_id, old_package_label, new_package_label } = req.body;
            const userId = req.user.id;

            if (!invoice_id || !line_item_id || !old_package_label || !new_package_label) {
                return res.status(400).json({ error: 'All fields are required' });
            }

            const result = await adminSessionService.editScannedPackage(
                invoice_id,
                line_item_id,
                old_package_label,
                new_package_label,
                userId
            );
            res.json(result);
        } catch (error) {
            console.error('[Admin] Error editing package:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Manually adjust session (admin)
     * POST /api/v1/admin/fulfillment/sessions/:sessionId/adjust
     */
    async manuallyAdjustSession(req, res) {
        try {
            const { sessionId } = req.params;
            const { adjustments, reason } = req.body;
            const userId = req.user.id;

            if (!adjustments || !reason) {
                return res.status(400).json({ error: 'adjustments and reason are required' });
            }

            const result = await adminSessionService.manuallyAdjustSession(
                parseInt(sessionId),
                userId,
                adjustments,
                reason
            );
            res.json(result);
        } catch (error) {
            console.error('[Admin] Error adjusting session:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Get all issues (admin)
     * GET /api/v1/admin/fulfillment/issues
     */
    async getAllIssues(req, res) {
        try {
            const filters = {
                issue_type: req.query.issue_type || null,
                date_from: req.query.date_from || null,
                date_to: req.query.date_to || null,
                sales_rep_id: req.query.sales_rep_id ? parseInt(req.query.sales_rep_id) : null
            };

            const result = await fulfillmentIssueService.getAllIssues(filters);
            res.json(result);
        } catch (error) {
            console.error('[Admin] Error getting issues:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Bulk assign issues (admin)
     * POST /api/v1/admin/fulfillment/issues/bulk-assign
     */
    async bulkAssignIssues(req, res) {
        try {
            const { invoice_ids, sales_rep_id } = req.body;
            const userId = req.user.id;

            if (!invoice_ids || !Array.isArray(invoice_ids) || !sales_rep_id) {
                return res.status(400).json({ error: 'invoice_ids (array) and sales_rep_id are required' });
            }

            const result = await fulfillmentIssueService.bulkAssignIssues(
                invoice_ids,
                sales_rep_id,
                userId
            );
            res.json(result);
        } catch (error) {
            console.error('[Admin] Error bulk assigning issues:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Finalize destroyed packages (admin)
     * POST /api/v1/admin/cancelled-shipments/:invoiceId/finalize-destroyed
     */
    async finalizeDestroyedPackages(req, res) {
        try {
            const { invoiceId } = req.params;
            const { destroyed_packages } = req.body;
            const userId = req.user.id;

            if (!destroyed_packages || !Array.isArray(destroyed_packages)) {
                return res.status(400).json({ error: 'destroyed_packages (array) is required' });
            }

            const result = await cancelledShipmentService.finalizeDestroyedPackages(
                parseInt(invoiceId),
                destroyed_packages,
                userId
            );
            res.json(result);
        } catch (error) {
            console.error('[Admin] Error finalizing destroyed packages:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Get unaccounted packages (admin)
     * GET /api/v1/admin/cancelled-shipments/:invoiceId/unaccounted-packages
     */
    async getUnaccountedPackages(req, res) {
        try {
            const { invoiceId } = req.params;

            const result = await cancelledShipmentService.getUnaccountedPackages(parseInt(invoiceId));
            res.json(result);
        } catch (error) {
            console.error('[Admin] Error getting unaccounted packages:', error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Sync manifest statuses (scheduled job)
     * POST /api/v1/admin/fulfillment/sync-statuses
     */
    async syncManifestStatuses(req, res) {
        try {
            const result = await manifestStatusTrackingService.syncManifestStatuses();
            res.json(result);
        } catch (error) {
            console.error('[Admin] Error syncing manifest statuses:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = new FulfillmentController();

