-- Module 5: Rejected Packages Improvements
-- This script adds missing fields, foreign keys, and validation constraints
-- Run this on both development and production databases

-- =====================================================
-- 1.5.1 Add Missing Fields
-- =====================================================

-- Add fk_invoice_id field
ALTER TABLE "ORDERS-rejected_packages"
    ADD COLUMN IF NOT EXISTS fk_invoice_id INTEGER;

-- Add admin_verified field
ALTER TABLE "ORDERS-rejected_packages"
    ADD COLUMN IF NOT EXISTS admin_verified BOOLEAN DEFAULT false;

-- =====================================================
-- 1.5.2 Populate fk_invoice_id from manifest number
-- =====================================================

-- Try to populate fk_invoice_id from existing manifest numbers
-- This is a best-effort migration - some records may not have matching invoices
UPDATE "ORDERS-rejected_packages" rp
SET fk_invoice_id = (
    SELECT inv.id
    FROM "ORDERS-invoices" inv
    WHERE inv.metrc_manifest_numbers::text LIKE '%' || rp.manifestnumber || '%'
    LIMIT 1
)
WHERE rp.fk_invoice_id IS NULL;

-- =====================================================
-- 1.5.3 Add Foreign Key Constraints
-- =====================================================

-- Add foreign key for fk_invoice_id
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'ORDERS-rejected_packages_fk_invoice_id_fkey'
        AND table_name = 'ORDERS-rejected_packages'
    ) THEN
        ALTER TABLE "ORDERS-rejected_packages"
        ADD CONSTRAINT "ORDERS-rejected_packages_fk_invoice_id_fkey" 
        FOREIGN KEY (fk_invoice_id) REFERENCES "ORDERS-invoices"(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Update batch_id foreign key to be NOT NULL and add proper constraint
DO $$ 
DECLARE
    constraint_name_var TEXT;
BEGIN
    -- Find the actual constraint name
    SELECT tc.constraint_name INTO constraint_name_var
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'ORDERS-rejected_packages'
        AND kcu.column_name = 'batch_id'
        AND tc.constraint_type = 'FOREIGN KEY'
    LIMIT 1;
    
    -- Drop existing constraint if it exists
    IF constraint_name_var IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "ORDERS-rejected_packages" DROP CONSTRAINT IF EXISTS %I', constraint_name_var);
    END IF;
    
    -- Set batch_id to NOT NULL if it's currently nullable
    ALTER TABLE "ORDERS-rejected_packages"
    ALTER COLUMN batch_id SET NOT NULL;
    
    -- Recreate with proper foreign key
    ALTER TABLE "ORDERS-rejected_packages"
    ADD CONSTRAINT "ORDERS-rejected_packages_batch_id_fkey" 
    FOREIGN KEY (batch_id) REFERENCES "ORDERS-batches"(id);
END $$;

-- =====================================================
-- 1.5.4 Add Validation Constraints
-- =====================================================

-- Constraint: inventory_returned = true requires admin_verified = true
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_rejected_package_inventory_returned'
        AND table_name = 'ORDERS-rejected_packages'
    ) THEN
        ALTER TABLE "ORDERS-rejected_packages"
        ADD CONSTRAINT chk_rejected_package_inventory_returned 
        CHECK (returned_to_inventory = false OR admin_verified = true);
    END IF;
END $$;

-- Constraint: Package label format validation (24 alphanumeric characters)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_rejected_package_label_format'
        AND table_name = 'ORDERS-rejected_packages'
    ) THEN
        ALTER TABLE "ORDERS-rejected_packages"
        ADD CONSTRAINT chk_rejected_package_label_format 
        CHECK (packagelabel ~ '^[A-Z0-9]{24}$');
    END IF;
END $$;

-- Constraint: METRC package ID integer validation
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_rejected_package_metrc_id'
        AND table_name = 'ORDERS-rejected_packages'
    ) THEN
        ALTER TABLE "ORDERS-rejected_packages"
        ADD CONSTRAINT chk_rejected_package_metrc_id 
        CHECK (package_metrc_id IS NULL OR package_metrc_id > 0);
    END IF;
END $$;

-- =====================================================
-- 1.5.5 Add Index for Invoice Lookup
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_rejected_packages_invoice 
    ON "ORDERS-rejected_packages"(fk_invoice_id);

-- =====================================================
-- Success Message
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Rejected packages improvements added successfully';
END $$;


