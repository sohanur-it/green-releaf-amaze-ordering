// Server/server.js

const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
require('dotenv').config({ path: path.join(__dirname, '../.ENV') });

const logger = require('../Utilities/logger');
const { errorHandler, notFoundHandler } = require('./Middleware/error-handler');

//import routes
const adminRoutes = require('./Routes/admin-routes');
const crmApiRoutes = require('./Routes/crm/api');
const authRoutes = require('./Routes/auth-routes');

//create express app
const app = express();
const PORT = process.env.PORT || 3000;

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
        secure: process.env.NODE_ENV === 'production', // Only use secure cookies in production
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

//routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/api/crm', crmApiRoutes); // our CRM API routes are handled here

//root redirect
app.get('/', (req, res) => {
    res.redirect('/admin');
});

//404 handler
app.use(notFoundHandler);

//error handler
app.use(errorHandler);

//start server
app.listen(PORT, () => {
    logger.info(`🚀 Server started on port ${PORT}`);
    logger.info(`📝 Admin panel: http://localhost:${PORT}/admin`);
    logger.info(`💚 Green Releaf Amaze Ordering System`);
});

module.exports = app;