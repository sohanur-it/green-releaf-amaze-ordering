const express = require('express');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.ENV') });

const logger = require('../Utilities/logger');
const { errorHandler, notFoundHandler } = require('./Middleware/error-handler');

//import routes
const adminRoutes = require('./Routes/admin-routes');
const orderRoutes = require('./Routes/order-routes');
const apiRoutes = require('./Routes/api-routes');

//create express app
const app = express();
const PORT = process.env.PORT || 3000;

//view engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../Views'));

//middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//static files
app.use('/public', express.static(path.join(__dirname, '../Public')));
app.use('/photos', express.static(path.join(__dirname, '../Photos')));

//request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
});

//routes
app.use('/admin', adminRoutes);
app.use('/order', orderRoutes);
app.use('/api', apiRoutes);

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
    logger.info(`🛒 Order page: http://localhost:${PORT}/order`);
    logger.info(`💚 Green Releaf Amaze Ordering System`);
});

module.exports = app;