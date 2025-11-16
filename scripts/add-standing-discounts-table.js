const { Pool } = require('pg');
const path = require('path');

require('dotenv').config({
    path: path.join(__dirname, '../config/production.env')
});

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10),
    ssl: { rejectUnauthorized: false }
});

async function ensureEnum(client) {
    console.log('🔎 Ensuring discount_type enum exists...');
    await client.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'discount_type') THEN
                CREATE TYPE discount_type AS ENUM ('Percentage', 'Fixed_Amount', 'BOGO');
            END IF;
        END $$;
    `);
    console.log('✅ discount_type enum ready');
}

async function ensureTable(client) {
    console.log('🔎 Ensuring "ORDERS-standing-discounts" table exists...');
    await client.query(`
        CREATE TABLE IF NOT EXISTS "ORDERS-standing-discounts" (
            id SERIAL PRIMARY KEY,
            fk_location_id INTEGER NOT NULL REFERENCES "ORDERS-buyer_locations"(entry_id),
            fk_master_product_id INTEGER NOT NULL REFERENCES "ORDERS-products"(entry_id),
            discount_type discount_type NOT NULL,
            discount_value NUMERIC(10, 2) NOT NULL,
            bogo_buy_quantity INTEGER,
            bogo_get_quantity INTEGER,
            bogo_discount_percent NUMERIC(5, 2),
            valid_from DATE,
            valid_until DATE,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_by INTEGER NOT NULL REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            notes TEXT
        );
    `);
    console.log('✅ Table ready');
}

async function ensureIndexes(client) {
    console.log('🔎 Ensuring indexes exist...');
    await client.query(`
        CREATE INDEX IF NOT EXISTS idx_standing_discounts_location_product
        ON "ORDERS-standing-discounts"(fk_location_id, fk_master_product_id);
    `);
    await client.query(`
        CREATE INDEX IF NOT EXISTS idx_standing_discounts_active
        ON "ORDERS-standing-discounts"(is_active) WHERE is_active = true;
    `);
    console.log('✅ Indexes ready');
}

async function run() {
    const client = await pool.connect();
    try {
        await ensureEnum(client);
        await ensureTable(client);
        await ensureIndexes(client);
        console.log('🎉 Standing discounts schema ensured successfully.');
    } catch (error) {
        console.error('❌ Failed to create standing discounts schema:', error);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    run();
}


