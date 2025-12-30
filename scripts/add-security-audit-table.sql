-- Module 11.5: Security Audit Log Table
-- Tracks failed admin override attempts and security events

CREATE TABLE IF NOT EXISTS "ORDERS-security_audit_log" (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    status VARCHAR(20) NOT NULL,
    reason TEXT,
    source_ip INET,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_security_audit_user_id 
    ON "ORDERS-security_audit_log"(user_id);

CREATE INDEX IF NOT EXISTS idx_security_audit_timestamp 
    ON "ORDERS-security_audit_log"(timestamp);

CREATE INDEX IF NOT EXISTS idx_security_audit_action 
    ON "ORDERS-security_audit_log"(action);

CREATE INDEX IF NOT EXISTS idx_security_audit_status 
    ON "ORDERS-security_audit_log"(status);

-- Add comments for documentation
COMMENT ON TABLE "ORDERS-security_audit_log" IS 'Module 11.5: Security audit log for tracking failed admin override attempts and security events';
COMMENT ON COLUMN "ORDERS-security_audit_log".user_id IS 'User who attempted the action';
COMMENT ON COLUMN "ORDERS-security_audit_log".action IS 'Type of action attempted (e.g., admin_override_attempt, manual_package_add_attempt)';
COMMENT ON COLUMN "ORDERS-security_audit_log".resource_type IS 'Type of resource affected';
COMMENT ON COLUMN "ORDERS-security_audit_log".resource_id IS 'ID of the specific resource';
COMMENT ON COLUMN "ORDERS-security_audit_log".status IS 'Success or failure status';
COMMENT ON COLUMN "ORDERS-security_audit_log".reason IS 'Reason for failure or additional context';
COMMENT ON COLUMN "ORDERS-security_audit_log".source_ip IS 'IP address of the user making the request';



