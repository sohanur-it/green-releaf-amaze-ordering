/**
 * Migration: Add sort_order column to ORDERS-discount-rules table
 * 
 * This script adds the sort_order column to allow reordering of discount rules.
 * Run this script if you're getting "column sort_order does not exist" errors.
 * 
 * Usage:
 *   node scripts/add-discount-rules-sort-order.js
 */

const { Pool } = require('pg');
const path = require('path');

// Load environment variables - try production first, then local
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });

// Use the same connection pattern as add-discount-builder-schema.js
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE || process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addSortOrderColumn() {
    const client = await pool.connect();
    try {
        console.log('🔎 Checking if sort_order column exists...');
        
        // Check if column exists
        const checkResult = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'ORDERS-discount-rules' 
            AND column_name = 'sort_order'
        `);
        
        if (checkResult.rows.length > 0) {
            console.log('✅ sort_order column already exists. No migration needed.');
            return;
        }
        
        console.log('📝 Adding sort_order column to ORDERS-discount-rules table...');
        
        // Add the column
        await client.query(`
            ALTER TABLE "ORDERS-discount-rules" 
            ADD COLUMN sort_order INTEGER
        `);
        
        console.log('✅ Successfully added sort_order column.');
        
        // Optionally, initialize sort_order based on created_at for existing rules
        console.log('📝 Initializing sort_order for existing rules...');
        await client.query(`
            UPDATE "ORDERS-discount-rules"
            SET sort_order = sub.row_num
            FROM (
                SELECT id, 
                       ROW_NUMBER() OVER (PARTITION BY fk_discount_id ORDER BY created_at ASC) as row_num
                FROM "ORDERS-discount-rules"
            ) sub
            WHERE "ORDERS-discount-rules".id = sub.id
        `);
        
        console.log('✅ Successfully initialized sort_order for existing rules.');
        console.log('🎉 Migration completed successfully!');
        
    } catch (error) {
        console.error('❌ Error adding sort_order column:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the migration
addSortOrderColumn()
    .then(() => {
        console.log('✅ Migration script completed.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    });

