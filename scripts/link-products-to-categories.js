#!/usr/bin/env node

/**
 * Link Products to Categories
 * 
 * This script maps existing products' category_name to fk_category_id
 * by creating a mapping or adding new categories as needed.
 */

const { Pool } = require('pg');
const path = require('path');

// Determine environment and load appropriate env file
const nodeEnv = process.env.NODE_ENV || 'development';
let envPath;

if (nodeEnv === 'production') {
    envPath = path.join(__dirname, '../config/production.env');
} else {
    envPath = path.join(__dirname, '../config/local.env');
}

// Load environment variables
require('dotenv').config({ path: envPath });

const isDevelopment = nodeEnv !== 'production';

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

async function linkProductsToCategories() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Linking products to categories...');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 Database: ${process.env.DB_DATABASE || 'green_releaf_dev'}`);
        
        await client.query('BEGIN');
        
        // Get all unique category_name values from products
        const uniqueCategories = await client.query(`
            SELECT DISTINCT category_name 
            FROM "ORDERS-products" 
            WHERE category_name IS NOT NULL
            ORDER BY category_name
        `);
        
        console.log(`\n📦 Found ${uniqueCategories.rows.length} unique product categories:`);
        const categoryMap = {};
        
        for (const row of uniqueCategories.rows) {
            const categoryName = row.category_name;
            console.log(`   - ${categoryName}`);
            
            // Try to find existing category
            const existing = await client.query(`
                SELECT id FROM "ORDERS-product-categories" 
                WHERE category_name = $1
            `, [categoryName]);
            
            if (existing.rows.length > 0) {
                categoryMap[categoryName] = existing.rows[0].id;
                console.log(`      ✓ Found category ID: ${existing.rows[0].id}`);
            } else {
                // Create new category
                const result = await client.query(`
                    INSERT INTO "ORDERS-product-categories" (category_name) 
                    VALUES ($1)
                    RETURNING id
                `, [categoryName]);
                
                categoryMap[categoryName] = result.rows[0].id;
                console.log(`      ✓ Created new category ID: ${result.rows[0].id}`);
            }
        }
        
        // Now update all products with their fk_category_id
        console.log('\n🔗 Linking products...');
        let linkedCount = 0;
        
        for (const [categoryName, categoryId] of Object.entries(categoryMap)) {
            const result = await client.query(`
                UPDATE "ORDERS-products"
                SET fk_category_id = $1
                WHERE category_name = $2
            `, [categoryId, categoryName]);
            
            linkedCount += result.rowCount;
            console.log(`   ✓ Linked ${result.rowCount} products to category "${categoryName}"`);
        }
        
        await client.query('COMMIT');
        console.log(`\n✅ Successfully linked ${linkedCount} products to categories!`);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('💥 Failed to link products:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    linkProductsToCategories()
        .then(() => {
            console.log('\n🎉 Done!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Migration failed:', error.message);
            process.exit(1);
        });
}

module.exports = { linkProductsToCategories };

