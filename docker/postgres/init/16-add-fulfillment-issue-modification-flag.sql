-- Migration: Add fulfillment_issue_modification flag to line items
-- This flag tracks if a line item was modified during Fulfillment_Issue status
-- Allows filtering/reporting on issue-driven modifications

-- Add column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ORDERS-invoice-line-items' 
        AND column_name = 'fulfillment_issue_modification'
    ) THEN
        ALTER TABLE "ORDERS-invoice-line-items"
        ADD COLUMN fulfillment_issue_modification BOOLEAN DEFAULT false;
        
        COMMENT ON COLUMN "ORDERS-invoice-line-items".fulfillment_issue_modification IS 
            'Flag indicating this line item was modified during Fulfillment_Issue status. 
             Allows filtering/reporting on issue-driven modifications.';
        
        -- Create index for efficient querying
        CREATE INDEX IF NOT EXISTS idx_line_items_fulfillment_issue_mod 
            ON "ORDERS-invoice-line-items"(fulfillment_issue_modification) 
            WHERE fulfillment_issue_modification = true;
        
        RAISE NOTICE 'Added fulfillment_issue_modification column to ORDERS-invoice-line-items';
    ELSE
        RAISE NOTICE 'Column fulfillment_issue_modification already exists';
    END IF;
END $$;

