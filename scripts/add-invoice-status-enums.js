#!/usr/bin/env node

/**
 * Migration script to add Manifest_Voided and Voided statuses to invoice_status enum
 * Run this script to update existing databases with the new status values
 */

const { query, pool } = require('../Server/config/database');

async function addEnumValues() {
    try {
        console.log('➡️  Adding "Manifest_Voided" and "Voided" to invoice_status enum...');
        
        // Add Manifest_Voided
        await query(`
            DO $$
            BEGIN
                ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Manifest_Voided';
            EXCEPTION
                WHEN duplicate_object THEN
                    RAISE NOTICE 'Enum value "Manifest_Voided" already exists';
            END $$;
        `);
        console.log('✅ Enum value "Manifest_Voided" added successfully');
        
        // Add Voided
        await query(`
            DO $$
            BEGIN
                ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Voided';
            EXCEPTION
                WHEN duplicate_object THEN
                    RAISE NOTICE 'Enum value "Voided" already exists';
            END $$;
        `);
        console.log('✅ Enum value "Voided" added successfully');
        
    } catch (error) {
        if (error.message && error.message.includes('already exists')) {
            console.log('ℹ️  Enum values already exist');
        } else {
            console.error('❌ Error adding enum values:', error.message);
            throw error;
        }
    }
}

async function run() {
    try {
        console.log('🚀 Starting invoice status enum update...');
        await addEnumValues();
        console.log('🎉 Invoice status enum update complete!');
        console.log('');
        console.log('📝 Summary:');
        console.log('   - Manifest_Voided: Status when all manifests are voided (allows rescanning)');
        console.log('   - Voided: Status when entire invoice is voided (terminal state)');
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

