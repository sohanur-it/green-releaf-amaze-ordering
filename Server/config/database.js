const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.ENV') });

//databse connection pool config
//uses env vars from .ENV file
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    max: 20, //max connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

//error handlr for pool
pool.on('error', (err, client) => {
    console.error('Unexpected error on idle database client', err);
    process.exit(-1);
});

//test connection on startup
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Database connection test failed:', err);
    } else {
        console.log('✅ Database connected successfully at:', res.rows[0].now);
    }
});

module.exports = pool;