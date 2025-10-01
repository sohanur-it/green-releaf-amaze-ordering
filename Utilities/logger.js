//simple logger utility
//keeps consistent logging format across the app

const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

const currentLogLevel = process.env.LOG_LEVEL || 'INFO';

function log(level, message, data = null) {
    if (LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel]) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level}] ${message}`;

        if (level === 'ERROR') {
            console.error(logMessage, data || '');
        } else if (level === 'WARN') {
            console.warn(logMessage, data || '');
        } else {
            console.log(logMessage, data || '');
        }
    }
}

module.exports = {
    debug: (msg, data) => log('DEBUG', msg, data),
    info: (msg, data) => log('INFO', msg, data),
    warn: (msg, data) => log('WARN', msg, data),
    error: (msg, data) => log('ERROR', msg, data)
};