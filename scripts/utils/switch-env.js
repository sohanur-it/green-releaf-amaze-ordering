#!/usr/bin/env node

/**
 * Environment Switcher Script
 * 
 * Switches between local and production environment configurations
 * by copying the appropriate .env file to the root directory
 * 
 * Usage:
 *   node scripts/utils/switch-env.js local
 *   node scripts/utils/switch-env.js production
 *   node scripts/utils/switch-env.js (shows current status)
 */

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '../../config');
const LOCAL_ENV = path.join(CONFIG_DIR, 'local.env');
const PRODUCTION_ENV = path.join(CONFIG_DIR, 'production.env');
const TARGET_ENV = path.join(__dirname, '../../.env');

function showStatus() {
    console.log('🔧 Environment Configuration Status');
    console.log('=====================================');
    
    // Check which config files exist
    const localExists = fs.existsSync(LOCAL_ENV);
    const prodExists = fs.existsSync(PRODUCTION_ENV);
    const targetExists = fs.existsSync(TARGET_ENV);
    
    console.log(`📁 Local config:     ${localExists ? '✅' : '❌'} ${LOCAL_ENV}`);
    console.log(`📁 Production config: ${prodExists ? '✅' : '❌'} ${PRODUCTION_ENV}`);
    console.log(`📁 Current .env:     ${targetExists ? '✅' : '❌'} ${TARGET_ENV}`);
    
    if (targetExists) {
        try {
            const envContent = fs.readFileSync(TARGET_ENV, 'utf8');
            const isLocal = envContent.includes('localhost') || envContent.includes('green_releaf_dev');
            const isProduction = envContent.includes('n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com') || envContent.includes('postgres');
            
            if (isLocal) {
                console.log('🎯 Current environment: LOCAL (Docker PostgreSQL)');
            } else if (isProduction) {
                console.log('🎯 Current environment: PRODUCTION (AWS RDS)');
            } else {
                console.log('🎯 Current environment: UNKNOWN');
            }
        } catch (error) {
            console.log('🎯 Current environment: ERROR reading .env file');
        }
    }
    
    console.log('\n📋 Available commands:');
    console.log('  npm run env:local      - Switch to local development');
    console.log('  npm run env:production - Switch to production');
    console.log('  npm run env:status     - Show current status');
}

function switchEnvironment(targetEnv) {
    let sourceFile, envName;
    
    if (targetEnv === 'local') {
        sourceFile = LOCAL_ENV;
        envName = 'LOCAL (Docker PostgreSQL)';
    } else if (targetEnv === 'production') {
        sourceFile = PRODUCTION_ENV;
        envName = 'PRODUCTION (AWS RDS)';
    } else {
        console.error('❌ Invalid environment. Use "local" or "production"');
        process.exit(1);
    }
    
    // Check if source file exists
    if (!fs.existsSync(sourceFile)) {
        console.error(`❌ Source file not found: ${sourceFile}`);
        console.error('Please ensure the environment configuration files exist in the config/ directory');
        process.exit(1);
    }
    
    try {
        // Copy the environment file
        fs.copyFileSync(sourceFile, TARGET_ENV);
        console.log(`✅ Successfully switched to ${envName}`);
        console.log(`📁 Copied: ${sourceFile} → ${TARGET_ENV}`);
        
        // Show some key settings
        const envContent = fs.readFileSync(TARGET_ENV, 'utf8');
        const lines = envContent.split('\n');
        
        console.log('\n🔧 Key Configuration:');
        lines.forEach(line => {
            if (line.startsWith('DB_HOST=') || line.startsWith('DB_DATABASE=') || 
                line.startsWith('T3_USERNAME=') || line.startsWith('NODE_ENV=')) {
                console.log(`   ${line}`);
            }
        });
        
    } catch (error) {
        console.error(`❌ Failed to switch environment: ${error.message}`);
        process.exit(1);
    }
}

// Main execution
const args = process.argv.slice(2);
const command = args[0];

if (!command) {
    showStatus();
} else {
    switchEnvironment(command);
}