-- Module 22: Performance Considerations - CONCURRENT Index Creation
-- 
-- This script creates indexes using CONCURRENTLY to avoid table locks.
-- Run this script manually during low-traffic periods for production databases.
-- 
-- Usage:
--   psql -h your-host -U your-user -d your-database -f add-module22-performance-indexes-concurrent.sql
--
-- NOTE: CONCURRENTLY cannot run inside a transaction, so each index is created separately.

-- 22.1.1: Fulfillment queue index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_fulfillment_queue 
ON "ORDERS-invoices"(status, approved_at) 
WHERE status IN ('Approved', 'Fulfillment_Accepted', 'Fulfillment_Issue');

-- 22.1.2: Active packages label lookup index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activepackages_label_lookup 
ON activepackages(label, synclicense) 
WHERE isarchived = FALSE AND isfinished = FALSE;

-- 22.1.3: Scanning sessions cleanup index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scanning_sessions_cleanup 
ON "ORDERS-scanning-sessions"(last_activity) 
WHERE session_status = 'active';

-- Additional fulfillment-related indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_fulfillment_worker 
ON "ORDERS-invoices"(fulfillment_accepted_by) 
WHERE status IN ('Fulfillment_Accepted', 'Fulfillment_Issue');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_voided_manifests 
ON "ORDERS-invoices"(voided_manifest_number) 
WHERE voided_manifest_number IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_manifest_numbers 
ON "ORDERS-invoices" USING GIN(metrc_manifest_numbers);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scanning_sessions_invoice 
ON "ORDERS-scanning-sessions"(fk_invoice_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scanning_sessions_user 
ON "ORDERS-scanning-sessions"(fk_user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scanning_sessions_active 
ON "ORDERS-scanning-sessions"(session_status) 
WHERE session_status = 'active';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_manifest_packages_invoice 
ON "ORDERS-manifest-packages"(fk_invoice_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_manifest_packages_manifest 
ON "ORDERS-manifest-packages"(manifest_number, synclicense);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_manifest_packages_label 
ON "ORDERS-manifest-packages"(package_label, synclicense);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cancelled_packages_invoice 
ON "ORDERS-cancelled-shipment-packages"(fk_invoice_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cancelled_packages_unverified 
ON "ORDERS-cancelled-shipment-packages"(returned_to_inventory, verified_in_metrc) 
WHERE verified_in_metrc = FALSE;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cancelled_packages_allocation_status 
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



