#!/usr/bin/env node

/**
 * Create Orders Table
 * 
 * This script creates the orders table if it doesn't exist
 */

const { Pool } = require('pg');
const path = require('path');

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

const isDevelopment = process.env.NODE_ENV !== 'production';

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    ...(isDevelopment ? {} : {
        ssl: { rejectUnauthorized: false }
    })
});

async function createOrdersTable() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Creating orders table...');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 Database: ${process.env.DB_DATABASE || 'green_releaf_dev'}`);
        
        await client.query('BEGIN');
        
        // Create orders table if it doesn't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                customer_name VARCHAR(255) NOT NULL,
                customer_email VARCHAR(255),
                customer_phone VARCHAR(50),
                order_date TIMESTAMP NOT NULL DEFAULT NOW(),
                status VARCHAR(50) NOT NULL DEFAULT 'Draft',
                total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                notes TEXT,
                
                -- Manifest related columns
                manifest_number VARCHAR(100),
                manifested_at TIMESTAMP,
                manifested_by INTEGER REFERENCES users(id),
                
                -- Audit columns
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                created_by INTEGER REFERENCES users(id),
                updated_by INTEGER REFERENCES users(id)
            )
        `);
        
        console.log('✅ Orders table created or already exists');
        
        // Create indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
            CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
        `);
        
        console.log('✅ Indexes created');
        
        // Add trigger for updated_at
        await client.query(`
            CREATE OR REPLACE FUNCTION update_orders_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);
        
        await client.query(`
            DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
            CREATE TRIGGER update_orders_updated_at
                BEFORE UPDATE ON orders
                FOR EACH ROW
                EXECUTE FUNCTION update_orders_updated_at()
        `);
        
        console.log('✅ Trigger created');
        
        await client.query('COMMIT');
        console.log('🎉 Orders table setup completed successfully!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('💥 Failed to create orders table:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    createOrdersTable()
        .then(() => {
            console.log('✨ Done!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Migration failed:', error.message);
            process.exit(1);
        });
}

module.exports = { createOrdersTable };

