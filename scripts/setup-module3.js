#!/usr/bin/env node

/**
 * Module 3 Setup Script
 * 
 * This script sets up the complete Module 3 database schema and tests the functionality.
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs').promises;

// Load environment variables
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });
}

// Database configuration
const isDevelopment = process.env.NODE_ENV !== 'production';

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    // Only use SSL in production
    ...(isDevelopment ? {} : {
        ssl: { rejectUnauthorized: false }
    })
};

const pool = new Pool(DB_CONFIG);

async function setupModule3() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Setting up Module 3: Product & Inventory Management...');
        
        // 1. Load and execute the schema migration
        console.log('📋 Step 1: Creating database schema...');
        const schemaPath = path.join(__dirname, '../docker/postgres/init/08-module3-schema.sql');
        const schemaSQL = await fs.readFile(schemaPath, 'utf8');
        
        await client.query(schemaSQL);
        console.log('✅ Database schema created successfully');
        
        // 2. Test the batch extraction query
        console.log('📋 Step 2: Testing batch extraction query...');
        const queryPath = path.join(__dirname, '../Queries/metrc-batch-extractor-query.sql');
        const extractionQuery = await fs.readFile(queryPath, 'utf8');
        
        const result = await client.query(extractionQuery);
        console.log(`✅ Batch extraction query executed successfully: ${result.rows.length} batches found`);
        
        // 3. Insert sample data for testing
        console.log('📋 Step 3: Creating sample data...');
        
        // Create sample master products
        const sampleProducts = [
            {
                name: 'Amaze Orange 3.5g',
                category_name: 'Flower - 3.5g Jars',
                default_price: 50.00,
                description: 'Premium Orange strain flower',
                brand_name: 'Amaze',
                cultivar_name: 'Orange',
                lineage: 'Orange x Unknown'
            },
            {
                name: 'Blue Dream 1g',
                category_name: 'Flower - 1g Jars',
                default_price: 15.00,
                description: 'Classic Blue Dream strain',
                brand_name: 'Amaze',
                cultivar_name: 'Blue Dream',
                lineage: 'Blueberry x Haze'
            }
        ];
        
        for (const product of sampleProducts) {
            // Check if product already exists
            const existingProduct = await client.query(`
                SELECT entry_id FROM "ORDERS-products" WHERE name = $1
            `, [product.name]);
            
            if (existingProduct.rows.length === 0) {
                await client.query(`
                    INSERT INTO "ORDERS-products" (
                        name, category_name, default_price, description,
                        brand_name, cultivar_name, lineage,
                        metrc_linked_items, price_updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                `, [
                    product.name, product.category_name, product.default_price,
                    product.description, product.brand_name, product.cultivar_name,
                    product.lineage, JSON.stringify([])
                ]);
            }
        }
        
        console.log('✅ Sample master products created');
        
        // 4. Test the helper functions
        console.log('📋 Step 4: Testing helper functions...');
        
        // Test get_effective_price function
        const priceTest = await client.query(`
            SELECT get_effective_price(1) as effective_price
        `);
        console.log('✅ get_effective_price function working');
        
        // Test can_batch_be_sellable function
        const sellableTest = await client.query(`
            SELECT can_batch_be_sellable(1) as can_be_sellable
        `);
        console.log('✅ can_batch_be_sellable function working');
        
        // 5. Verify all tables and indexes
        console.log('📋 Step 5: Verifying database structure...');
        
        const tables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE 'ORDERS-%'
            ORDER BY table_name
        `);
        
        console.log('📊 Created tables:');
        tables.rows.forEach(row => {
            console.log(`  - ${row.table_name}`);
        });
        
        const indexes = await client.query(`
            SELECT indexname 
            FROM pg_indexes 
            WHERE schemaname = 'public' 
            AND indexname LIKE 'idx_%'
            ORDER BY indexname
        `);
        
        console.log('📊 Created indexes:');
        indexes.rows.forEach(row => {
            console.log(`  - ${row.indexname}`);
        });
        
        // 6. Test the BatchSyncService
        console.log('📋 Step 6: Testing BatchSyncService...');
        
        const BatchSyncService = require('../Server/Services/BatchSyncService');
        const batchSyncService = new BatchSyncService();
        
        // Test the service (without actually running sync)
        console.log('✅ BatchSyncService initialized successfully');
        
        await batchSyncService.close();
        
        console.log('🎉 Module 3 setup completed successfully!');
        console.log('');
        console.log('📋 Next steps:');
        console.log('1. Run batch sync: npm run sync:batches');
        console.log('2. Test API endpoints: /api/v1/products/master');
        console.log('3. Create master products and link METRC items');
        console.log('4. Test auto-promotion logic');
        
    } catch (error) {
        console.error('❌ Module 3 setup failed:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    setupModule3()
        .then(() => {
            console.log('✅ Setup completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Setup failed:', error.message);
            process.exit(1);
        });
}

module.exports = { setupModule3 };

