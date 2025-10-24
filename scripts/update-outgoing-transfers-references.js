#!/usr/bin/env node

/**
 * Update all remaining references from outgoingtransfers to activeoutgoingtransfers
 * This script will update SQL files, documentation, and any other references
 */

const fs = require('fs');
const path = require('path');

// Files to update (relative to project root)
const filesToUpdate = [
    'docker/postgres/init/02-create-metrc-tables.sql',
    'docker/postgres/init/06-update-schema-to-production.sql',
    'docker/postgres/init/07-update-production-schema.sql',
    'docs/guides/INCREMENTAL_DELTA_SYNC_IMPLEMENTATION.md'
];

// Patterns to replace
const replacements = [
    {
        from: /outgoingtransfers/g,
        to: 'activeoutgoingtransfers'
    },
    {
        from: /idx_outgoingtransfers_/g,
        to: 'idx_activeoutgoingtransfers_'
    },
    {
        from: /outgoingtransfers_metrcid_key/g,
        to: 'activeoutgoingtransfers_metrcid_key'
    },
    {
        from: /update_outgoingtransfers_updated_at/g,
        to: 'update_activeoutgoingtransfers_updated_at'
    }
];

async function updateFiles() {
    console.log('🔄 Updating all references from outgoingtransfers to activeoutgoingtransfers');
    
    let totalFilesUpdated = 0;
    let totalReplacements = 0;
    
    for (const filePath of filesToUpdate) {
        const fullPath = path.join(__dirname, '..', filePath);
        
        if (!fs.existsSync(fullPath)) {
            console.log(`⚠️  File not found: ${filePath}`);
            continue;
        }
        
        try {
            let content = fs.readFileSync(fullPath, 'utf8');
            let fileReplacements = 0;
            
            // Apply all replacements
            for (const replacement of replacements) {
                const matches = content.match(replacement.from);
                if (matches) {
                    content = content.replace(replacement.from, replacement.to);
                    fileReplacements += matches.length;
                }
            }
            
            if (fileReplacements > 0) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log(`✅ Updated ${filePath}: ${fileReplacements} replacements`);
                totalFilesUpdated++;
                totalReplacements += fileReplacements;
            } else {
                console.log(`ℹ️  No changes needed: ${filePath}`);
            }
            
        } catch (error) {
            console.error(`❌ Error updating ${filePath}:`, error.message);
        }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`  - Files updated: ${totalFilesUpdated}`);
    console.log(`  - Total replacements: ${totalReplacements}`);
    
    if (totalReplacements > 0) {
        console.log('\n✅ All references updated successfully!');
        console.log('\n📝 Next steps:');
        console.log('1. Review the updated files');
        console.log('2. Test the changes in development');
        console.log('3. Deploy to production');
    } else {
        console.log('\nℹ️  No references found to update.');
    }
}

// Run the update
updateFiles()
    .then(() => {
        console.log('\n🎉 Reference update completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Reference update failed:', error.message);
        process.exit(1);
    });
