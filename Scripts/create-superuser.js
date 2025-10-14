#!/usr/bin/env node

/**
 * Create Superuser Script
 * 
 * This script creates the first superuser account for the application.
 * It should be run ONCE during initial deployment.
 * 
 * Usage: node Scripts/create-superuser.js
 */

const readline = require('readline');
const bcrypt = require('bcrypt');
const { query } = require('../Server/config/database');
require('dotenv').config({ path: require('path').join(__dirname, '../.ENV') });

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function createSuperuser() {
    console.log('\n========================================');
    console.log('  GREEN RELEAF - SUPERUSER CREATION');
    console.log('========================================\n');
    
    console.log('⚠️  WARNING: This script will create the first superuser account.');
    console.log('⚠️  This account will have full system access.\n');
    
    try {
        // Check if superuser already exists
        const checkSql = 'SELECT COUNT(*) as count FROM users WHERE is_superuser = true';
        const checkResult = await query(checkSql);
        
        if (parseInt(checkResult.rows[0].count) > 0) {
            console.log('❌ ERROR: A superuser already exists!');
            console.log('   This script can only be run once during initial setup.\n');
            rl.close();
            process.exit(1);
        }
        
        // Get user details
        const username = await question('Enter username: ');
        if (!username || username.trim().length < 3) {
            console.log('❌ ERROR: Username must be at least 3 characters long.\n');
            rl.close();
            process.exit(1);
        }
        
        const firstname = await question('Enter first name: ');
        if (!firstname || firstname.trim().length < 1) {
            console.log('❌ ERROR: First name is required.\n');
            rl.close();
            process.exit(1);
        }
        
        const lastname = await question('Enter last name: ');
        if (!lastname || lastname.trim().length < 1) {
            console.log('❌ ERROR: Last name is required.\n');
            rl.close();
            process.exit(1);
        }
        
        const email = await question('Enter email: ');
        if (!email || !email.includes('@')) {
            console.log('❌ ERROR: Valid email is required.\n');
            rl.close();
            process.exit(1);
        }
        
        const password = await question('Enter password: ');
        if (!password || password.length < 8) {
            console.log('❌ ERROR: Password must be at least 8 characters long.\n');
            rl.close();
            process.exit(1);
        }
        
        const confirmPassword = await question('Confirm password: ');
        if (password !== confirmPassword) {
            console.log('❌ ERROR: Passwords do not match.\n');
            rl.close();
            process.exit(1);
        }
        
        // Check if username or email already exists
        const existingUserSql = 'SELECT username, email FROM users WHERE username = $1 OR email = $2';
        const existingUserResult = await query(existingUserSql, [username, email]);
        
        if (existingUserResult.rows.length > 0) {
            console.log('❌ ERROR: Username or email already exists!\n');
            rl.close();
            process.exit(1);
        }
        
        // Hash password
        const password_hash = await bcrypt.hash(password, 10);
        
        // Create superuser
        const insertSql = `
            INSERT INTO users (username, firstname, lastname, email, password_hash, status, is_superuser)
            VALUES ($1, $2, $3, $4, $5, 'active', true)
            RETURNING id, username, email, is_superuser
        `;
        
        const result = await query(insertSql, [username, firstname, lastname, email, password_hash]);
        const user = result.rows[0];
        
        console.log('\n✅ SUCCESS! Superuser created successfully!\n');
        console.log('   User ID:', user.id);
        console.log('   Username:', user.username);
        console.log('   Email:', user.email);
        console.log('   Status: Active');
        console.log('   Superuser: Yes\n');
        console.log('========================================\n');
        console.log('⚠️  IMPORTANT: Store these credentials securely!');
        console.log('⚠️  This superuser account has full system access.\n');
        console.log('   You can now log in at: http://localhost:3000/auth/login\n');
        
    } catch (error) {
        console.error('\n❌ ERROR creating superuser:', error.message);
        console.error('\nStack trace:', error.stack);
        rl.close();
        process.exit(1);
    } finally {
        rl.close();
    }
}

// Run the script
createSuperuser()
    .then(() => {
        console.log('Script completed successfully.\n');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Unexpected error:', error);
        process.exit(1);
    });

