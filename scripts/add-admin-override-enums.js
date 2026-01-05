#!/usr/bin/env node

/**
 * Add admin override enum values to modification_type enum
 * This script adds:
 * - 'admin_override'
 * - 'admin_manual_package_add'
 * - 'admin_force_release_allocation'
 * 
 * This script can be run for both local and production databases
 */

const { query, pool } = require('../Server/config/database');

const enumValues = [
    'admin_override',
    'admin_manual_package_add',
    'admin_force_release_allocation'
];

async function addEnumValues() {
    try {
        console.log('➡️  Adding admin override enum values to modification_type enum...');
        
        for (const enumValue of enumValues) {
            try {
                // Use DO block to handle the case where the value might already exist
                await query(`
                    DO $$ 
                    BEGIN
                        ALTER TYPE modification_type ADD VALUE IF NOT EXISTS '${enumValue}';
                    EXCEPTION
                        WHEN duplicate_object THEN 
                            RAISE NOTICE 'Enum value "${enumValue}" already exists';
                    END $$;
                `);
                
                console.log(`✅ Enum value "${enumValue}" added successfully`);
            } catch (error) {
                // If the value already exists, that's fine
                if (error.message && (error.message.includes('already exists') || error.message.includes('duplicate_object'))) {
                    console.log(`ℹ️  Enum value "${enumValue}" already exists`);
                } else {
                    console.error(`❌ Error adding enum value "${enumValue}":`, error.message);
                    throw error;
                }
            }
        }
    } catch (error) {
        console.error('❌ Error adding enum values:', error.message);
        throw error;
    }
}

async function run() {
    try {
        console.log('🚀 Starting enum update...');
        await addEnumValues();
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

