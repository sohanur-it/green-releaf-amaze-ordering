/**
 * Add assigned_sales_rep_id column to ORDERS-buyer_locations table
 * This allows sales reps to be assigned to specific locations
 */

const { query } = require('../Server/config/database');

async function addAssignedSalesRepColumn() {
    try {
        console.log('🔧 Adding assigned_sales_rep_id column to ORDERS-buyer_locations...');
        
        // Check if column already exists
        const checkColumn = await query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'ORDERS-buyer_locations' 
            AND column_name = 'assigned_sales_rep_id'
        `);
        
        if (checkColumn.rows.length > 0) {
            console.log('✅ Column assigned_sales_rep_id already exists');
            return;
        }
        
        // Add the column
        await query(`
            ALTER TABLE "ORDERS-buyer_locations" 
            ADD COLUMN assigned_sales_rep_id INTEGER REFERENCES users(id) ON DELETE SET NULL
        `);
        
        console.log('✅ Successfully added assigned_sales_rep_id column');
        
        // Create index for better query performance
        await query(`
            CREATE INDEX IF NOT EXISTS idx_buyer_locations_assigned_sales_rep 
            ON "ORDERS-buyer_locations"(assigned_sales_rep_id)
        `);
        
        console.log('✅ Created index on assigned_sales_rep_id');
        
    } catch (error) {
        console.error('❌ Error adding column:', error);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    addAssignedSalesRepColumn()
        .then(() => {
            console.log('✅ Migration completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Migration failed:', error);
            process.exit(1);
        });
}

module.exports = addAssignedSalesRepColumn;
