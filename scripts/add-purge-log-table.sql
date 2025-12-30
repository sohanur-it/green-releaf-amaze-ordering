-- Module 20.4: Purge Log Table
-- Tracks all purge operations for compliance and audit

CREATE TABLE IF NOT EXISTS "ORDERS-purge-log" (
    id SERIAL PRIMARY KEY,
    
    -- Purge Details
    archive_type VARCHAR(50) NOT NULL,
    -- Values: 'scanning_sessions', 'manifest_packages', 'cancelled_shipment_packages'
    
    -- What was purged
    purged_record_ids INTEGER[] NOT NULL,
    purged_count INTEGER NOT NULL,
    
    -- Approval
    approval_document_path TEXT,
    approval_reference VARCHAR(255),
    approval_date TIMESTAMPTZ,
    
    -- Reason
    purge_reason TEXT NOT NULL,
    -- Minimum 100 characters required
    
    -- Who performed
    purged_by INTEGER NOT NULL REFERENCES users(id),
    purged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Metadata
    additional_details JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_purge_log_archive_type 
    ON "ORDERS-purge-log"(archive_type);

CREATE INDEX IF NOT EXISTS idx_purge_log_purged_by 
    ON "ORDERS-purge-log"(purged_by);

CREATE INDEX IF NOT EXISTS idx_purge_log_purged_at 
    ON "ORDERS-purge-log"(purged_at DESC);

COMMENT ON TABLE "ORDERS-purge-log" IS 
    'Immutable log of all purge operations. Records cannot be deleted. Used for compliance and audit purposes.';

COMMENT ON COLUMN "ORDERS-purge-log".purge_reason IS 
    'Required reason for purge operation. Minimum 100 characters.';

COMMENT ON COLUMN "ORDERS-purge-log".approval_reference IS 
    'Reference to written approval document (e.g., approval ID, document number).';

-- Prevent deletion of purge log records
CREATE OR REPLACE FUNCTION prevent_purge_log_deletion()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Purge log records cannot be deleted. This is an immutable audit log.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_purge_log_delete
    BEFORE DELETE ON "ORDERS-purge-log"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_purge_log_deletion();



