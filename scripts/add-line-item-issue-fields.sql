-- Migration: Add line item level issue tracking fields
-- Section 4.1: Line Item Level Issues

-- Add fulfillment_issue_type field to ORDERS-invoice-line-items
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ORDERS-invoice-line-items' 
        AND column_name = 'fulfillment_issue_type'
    ) THEN
        ALTER TABLE "ORDERS-invoice-line-items"
            ADD COLUMN fulfillment_issue_type VARCHAR(100);
        
        COMMENT ON COLUMN "ORDERS-invoice-line-items".fulfillment_issue_type IS 
            'Type of fulfillment issue reported for this line item (e.g., "wrong_batch", "insufficient_quantity", "damaged_package")';
        
        RAISE NOTICE 'Added fulfillment_issue_type column to ORDERS-invoice-line-items';
    ELSE
        RAISE NOTICE 'Column fulfillment_issue_type already exists in ORDERS-invoice-line-items';
    END IF;
END $$;

-- Add has_fulfillment_issue field to ORDERS-invoice-line-items
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ORDERS-invoice-line-items' 
        AND column_name = 'has_fulfillment_issue'
    ) THEN
        ALTER TABLE "ORDERS-invoice-line-items"
            ADD COLUMN has_fulfillment_issue BOOLEAN DEFAULT false;
        
        COMMENT ON COLUMN "ORDERS-invoice-line-items".has_fulfillment_issue IS 
            'Flag indicating if this line item has a reported fulfillment issue';
        
        CREATE INDEX IF NOT EXISTS idx_line_items_has_issue 
            ON "ORDERS-invoice-line-items"(has_fulfillment_issue) 
            WHERE has_fulfillment_issue = true;
        
        RAISE NOTICE 'Added has_fulfillment_issue column to ORDERS-invoice-line-items';
    ELSE
        RAISE NOTICE 'Column has_fulfillment_issue already exists in ORDERS-invoice-line-items';
    END IF;
END $$;

-- Add issue_photo_urls JSONB field for storing photo URLs
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ORDERS-invoice-line-items' 
        AND column_name = 'issue_photo_urls'
    ) THEN
        ALTER TABLE "ORDERS-invoice-line-items"
            ADD COLUMN issue_photo_urls JSONB DEFAULT '[]'::jsonb;
        
        COMMENT ON COLUMN "ORDERS-invoice-line-items".issue_photo_urls IS 
            'JSONB array of photo URLs uploaded when reporting issues for this line item';
        
        RAISE NOTICE 'Added issue_photo_urls column to ORDERS-invoice-line-items';
    ELSE
        RAISE NOTICE 'Column issue_photo_urls already exists in ORDERS-invoice-line-items';
    END IF;
END $$;

