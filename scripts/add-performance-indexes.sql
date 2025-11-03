-- Performance optimization indexes for cart and checkout operations
-- Run this script on your RDS database to improve query performance

-- Composite index for finding draft invoices by buyer/location (most common query)
CREATE INDEX IF NOT EXISTS idx_invoices_draft_buyer_location 
ON "ORDERS-invoices" (fk_buyer_id, fk_location_id, status, source) 
WHERE status = 'Draft' AND source = 'External';

-- Composite index for invoice lookup with expiry check
CREATE INDEX IF NOT EXISTS idx_invoices_draft_with_expiry
ON "ORDERS-invoices" (fk_buyer_id, fk_location_id, status, source, cart_expires_at)
WHERE status = 'Draft' AND source = 'External';

-- Index for invoice number generation query (uses LIKE pattern)
CREATE INDEX IF NOT EXISTS idx_invoices_number_source_year
ON "ORDERS-invoices" (source, invoice_number)
WHERE source = 'External';

-- Composite index for line items lookup by invoice and batch
CREATE INDEX IF NOT EXISTS idx_line_items_invoice_batch
ON "ORDERS-invoice-line-items" (fk_invoice_id, fk_batch_id);

-- Index for aggregating line items by invoice (for totals calculation)
CREATE INDEX IF NOT EXISTS idx_line_items_invoice_totals
ON "ORDERS-invoice-line-items" (fk_invoice_id, line_total);

-- Index for batch lookup with status
CREATE INDEX IF NOT EXISTS idx_batches_product_status_available
ON "ORDERS-batches" (fk_master_product_id, status, quantity, allocated_quantity)
WHERE status = 'Sellable';

-- Index for location license lookup
CREATE INDEX IF NOT EXISTS idx_buyer_locations_entry_id
ON "ORDERS-buyer_locations" (entry_id) 
INCLUDE (state_license);

-- Analyze tables to update statistics for query planner
ANALYZE "ORDERS-invoices";
ANALYZE "ORDERS-invoice-line-items";
ANALYZE "ORDERS-batches";
ANALYZE "ORDERS-products";
ANALYZE "ORDERS-buyer_locations";

