// Server/config/database.js

const { Pool } = require('pg');
const path = require('path');

// Load environment variables based on NODE_ENV (same as server.js)
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
}

// Database configuration with support for both local development and production
const isDevelopment = process.env.NODE_ENV === 'development';

// Configuration object
const dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    // Additional configuration for production
    ...(isDevelopment ? {
        // Development settings
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
    } : {
        // Production settings
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ssl: {
            rejectUnauthorized: false
        }
    })
};

// Create connection pool
const pool = new Pool(dbConfig);

// Handle pool errors
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// Test database connection
pool.on('connect', () => {
    if (isDevelopment) {
        console.log(`[INFO] Connected to local PostgreSQL database: ${dbConfig.database}`);
    } else {
        console.log(`[INFO] Connected to production PostgreSQL database: ${dbConfig.database}`);
    }
});

// Enhanced query function with error handling and logging
const query = async (text, params) => {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        
        if (isDevelopment && duration > 1000) {
            console.log(`[SLOW QUERY] ${text.substring(0, 100)}... (${duration}ms)`);
        }
        
        return result;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
};

// Health check function
const healthCheck = async () => {
    try {
        const result = await pool.query('SELECT NOW()');
        return {
            status: 'healthy',
            timestamp: result.rows[0].now,
            database: dbConfig.database,
            host: dbConfig.host
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message,
            database: dbConfig.database,
            host: dbConfig.host
        };
    }
};

// Graceful shutdown
const closePool = async () => {
    try {
        await pool.end();
        console.log('[INFO] Database pool closed gracefully');
    } catch (error) {
        console.error('Error closing database pool:', error);
    }
};

// Handle process termination
process.on('SIGINT', closePool);
process.on('SIGTERM', closePool);

module.exports = {
    query,
    healthCheck,
    closePool,
    pool
};