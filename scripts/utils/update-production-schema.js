#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load production environment variables
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });

// Production database configuration
const PROD_DB_CONFIG = {
    host: process.env.DB_HOST || 'n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'postgres',
    user: process.env.DB_USER || 'master',
    password: process.env.DB_PASSWORD || 'GreenReleaf123!',
    ssl: {
        rejectUnauthorized: false
    },
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 30000
};

async function updateProductionSchema() {
    console.log('🚀 Starting Production Schema Update');
    console.log('📊 Environment: production');
    console.log('🏢 Database:', PROD_DB_CONFIG.host);
    
    const pool = new Pool(PROD_DB_CONFIG);
    const client = await pool.connect();
    
    try {
        console.log('✅ Connected to production RDS database');
        
        // Read the schema update script
        const schemaScript = fs.readFileSync(
            path.join(__dirname, '../../docker/postgres/init/07-update-production-schema.sql'), 
            'utf8'
        );
        
        console.log('📄 Executing schema update script...');
        
        // Split the script into individual statements
        const statements = schemaScript
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
        
        console.log(`📊 Found ${statements.length} SQL statements to execute`);
        
        let successCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            try {
                await client.query(statement);
                successCount++;
                console.log(`✅ Statement ${i + 1}/${statements.length} executed successfully`);
            } catch (error) {
                errorCount++;
                console.log(`❌ Statement ${i + 1}/${statements.length} failed: ${error.message}`);
                // Continue with other statements even if one fails
            }
        }
        
        console.log(`\n📊 Schema Update Summary:`);
        console.log(`✅ Successful: ${successCount}`);
        console.log(`❌ Failed: ${errorCount}`);
        
        if (errorCount === 0) {
            console.log('🎉 Production schema update completed successfully!');
        } else {
            console.log('⚠️  Production schema update completed with some errors');
        }
        
    } catch (error) {
        console.error('❌ Production schema update failed:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the schema update
updateProductionSchema()
    .then(() => {
        console.log('✅ Production schema update process completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Production schema update process failed:', error.message);
        process.exit(1);
    });
