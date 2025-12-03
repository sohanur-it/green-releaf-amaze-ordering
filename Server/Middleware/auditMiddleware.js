/**
 * Audit Middleware
 * 
 * Automatically logs all state-changing API requests
 * Captures user actions, resource changes, and outcomes
 */

const auditLogger = require('../Services/auditLogger');

/**
 * Audit middleware factory
 * Creates middleware that logs API requests based on configuration
 */
function createAuditMiddleware(options = {}) {
    const {
        logMethods = ['POST', 'PUT', 'DELETE', 'PATCH'],
        excludePaths = ['/health', '/status'],
        extractAction = null,
        extractResourceData = null
    } = options;

    return async (req, res, next) => {
        // Skip if method is not in logMethods
        if (!logMethods.includes(req.method)) {
            return next();
        }

        // Skip if path is excluded
        if (excludePaths.some(path => req.path.startsWith(path))) {
            return next();
        }

        // Skip if user is not authenticated (except for system actions)
        if (!req.session?.userId && !req.path.includes('/system/')) {
            return next();
        }

        // Extract action from path or use custom function
        const action = extractAction ? extractAction(req) : extractActionFromPath(req);
        
        // Extract resource data if custom function provided
        let beforeData = null;
        if (extractResourceData) {
            beforeData = await extractResourceData(req);
        }

        // Store original res.end to intercept response
        const originalEnd = res.end;
        let responseBody = null;

        res.end = function(chunk, encoding) {
            if (chunk) {
                responseBody = chunk.toString();
            }
            originalEnd.call(this, chunk, encoding);
        };

        // Log the action after response is sent
        res.on('finish', async () => {
            try {
                const status = res.statusCode >= 200 && res.statusCode < 300 ? 'success' : 'failure';
                
                // Extract after data from response
                let afterData = null;
                if (responseBody && res.get('Content-Type')?.includes('application/json')) {
                    try {
                        afterData = JSON.parse(responseBody);
                    } catch (e) {
                        // Response body is not JSON, skip afterData
                    }
                }

                await auditLogger.logApiRequest(req, res, action, beforeData, afterData, status);
            } catch (error) {
                console.error('❌ Failed to log API request:', error.message);
            }
        });

        next();
    };
}

/**
 * Extract action from request path
 */
function extractActionFromPath(req) {
    const method = req.method.toLowerCase();
    const path = req.path.toLowerCase();
    
    // Special handling for batch promotion routes
    if (path.includes('/batches') && path.includes('/promote')) {
        return 'batch_promotion_manual';
    }
    if (path.includes('/batches') && path.includes('/status')) {
        return 'batch_status_update';
    }
    if (path.includes('/batches') && path.includes('/force-check')) {
        return 'batch_force_check';
    }
    
    // Special handling for line item updates
    if (path.includes('/invoices') && path.includes('/line-items')) {
        if (method === 'patch' || method === 'put') {
            return 'invoice_line_item_update';
        } else if (method === 'post') {
            return 'invoice_line_item_create';
        } else if (method === 'delete') {
            return 'invoice_line_item_delete';
        }
    }
    
    // Extract resource from path
    let resource = 'unknown';
    if (path.includes('/orders')) resource = 'order';
    else if (path.includes('/invoices')) resource = 'invoice';
    else if (path.includes('/batches')) resource = 'batch';
    else if (path.includes('/manifests')) resource = 'manifest';
    else if (path.includes('/users')) resource = 'user';
    else if (path.includes('/packages')) resource = 'package';
    else if (path.includes('/sync')) resource = 'sync';
    
    // Map HTTP methods to actions
    const actionMap = {
        'post': 'create',
        'put': 'update',
        'patch': 'update',
        'delete': 'delete'
    };
    
    const action = actionMap[method] || method;
    
    return `${resource}_${action}`;
}

/**
 * Standard audit middleware for most API routes
 */
const auditMiddleware = createAuditMiddleware({
    logMethods: ['POST', 'PUT', 'DELETE', 'PATCH'],
    excludePaths: ['/health', '/status', '/auth/login', '/auth/logout']
});

/**
 * Audit middleware for sync operations
 */
const syncAuditMiddleware = createAuditMiddleware({
    logMethods: ['POST'],
    excludePaths: [],
    extractAction: (req) => {
        const serviceName = req.params.serviceName || 'unknown';
        return `sync_${serviceName}_triggered`;
    }
});

/**
 * Audit middleware for user management
 */
const userAuditMiddleware = createAuditMiddleware({
    logMethods: ['POST', 'PUT', 'DELETE'],
    excludePaths: [],
    extractAction: (req) => {
        const path = req.path.toLowerCase();
        if (path.includes('/approve')) return 'user_approve';
        if (path.includes('/revoke')) return 'user_revoke';
        if (path.includes('/assign-roles')) return 'user_assign_roles';
        return 'user_update';
    }
});

/**
 * Audit middleware for manifest creation
 */
const manifestAuditMiddleware = createAuditMiddleware({
    logMethods: ['POST'],
    excludePaths: [],
    extractAction: () => 'manifest_create',
    extractResourceData: async (req) => {
        // Extract order data before manifest creation
        if (req.body.orderId) {
            // This would typically query the database for order details
            // For now, return the orderId from request body
            return { orderId: req.body.orderId };
        }
        return null;
    }
});

/**
 * Audit middleware for order operations with field-level change tracking
 * 
 * This middleware:
 * 1. Intercepts order update requests (PUT/PATCH)
 * 2. Fetches the current state of the order from database BEFORE changes
 * 3. Allows the controller to process the update
 * 4. Captures the new state AFTER changes
 * 5. Logs detailed field-by-field changes to audit trail
 */
const { Pool } = require('pg');
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    password: process.env.DB_PASSWORD || 'postgres',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
});

const orderAuditMiddleware = createAuditMiddleware({
    logMethods: ['PUT', 'PATCH'],
    excludePaths: [],
    extractAction: (req) => 'order_update',
    extractResourceData: async (req) => {
        // Extract order ID from URL parameters
        const orderId = req.params.orderId || req.params.id;
        
        if (!orderId) {
            return null;
        }
        
        try {
            // Fetch current order state from database BEFORE any changes
            const result = await pool.query(`
                SELECT * FROM "ORDERS-orders" WHERE order_id = $1
            `, [orderId]);
            
            if (result.rows.length === 0) {
                return null;
            }
            
            // Return the complete current state
            return result.rows[0];
            
        } catch (error) {
            console.error('❌ Failed to fetch order before state:', error.message);
            return null;
        }
    }
});

/**
 * Audit middleware for batch status changes
 * Tracks when batches are promoted from "On Deck" to "Sellable" or "On Hold"
 */
const batchAuditMiddleware = createAuditMiddleware({
    logMethods: ['PUT', 'PATCH'],
    excludePaths: [],
    extractAction: (req) => {
        if (req.path.includes('/promote')) return 'batch_promote';
        if (req.path.includes('/hold')) return 'batch_hold';
        return 'batch_update';
    },
    extractResourceData: async (req) => {
        const batchId = req.params.batchId || req.params.id;
        
        if (!batchId) {
            return null;
        }
        
        try {
            const result = await pool.query(`
                SELECT 
                    id, batch_name, metrc_item_name, status,
                    quantity, allocated_quantity, fk_master_product_id,
                    override_price, thc_percentage, production_date
                FROM "ORDERS-batches" WHERE id = $1
            `, [batchId]);
            
            if (result.rows.length === 0) {
                return null;
            }
            
            return result.rows[0];
            
        } catch (error) {
            console.error('❌ Failed to fetch batch before state:', error.message);
            return null;
        }
    }
});

module.exports = {
    createAuditMiddleware,
    auditMiddleware,
    syncAuditMiddleware,
    userAuditMiddleware,
    manifestAuditMiddleware,
    orderAuditMiddleware,
    batchAuditMiddleware
};
