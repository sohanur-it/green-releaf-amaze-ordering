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
require('dotenv').config();

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

        // Hash password
        console.log('\n🔒 Hashing password...');
        const saltRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Connect to database
        console.log('🗄️ Connecting to database...');
        const client = await pool.connect();

        try {
            // Check if superuser already exists
            const existingSuperuser = await client.query(
                'SELECT id FROM users WHERE is_superuser = true'
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
                INSERT INTO users (username, firstname, lastname, email, password_hash, status, is_superuser)
                VALUES ($1, $2, $3, $4, $5, 'active', true)
                RETURNING id, username, email
            `, [username, firstName, lastName, email, passwordHash]);

            const user = result.rows[0];

            console.log('\n✅ Superuser created successfully!');
            console.log('================================');
            console.log(`👤 User ID: ${user.id}`);
            console.log(`👤 Username: ${user.username}`);
            console.log(`📧 Email: ${user.email}`);
            console.log(`🔐 Status: Active`);
            console.log(`👑 Superuser: Yes`);
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
