// Server/server.js

const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool } = require('./config/database');

// Load environment variables based on NODE_ENV
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const logger = require('../Utilities/logger');
const { errorHandler, notFoundHandler } = require('./Middleware/error-handler');
const swaggerAuth = require('./Middleware/swagger-auth');

// Swagger configuration
const { swaggerSpec, swaggerUi, swaggerUiOptions } = require('./config/swagger');

//import routes
const adminRoutes = require('./Routes/admin-routes');
const crmApiRoutes = require('./Routes/crm/api');
const authRoutes = require('./Routes/auth-routes');
const tokenRoutes = require('./Routes/token-routes');
const syncRoutes = require('./Routes/sync-routes');
const manifestRoutes = require('./Routes/manifest-routes');
const adminSyncRoutes = require('./Routes/admin-sync-routes');
const userManagementRoutes = require('./Routes/user-management-routes');
const auditLogRoutes = require('./Routes/audit-log-routes');
const batchRoutes = require('./Routes/batch-routes');
const alertRoutes = require('./Routes/alertRoutes');
const module3Routes = require('./Routes/module3-routes');
const portalRoutes = require('./Routes/portal-routes');
const invoiceRoutes = require('./Routes/invoice-routes');
const notificationRoutes = require('./Routes/notification-routes');
const fulfillmentRoutes = require('./Routes/fulfillment-routes');
const healthRoutes = require('./Routes/health-routes');

//import services
const masterScheduler = require('./Services/masterScheduler');
const inventoryMonitorService = require('./Services/inventoryMonitorService');
const websocketService = require('./Services/websocketService');

//create express app
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for proper IP address extraction
app.set('trust proxy', true);

//view engine setup
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('views', path.join(__dirname, '../Views'));

//middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//session middleware with PostgreSQL store for persistence across restarts
let sessionStore;
try {
    sessionStore = new pgSession({
        pool: pool,
        tableName: 'user_sessions',
        createTableIfMissing: false // We create it manually to ensure correct schema
    });
    console.log('[INFO] PostgreSQL session store initialized');
} catch (error) {
    console.error('[ERROR] Failed to initialize PostgreSQL session store:', error);
    console.log('[WARN] Falling back to memory store (sessions will be lost on restart)');
    sessionStore = undefined;
}

// Add error handler for session store
if (sessionStore) {
    sessionStore.on('error', (error) => {
        console.error('[SESSION] Session store error:', error);
    });
    sessionStore.on('connect', () => {
        console.log('[SESSION] Session store connected successfully');
    });
}

app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'green-releaf-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    rolling: true, // Reset expiration on activity
    cookie: {
        secure: process.env.NODE_ENV === 'production' ? true : false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax', // Allow cookie to be sent with redirects
        path: '/' // Ensure cookie is available for all paths
    },
    name: 'connect.sid' // Explicit session cookie name
}));

// Add middleware to reload session from store if needed
// This runs AFTER express-session middleware, so we can check if session was loaded
app.use((req, res, next) => {
    // Check if we have a cookie but session is empty or has different ID
    const cookies = req.headers.cookie || '';
    const sessionCookie = cookies.split(';').find(c => c.trim().startsWith('connect.sid='));
    
    if (sessionCookie) {
        // Extract the session ID from the signed cookie
        // express-session signs cookies as: s:sessionId.signature
        let cookieSid = sessionCookie.split('=')[1];
        if (cookieSid.startsWith('s:')) {
            cookieSid = cookieSid.substring(2).split('.')[0];
        }
        
        // If the session ID from cookie doesn't match req.sessionID, or session is empty
        if (cookieSid !== req.sessionID || (req.session && Object.keys(req.session).length === 1 && req.session.cookie)) {
            // Only log in development or if SESSION_DEBUG is enabled
            if (process.env.NODE_ENV !== 'production' || process.env.SESSION_DEBUG === 'true') {
                console.log(`[SESSION] Cookie SID (${cookieSid.substring(0, 20)}...) doesn't match session ID (${req.sessionID?.substring(0, 20)}...), attempting to load from store...`);
            }
            
            if (sessionStore && cookieSid) {
                sessionStore.get(cookieSid, (err, session) => {
                    if (!err && session) {
                        // Only log in development or if SESSION_DEBUG is enabled
                        if (process.env.NODE_ENV !== 'production' || process.env.SESSION_DEBUG === 'true') {
                            console.log('[SESSION] Successfully loaded session from store. Keys:', Object.keys(session));
                        }
                        // Replace the session data
                        const cookie = req.session?.cookie;
                        // Clear existing session data
                        if (req.session) {
                            Object.keys(req.session).forEach(key => {
                                if (key !== 'cookie') delete req.session[key];
                            });
                        }
                        // Copy session data
                        Object.assign(req.session, session);
                        if (cookie) {
                            req.session.cookie = cookie;
                        }
                        // Update session ID
                        req.sessionID = cookieSid;
                        // Only log in development or if SESSION_DEBUG is enabled
                        if (process.env.NODE_ENV !== 'production' || process.env.SESSION_DEBUG === 'true') {
                            console.log('[SESSION] Session after reload. userId:', req.session.userId);
                        }
                    } else if (err) {
                        console.error('[SESSION] Error reloading session:', err);
                    } else {
                        console.log('[SESSION] No session found in store for cookie SID:', cookieSid);
                    }
                    next();
                });
                return;
            }
        }
    }
    
    // If session exists but has no data (only cookie), try to reload from store
    if (req.session && Object.keys(req.session).length === 1 && req.session.cookie && req.sessionID) {
        // Only log in development or if SESSION_DEBUG is enabled
        if (process.env.NODE_ENV !== 'production' || process.env.SESSION_DEBUG === 'true') {
            console.log('[SESSION] Session exists but appears empty, attempting to reload from store...');
        }
        if (sessionStore) {
            sessionStore.get(req.sessionID, (err, session) => {
                if (!err && session) {
                    // Only log in development or if SESSION_DEBUG is enabled
                    if (process.env.NODE_ENV !== 'production' || process.env.SESSION_DEBUG === 'true') {
                        console.log('[SESSION] Reloaded session from store. Keys:', Object.keys(session));
                    }
                    // Merge session data (but preserve cookie)
                    const cookie = req.session.cookie;
                    Object.assign(req.session, session);
                    req.session.cookie = cookie; // Preserve cookie settings
                    // Only log in development or if SESSION_DEBUG is enabled
                    if (process.env.NODE_ENV !== 'production' || process.env.SESSION_DEBUG === 'true') {
                        console.log('[SESSION] Session after reload. userId:', req.session.userId);
                    }
                } else if (err) {
                    console.error('[SESSION] Error reloading session:', err);
                } else {
                    console.log('[SESSION] No session found in store for ID:', req.sessionID);
                }
                next();
            });
            return;
        }
    }
    next();
});

// Add middleware to log session and cookie information (only for auth-related routes to reduce noise)
app.use((req, res, next) => {
    // Only log for auth and admin routes
    if (req.path.startsWith('/auth') || req.path.startsWith('/admin')) {
        const cookies = req.headers.cookie || '';
        const sessionCookie = cookies.split(';').find(c => c.trim().startsWith('connect.sid='));
        console.log(`[SESSION] ${req.method} ${req.path}`);
        console.log(`[SESSION] Cookie in request: ${sessionCookie ? 'YES' : 'NO'}`);
        if (sessionCookie) {
            const sid = sessionCookie.split('=')[1];
            console.log(`[SESSION] Cookie SID: ${sid.substring(0, 20)}...`);
        }
        console.log(`[SESSION] Session ID from middleware: ${req.sessionID}`);
        console.log(`[SESSION] Session object exists: ${!!req.session}`);
        if (req.session) {
            console.log(`[SESSION] Session keys: ${Object.keys(req.session).join(', ')}`);
            console.log(`[SESSION] Session userId: ${req.session.userId || 'undefined'}`);
        }
    }
    
    next();
});

//static files
app.use('/public', express.static(path.join(__dirname, '../Public')));
app.use('/photos', express.static(path.join(__dirname, '../Photos')));

//request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
});

// Make user roles and permissions available to all templates
// Note: Roles are refreshed from database in requireAuth middleware to ensure they're current
app.use((req, res, next) => {
    if (req.session) {
        // Use session data (which is refreshed from DB in requireAuth middleware)
        res.locals.userRoles = req.session.roles || [];
        res.locals.userPermissions = req.session.permissions || [];
        res.locals.isSuperuser = req.session.isSuperuser || false;
        res.locals.username = req.session.username || '';
        res.locals.userEmail = req.session.email || '';
    } else {
        res.locals.userRoles = [];
        res.locals.userPermissions = [];
        res.locals.isSuperuser = false;
        res.locals.username = '';
        res.locals.userEmail = '';
    }
    next();
});

// Swagger API documentation
app.use('/api-docs', swaggerAuth, swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));

// Serve Swagger JSON spec
app.get('/api-docs.json', swaggerAuth, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

//routes
app.use('/auth', authRoutes);
app.use('/api/v1/auth', tokenRoutes); // JWT token routes
app.use('/admin', adminRoutes);
app.use('/api/crm', crmApiRoutes); // our CRM API routes are handled here
app.use('/api/v1/admin/sync', syncRoutes); // sync management API routes
app.use('/api/v1/swagger/sync', adminSyncRoutes); // admin sync API routes with Swagger docs
app.use('/api/v1/manifests', manifestRoutes); // manifest creation API routes
app.use('/api/v1/admin/users', userManagementRoutes); // user management API routes
app.use('/api/v1/admin/audit-logs', auditLogRoutes); // audit log API routes
app.use('/api/batches', batchRoutes); // batch status management API routes
app.use('/api/v1', module3Routes); // Module 3: Product & Inventory Management API routes
app.use('/api/v1/invoices', invoiceRoutes); // Module 4: Invoice management API routes
app.use('/api/v1/discounts', require('./Routes/discount-routes')); // Module 4: Discount management API routes
app.use('/api/v1/credits', require('./Routes/credit-routes')); // Module 4: Credit management API routes
app.use('/api/v1/notifications', notificationRoutes); // Module 4: Notification management API routes
app.use('/api/v1/fulfillment', fulfillmentRoutes); // Module 5: Fulfillment & Manifesting API routes
app.use('/api/alerts', alertRoutes); // sync failure alert API routes
app.use('/api/health', healthRoutes); // Module 19: Health check routes
app.use('/', portalRoutes); // External buyer portal routes

// WebSocket test page
app.get('/test-websocket', (req, res) => {
    res.sendFile(path.join(__dirname, '../Public/test-websocket.html'));
});

//root redirect
app.get('/', (req, res) => {
    res.redirect('/admin');
});

//404 handler
app.use(notFoundHandler);

//error handler
app.use(errorHandler);

//start server
app.listen(PORT, async () => {
    logger.info(`🚀 Server started on port ${PORT}`);
    logger.info(`📝 Admin panel: http://localhost:${PORT}/admin`);
    logger.info(`📚 API Documentation: http://localhost:${PORT}/api-docs`);
    logger.info(`💚 Green Releaf Amaze Ordering System`);
    
    // Start the master scheduler (configurable via environment variable)
    const enableScheduler = process.env.ENABLE_SCHEDULER === 'true' || process.env.NODE_ENV === 'production';
    if (enableScheduler) {
        try {
            await masterScheduler.start();
            logger.info(`⏰ Master scheduler started successfully`);
        } catch (error) {
            logger.error(`❌ Failed to start master scheduler: ${error.message}`);
        }
    } else {
        logger.info(`⏸️  Master scheduler disabled (set ENABLE_SCHEDULER=true to enable)`);
    }
    
    // Start inventory monitoring (configurable via environment variable)
    const enableInventoryMonitoring = process.env.ENABLE_INVENTORY_MONITORING === 'true' || process.env.NODE_ENV === 'production';
    if (enableInventoryMonitoring) {
        try {
            inventoryMonitorService.start();
            logger.info(`📦 Inventory monitoring started successfully`);
        } catch (error) {
            logger.error(`❌ Failed to start inventory monitoring: ${error.message}`);
        }
    } else {
        logger.info(`⏸️  Inventory monitoring disabled (set ENABLE_INVENTORY_MONITORING=true to enable)`);
    }
    
    // Start WebSocket server (configurable via environment variable)
    const enableWebSocket = process.env.ENABLE_WEBSOCKET !== 'false';
    if (enableWebSocket) {
        try {
            websocketService.start();
            logger.info(`🔌 WebSocket server started successfully`);
        } catch (error) {
            logger.error(`❌ Failed to start WebSocket server: ${error.message}`);
        }
    } else {
        logger.info(`⏸️  WebSocket server disabled (set ENABLE_WEBSOCKET=false to disable)`);
    }
});

module.exports = app;