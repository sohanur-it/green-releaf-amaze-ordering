// Server/Middleware/error-handler.js

const logger = require('../../Utilities/logger');

// this thing catches any requests for routes that we haven't defined.
// basically a "404 Not Found" message.
const notFoundHandler = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

// this is the big one. if any other part of the app throws an error,
//it lands here. keeps the server from crashing completely.
const errorHandler = (err, req, res, next) => {
    // Sometimes an error happens but the status code is still 200, which is stupid. Lol
    // this makes sure we send back a real error code.
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode);

    logger.error(err.stack); // log the ugly error stack to the console

    res.json({
        message: err.message,
        // only show the stack trace if we're not in "production" mode?
        stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack,
    });
};

module.exports = {
    notFoundHandler,
    errorHandler,
};