#!/usr/bin/env node

/**
 * Create Superuser Script
 * 
 * Creates the initial superuser account for the application
 * This is a one-time setup script that should be run after database initialization
 * 
 * Usage: node scripts/utils/create-superuser.js
 */

const readline = require('readline');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

// Load environment variables
const path = require('path');
const envFile = process.env.NODE_ENV === 'production' ? 'config/production.env' : 'config/local.env';
require('dotenv').config({ path: path.resolve(envFile) });

// Database configuration
const DB_CONFIG = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    password: process.env.DB_PASSWORD || 'dev_password_123',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
};

const pool = new Pool(DB_CONFIG);

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, resolve);
    });
}

async function createSuperuser() {
    try {
        console.log('🔐 Creating Superuser Account');
        console.log('============================');
        console.log('This script will create the initial superuser account.');
        console.log('The superuser has full administrative privileges.\n');

        // Get user input
        const username = await askQuestion('Username: ');
        const firstName = await askQuestion('First Name: ');
        const lastName = await askQuestion('Last Name: ');
        const email = await askQuestion('Email: ');
        
        // Get password securely
        const password = await askQuestion('Password: ');
        const confirmPassword = await askQuestion('Confirm Password: ');

        // Validate input
        if (!username || !firstName || !lastName || !email || !password) {
            console.error('❌ All fields are required');
            process.exit(1);
        }

        if (password !== confirmPassword) {
            console.error('❌ Passwords do not match');
            process.exit(1);
        }

        if (password.length < 8) {
            console.error('❌ Password must be at least 8 characters long');
            process.exit(1);
        }

        // Hash password and email
        console.log('\n🔒 Hashing password and email...');
        const saltRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        const emailHash = await bcrypt.hash(email, saltRounds);

        // Connect to database
        console.log('🗄️ Connecting to database...');
        console.log(`   Host: ${DB_CONFIG.host}`);
        console.log(`   Database: ${DB_CONFIG.database}`);
        console.log(`   User: ${DB_CONFIG.user}`);
        
        const client = await pool.connect();

        try {
            // Test database connection and table structure
            console.log('🔍 Testing database connection...');
            const testQuery = await client.query('SELECT 1 as test');
            console.log('✅ Database connection successful');
            
            // Check if users table exists and has correct structure
            const tableCheck = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                AND column_name IN ('first_name', 'last_name', 'is_admin', 'is_active', 'email_hash')
                ORDER BY column_name
            `);
            
            if (tableCheck.rows.length < 5) {
                console.error('❌ Users table does not have the expected structure');
                console.error('Expected columns: first_name, last_name, is_admin, is_active, email_hash');
                console.error('Found columns:', tableCheck.rows.map(r => r.column_name));
                process.exit(1);
            }
            
            console.log('✅ Users table structure verified');
            
            // Check if superuser already exists
            const existingSuperuser = await client.query(
                'SELECT id FROM users WHERE is_admin = true'
            );

            if (existingSuperuser.rows.length > 0) {
                console.log('⚠️  A superuser already exists in the database.');
                const proceed = await askQuestion('Do you want to create another superuser? (y/N): ');
                if (proceed.toLowerCase() !== 'y' && proceed.toLowerCase() !== 'yes') {
                    console.log('❌ Superuser creation cancelled');
                    process.exit(0);
                }
            }

            // Check if username or email already exists
            const existingUser = await client.query(
                'SELECT id FROM users WHERE username = $1 OR email = $2',
                [username, email]
            );

            if (existingUser.rows.length > 0) {
                console.error('❌ Username or email already exists');
                process.exit(1);
            }

            // Create superuser
            console.log('👤 Creating superuser account...');
            const result = await client.query(`
                INSERT INTO users (username, first_name, last_name, email, email_hash, password_hash, is_active, is_admin, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, true, true, NOW())
                RETURNING id, username, email
            `, [username, firstName, lastName, email, emailHash, passwordHash]);

            const user = result.rows[0];

            // Assign Administrator role to the superuser
            console.log('🔑 Assigning Administrator role...');
            
            // Get or create Administrator role
            let adminRole = await client.query(`
                SELECT id FROM roles WHERE name = 'Administrator'
            `);
            
            if (adminRole.rows.length === 0) {
                console.log('📝 Creating Administrator role...');
                const newRole = await client.query(`
                    INSERT INTO roles (name, description) 
                    VALUES ('Administrator', 'Full system access and user management')
                    RETURNING id
                `);
                adminRole = newRole;
            }
            
            const roleId = adminRole.rows[0].id;
            
            // Assign Administrator role to the superuser
            await client.query(`
                INSERT INTO user_roles (user_id, role_id, assigned_by)
                VALUES ($1, $2, $1)
                ON CONFLICT (user_id, role_id) DO NOTHING
            `, [user.id, roleId]);
            
            console.log('✅ Administrator role assigned');

            console.log('\n✅ Superuser created successfully!');
            console.log('================================');
            console.log(`👤 User ID: ${user.id}`);
            console.log(`👤 Username: ${user.username}`);
            console.log(`📧 Email: ${user.email}`);
            console.log(`🔐 Status: Active`);
            console.log(`👑 Superuser: Yes`);
            console.log(`🔑 Role: Administrator`);
            console.log('\n🎯 You can now log in to the application with these credentials.');

        } finally {
            client.release();
        }

    } catch (error) {
        console.error('❌ Error creating superuser:', error.message);
        process.exit(1);
    } finally {
        rl.close();
        await pool.end();
    }
}

// Run the script
if (require.main === module) {
    createSuperuser().catch(error => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { createSuperuser };
