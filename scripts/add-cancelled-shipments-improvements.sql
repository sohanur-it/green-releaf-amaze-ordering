-- Module 5: Cancelled Shipment Packages Improvements
-- This script adds enum type, archive table, and validation functions
-- Run this on both development and production databases

-- =====================================================
-- 1.3.1 Create Enum Type for Incident Type
-- =====================================================

DO $$ BEGIN
    CREATE TYPE incident_type AS ENUM ('customer_cancel', 'driver_accident', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- 1.3.2 Add cancellation_cleanup_completed Field to Invoices
-- =====================================================

ALTER TABLE "ORDERS-invoices"
    ADD COLUMN IF NOT EXISTS cancellation_cleanup_completed BOOLEAN DEFAULT false;

-- =====================================================
-- 1.3.3 Add cancellation_cleanup_completed Field to Cancelled Packages
-- =====================================================

ALTER TABLE "ORDERS-cancelled-shipment-packages"
    ADD COLUMN IF NOT EXISTS cancellation_cleanup_completed BOOLEAN DEFAULT false;

-- =====================================================
-- 1.3.4 Migrate incident_type from VARCHAR to Enum
-- =====================================================

DO $$ 
DECLARE
    col_type TEXT;
BEGIN
    -- Check current column type
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_name = 'ORDERS-cancelled-shipment-packages'
    AND column_name = 'incident_type';
    
    -- If it's still VARCHAR, we need to convert it
    IF col_type = 'character varying' THEN
        -- First, ensure all values are valid
        UPDATE "ORDERS-cancelled-shipment-packages"
        SET incident_type = 'other'
        WHERE incident_type IS NOT NULL 
        AND incident_type NOT IN ('customer_cancel', 'driver_accident', 'other');
        
        -- Add a temporary column with enum type
        ALTER TABLE "ORDERS-cancelled-shipment-packages"
        ADD COLUMN incident_type_new incident_type;
        
        -- Copy data with explicit cast
        UPDATE "ORDERS-cancelled-shipment-packages"
        SET incident_type_new = incident_type::incident_type;
        
        -- Drop old column and rename new one
        ALTER TABLE "ORDERS-cancelled-shipment-packages"
        DROP COLUMN incident_type;
        
        ALTER TABLE "ORDERS-cancelled-shipment-packages"
        RENAME COLUMN incident_type_new TO incident_type;
    END IF;
END $$;

-- =====================================================
-- 1.3.5 Add CHECK Constraint (backup validation)
-- =====================================================

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_incident_type'
        AND table_name = 'ORDERS-cancelled-shipment-packages'
    ) THEN
        ALTER TABLE "ORDERS-cancelled-shipment-packages"
        ADD CONSTRAINT chk_incident_type 
        CHECK (incident_type IS NULL OR incident_type IN ('customer_cancel', 'driver_accident', 'other'));
    END IF;
END $$;

-- =====================================================
-- 1.3.6 Create Archive Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-cancelled-shipment-packages-archive" (
    id INTEGER NOT NULL,
    fk_invoice_id INTEGER NOT NULL,
    
    -- Package Info
    package_label VARCHAR(255) NOT NULL,
    package_metrc_id INTEGER,
    batch_id INTEGER,
    
    -- Expected vs Actual Return
    was_on_manifest BOOLEAN NOT NULL,
    returned_to_inventory BOOLEAN DEFAULT false,
    verified_in_metrc BOOLEAN DEFAULT false,
    
    -- Issue Tracking
    cancellation_reason TEXT,
    incident_type incident_type,
    
    -- Verification
    verified_by INTEGER,
    verified_at TIMESTAMPTZ,
    admin_notes TEXT,
    
    -- Allocation Release Tracking
    allocation_released BOOLEAN DEFAULT false,
    allocation_released_at TIMESTAMPTZ,
    allocation_released_by INTEGER,
    
    -- Metadata
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    
    -- Soft Delete Support
    deleted_at TIMESTAMPTZ,
    deleted_by INTEGER,
    
    -- Cleanup tracking
    cancellation_cleanup_completed BOOLEAN DEFAULT false,
    
    -- Archive metadata
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (id, archived_at)
);

CREATE INDEX IF NOT EXISTS idx_cancelled_packages_archive_invoice 
    ON "ORDERS-cancelled-shipment-packages-archive"(fk_invoice_id);

CREATE INDEX IF NOT EXISTS idx_cancelled_packages_archive_archived_at 
    ON "ORDERS-cancelled-shipment-packages-archive"(archived_at DESC);

COMMENT ON TABLE "ORDERS-cancelled-shipment-packages-archive" IS 
    'Archive table for cancelled shipment packages. Records are archived weekly for resolved cancellations.';

-- =====================================================
-- 1.3.7 Create Archive Function
-- =====================================================

CREATE OR REPLACE FUNCTION archive_resolved_cancelled_shipments()
RETURNS TABLE(archived_count INTEGER, remaining_count INTEGER) AS $$
DECLARE
    archived_count_var INTEGER;
    remaining_count_var INTEGER;
BEGIN
    -- Insert resolved cancellations into archive
    WITH archived AS (
        INSERT INTO "ORDERS-cancelled-shipment-packages-archive" (
            id, fk_invoice_id, package_label, package_metrc_id, batch_id,
            was_on_manifest, returned_to_inventory, verified_in_metrc,
            cancellation_reason, incident_type, verified_by, verified_at,
            admin_notes, allocation_released, allocation_released_at,
            allocation_released_by, synclicense, created_at, updated_at,
            deleted_at, deleted_by, cancellation_cleanup_completed
        )
        SELECT 
            csp.id, csp.fk_invoice_id, csp.package_label, csp.package_metrc_id, csp.batch_id,
            csp.was_on_manifest, csp.returned_to_inventory, csp.verified_in_metrc,
            csp.cancellation_reason, csp.incident_type, csp.verified_by, csp.verified_at,
            csp.admin_notes, csp.allocation_released, csp.allocation_released_at,
            csp.allocation_released_by, csp.synclicense, csp.created_at, csp.updated_at,
            csp.deleted_at, csp.deleted_by, csp.cancellation_cleanup_completed
        FROM "ORDERS-cancelled-shipment-packages" csp
        WHERE csp.cancellation_cleanup_completed = true
            AND csp.verified_in_metrc = true
            AND csp.allocation_released = true
            AND csp.deleted_at IS NULL
        RETURNING id
    )
    SELECT COUNT(*) INTO archived_count_var FROM archived;
    
    -- Update cancellation_cleanup_completed flag on invoices
    UPDATE "ORDERS-invoices"
    SET cancellation_cleanup_completed = true
    WHERE id IN (
        SELECT DISTINCT fk_invoice_id
        FROM "ORDERS-cancelled-shipment-packages-archive"
        WHERE archived_at >= NOW() - INTERVAL '1 hour'
    );
    
    -- Delete archived records from active table
    DELETE FROM "ORDERS-cancelled-shipment-packages"
    WHERE cancellation_cleanup_completed = true
        AND verified_in_metrc = true
        AND allocation_released = true
        AND deleted_at IS NULL;
    
    -- Get remaining count
    SELECT COUNT(*) INTO remaining_count_var FROM "ORDERS-cancelled-shipment-packages";
    
    -- Log operation
    RAISE NOTICE 'Archived % cancelled shipment packages. Remaining: %', archived_count_var, remaining_count_var;
    
    RETURN QUERY SELECT archived_count_var, remaining_count_var;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION archive_resolved_cancelled_shipments() IS 
    'Archives resolved cancelled shipment packages (weekly). Moves records to archive table and deletes from active table.';

-- =====================================================
-- 1.3.8 Add Bulk Update Validation Functions
-- =====================================================

-- Function to validate bulk verification (package must exist in activepackages)
CREATE OR REPLACE FUNCTION validate_bulk_verification()
RETURNS TRIGGER AS $$
DECLARE
    license_column_name TEXT;
    package_exists BOOLEAN;
BEGIN
    -- Only validate on bulk updates (when multiple rows are updated)
    IF TG_OP = 'UPDATE' AND NEW.verified_in_metrc = true AND OLD.verified_in_metrc = false THEN
        -- Detect license column name
        SELECT column_name INTO license_column_name
        FROM information_schema.columns
        WHERE table_name = 'activepackages'
        AND column_name IN ('sync_license', 'synclicense')
        LIMIT 1;
        
        -- Check if package exists in activepackages
        EXECUTE format(
            'SELECT EXISTS (
                SELECT 1 FROM activepackages
                WHERE label = $1 AND %I = $2
                AND isarchived = false AND isfinished = false
            )',
            license_column_name
        ) INTO package_exists USING NEW.package_label, NEW.synclicense;
        
        IF NOT package_exists THEN
            RAISE EXCEPTION 'Cannot mark package % as verified: Package does not exist in activepackages table', NEW.package_label;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for bulk verification validation
DROP TRIGGER IF EXISTS trg_validate_bulk_verification ON "ORDERS-cancelled-shipment-packages";
CREATE TRIGGER trg_validate_bulk_verification
    BEFORE UPDATE OF verified_in_metrc ON "ORDERS-cancelled-shipment-packages"
    FOR EACH ROW
    EXECUTE FUNCTION validate_bulk_verification();

-- Function to validate bulk allocation release (packages must be verified first)
CREATE OR REPLACE FUNCTION validate_bulk_allocation_release()
RETURNS TRIGGER AS $$
BEGIN
    -- Only validate on bulk updates (when allocation is released)
    IF TG_OP = 'UPDATE' AND NEW.allocation_released = true AND OLD.allocation_released = false THEN
        IF NEW.verified_in_metrc = false THEN
            RAISE EXCEPTION 'Cannot release allocation for package %: Package must be verified in METRC first', NEW.package_label;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for bulk allocation release validation
DROP TRIGGER IF EXISTS trg_validate_bulk_allocation_release ON "ORDERS-cancelled-shipment-packages";
CREATE TRIGGER trg_validate_bulk_allocation_release
    BEFORE UPDATE OF allocation_released ON "ORDERS-cancelled-shipment-packages"
    FOR EACH ROW
    EXECUTE FUNCTION validate_bulk_allocation_release();

-- =====================================================
-- Success Message
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Cancelled shipment packages improvements added successfully';
END $$;


