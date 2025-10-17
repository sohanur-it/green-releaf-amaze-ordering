/**
 * Create Audit Log Table Script
 * 
 * Creates the audit log table if it doesn't exist
 */

const { pool } = require('../Server/config/database');

async function createAuditLogTable() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Checking if audit log table exists...');
        
        // Check if table exists
        const checkTable = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'ORDERS-audit_log'
            );
        `);
        
        if (checkTable.rows[0].exists) {
            console.log('✅ Audit log table already exists');
            return;
        }
        
        console.log('📝 Creating audit log table...');
        
        // Create the audit log table
        await client.query(`
            CREATE TABLE IF NOT EXISTS "ORDERS-audit_log" (
                id BIGSERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id), -- Nullable for system initiated actions
                action VARCHAR(100) NOT NULL, -- e.g., 'order_created', 'batch_status_updated'
                resource_type VARCHAR(50), -- e.g., 'Order', 'Invoice', 'Batch'
                resource_id VARCHAR(255), -- The ID of the affected record
                details JSONB, -- Stores contextual data, like before/after values
                status VARCHAR(20) NOT NULL DEFAULT 'success', -- 'success' or 'failure'
                source_ip INET, -- The IP address of the user making the request
                timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        
        // Create indexes for efficient querying of the audit log
        await client.query(`
            CREATE INDEX IF NOT EXISTS "idx_audit_log_user_id" ON "ORDERS-audit_log"(user_id);
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS "idx_audit_log_resource" ON "ORDERS-audit_log"(resource_type, resource_id);
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS "idx_audit_log_timestamp" ON "ORDERS-audit_log"(timestamp);
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS "idx_audit_log_action" ON "ORDERS-audit_log"(action);
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS "idx_audit_log_status" ON "ORDERS-audit_log"(status);
        `);
        
        console.log('✅ Audit log table created successfully with indexes');
        
    } catch (error) {
        console.error('❌ Error creating audit log table:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// Run the script
if (require.main === module) {
    createAuditLogTable()
        .then(() => {
            console.log('🎉 Audit log table setup complete!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Failed to setup audit log table:', error.message);
            process.exit(1);
        });
}

module.exports = createAuditLogTable;
