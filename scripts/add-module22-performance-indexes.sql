-- Module 22: Performance Considerations - Database Query Optimization
-- Critical indexes for fulfillment performance
-- 
-- NOTE: These indexes use regular CREATE INDEX (not CONCURRENTLY) to allow
-- execution within a transaction. For production, consider running CONCURRENTLY
-- versions manually during low-traffic periods to avoid table locks.

-- 22.1.1: Fulfillment queue index
-- Optimizes queries filtering by status and approved_at
CREATE INDEX IF NOT EXISTS idx_invoices_fulfillment_queue 
ON "ORDERS-invoices"(status, approved_at) 
WHERE status IN ('Approved', 'Fulfillment_Accepted', 'Fulfillment_Issue');

-- 22.1.2: Active packages label lookup index
-- Critical for scanning validation performance
-- Note: Production uses sync_license, development uses synclicense
-- This will create the index with the correct column name based on what exists
DO $$
DECLARE
    license_col_name TEXT;
BEGIN
    -- Determine which license column exists
    SELECT column_name INTO license_col_name
    FROM information_schema.columns 
    WHERE table_name = 'activepackages' 
    AND column_name IN ('sync_license', 'synclicense')
    LIMIT 1;
    
    -- Create index with the correct column name
    IF license_col_name = 'sync_license' THEN
        -- Production: use sync_license
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_activepackages_label_lookup 
            ON activepackages(label, sync_license) 
            WHERE isarchived = FALSE AND isfinished = FALSE');
    ELSIF license_col_name = 'synclicense' THEN
        -- Development: use synclicense
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_activepackages_label_lookup 
            ON activepackages(label, synclicense) 
            WHERE isarchived = FALSE AND isfinished = FALSE');
    ELSE
        -- Fallback: create index without license column
        CREATE INDEX IF NOT EXISTS idx_activepackages_label_lookup 
        ON activepackages(label) 
        WHERE isarchived = FALSE AND isfinished = FALSE;
    END IF;
END $$;

-- 22.1.3: Scanning sessions cleanup index
-- Optimizes cleanup job queries for abandoned sessions
CREATE INDEX IF NOT EXISTS idx_scanning_sessions_cleanup 
ON "ORDERS-scanning-sessions"(last_activity) 
WHERE session_status = 'active';

-- Additional fulfillment-related indexes for completeness
CREATE INDEX IF NOT EXISTS idx_invoices_fulfillment_worker 
ON "ORDERS-invoices"(fulfillment_accepted_by) 
WHERE status IN ('Fulfillment_Accepted', 'Fulfillment_Issue');

CREATE INDEX IF NOT EXISTS idx_invoices_voided_manifests 
ON "ORDERS-invoices"(voided_manifest_number) 
WHERE voided_manifest_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_manifest_numbers 
ON "ORDERS-invoices" USING GIN(metrc_manifest_numbers);

CREATE INDEX IF NOT EXISTS idx_scanning_sessions_invoice 
ON "ORDERS-scanning-sessions"(fk_invoice_id);

CREATE INDEX IF NOT EXISTS idx_scanning_sessions_user 
ON "ORDERS-scanning-sessions"(fk_user_id);

CREATE INDEX IF NOT EXISTS idx_scanning_sessions_active 
ON "ORDERS-scanning-sessions"(session_status) 
WHERE session_status = 'active';

CREATE INDEX IF NOT EXISTS idx_manifest_packages_invoice 
ON "ORDERS-manifest-packages"(fk_invoice_id);

CREATE INDEX IF NOT EXISTS idx_manifest_packages_manifest 
ON "ORDERS-manifest-packages"(manifest_number, synclicense);

CREATE INDEX IF NOT EXISTS idx_manifest_packages_label 
ON "ORDERS-manifest-packages"(package_label, synclicense);

CREATE INDEX IF NOT EXISTS idx_cancelled_packages_invoice 
ON "ORDERS-cancelled-shipment-packages"(fk_invoice_id);

CREATE INDEX IF NOT EXISTS idx_cancelled_packages_unverified 
ON "ORDERS-cancelled-shipment-packages"(returned_to_inventory, verified_in_metrc) 
WHERE verified_in_metrc = FALSE;

CREATE INDEX IF NOT EXISTS idx_cancelled_packages_allocation_status 
ON "ORDERS-cancelled-shipment-packages"(fk_invoice_id, allocation_released) 
WHERE allocation_released = FALSE;

-- Analyze tables to update statistics for query planner
ANALYZE "ORDERS-invoices";
ANALYZE "ORDERS-scanning-sessions";
ANALYZE activepackages;
ANALYZE "ORDERS-manifest-packages";
ANALYZE "ORDERS-cancelled-shipment-packages";

COMMENT ON INDEX idx_invoices_fulfillment_queue IS 'Module 22.1.1: Optimizes fulfillment queue queries filtering by status and approved_at';
COMMENT ON INDEX idx_activepackages_label_lookup IS 'Module 22.1.2: Critical for scanning validation performance - fast lookup of active packages by label and license';
COMMENT ON INDEX idx_scanning_sessions_cleanup IS 'Module 22.1.3: Optimizes cleanup job queries for abandoned scanning sessions';

