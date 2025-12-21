-- Migration: Add resolution tracking fields to invoices
-- Section 4.5: Resolution Tracking

-- Add resolved_at field to ORDERS-invoices
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ORDERS-invoices' 
        AND column_name = 'resolved_at'
    ) THEN
        ALTER TABLE "ORDERS-invoices"
            ADD COLUMN resolved_at TIMESTAMPTZ;
        
        COMMENT ON COLUMN "ORDERS-invoices".resolved_at IS 
            'Timestamp when the fulfillment issue was resolved';
        
        RAISE NOTICE 'Added resolved_at column to ORDERS-invoices';
    ELSE
        RAISE NOTICE 'Column resolved_at already exists in ORDERS-invoices';
    END IF;
END $$;

-- Add resolved_by field to ORDERS-invoices
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ORDERS-invoices' 
        AND column_name = 'resolved_by'
    ) THEN
        ALTER TABLE "ORDERS-invoices"
            ADD COLUMN resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
        
        COMMENT ON COLUMN "ORDERS-invoices".resolved_by IS 
            'User ID who resolved the fulfillment issue';
        
        RAISE NOTICE 'Added resolved_by column to ORDERS-invoices';
    ELSE
        RAISE NOTICE 'Column resolved_by already exists in ORDERS-invoices';
    END IF;
END $$;

-- Add resolution_actions JSONB field to ORDERS-invoices
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ORDERS-invoices' 
        AND column_name = 'resolution_actions'
    ) THEN
        ALTER TABLE "ORDERS-invoices"
            ADD COLUMN resolution_actions JSONB DEFAULT '[]'::jsonb;
        
        COMMENT ON COLUMN "ORDERS-invoices".resolution_actions IS 
            'JSONB array of actions taken to resolve the issue';
        
        RAISE NOTICE 'Added resolution_actions column to ORDERS-invoices';
    ELSE
        RAISE NOTICE 'Column resolution_actions already exists in ORDERS-invoices';
    END IF;
END $$;

