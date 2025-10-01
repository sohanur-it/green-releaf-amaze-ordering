const logger = require('../../Utilities/logger');

//global error handler middleware

function errorHandler(err, req, res, next) {
    //log the error
    logger.error('Error caught by error handler:', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method
    });

    //determine status code
    const statusCode = err.statusCode || err.status || 500;

    //dont leak error details in production
    const isDevelopment = process.env.NODE_ENV !== 'production';

    //send error response
    res.status(statusCode).json({
        error: {
            message: err.message || 'An error occurred',
            ...(isDevelopment && { stack: err.stack }),
            ...(err.details && { details: err.details })
        }
    });
}

//404 handler
function notFoundHandler(req, res, next) {
    res.status(404).json({
        error: {
            message: 'Route not found',
            url: req.url
        }
    });
}

module.exports = {
    errorHandler,
    notFoundHandler
};