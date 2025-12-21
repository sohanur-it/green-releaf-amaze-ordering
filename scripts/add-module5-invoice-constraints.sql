-- Module 5: Invoice Table Constraints and Validations
-- This script adds CHECK constraints, ON DELETE clauses, and status transition validation
-- Run this on both development and production databases

-- =====================================================
-- 1.1.1 Add CHECK Constraints
-- =====================================================

-- Constraint: voided_at IS NULL OR voided_manifest_reason IS NOT NULL
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_invoice_voided_reason'
        AND table_name = 'ORDERS-invoices'
    ) THEN
        ALTER TABLE "ORDERS-invoices"
        ADD CONSTRAINT chk_invoice_voided_reason 
        CHECK (voided_at IS NULL OR voided_manifest_reason IS NOT NULL);
    END IF;
END $$;

-- Constraint: packages_returned_count >= 0
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_invoice_packages_returned_non_negative'
        AND table_name = 'ORDERS-invoices'
    ) THEN
        ALTER TABLE "ORDERS-invoices"
        ADD CONSTRAINT chk_invoice_packages_returned_non_negative 
        CHECK (packages_returned_count >= 0);
    END IF;
END $$;

-- Constraint: packages_missing_count >= 0
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_invoice_packages_missing_non_negative'
        AND table_name = 'ORDERS-invoices'
    ) THEN
        ALTER TABLE "ORDERS-invoices"
        ADD CONSTRAINT chk_invoice_packages_missing_non_negative 
        CHECK (packages_missing_count >= 0);
    END IF;
END $$;

-- Constraint: transportation_details IS NULL OR jsonb_typeof(transportation_details) = 'object'
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_invoice_transportation_details_jsonb'
        AND table_name = 'ORDERS-invoices'
    ) THEN
        ALTER TABLE "ORDERS-invoices"
        ADD CONSTRAINT chk_invoice_transportation_details_jsonb 
        CHECK (transportation_details IS NULL OR jsonb_typeof(transportation_details) = 'object');
    END IF;
END $$;

-- =====================================================
-- 1.1.2 Add ON DELETE Clauses to Foreign Keys
-- =====================================================

-- Note: PostgreSQL doesn't support ALTER CONSTRAINT to change ON DELETE behavior
-- We need to drop and recreate the foreign keys

-- voided_by: Add ON DELETE SET NULL
DO $$ 
BEGIN
    -- Drop existing constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'ORDERS-invoices_voided_by_fkey'
        AND table_name = 'ORDERS-invoices'
    ) THEN
        ALTER TABLE "ORDERS-invoices" DROP CONSTRAINT "ORDERS-invoices_voided_by_fkey";
    END IF;
    
    -- Recreate with ON DELETE SET NULL
    ALTER TABLE "ORDERS-invoices"
    ADD CONSTRAINT "ORDERS-invoices_voided_by_fkey" 
    FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL;
END $$;

-- fulfillment_accepted_by: Add ON DELETE SET NULL
DO $$ 
DECLARE
    constraint_name_var TEXT;
BEGIN
    -- Check if column exists first
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ORDERS-invoices' 
        AND column_name = 'fulfillment_accepted_by'
    ) THEN
        -- Find the actual constraint name (it might have a different name)
        SELECT tc.constraint_name INTO constraint_name_var
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
            ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'ORDERS-invoices'
            AND kcu.column_name = 'fulfillment_accepted_by'
            AND tc.constraint_type = 'FOREIGN KEY'
        LIMIT 1;
        
        -- Drop existing constraint if it exists
        IF constraint_name_var IS NOT NULL THEN
            EXECUTE format('ALTER TABLE "ORDERS-invoices" DROP CONSTRAINT IF EXISTS %I', constraint_name_var);
        END IF;
        
        -- Recreate with ON DELETE SET NULL
        ALTER TABLE "ORDERS-invoices"
        ADD CONSTRAINT "ORDERS-invoices_fulfillment_accepted_by_fkey" 
        FOREIGN KEY (fulfillment_accepted_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- global_issue_requested_by: Add ON DELETE SET NULL
DO $$ 
BEGIN
    -- Drop existing constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'ORDERS-invoices_global_issue_requested_by_fkey'
        AND table_name = 'ORDERS-invoices'
    ) THEN
        ALTER TABLE "ORDERS-invoices" DROP CONSTRAINT "ORDERS-invoices_global_issue_requested_by_fkey";
    END IF;
    
    -- Recreate with ON DELETE SET NULL
    ALTER TABLE "ORDERS-invoices"
    ADD CONSTRAINT "ORDERS-invoices_global_issue_requested_by_fkey" 
    FOREIGN KEY (global_issue_requested_by) REFERENCES users(id) ON DELETE SET NULL;
END $$;

-- sales_acknowledged_void_by: Add ON DELETE SET NULL
DO $$ 
BEGIN
    -- Drop existing constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'ORDERS-invoices_sales_acknowledged_void_by_fkey'
        AND table_name = 'ORDERS-invoices'
    ) THEN
        ALTER TABLE "ORDERS-invoices" DROP CONSTRAINT "ORDERS-invoices_sales_acknowledged_void_by_fkey";
    END IF;
    
    -- Recreate with ON DELETE SET NULL
    ALTER TABLE "ORDERS-invoices"
    ADD CONSTRAINT "ORDERS-invoices_sales_acknowledged_void_by_fkey" 
    FOREIGN KEY (sales_acknowledged_void_by) REFERENCES users(id) ON DELETE SET NULL;
END $$;

-- =====================================================
-- 1.1.3 Status Transition Validation
-- =====================================================

-- Create function to validate status transitions
CREATE OR REPLACE FUNCTION validate_invoice_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- Validate Approved → Fulfillment_Accepted transition
    IF NEW.status = 'Fulfillment_Accepted' THEN
        IF OLD.status NOT IN ('Approved', 'Manifest_Voided', 'Partially_Voided') THEN
            RAISE EXCEPTION 'Invalid status transition: Cannot transition from % to Fulfillment_Accepted. Only Approved, Manifest_Voided, or Partially_Voided allowed.', OLD.status;
        END IF;
        
        -- Ensure fulfillment_accepted_by is set when transitioning to Fulfillment_Accepted
        IF NEW.fulfillment_accepted_by IS NULL THEN
            RAISE EXCEPTION 'Invalid transition: fulfillment_accepted_by must be set when transitioning to Fulfillment_Accepted';
        END IF;
    END IF;
    
    -- Allow transition from Fulfillment_Accepted or Fulfillment_Issue to Partially_Manifested
    IF NEW.status = 'Partially_Manifested' THEN
        IF OLD.status NOT IN ('Fulfillment_Accepted', 'Fulfillment_Issue') THEN
            RAISE EXCEPTION 'Invalid status transition: Cannot transition from % to Partially_Manifested. Only Fulfillment_Accepted or Fulfillment_Issue allowed.', OLD.status;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trg_validate_invoice_status_transition ON "ORDERS-invoices";
CREATE TRIGGER trg_validate_invoice_status_transition
    BEFORE UPDATE OF status ON "ORDERS-invoices"
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION validate_invoice_status_transition();

-- =====================================================
-- Success Message
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Module 5 Invoice constraints added successfully';
END $$;

