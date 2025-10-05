// Utilities/logger.js

//this is a super simple logger
// it just prints info messages to the console. we can make it fancier later if we need.
const logger = {
    info: (message) => {
        console.log(`[INFO] ${new Date().toISOString()}: ${message}`);
    },
    error: (message) => {
        console.error(`[ERROR] ${new Date().toISOString()}: ${message}`);
    }
};

module.exports = logger;