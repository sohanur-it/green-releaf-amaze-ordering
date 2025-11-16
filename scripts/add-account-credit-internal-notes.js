const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({
    path: path.join(__dirname, '../config/production.env')
});

async function run() {
    const pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT, 10),
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    });

    const client = await pool.connect();
    try {
        console.log('🔎 Checking for internal_notes column on ORDERS-account-credits…');
        await client.query(`
            ALTER TABLE "ORDERS-account-credits"
            ADD COLUMN IF NOT EXISTS internal_notes TEXT
        `);
        console.log('✅ internal_notes column ensured on ORDERS-account-credits');
    } catch (error) {
        console.error('❌ Failed to add internal_notes column:', error);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

run();


