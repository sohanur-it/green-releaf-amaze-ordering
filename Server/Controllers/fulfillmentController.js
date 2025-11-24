// Server/Controllers/fulfillmentController.js
// Module 5: Fulfillment Controller

const fulfillmentQueueService = require('../Services/fulfillmentQueueService');
const scanningSessionService = require('../Services/scanningSessionService');
const packageScanService = require('../Services/packageScanService');
const transportationDetailsService = require('../Services/transportationDetailsService');
const manifestCreationService = require('../Services/manifestCreationService');
const fulfillmentIssueService = require('../Services/fulfillmentIssueService');
const manifestVoidingService = require('../Services/manifestVoidingService');

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
            const { invoice_id, reason } = req.body;
            const userId = req.user.id;

            if (!invoice_id || !reason) {
                return res.status(400).json({ error: 'invoice_id and reason are required' });
            }

            const result = await manifestVoidingService.voidManifest(invoice_id, userId, reason);
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
}

module.exports = new FulfillmentController();

