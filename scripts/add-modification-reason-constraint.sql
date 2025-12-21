-- Section 17.3: Traceability Requirements
-- Migration script to make modification_reason required when was_modified = true

-- Add CHECK constraint: If was_modified = true, modification_reason must not be NULL
ALTER TABLE "ORDERS-invoice-line-items"
    DROP CONSTRAINT IF EXISTS check_modification_reason_required;

ALTER TABLE "ORDERS-invoice-line-items"
    ADD CONSTRAINT check_modification_reason_required
    CHECK (
        (was_modified = false) OR 
        (was_modified = true AND modification_reason IS NOT NULL AND LENGTH(TRIM(modification_reason)) > 0)
    );

-- Add comment
COMMENT ON CONSTRAINT check_modification_reason_required ON "ORDERS-invoice-line-items" IS 
    'Section 17.3.2: If was_modified = true, modification_reason is required and cannot be empty';

