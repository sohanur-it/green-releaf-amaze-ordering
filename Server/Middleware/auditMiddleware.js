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

module.exports = {
    createAuditMiddleware,
    auditMiddleware,
    syncAuditMiddleware,
    userAuditMiddleware,
    manifestAuditMiddleware
};
