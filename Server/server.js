// Server/server.js

const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');

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

//import services
const masterScheduler = require('./Services/masterScheduler');

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

//session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'green-releaf-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to false for local development and testing
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

//static files
app.use('/public', express.static(path.join(__dirname, '../Public')));
app.use('/photos', express.static(path.join(__dirname, '../Photos')));

//request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`);
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
    
    // Start the master scheduler in production
    if (process.env.NODE_ENV === 'production') {
        try {
            await masterScheduler.start();
            logger.info(`⏰ Master scheduler started successfully`);
        } catch (error) {
            logger.error(`❌ Failed to start master scheduler: ${error.message}`);
        }
    }
});

module.exports = app;