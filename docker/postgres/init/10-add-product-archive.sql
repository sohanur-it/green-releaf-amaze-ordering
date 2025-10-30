-- Add archiving capability to products
-- This allows admins to stop listing products externally without affecting internal operations

ALTER TABLE "ORDERS-products" 
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id);

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_products_is_archived ON "ORDERS-products"(is_archived);

-- Add comments
COMMENT ON COLUMN "ORDERS-products".is_archived IS 'Soft delete flag - archived products are hidden from external catalog but batches remain usable internally';
COMMENT ON COLUMN "ORDERS-products".archived_at IS 'Timestamp when product was archived';
COMMENT ON COLUMN "ORDERS-products".archived_by IS 'User ID who archived the product';

-- Grant permissions
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        GRANT SELECT, UPDATE ON "ORDERS-products" TO postgres;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'master') THEN
        GRANT SELECT, UPDATE ON "ORDERS-products" TO master;
    END IF;
END $$;

DO $$
BEGIN
    RAISE NOTICE 'Product archiving columns added successfully';
END $$;

