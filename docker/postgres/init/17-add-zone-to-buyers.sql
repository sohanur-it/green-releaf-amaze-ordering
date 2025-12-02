-- Add zone column to ORDERS-buyers table
-- Migration script to add the zone field to existing buyers table

ALTER TABLE "ORDERS-buyers"
    ADD COLUMN IF NOT EXISTS zone VARCHAR(100);

-- Add comment for documentation
COMMENT ON COLUMN "ORDERS-buyers".zone IS 'Geographic zone or territory assignment for the buyer';


