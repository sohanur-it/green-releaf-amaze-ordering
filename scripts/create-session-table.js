/**
 * Create user_sessions table for connect-pg-simple
 * 
 * This script creates the correct table schema for PostgreSQL session storage.
 * Run this if you're getting "column sess does not exist" errors.
 * 
 * Usage:
 *   node scripts/create-session-table.js
 */

const { Pool } = require('pg');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });
require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE || process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createSessionTable() {
    const client = await pool.connect();
    try {
        console.log('🔎 Checking user_sessions table...');
        
        // Check if table exists
        const checkResult = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'user_sessions'
            );
        `);
        
        if (checkResult.rows[0].exists) {
            console.log('📝 Table exists. Checking schema...');
            
            // Check if it has the correct columns
            const columnCheck = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'user_sessions' 
                AND column_name = 'sess'
            `);
            
            if (columnCheck.rows.length === 0) {
                console.log('⚠️  Table exists but has wrong schema. Dropping and recreating...');
                await client.query('DROP TABLE IF EXISTS user_sessions CASCADE');
            } else {
                console.log('✅ Table already has correct schema.');
                return;
            }
        }
        
        console.log('📝 Creating user_sessions table with correct schema...');
        
        // Create the table with the exact schema that connect-pg-simple expects
        await client.query(`
            CREATE TABLE IF NOT EXISTS "user_sessions" (
                "sid" varchar NOT NULL COLLATE "default",
                "sess" json NOT NULL,
                "expire" timestamp(6) NOT NULL,
                CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
            )
            WITH (OIDS=FALSE);
        `);
        
        // Create index on expire column for cleanup
        await client.query(`
            CREATE INDEX IF NOT EXISTS "IDX_session_expire" 
            ON "user_sessions" ("expire");
        `);
        
        console.log('✅ Successfully created user_sessions table.');
        console.log('🎉 Session table setup complete!');
        
    } catch (error) {
        console.error('❌ Error creating session table:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the script
createSessionTable()
    .then(() => {
        console.log('✅ Script completed successfully.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Script failed:', error);
        process.exit(1);
    });

