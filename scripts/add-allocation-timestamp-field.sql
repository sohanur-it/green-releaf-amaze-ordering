-- Section 17.3.1: Add explicit allocation timestamp tracking
-- Migration script to add allocated_at field to ORDERS-invoice-line-items

-- Add allocated_at column if it doesn't exist
ALTER TABLE "ORDERS-invoice-line-items"
    ADD COLUMN IF NOT EXISTS allocated_at TIMESTAMPTZ;

-- Create index for allocation timestamp queries
CREATE INDEX IF NOT EXISTS idx_line_items_allocated_at 
    ON "ORDERS-invoice-line-items"(allocated_at) 
    WHERE allocated_at IS NOT NULL;

-- Add comment
COMMENT ON COLUMN "ORDERS-invoice-line-items".allocated_at IS 
    'Section 17.3.1: Timestamp when quantity_allocated was first set (allocation timestamp tracking)';

