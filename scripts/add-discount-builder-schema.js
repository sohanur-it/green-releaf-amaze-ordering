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

async function ensureTypes(client) {
    console.log('🔎 Ensuring discount enums exist...');
    await client.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'discount_scope') THEN
                CREATE TYPE discount_scope AS ENUM ('Entire_Order', 'Specific_Category', 'Specific_Product');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'discount_action') THEN
                CREATE TYPE discount_action AS ENUM ('Percentage_Off', 'Fixed_Amount_Off', 'Set_Fixed_Price');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'discount_stacking_behavior') THEN
                CREATE TYPE discount_stacking_behavior AS ENUM ('Best_Price', 'Current_Price');
            END IF;
        END $$;
    `);
    console.log('✅ Discount enums ready');
}

async function ensureTables(client) {
    console.log('🔎 Ensuring discount tables exist...');
    await client.query(`
        CREATE TABLE IF NOT EXISTS "ORDERS-discount-codes" (
            id SERIAL PRIMARY KEY,
            display_name TEXT NOT NULL,
            code_name TEXT NOT NULL UNIQUE,
            internal_notes TEXT,
            stacking_behavior discount_stacking_behavior NOT NULL DEFAULT 'Current_Price',
            minimum_quantity INTEGER,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_by INTEGER REFERENCES users(id),
            updated_by INTEGER REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await client.query(`
        CREATE TABLE IF NOT EXISTS "ORDERS-discount-rules" (
            id SERIAL PRIMARY KEY,
            fk_discount_id INTEGER NOT NULL REFERENCES "ORDERS-discount-codes"(id) ON DELETE CASCADE,
            applies_to discount_scope NOT NULL,
            category_name TEXT,
            fk_master_product_id INTEGER REFERENCES "ORDERS-products"(entry_id),
            action discount_action NOT NULL,
            value NUMERIC(12, 4) NOT NULL,
            metadata JSONB,
            sort_order INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
    
    // Add sort_order column if it doesn't exist (for existing databases)
    await client.query(`
        DO $$ 
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'ORDERS-discount-rules' 
                AND column_name = 'sort_order'
            ) THEN
                ALTER TABLE "ORDERS-discount-rules" ADD COLUMN sort_order INTEGER;
            END IF;
        END $$;
    `);

    await client.query(`
        CREATE TABLE IF NOT EXISTS "ORDERS-discount-conflicts" (
            id SERIAL PRIMARY KEY,
            fk_discount_id INTEGER NOT NULL REFERENCES "ORDERS-discount-codes"(id) ON DELETE CASCADE,
            fk_conflicting_discount_id INTEGER NOT NULL REFERENCES "ORDERS-discount-codes"(id) ON DELETE CASCADE,
            CONSTRAINT uniq_discount_conflict UNIQUE (fk_discount_id, fk_conflicting_discount_id)
        );
    `);

    await client.query(`
        CREATE TABLE IF NOT EXISTS "ORDERS-discount-buyer-assignments" (
            id SERIAL PRIMARY KEY,
            fk_buyer_id INTEGER NOT NULL REFERENCES "ORDERS-buyers"(entry_id),
            fk_discount_id INTEGER NOT NULL REFERENCES "ORDERS-discount-codes"(id) ON DELETE CASCADE,
            priority INTEGER NOT NULL DEFAULT 1,
            is_active BOOLEAN NOT NULL DEFAULT true,
            assigned_by INTEGER REFERENCES users(id),
            assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (fk_buyer_id, fk_discount_id)
        );
    `);
    console.log('✅ Tables ready');
}

async function ensureIndexes(client) {
    console.log('🔎 Creating indexes...');
    await client.query(`
        CREATE INDEX IF NOT EXISTS idx_discount_codes_active
            ON "ORDERS-discount-codes"(is_active);
    `);
    await client.query(`
        CREATE INDEX IF NOT EXISTS idx_discount_rules_discount
            ON "ORDERS-discount-rules"(fk_discount_id);
    `);
    await client.query(`
        CREATE INDEX IF NOT EXISTS idx_discount_rules_product
            ON "ORDERS-discount-rules"(fk_master_product_id)
            WHERE fk_master_product_id IS NOT NULL;
    `);
    await client.query(`
        CREATE INDEX IF NOT EXISTS idx_discount_assignments_buyer
            ON "ORDERS-discount-buyer-assignments"(fk_buyer_id);
    `);
    console.log('✅ Indexes ready');
}

async function run() {
    const client = await pool.connect();
    try {
        await ensureTypes(client);
        await ensureTables(client);
        await ensureIndexes(client);
        console.log('🎉 Discount builder schema complete.');
    } catch (error) {
        console.error('❌ Failed to ensure discount builder schema:', error);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    run();
}


