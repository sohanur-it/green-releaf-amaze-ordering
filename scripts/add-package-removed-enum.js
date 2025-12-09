#!/usr/bin/env node

/**
 * Add 'package_removed' to modification_type enum
 * This script can be run for both local and production databases
 */

const { query, pool } = require('../Server/config/database');

async function addEnumValue() {
    try {
        console.log('➡️  Adding "package_removed" to modification_type enum...');
        
        // Use DO block to handle the case where the value might already exist
        await query(`
            DO $$ 
            BEGIN
                ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'package_removed';
            EXCEPTION
                WHEN duplicate_object THEN 
                    RAISE NOTICE 'Enum value "package_removed" already exists';
            END $$;
        `);
        
        console.log('✅ Enum value "package_removed" added successfully');
    } catch (error) {
        // If the value already exists, that's fine
        if (error.message && error.message.includes('already exists')) {
            console.log('ℹ️  Enum value "package_removed" already exists');
        } else {
            console.error('❌ Error adding enum value:', error.message);
            throw error;
        }
    }
}

async function run() {
    try {
        console.log('🚀 Starting enum update...');
        await addEnumValue();
        console.log('🎉 Enum update complete!');
    } catch (error) {
        console.error('❌ Enum update failed:', error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    run();
}

module.exports = {
    run
};

