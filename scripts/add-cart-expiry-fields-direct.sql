-- Add cart expiry tracking fields to ORDERS-invoices table
-- Run this SQL directly on your production database
-- This script is idempotent - safe to run multiple times

-- Add cart_started_at if it doesn't exist
DO $$ 
BEGIN
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
END $$;

-- Add extended_until if it doesn't exist
DO $$ 
BEGIN
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

-- Add indexes for cart expiry queries
CREATE INDEX IF NOT EXISTS idx_invoices_cart_started_at 
    ON "ORDERS-invoices" (cart_started_at) 
    WHERE status = 'Draft' AND source = 'External';

CREATE INDEX IF NOT EXISTS idx_invoices_extended_until 
    ON "ORDERS-invoices" (extended_until) 
    WHERE status = 'Draft' AND source = 'External';

