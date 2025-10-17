-- Create audit log table for tracking all significant user and system actions
-- This table is designed to be append-only for security and compliance

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

-- Create indexes for efficient querying of the audit log
CREATE INDEX IF NOT EXISTS "idx_audit_log_user_id" ON "ORDERS-audit_log"(user_id);
CREATE INDEX IF NOT EXISTS "idx_audit_log_resource" ON "ORDERS-audit_log"(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS "idx_audit_log_timestamp" ON "ORDERS-audit_log"(timestamp);
CREATE INDEX IF NOT EXISTS "idx_audit_log_action" ON "ORDERS-audit_log"(action);
CREATE INDEX IF NOT EXISTS "idx_audit_log_status" ON "ORDERS-audit_log"(status);

-- Add comments for documentation
COMMENT ON TABLE "ORDERS-audit_log" IS 'Immutable audit trail for tracking all significant user and system actions';
COMMENT ON COLUMN "ORDERS-audit_log".user_id IS 'User who performed the action (NULL for system actions)';
COMMENT ON COLUMN "ORDERS-audit_log".action IS 'Type of action performed (e.g., order_created, batch_status_updated)';
COMMENT ON COLUMN "ORDERS-audit_log".resource_type IS 'Type of resource affected (e.g., Order, Invoice, Batch)';
COMMENT ON COLUMN "ORDERS-audit_log".resource_id IS 'ID of the specific resource affected';
COMMENT ON COLUMN "ORDERS-audit_log".details IS 'JSONB field containing contextual data like before/after values';
COMMENT ON COLUMN "ORDERS-audit_log".status IS 'Success or failure status of the action';
COMMENT ON COLUMN "ORDERS-audit_log".source_ip IS 'IP address of the user making the request';
COMMENT ON COLUMN "ORDERS-audit_log".timestamp IS 'When the action occurred (automatically set)';
