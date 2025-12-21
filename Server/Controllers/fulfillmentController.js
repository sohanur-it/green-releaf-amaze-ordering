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
                deliveryZone: req.query.deliveryZone || req.query.delivery_zone || null, // Support both naming conventions
                minTotal: req.query.minTotal ? parseFloat(req.query.minTotal) : null,
                maxTotal: req.query.maxTotal ? parseFloat(req.query.maxTotal) : null,
                dateFrom: req.query.dateFrom || req.query.date_from || null,
                dateTo: req.query.dateTo || req.query.date_to || null,
                myOrders: req.query.myOrders === 'true' || req.query.my_orders === 'true',
                userId: req.user?.id || req.session?.userId || null,
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
     * Section 10.3.1: Get locked packages for an invoice (for fetching missed events on reconnect)
     * GET /api/v1/fulfillment/scanning/locked-packages?invoice_id=123
     */
    async getLockedPackages(req, res) {
        try {
            const invoiceId = parseInt(req.query.invoice_id);
            
            if (!invoiceId) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            const { pool } = require('../config/database');
            const client = await pool.connect();

            try {
                // Get all active scanning sessions for this invoice with locked packages
                const sessions = await client.query(`
                    SELECT 
                        ss.id,
                        ss.fk_user_id,
                        ss.currently_locked_packages,
                        u.first_name,
                        u.last_name
                    FROM "ORDERS-scanning-sessions" ss
                    LEFT JOIN users u ON ss.fk_user_id = u.id
                    WHERE ss.fk_invoice_id = $1
                        AND ss.session_status = 'active'
                        AND ss.currently_locked_packages IS NOT NULL
                        AND jsonb_array_length(ss.currently_locked_packages::jsonb) > 0
                `, [invoiceId]);

                const lockedPackages = [];
                
                for (const session of sessions.rows) {
                    const packages = Array.isArray(session.currently_locked_packages)
                        ? session.currently_locked_packages
                        : JSON.parse(session.currently_locked_packages || '[]');
                    
                    const userName = session.first_name && session.last_name
                        ? `${session.first_name} ${session.last_name}`
                        : 'Unknown';
                    
                    packages.forEach(packageLabel => {
                        lockedPackages.push({
                            package_label: packageLabel,
                            locked_by_user_id: session.fk_user_id,
                            locked_by_user_name: userName,
                            session_id: session.id,
                            locked_at: new Date().toISOString() // Approximate, could be enhanced with actual timestamp
                        });
                    });
                }

                res.json({
                    success: true,
                    locked_packages: lockedPackages
                });
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('[Fulfillment] Error getting locked packages:', error);
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
     * Acknowledge package removal (package not on order)
     * POST /api/v1/fulfillment/scanning/acknowledge-removal
     */
    async acknowledgePackageRemoval(req, res) {
        try {
            const { invoice_id, package_label, session_id } = req.body;
            const userId = req.user.id;

            if (!invoice_id || !package_label) {
                return res.status(400).json({ error: 'invoice_id and package_label are required' });
            }

            const packageScanService = require('../Services/packageScanService');
            const result = await packageScanService.acknowledgePackageRemoval(invoice_id, package_label, userId, session_id);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error acknowledging package removal:', error);
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
     * Get available transporters from METRC T3 API
     * GET /api/v1/fulfillment/transporters
     */
    async getTransporters(req, res) {
        try {
            console.log('[Fulfillment] Fetching transporters from METRC T3 API...');
            
            // Ensure environment variables are loaded
            const path = require('path');
            if (process.env.NODE_ENV === 'production') {
                require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
            } else {
                require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
            }
            
            const metrcAuth = require('../Services/metrcAuth');
            const apiBaseUrl = metrcAuth.apiBaseUrl || process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
            const licenseNumber = req.query.licenseNumber || process.env.T3_LICENSE_NUMBER;
            
            if (!licenseNumber) {
                return res.status(400).json({ error: 'licenseNumber is required' });
            }

            // Try multiple endpoints to get transporters with pagination
            // Since /transfers/transporters might not exist, we'll try:
            // 1. /transfers/create/transporters (returns available transporters for transfers)
            // 2. /facilities (returns all facilities, filter for transporters)
            let allTransporters = [];
            let endpointUsed = null;
            let error = null;
            let endpointWorks = false;

            // Method 1: Try /transfers/create/transporters with pagination
            try {
                endpointUsed = `${apiBaseUrl}/transfers/create/transporters`;
                console.log(`[Fulfillment] Attempting endpoint: GET ${endpointUsed}?licenseNumber=${licenseNumber}`);
                
                // Fetch all pages
                let page = 1;
                let hasMorePages = true;
                const pageSize = 500; // Maximum allowed by API
                
                while (hasMorePages) {
                    console.log(`[Fulfillment] Fetching page ${page}...`);
                    
                    const response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: endpointUsed,
                        params: {
                            licenseNumber: licenseNumber,
                            page: page,
                            pageSize: pageSize
                        },
                        timeout: 15000
                    });
                    
                    // Parse the response
                    let pageTransporters = [];
                    if (Array.isArray(response.data)) {
                        pageTransporters = response.data;
                    } else if (response.data?.data && Array.isArray(response.data.data)) {
                        pageTransporters = response.data.data;
                    } else if (response.data?.transporters && Array.isArray(response.data.transporters)) {
                        pageTransporters = response.data.transporters;
                    } else if (response.data?.facilities && Array.isArray(response.data.facilities)) {
                        pageTransporters = response.data.facilities;
                    }
                    
                    allTransporters = allTransporters.concat(pageTransporters);
                    console.log(`[Fulfillment] Retrieved ${pageTransporters.length} transporters from page ${page} (total: ${allTransporters.length})`);
                    
                    // Check if there are more pages
                    if (response.data) {
                        const total = response.data.total || response.data.totalCount || 0;
                        const totalPages = response.data.totalPages || Math.ceil(total / pageSize);
                        const currentPageSize = pageTransporters.length;
                        
                        // If we got fewer results than pageSize, we're done
                        // Or if we've reached totalPages
                        hasMorePages = currentPageSize === pageSize && (totalPages === 0 || page < totalPages);
                    } else {
                        // If no pagination info, stop if we got fewer than pageSize
                        hasMorePages = pageTransporters.length === pageSize;
                    }
                    
                    page++;
                    
                    // Small delay to avoid rate limiting
                    if (hasMorePages) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }
                
                endpointWorks = true;
                console.log(`[Fulfillment] ✅ Successfully fetched all transporters from ${endpointUsed} (${allTransporters.length} total)`);
            } catch (firstError) {
                console.warn(`[Fulfillment] Endpoint ${endpointUsed} failed:`, firstError.message);
                if (firstError.response) {
                    console.warn(`[Fulfillment] Response status:`, firstError.response.status);
                    console.warn(`[Fulfillment] Response data:`, JSON.stringify(firstError.response.data).substring(0, 500));
                }
                error = firstError;
                
                // Method 2: Try /facilities endpoint with pagination (fallback)
                try {
                    endpointUsed = `${apiBaseUrl}/facilities`;
                    console.log(`[Fulfillment] Trying alternative endpoint: GET ${endpointUsed}?licenseNumber=${licenseNumber}`);
                    
                    // Fetch all pages
                    let page = 1;
                    let hasMorePages = true;
                    const pageSize = 500;
                    
                    while (hasMorePages) {
                        console.log(`[Fulfillment] Fetching page ${page}...`);
                        
                        const response = await metrcAuth.makeAuthenticatedRequest({
                            method: 'GET',
                            url: endpointUsed,
                            params: {
                                licenseNumber: licenseNumber,
                                page: page,
                                pageSize: pageSize
                            },
                            timeout: 15000
                        });
                        
                        // Parse the response
                        let pageTransporters = [];
                        if (Array.isArray(response.data)) {
                            pageTransporters = response.data;
                        } else if (response.data?.data && Array.isArray(response.data.data)) {
                            pageTransporters = response.data.data;
                        } else if (response.data?.transporters && Array.isArray(response.data.transporters)) {
                            pageTransporters = response.data.transporters;
                        } else if (response.data?.facilities && Array.isArray(response.data.facilities)) {
                            pageTransporters = response.data.facilities;
                        }
                        
                        allTransporters = allTransporters.concat(pageTransporters);
                        console.log(`[Fulfillment] Retrieved ${pageTransporters.length} transporters from page ${page} (total: ${allTransporters.length})`);
                        
                        // Check if there are more pages
                        if (response.data) {
                            const total = response.data.total || response.data.totalCount || 0;
                            const totalPages = response.data.totalPages || Math.ceil(total / pageSize);
                            const currentPageSize = pageTransporters.length;
                            
                            hasMorePages = currentPageSize === pageSize && (totalPages === 0 || page < totalPages);
                        } else {
                            hasMorePages = pageTransporters.length === pageSize;
                        }
                        
                        page++;
                        
                        // Small delay to avoid rate limiting
                        if (hasMorePages) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    }
                    
                    endpointWorks = true;
                    error = null;
                    console.log(`[Fulfillment] ✅ Successfully fetched all transporters from ${endpointUsed} (${allTransporters.length} total)`);
                } catch (secondError) {
                    console.error(`[Fulfillment] ❌ Both endpoints failed. Last error:`, secondError.message);
                    if (secondError.response) {
                        console.error(`[Fulfillment] Response status:`, secondError.response.status);
                        console.error(`[Fulfillment] Response data:`, JSON.stringify(secondError.response.data).substring(0, 500));
                    }
                    error = secondError;
                }
            }

            if (!endpointWorks || allTransporters.length === 0) {
                throw new Error(
                    `Failed to fetch transporters from METRC API. ` +
                    `Tried endpoints: ${apiBaseUrl}/transfers/create/transporters and ${apiBaseUrl}/facilities. ` +
                    `Error: ${error?.message || 'Unknown error'}. ` +
                    `Please check the METRC T3 API documentation at https://api.trackandtrace.tools/v2/docs/#/ to verify the correct endpoint.`
                );
            }

            console.log(`[Fulfillment] Found ${allTransporters.length} total transporter(s) from METRC API (all pages)`);

            // Format transporters for dropdown
            const formattedTransporters = allTransporters.map(transporter => {
                // Extract transporter ID and license number from various possible field names
                const transporterId = transporter.id || 
                                     transporter.transporterId || 
                                     transporter.facilityId ||
                                     transporter.FacilityId ||
                                     (transporter.facility && transporter.facility.id);
                
                const licenseNumber = transporter.licenseNumber || 
                                     transporter.license || 
                                     transporter.LicenseNumber ||
                                     transporter.License ||
                                     (transporter.facility && (transporter.facility.licenseNumber || transporter.facility.license));
                
                const name = transporter.name || 
                            transporter.facilityName || 
                            transporter.FacilityName ||
                            transporter.transporterName ||
                            (transporter.facility && transporter.facility.name);

                return {
                    id: transporterId ? parseInt(transporterId, 10) : null,
                    licenseNumber: licenseNumber || 'N/A',
                    name: name || licenseNumber || 'Unknown Transporter',
                    displayName: name ? `${name} (${licenseNumber || 'N/A'})` : (licenseNumber || 'Unknown Transporter')
                };
            }).filter(t => t.id !== null && t.id > 0); // Only include transporters with valid IDs

            console.log(`[Fulfillment] Formatted ${formattedTransporters.length} valid transporter(s) for dropdown`);

            res.json({
                success: true,
                transporters: formattedTransporters,
                count: formattedTransporters.length
            });
        } catch (error) {
            console.error('[Fulfillment] ❌ Error getting transporters:', error.message);
            if (error.response) {
                console.error('[Fulfillment] Response status:', error.response.status);
                console.error('[Fulfillment] Response data:', JSON.stringify(error.response.data).substring(0, 500));
            }
            res.status(500).json({ 
                error: error.message,
                details: error.response?.data || null
            });
        }
    }

    /**
     * Get available recipients from METRC T3 API
     * GET /api/v1/fulfillment/recipients
     */
    async getRecipients(req, res) {
        try {
            console.log('[Fulfillment] Fetching recipients from METRC T3 API...');
            
            // Ensure environment variables are loaded
            const path = require('path');
            if (process.env.NODE_ENV === 'production') {
                require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
            } else {
                require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
            }
            
            const metrcAuth = require('../Services/metrcAuth');
            const apiBaseUrl = metrcAuth.apiBaseUrl || process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
            const licenseNumber = req.query.licenseNumber || process.env.T3_LICENSE_NUMBER;
            
            if (!licenseNumber) {
                return res.status(400).json({ error: 'licenseNumber is required' });
            }

                // Try multiple endpoints to get recipients with pagination
            // Since /transfers/recipients doesn't exist, we'll try:
            // 1. /transfers/create/destinations (returns available destination facilities)
            // 2. /facilities (returns all facilities)
            let allRecipients = [];
            let endpointUsed = null;
            let error = null;
            let endpointWorks = false;

            // Method 1: Try /transfers/create/destinations with pagination
            try {
                endpointUsed = `${apiBaseUrl}/transfers/create/destinations`;
                console.log(`[Fulfillment] Attempting endpoint: GET ${endpointUsed}?licenseNumber=${licenseNumber}`);
                
                // Fetch all pages
                let page = 1;
                let hasMorePages = true;
                const pageSize = 500; // Maximum allowed by API
                
                while (hasMorePages) {
                    console.log(`[Fulfillment] Fetching page ${page}...`);
                    
                    const response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: endpointUsed,
                        params: {
                            licenseNumber: licenseNumber,
                            page: page,
                            pageSize: pageSize
                        },
                        timeout: 15000
                    });
                    
                    // Parse the response
                    let pageRecipients = [];
                    if (Array.isArray(response.data)) {
                        pageRecipients = response.data;
                    } else if (response.data?.data && Array.isArray(response.data.data)) {
                        pageRecipients = response.data.data;
                    } else if (response.data?.recipients && Array.isArray(response.data.recipients)) {
                        pageRecipients = response.data.recipients;
                    } else if (response.data?.destinations && Array.isArray(response.data.destinations)) {
                        pageRecipients = response.data.destinations;
                    } else if (response.data?.facilities && Array.isArray(response.data.facilities)) {
                        pageRecipients = response.data.facilities;
                    }
                    
                    allRecipients = allRecipients.concat(pageRecipients);
                    console.log(`[Fulfillment] Retrieved ${pageRecipients.length} recipients from page ${page} (total: ${allRecipients.length})`);
                    
                    // Check if there are more pages
                    if (response.data) {
                        const total = response.data.total || response.data.totalCount || 0;
                        const totalPages = response.data.totalPages || Math.ceil(total / pageSize);
                        const currentPageSize = pageRecipients.length;
                        
                        // If we got fewer results than pageSize, we're done
                        // Or if we've reached totalPages
                        hasMorePages = currentPageSize === pageSize && (totalPages === 0 || page < totalPages);
                    } else {
                        // If no pagination info, stop if we got fewer than pageSize
                        hasMorePages = pageRecipients.length === pageSize;
                    }
                    
                    page++;
                    
                    // Small delay to avoid rate limiting
                    if (hasMorePages) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }
                
                endpointWorks = true;
                console.log(`[Fulfillment] ✅ Successfully fetched all recipients from ${endpointUsed} (${allRecipients.length} total)`);
            } catch (firstError) {
                console.warn(`[Fulfillment] Endpoint ${endpointUsed} failed:`, firstError.message);
                if (firstError.response) {
                    console.warn(`[Fulfillment] Response status:`, firstError.response.status);
                    console.warn(`[Fulfillment] Response data:`, JSON.stringify(firstError.response.data).substring(0, 500));
                }
                error = firstError;
                
                // Method 2: Try /facilities endpoint with pagination
                try {
                    endpointUsed = `${apiBaseUrl}/facilities`;
                    console.log(`[Fulfillment] Trying alternative endpoint: GET ${endpointUsed}?licenseNumber=${licenseNumber}`);
                    
                    // Fetch all pages
                    let page = 1;
                    let hasMorePages = true;
                    const pageSize = 500;
                    
                    while (hasMorePages) {
                        console.log(`[Fulfillment] Fetching page ${page}...`);
                        
                        const response = await metrcAuth.makeAuthenticatedRequest({
                            method: 'GET',
                            url: endpointUsed,
                            params: {
                                licenseNumber: licenseNumber,
                                page: page,
                                pageSize: pageSize
                            },
                            timeout: 15000
                        });
                        
                        // Parse the response
                        let pageRecipients = [];
                        if (Array.isArray(response.data)) {
                            pageRecipients = response.data;
                        } else if (response.data?.data && Array.isArray(response.data.data)) {
                            pageRecipients = response.data.data;
                        } else if (response.data?.recipients && Array.isArray(response.data.recipients)) {
                            pageRecipients = response.data.recipients;
                        } else if (response.data?.destinations && Array.isArray(response.data.destinations)) {
                            pageRecipients = response.data.destinations;
                        } else if (response.data?.facilities && Array.isArray(response.data.facilities)) {
                            pageRecipients = response.data.facilities;
                        }
                        
                        allRecipients = allRecipients.concat(pageRecipients);
                        console.log(`[Fulfillment] Retrieved ${pageRecipients.length} recipients from page ${page} (total: ${allRecipients.length})`);
                        
                        // Check if there are more pages
                        if (response.data) {
                            const total = response.data.total || response.data.totalCount || 0;
                            const totalPages = response.data.totalPages || Math.ceil(total / pageSize);
                            const currentPageSize = pageRecipients.length;
                            
                            hasMorePages = currentPageSize === pageSize && (totalPages === 0 || page < totalPages);
                        } else {
                            hasMorePages = pageRecipients.length === pageSize;
                        }
                        
                        page++;
                        
                        // Small delay to avoid rate limiting
                        if (hasMorePages) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    }
                    
                    endpointWorks = true;
                    error = null;
                    console.log(`[Fulfillment] ✅ Successfully fetched all recipients from ${endpointUsed} (${allRecipients.length} total)`);
                } catch (secondError) {
                    console.error(`[Fulfillment] ❌ Both endpoints failed. Last error:`, secondError.message);
                    if (secondError.response) {
                        console.error(`[Fulfillment] Response status:`, secondError.response.status);
                        console.error(`[Fulfillment] Response data:`, JSON.stringify(secondError.response.data).substring(0, 500));
                    }
                    error = secondError;
                }
            }

            if (!endpointWorks || allRecipients.length === 0) {
                // Check if it's a METRC server issue
                const isServerError = error?.response?.status === 500 || 
                                     error?.message?.includes('500') ||
                                     error?.message?.includes('Internal Server Error');
                
                if (isServerError) {
                    throw new Error(
                        `METRC API is currently experiencing server issues. ` +
                        `This is a temporary problem on METRC's side, not with your code or credentials. ` +
                        `Please try again in a few minutes. ` +
                        `If the issue persists, contact METRC support. ` +
                        `(Error: ${error?.message || '500 Internal Server Error'})`
                    );
                }
                
                throw new Error(
                    `Failed to fetch recipients from METRC API. ` +
                    `Tried endpoints: ${apiBaseUrl}/transfers/create/destinations and ${apiBaseUrl}/facilities. ` +
                    `Error: ${error?.message || 'Unknown error'}. ` +
                    `Please check the METRC T3 API documentation at https://api.trackandtrace.tools/v2/docs/#/ to verify the correct endpoint.`
                );
            }

            console.log(`[Fulfillment] Found ${allRecipients.length} total recipient(s) from METRC API (all pages)`);

            // Format recipients for dropdown
            const formattedRecipients = allRecipients.map(recipient => {
                // Extract recipient ID and license number from various possible field names
                const recipientId = recipient.id || 
                                   recipient.recipientId || 
                                   recipient.facilityId ||
                                   recipient.FacilityId ||
                                   (recipient.facility && recipient.facility.id);
                
                const licenseNumber = recipient.licenseNumber || 
                                     recipient.license || 
                                     recipient.LicenseNumber ||
                                     recipient.License ||
                                     (recipient.facility && (recipient.facility.licenseNumber || recipient.facility.license));
                
                const name = recipient.name || 
                            recipient.facilityName || 
                            recipient.FacilityName ||
                            (recipient.facility && recipient.facility.name);

                return {
                    id: recipientId ? parseInt(recipientId, 10) : null,
                    licenseNumber: licenseNumber || 'N/A',
                    name: name || licenseNumber || 'Unknown Facility',
                    displayName: name ? `${name} (${licenseNumber || 'N/A'})` : (licenseNumber || 'Unknown Facility')
                };
            }).filter(r => r.id !== null && r.id > 0); // Only include recipients with valid IDs

            console.log(`[Fulfillment] Formatted ${formattedRecipients.length} valid recipient(s) for dropdown`);

            res.json({
                success: true,
                recipients: formattedRecipients,
                count: formattedRecipients.length
            });
        } catch (error) {
            console.error('[Fulfillment] ❌ Error getting recipients:', error.message);
            if (error.response) {
                console.error('[Fulfillment] Response status:', error.response.status);
                console.error('[Fulfillment] Response data:', JSON.stringify(error.response.data).substring(0, 500));
            }
            res.status(500).json({ 
                error: error.message,
                details: error.response?.data || null
            });
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
     * Get manifest payload preview (before creation)
     * GET /api/v1/fulfillment/manifest/preview/:invoiceId
     */
    async getManifestPreview(req, res) {
        try {
            const invoiceId = parseInt(req.params.invoiceId);
            const userId = req.user.id;

            if (!invoiceId) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            // Get the payload that would be sent to METRC
            const payload = await manifestCreationService.getManifestPayloadPreview(invoiceId, userId);
            
            res.json({
                success: true,
                payload: payload,
                invoice_id: invoiceId
            });
        } catch (error) {
            console.error(`[Fulfillment] Error getting manifest preview:`, error);
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * Get manifest payload preview (alias for consistency)
     * GET /api/v1/fulfillment/manifest/payload-preview/:invoiceId
     */
    async getManifestPayloadPreview(req, res) {
        return this.getManifestPreview(req, res);
    }

    /**
     * Section 17.2.2: Perform dry run validation
     * POST /api/v1/fulfillment/manifest/validate-dry-run
     */
    async validateDryRun(req, res) {
        try {
            const { invoice_id } = req.body;
            const userId = req.user.id;

            if (!invoice_id) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            console.log(`[Fulfillment] Dry run validation request: invoice_id=${invoice_id}, user_id=${userId}`);

            // Get manifest preview to build payloads
            const preview = await manifestCreationService.getManifestPayloadPreview(invoice_id, userId);
            
            if (!preview || !preview.payloads || preview.payloads.length === 0) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Failed to generate manifest preview for validation' 
                });
            }

            // Perform dry run validation for each license
            const validationResults = [];
            const payloads = preview.payloads || [];
            
            for (const payloadData of payloads) {
                const { license, payload } = payloadData;
                
                try {
                    const dryRunResult = await manifestCreationService.performDryRunValidation(payload, license);
                    
                    validationResults.push({
                        license: license,
                        success: dryRunResult.success,
                        errors: dryRunResult.errors || [],
                        warnings: dryRunResult.warnings || []
                    });
                } catch (error) {
                    console.error(`[Fulfillment] Dry run validation error for license ${license}:`, error);
                    validationResults.push({
                        license: license,
                        success: false,
                        errors: [{
                            message: error.message || 'Unknown error during dry run validation',
                            package: null
                        }],
                        warnings: []
                    });
                }
            }

            // Determine overall success
            const allPassed = validationResults.every(r => r.success);
            const hasErrors = validationResults.some(r => r.errors && r.errors.length > 0);

            res.json({
                success: allPassed,
                overall_success: allPassed,
                has_errors: hasErrors,
                validation_results: validationResults,
                invoice_id: invoice_id,
                total_licenses: payloads.length
            });

        } catch (error) {
            console.error('[Fulfillment] Error performing dry run validation:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
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
            
            // Check if the result indicates a failure
            if (!result.success) {
                const errorMessage = result.error || 'Failed to void manifest';
                const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('504') || errorMessage.includes('408');
                const isServiceUnavailable = errorMessage.includes('503') || errorMessage.includes('unavailable');
                
                if (isTimeout || isServiceUnavailable) {
                    return res.status(503).json({ 
                        error: errorMessage,
                        retryable: true 
                    });
                } else {
                    return res.status(400).json({ error: errorMessage });
                }
            }
            
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error voiding manifest:', error);
            const errorMessage = error.message || 'Failed to void manifest';
            const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('504') || errorMessage.includes('408');
            const isServiceUnavailable = errorMessage.includes('503') || errorMessage.includes('unavailable');
            
            if (isTimeout || isServiceUnavailable) {
                return res.status(503).json({ 
                    error: errorMessage,
                    retryable: true 
                });
            } else {
                return res.status(400).json({ error: errorMessage });
            }
        }
    }

    /**
     * Get manifest data for editing
     * GET /api/v1/fulfillment/manifest/edit/:invoiceId
     */
    async getManifestForEdit(req, res) {
        try {
            const { invoiceId } = req.params;
            const userId = req.user.id;

            if (!invoiceId) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            const manifestVoidingService = require('../Services/manifestVoidingService');
            const result = await manifestVoidingService.getManifestDataForEdit(parseInt(invoiceId), userId);
            
            if (!result.success) {
                return res.status(400).json({ error: result.error || 'Failed to get manifest data' });
            }
            
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error getting manifest data for edit:', error);
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
            
            // Check if the result indicates a failure
            if (!result.success) {
                // Determine appropriate status code based on error type
                const errorMessage = result.error || 'Failed to update manifest';
                const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('504') || errorMessage.includes('408');
                const isServiceUnavailable = errorMessage.includes('503') || errorMessage.includes('unavailable');
                
                if (isTimeout || isServiceUnavailable) {
                    // Return 503 for timeout/service unavailable errors
                    return res.status(503).json({ 
                        error: errorMessage,
                        retryable: true 
                    });
                } else {
                    // Return 400 for validation/client errors
                    return res.status(400).json({ error: errorMessage });
                }
            }
            
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error updating manifest:', error);
            
            // Check if it's a timeout or service error
            const errorMessage = error.message || 'Failed to update manifest';
            const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('504') || errorMessage.includes('408');
            const isServiceUnavailable = errorMessage.includes('503') || errorMessage.includes('unavailable');
            
            if (isTimeout || isServiceUnavailable) {
                return res.status(503).json({ 
                    error: errorMessage,
                    retryable: true 
                });
            }
            
            res.status(400).json({ error: errorMessage });
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
     * Sales rep resolves issue by modifying invoice
     * POST /api/v1/fulfillment/issues/resolve
     */
    async resolveIssueAndModify(req, res) {
        try {
            const { invoice_id, modifications } = req.body;
            const userId = req.user.id;

            if (!invoice_id) {
                return res.status(400).json({ error: 'invoice_id is required' });
            }

            if (!modifications) {
                return res.status(400).json({ error: 'modifications object is required' });
            }

            // Validate modifications structure
            if (!modifications.remove_items && !modifications.add_items && !modifications.quantity_changes) {
                return res.status(400).json({ 
                    error: 'At least one modification type is required (remove_items, add_items, or quantity_changes)' 
                });
            }

            const result = await fulfillmentIssueService.resolveIssueAndModify(invoice_id, modifications, userId);
            res.json(result);
        } catch (error) {
            console.error('[Fulfillment] Error resolving issue:', error);
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
                duration_min: req.query.duration_min ? parseInt(req.query.duration_min) : null,
                sortBy: req.query.sortBy || 'last_activity', // 3.6.3: Add sort options
                sortOrder: req.query.sortOrder || 'desc'
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
     * GET /api/v1/admin/cancelled-shipments/unverified-packages
     * Get unverified packages for admin dashboard
     */
    async getUnverifiedPackages(req, res) {
        try {
            const filters = {
                invoice: req.query.invoice || null,
                incident_type: req.query.incident_type || null,
                status: req.query.status || null,
                days: req.query.days ? parseInt(req.query.days) : null,
                page: parseInt(req.query.page) || 1,
                limit: parseInt(req.query.limit) || 25
            };

            const result = await cancelledShipmentService.getUnverifiedPackages(filters);
            res.json(result);
        } catch (error) {
            console.error('Error getting unverified packages:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * POST /api/v1/admin/cancelled-shipments/verify-package/:packageId
     * Verify a single package
     */
    async verifyPackage(req, res) {
        try {
            const packageId = parseInt(req.params.packageId);
            const userId = req.user.id;

            const result = await cancelledShipmentService.verifyPackage(packageId, userId);
            res.json(result);
        } catch (error) {
            console.error('Error verifying package:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * POST /api/v1/admin/cancelled-shipments/mark-missing/:packageId
     * Mark a package as missing
     */
    async markPackageMissing(req, res) {
        try {
            const packageId = parseInt(req.params.packageId);
            const userId = req.user.id;
            const { reason } = req.body;

            if (!reason || reason.trim().length < 10) {
                return res.status(400).json({ error: 'Reason is required (minimum 10 characters)' });
            }

            const result = await cancelledShipmentService.markPackageMissing(packageId, userId, reason);
            res.json(result);
        } catch (error) {
            console.error('Error marking package as missing:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * POST /api/v1/admin/cancelled-shipments/bulk-verify
     * Bulk verify packages
     */
    async bulkVerifyPackages(req, res) {
        try {
            const { package_ids } = req.body;
            const userId = req.user.id;

            if (!Array.isArray(package_ids) || package_ids.length === 0) {
                return res.status(400).json({ error: 'package_ids array is required' });
            }

            const result = await cancelledShipmentService.bulkVerifyPackages(package_ids, userId);
            res.json(result);
        } catch (error) {
            console.error('Error bulk verifying packages:', error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * POST /api/v1/admin/cancelled-shipments/bulk-mark-missing
     * Bulk mark packages as missing
     */
    async bulkMarkPackagesMissing(req, res) {
        try {
            const { package_ids, reason } = req.body;
            const userId = req.user.id;

            if (!Array.isArray(package_ids) || package_ids.length === 0) {
                return res.status(400).json({ error: 'package_ids array is required' });
            }

            if (!reason || reason.trim().length < 10) {
                return res.status(400).json({ error: 'Reason is required (minimum 10 characters)' });
            }

            const result = await cancelledShipmentService.bulkMarkPackagesMissing(package_ids, userId, reason);
            res.json(result);
        } catch (error) {
            console.error('Error bulk marking packages as missing:', error);
            res.status(500).json({ error: error.message });
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

