-- Add cart expiry tracking fields
-- cart_started_at: When cart first started holding inventory (for 48h limit)
-- extended_until: Maximum expiry time (cart_started_at + 48 hours)

DO $$ 
BEGIN
    -- Add cart_started_at if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ORDERS-invoices' 
        AND column_name = 'cart_started_at'
    ) THEN
        ALTER TABLE "ORDERS-invoices" 
        ADD COLUMN cart_started_at TIMESTAMPTZ;
        
        -- Set cart_started_at = cart_created_at for existing carts
        UPDATE "ORDERS-invoices"
        SET cart_started_at = cart_created_at
        WHERE cart_started_at IS NULL 
          AND cart_created_at IS NOT NULL;
        
        COMMENT ON COLUMN "ORDERS-invoices".cart_started_at IS 'When cart first started holding inventory (for 48h extension limit)';
    END IF;
    
    -- Add extended_until if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ORDERS-invoices' 
        AND column_name = 'extended_until'
    ) THEN
        ALTER TABLE "ORDERS-invoices" 
        ADD COLUMN extended_until TIMESTAMPTZ;
        
        COMMENT ON COLUMN "ORDERS-invoices".extended_until IS 'Maximum expiry time (cart_started_at + 48 hours)';
    END IF;
END $$;

-- Add index for cart expiry queries
CREATE INDEX IF NOT EXISTS idx_invoices_cart_started_at 
    ON "ORDERS-invoices" (cart_started_at) 
    WHERE status = 'Draft' AND source = 'External';

CREATE INDEX IF NOT EXISTS idx_invoices_extended_until 
    ON "ORDERS-invoices" (extended_until) 
    WHERE status = 'Draft' AND source = 'External';

