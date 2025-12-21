-- Module 5: Order Fulfillment & Manifesting
-- Complete database schema for fulfillment, scanning, and manifest creation
-- This script creates all tables, extensions, and indexes for Module 5

-- =====================================================
-- 1. Extend Invoice Status Enum
-- =====================================================

DO $$ BEGIN
    ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Partially_Voided';
    ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Manifest_Voided';
    ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Voided';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Manifest_Voided';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Voided';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Note: 'Partially_Manifested' already exists in Module 4 schema

-- =====================================================
-- 2. Extend Invoices Table with Module 5 Fields
-- =====================================================

-- Add void tracking fields
ALTER TABLE "ORDERS-invoices"
    ADD COLUMN IF NOT EXISTS voided_manifest_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS voided_manifest_reason TEXT,
    ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS sales_acknowledged_void BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS sales_acknowledged_void_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sales_acknowledged_void_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Add manifest tracking (supporting multi-license)
-- First check if single manifest fields exist, then migrate to arrays
DO $$ 
DECLARE
    has_manifest_number BOOLEAN;
    has_manifest_id BOOLEAN;
BEGIN
    -- Check if columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ORDERS-invoices' 
        AND column_name = 'metrc_manifest_number'
    ) INTO has_manifest_number;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ORDERS-invoices' 
        AND column_name = 'manifest_metrc_id'
    ) INTO has_manifest_id;
    
    -- Always add the new array columns
    ALTER TABLE "ORDERS-invoices"
        ADD COLUMN IF NOT EXISTS metrc_manifest_numbers JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS manifest_metrc_ids JSONB DEFAULT '[]'::jsonb;
    
    -- Migrate existing data if old columns exist
    IF has_manifest_number THEN
        IF has_manifest_id THEN
            -- Both columns exist - migrate both
            UPDATE "ORDERS-invoices"
            SET 
                metrc_manifest_numbers = CASE 
                    WHEN metrc_manifest_number IS NOT NULL 
                    THEN jsonb_build_array(metrc_manifest_number)
                    ELSE '[]'::jsonb
                END,
                manifest_metrc_ids = CASE 
                    WHEN manifest_metrc_id IS NOT NULL 
                    THEN jsonb_build_array(jsonb_build_object(
                        'id', manifest_metrc_id,
                        'number', metrc_manifest_number,
                        'license', 'CUL000063'  -- Default, may need manual correction
                    ))
                    ELSE '[]'::jsonb
                END
            WHERE metrc_manifest_number IS NOT NULL;
        ELSE
            -- Only manifest_number exists
            UPDATE "ORDERS-invoices"
            SET 
                metrc_manifest_numbers = CASE 
                    WHEN metrc_manifest_number IS NOT NULL 
                    THEN jsonb_build_array(metrc_manifest_number)
                    ELSE '[]'::jsonb
                END
            WHERE metrc_manifest_number IS NOT NULL;
        END IF;
        
        -- Drop old columns after migration
        ALTER TABLE "ORDERS-invoices"
            DROP COLUMN IF EXISTS metrc_manifest_number;
        
        IF has_manifest_id THEN
            ALTER TABLE "ORDERS-invoices"
                DROP COLUMN IF EXISTS manifest_metrc_id;
        END IF;
    END IF;
END $$;

-- Add transportation details (JSONB)
ALTER TABLE "ORDERS-invoices"
    ADD COLUMN IF NOT EXISTS transportation_details JSONB;

-- Add package return/missing tracking
ALTER TABLE "ORDERS-invoices"
    ADD COLUMN IF NOT EXISTS packages_returned_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS packages_missing_count INTEGER DEFAULT 0;

-- Add global issue request tracking
ALTER TABLE "ORDERS-invoices"
    ADD COLUMN IF NOT EXISTS global_issue_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS global_issue_requested_at TIMESTAMPTZ;

-- Add inventory finalization flag
ALTER TABLE "ORDERS-invoices"
    ADD COLUMN IF NOT EXISTS inventory_finalized BOOLEAN DEFAULT false;

-- Add resolution tracking fields (Section 4.5)
ALTER TABLE "ORDERS-invoices"
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS resolution_actions JSONB DEFAULT '[]'::jsonb;

-- Add indexes for Module 5
CREATE INDEX IF NOT EXISTS idx_invoices_fulfillment_worker 
    ON "ORDERS-invoices"(fulfillment_accepted_by)
    WHERE status IN ('Fulfillment_Accepted', 'Fulfillment_Issue');

CREATE INDEX IF NOT EXISTS idx_invoices_voided_manifests 
    ON "ORDERS-invoices"(voided_manifest_number)
    WHERE voided_manifest_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_manifest_numbers 
    ON "ORDERS-invoices" USING GIN(metrc_manifest_numbers);

CREATE INDEX IF NOT EXISTS idx_invoices_fulfillment_queue 
    ON "ORDERS-invoices"(status, approved_at) 
    WHERE status IN ('Approved', 'Fulfillment_Accepted', 'Fulfillment_Issue');

-- Comments
COMMENT ON COLUMN "ORDERS-invoices".metrc_manifest_numbers IS 
    'JSONB array of METRC manifest numbers. Multiple manifests required when order contains packages from multiple licenses.';
COMMENT ON COLUMN "ORDERS-invoices".manifest_metrc_ids IS 
    'JSONB array of manifest metadata: [{"license": "CUL000063", "id": 12345, "number": "M000123"}]';
COMMENT ON COLUMN "ORDERS-invoices".transportation_details IS 
    'JSONB object containing all transportation information entered by fulfillment worker. Stored here for audit trail and manifest recreation if needed.';
COMMENT ON COLUMN "ORDERS-invoices".inventory_finalized IS 
    'Flag to prevent double-deduction of inventory on delivery. Set to true when inventory is finalized after delivery confirmation.';

-- =====================================================
-- 2.1 Add CHECK Constraints to Invoices
-- =====================================================

-- Constraint: voided_at IS NULL OR voided_manifest_reason IS NOT NULL
ALTER TABLE "ORDERS-invoices"
    ADD CONSTRAINT chk_invoice_voided_reason 
    CHECK (voided_at IS NULL OR voided_manifest_reason IS NOT NULL);

-- Constraint: packages_returned_count >= 0
ALTER TABLE "ORDERS-invoices"
    ADD CONSTRAINT chk_invoice_packages_returned_non_negative 
    CHECK (packages_returned_count >= 0);

-- Constraint: packages_missing_count >= 0
ALTER TABLE "ORDERS-invoices"
    ADD CONSTRAINT chk_invoice_packages_missing_non_negative 
    CHECK (packages_missing_count >= 0);

-- Constraint: transportation_details IS NULL OR jsonb_typeof(transportation_details) = 'object'
ALTER TABLE "ORDERS-invoices"
    ADD CONSTRAINT chk_invoice_transportation_details_jsonb 
    CHECK (transportation_details IS NULL OR jsonb_typeof(transportation_details) = 'object');

-- =====================================================
-- 2.2 Update Foreign Keys with ON DELETE Clauses
-- =====================================================

-- Note: These will be applied via migration script for existing databases
-- For new databases, foreign keys are created with ON DELETE SET NULL

-- =====================================================
-- 2.3 Status Transition Validation
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
CREATE TRIGGER trg_validate_invoice_status_transition
    BEFORE UPDATE OF status ON "ORDERS-invoices"
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION validate_invoice_status_transition();

-- =====================================================
-- 3. Create Scanning Sessions Table
-- =====================================================

-- Create enum type for session status
DO $$ BEGIN
    CREATE TYPE scanning_session_status AS ENUM ('active', 'completed', 'cancelled', 'abandoned');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ORDERS-scanning-sessions" (
    id SERIAL PRIMARY KEY,
    fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id) ON DELETE CASCADE,
    fk_user_id INTEGER NOT NULL REFERENCES users(id),
    
    -- Session State
    session_status scanning_session_status NOT NULL DEFAULT 'active',
    
    -- Real-time Coordination
    currently_locked_packages JSONB DEFAULT '[]'::jsonb,
    -- Array of package labels: ["1A40E0100000067000001234", "1A40E0100000067000001235"]
    
    -- Activity Tracking
    last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Session Lifecycle
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    abandoned_at TIMESTAMPTZ,
    
    -- Metadata
    websocket_connection_id VARCHAR(255),
    
    -- Backup CHECK constraint (in case enum is not used)
    CONSTRAINT chk_scanning_session_status 
    CHECK (session_status IN ('active', 'completed', 'cancelled', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS idx_scanning_sessions_invoice 
    ON "ORDERS-scanning-sessions"(fk_invoice_id);

CREATE INDEX IF NOT EXISTS idx_scanning_sessions_user 
    ON "ORDERS-scanning-sessions"(fk_user_id);

CREATE INDEX IF NOT EXISTS idx_scanning_sessions_active 
    ON "ORDERS-scanning-sessions"(session_status) 
    WHERE session_status = 'active';

CREATE INDEX IF NOT EXISTS idx_scanning_sessions_cleanup 
    ON "ORDERS-scanning-sessions"(last_activity) 
    WHERE session_status = 'active';

-- Partial unique index: Only one active session per invoice
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_session 
    ON "ORDERS-scanning-sessions"(fk_invoice_id) 
    WHERE session_status = 'active';

COMMENT ON TABLE "ORDERS-scanning-sessions" IS 
    'Tracks active package scanning sessions for websocket coordination. Prevents multiple workers from scanning the same packages simultaneously. Sessions auto-abandon after 30 minutes of inactivity.';

-- =====================================================
-- 3.0.1 Create Scanning Session History Table (3.3.1)
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-scanning-session-history" (
    id SERIAL PRIMARY KEY,
    fk_session_id INTEGER NOT NULL REFERENCES "ORDERS-scanning-sessions"(id) ON DELETE CASCADE,
    fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id) ON DELETE CASCADE,
    fk_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    
    -- Error Details
    error_type VARCHAR(100) NOT NULL,
    error_message TEXT NOT NULL,
    package_label VARCHAR(255),
    
    -- Context
    scan_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_status VARCHAR(50),
    
    -- Additional metadata
    error_details JSONB,
    
    -- Indexes
    CONSTRAINT chk_session_history_error_type CHECK (error_type IN (
        'package_not_found',
        'package_not_on_order',
        'duplicate_scan',
        'first_sourcepackage_mismatch',
        'partial_package_not_allowed',
        'wrong_partial_package',
        'package_locked_by_other_worker',
        'session_inactive',
        'database_error',
        'validation_error'
    ))
);

CREATE INDEX IF NOT EXISTS idx_scanning_session_history_session 
    ON "ORDERS-scanning-session-history"(fk_session_id);

CREATE INDEX IF NOT EXISTS idx_scanning_session_history_invoice 
    ON "ORDERS-scanning-session-history"(fk_invoice_id);

CREATE INDEX IF NOT EXISTS idx_scanning_session_history_user 
    ON "ORDERS-scanning-session-history"(fk_user_id);

CREATE INDEX IF NOT EXISTS idx_scanning_session_history_timestamp 
    ON "ORDERS-scanning-session-history"(scan_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_scanning_session_history_error_type 
    ON "ORDERS-scanning-session-history"(error_type);

COMMENT ON TABLE "ORDERS-scanning-session-history" IS 
    'Dedicated table for logging scan errors during scanning sessions. Provides detailed error tracking separate from invoice history.';

-- =====================================================
-- 3.1 Create Scanning Sessions Archive Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-scanning-sessions-archive" (
    id INTEGER NOT NULL,
    fk_invoice_id INTEGER NOT NULL,
    fk_user_id INTEGER NOT NULL,
    
    -- Session State
    session_status scanning_session_status NOT NULL,
    
    -- Real-time Coordination
    currently_locked_packages JSONB DEFAULT '[]'::jsonb,
    
    -- Activity Tracking
    last_activity TIMESTAMPTZ NOT NULL,
    
    -- Session Lifecycle
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    abandoned_at TIMESTAMPTZ,
    
    -- Metadata
    websocket_connection_id VARCHAR(255),
    
    -- Archive metadata
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (id, archived_at)
);

CREATE INDEX IF NOT EXISTS idx_scanning_sessions_archive_invoice 
    ON "ORDERS-scanning-sessions-archive"(fk_invoice_id);

CREATE INDEX IF NOT EXISTS idx_scanning_sessions_archive_user 
    ON "ORDERS-scanning-sessions-archive"(fk_user_id);

CREATE INDEX IF NOT EXISTS idx_scanning_sessions_archive_archived_at 
    ON "ORDERS-scanning-sessions-archive"(archived_at DESC);

COMMENT ON TABLE "ORDERS-scanning-sessions-archive" IS 
    'Archive table for scanning sessions older than 30 days. Used for historical queries and audit purposes.';

-- =====================================================
-- 3.2 Create Archive Function for Scanning Sessions
-- =====================================================

CREATE OR REPLACE FUNCTION archive_old_scanning_sessions()
RETURNS TABLE(archived_count INTEGER, remaining_count INTEGER) AS $$
DECLARE
    archived_count_var INTEGER;
    remaining_count_var INTEGER;
BEGIN
    -- Insert old sessions into archive (older than 30 days)
    WITH archived AS (
        INSERT INTO "ORDERS-scanning-sessions-archive" (
            id, fk_invoice_id, fk_user_id, session_status,
            currently_locked_packages, last_activity, started_at,
            completed_at, cancelled_at, abandoned_at, websocket_connection_id
        )
        SELECT 
            id, fk_invoice_id, fk_user_id, session_status,
            currently_locked_packages, last_activity, started_at,
            completed_at, cancelled_at, abandoned_at, websocket_connection_id
        FROM "ORDERS-scanning-sessions"
        WHERE last_activity < NOW() - INTERVAL '30 days'
        RETURNING id
    )
    SELECT COUNT(*) INTO archived_count_var FROM archived;
    
    -- Delete archived sessions from active table
    DELETE FROM "ORDERS-scanning-sessions"
    WHERE last_activity < NOW() - INTERVAL '30 days';
    
    -- Get remaining count
    SELECT COUNT(*) INTO remaining_count_var FROM "ORDERS-scanning-sessions";
    
    -- Log operation
    RAISE NOTICE 'Archived % scanning sessions. Remaining: %', archived_count_var, remaining_count_var;
    
    RETURN QUERY SELECT archived_count_var, remaining_count_var;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION archive_old_scanning_sessions() IS 
    'Archives scanning sessions older than 30 days. Moves records to archive table and deletes from active table.';

-- =====================================================
-- 4. Create Cancelled Shipment Package Tracking Table
-- =====================================================

-- Create enum type for incident type
DO $$ BEGIN
    CREATE TYPE incident_type AS ENUM ('customer_cancel', 'driver_accident', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ORDERS-cancelled-shipment-packages" (
    id SERIAL PRIMARY KEY,
    fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id),
    
    -- Package Info
    package_label VARCHAR(255) NOT NULL,
    package_metrc_id INTEGER,
    batch_id INTEGER REFERENCES "ORDERS-batches"(id),
    
    -- Expected vs Actual Return
    was_on_manifest BOOLEAN NOT NULL DEFAULT true,
    returned_to_inventory BOOLEAN DEFAULT false,
    verified_in_metrc BOOLEAN DEFAULT false,
    
    -- Issue Tracking
    cancellation_reason TEXT,
    incident_type incident_type,
    
    -- Verification
    verified_by INTEGER REFERENCES users(id),
    verified_at TIMESTAMPTZ,
    admin_notes TEXT,
    
    -- Allocation Release Tracking
    allocation_released BOOLEAN DEFAULT false,
    allocation_released_at TIMESTAMPTZ,
    allocation_released_by INTEGER REFERENCES users(id),
    
    -- Metadata
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Soft Delete Support
    deleted_at TIMESTAMPTZ,
    deleted_by INTEGER REFERENCES users(id),
    
    -- Cleanup tracking
    cancellation_cleanup_completed BOOLEAN DEFAULT false,
    
    CONSTRAINT uq_cancelled_pkg UNIQUE (fk_invoice_id, package_label),
    -- Backup CHECK constraint
    CONSTRAINT chk_incident_type 
    CHECK (incident_type IS NULL OR incident_type IN ('customer_cancel', 'driver_accident', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_cancelled_packages_invoice 
    ON "ORDERS-cancelled-shipment-packages"(fk_invoice_id);

CREATE INDEX IF NOT EXISTS idx_cancelled_packages_unverified 
    ON "ORDERS-cancelled-shipment-packages"(returned_to_inventory, verified_in_metrc) 
    WHERE verified_in_metrc = FALSE;

CREATE INDEX IF NOT EXISTS idx_cancelled_packages_allocation_status 
    ON "ORDERS-cancelled-shipment-packages"(fk_invoice_id, allocation_released) 
    WHERE allocation_released = false;

COMMENT ON TABLE "ORDERS-cancelled-shipment-packages" IS 
    'Tracks packages from cancelled shipments to ensure inventory recovery. System verifies each package returns to activepackages before releasing allocations. Prevents inventory loss from accidents, cancellations, or other incidents.';

COMMENT ON COLUMN "ORDERS-cancelled-shipment-packages".allocation_released IS 
    'Tracks whether this specific package has had its allocation released from the batch. Prevents double-release when some packages are destroyed and others return.';

-- =====================================================
-- 4.1 Create Cancelled Shipment Packages Archive Table
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
-- 4.2 Create Archive Function for Cancelled Shipments
-- =====================================================

CREATE OR REPLACE FUNCTION archive_resolved_cancelled_shipments()
RETURNS TABLE(archived_count INTEGER, remaining_count INTEGER) AS $$
DECLARE
    archived_count_var INTEGER;
    remaining_count_var INTEGER;
BEGIN
    -- Insert resolved cancellations into archive (where all packages are verified and allocations released)
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
        INNER JOIN "ORDERS-invoices" inv ON csp.fk_invoice_id = inv.id
        WHERE csp.cancellation_cleanup_completed = true
            AND csp.verified_in_metrc = true
            AND csp.allocation_released = true
            AND csp.deleted_at IS NULL
        RETURNING id
    )
    SELECT COUNT(*) INTO archived_count_var FROM archived;
    
    -- Update cancellation_cleanup_completed flag and delete archived records
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
-- 4.3 Add Bulk Update Validation Functions
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
-- 5. Create Manifest Packages Junction Table
-- =====================================================

-- Create enum type for package status
DO $$ BEGIN
    CREATE TYPE manifest_package_status AS ENUM ('manifested', 'delivered', 'rejected', 'in_transit', 'voided');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ORDERS-manifest-packages" (
    id SERIAL PRIMARY KEY,
    fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id) ON DELETE CASCADE,
    manifest_number VARCHAR(100) NOT NULL,
    
    -- Package Details
    package_label VARCHAR(255) NOT NULL,
    package_metrc_id INTEGER NOT NULL,
    batch_id INTEGER NOT NULL REFERENCES "ORDERS-batches"(id),
    line_item_id INTEGER NOT NULL REFERENCES "ORDERS-invoice-line-items"(id),
    
    -- Manifest Details
    quantity NUMERIC NOT NULL,
    wholesale_price NUMERIC(10, 2) NOT NULL,
    gross_weight NUMERIC(10, 2) NOT NULL, -- In grams
    
    -- Status Tracking
    package_status manifest_package_status DEFAULT 'manifested',
    
    -- Void Tracking (if manifest voided)
    voided_at TIMESTAMPTZ,
    voided_by INTEGER REFERENCES users(id),
    
    -- Metadata
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uq_manifest_package UNIQUE (manifest_number, package_label, synclicense),
    -- Backup CHECK constraint
    CONSTRAINT chk_manifest_package_status 
    CHECK (package_status IN ('manifested', 'delivered', 'rejected', 'in_transit', 'voided'))
);

CREATE INDEX IF NOT EXISTS idx_manifest_packages_invoice 
    ON "ORDERS-manifest-packages"(fk_invoice_id);

CREATE INDEX IF NOT EXISTS idx_manifest_packages_manifest 
    ON "ORDERS-manifest-packages"(manifest_number, synclicense);

CREATE INDEX IF NOT EXISTS idx_manifest_packages_label 
    ON "ORDERS-manifest-packages"(package_label, synclicense);

CREATE INDEX IF NOT EXISTS idx_manifest_packages_voided 
    ON "ORDERS-manifest-packages"(package_status) 
    WHERE package_status = 'voided';

CREATE INDEX IF NOT EXISTS idx_manifest_packages_recent 
    ON "ORDERS-manifest-packages"(created_at DESC);

COMMENT ON TABLE "ORDERS-manifest-packages" IS 
    'Junction table recording which packages were on each manifest. Critical for rejection detection and cancelled shipment verification. Populated immediately after successful manifest creation.';

-- =====================================================
-- 5.1 Create System Configuration Table
-- =====================================================

CREATE TABLE IF NOT EXISTS system_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    description TEXT,
    data_type VARCHAR(20) DEFAULT 'string',
    -- Values: 'string', 'integer', 'boolean', 'json'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_system_config_key 
    ON system_config(config_key);

-- Insert default manifest void strategy
INSERT INTO system_config (config_key, config_value, description, data_type)
VALUES ('manifest_void_strategy', 'retain_records', 'Strategy for handling manifest package records when manifest is voided. Options: retain_records (default) or delete_records', 'string')
ON CONFLICT (config_key) DO NOTHING;

COMMENT ON TABLE system_config IS 
    'System-wide configuration settings. Used for feature flags, behavior configuration, and system parameters.';

-- =====================================================
-- 5.2 Create Manifest Packages Archive Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-manifest-packages-archive" (
    id INTEGER NOT NULL,
    fk_invoice_id INTEGER NOT NULL,
    manifest_number VARCHAR(100) NOT NULL,
    
    -- Package Details
    package_label VARCHAR(255) NOT NULL,
    package_metrc_id INTEGER NOT NULL,
    batch_id INTEGER NOT NULL,
    line_item_id INTEGER NOT NULL,
    
    -- Manifest Details
    quantity NUMERIC NOT NULL,
    wholesale_price NUMERIC(10, 2) NOT NULL,
    gross_weight NUMERIC(10, 2) NOT NULL,
    
    -- Status Tracking
    package_status manifest_package_status DEFAULT 'manifested',
    
    -- Void Tracking
    voided_at TIMESTAMPTZ,
    voided_by INTEGER,
    
    -- Metadata
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    
    -- Archive metadata
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (id, archived_at)
);

CREATE INDEX IF NOT EXISTS idx_manifest_packages_archive_invoice 
    ON "ORDERS-manifest-packages-archive"(fk_invoice_id);

CREATE INDEX IF NOT EXISTS idx_manifest_packages_archive_manifest 
    ON "ORDERS-manifest-packages-archive"(manifest_number, synclicense);

CREATE INDEX IF NOT EXISTS idx_manifest_packages_archive_archived_at 
    ON "ORDERS-manifest-packages-archive"(archived_at DESC);

COMMENT ON TABLE "ORDERS-manifest-packages-archive" IS 
    'Archive table for manifest packages older than 1 year for delivered invoices. Used for historical queries and audit purposes.';

-- =====================================================
-- 5.3 Create Archive Function for Manifest Packages
-- =====================================================

CREATE OR REPLACE FUNCTION archive_old_manifest_packages()
RETURNS TABLE(archived_count INTEGER, remaining_count INTEGER) AS $$
DECLARE
    archived_count_var INTEGER;
    remaining_count_var INTEGER;
BEGIN
    -- Insert old manifest packages into archive (older than 1 year for delivered invoices)
    WITH archived AS (
        INSERT INTO "ORDERS-manifest-packages-archive" (
            id, fk_invoice_id, manifest_number, package_label, package_metrc_id,
            batch_id, line_item_id, quantity, wholesale_price, gross_weight,
            package_status, voided_at, voided_by, synclicense, created_at
        )
        SELECT 
            mp.id, mp.fk_invoice_id, mp.manifest_number, mp.package_label, mp.package_metrc_id,
            mp.batch_id, mp.line_item_id, mp.quantity, mp.wholesale_price, mp.gross_weight,
            mp.package_status, mp.voided_at, mp.voided_by, mp.synclicense, mp.created_at
        FROM "ORDERS-manifest-packages" mp
        INNER JOIN "ORDERS-invoices" inv ON mp.fk_invoice_id = inv.id
        WHERE inv.status = 'Delivered'
            AND mp.created_at < NOW() - INTERVAL '1 year'
        RETURNING id
    )
    SELECT COUNT(*) INTO archived_count_var FROM archived;
    
    -- Delete archived records from active table
    DELETE FROM "ORDERS-manifest-packages"
    WHERE id IN (
        SELECT id FROM "ORDERS-manifest-packages-archive"
        WHERE archived_at >= NOW() - INTERVAL '1 hour'
    );
    
    -- Get remaining count
    SELECT COUNT(*) INTO remaining_count_var FROM "ORDERS-manifest-packages";
    
    -- Log operation
    RAISE NOTICE 'Archived % manifest packages. Remaining: %', archived_count_var, remaining_count_var;
    
    RETURN QUERY SELECT archived_count_var, remaining_count_var;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION archive_old_manifest_packages() IS 
    'Archives manifest packages older than 1 year for delivered invoices (monthly). Moves records to archive table and deletes from active table.';

-- =====================================================
-- 5.4 Create Manifest Packages Audit Table (for Option B: delete_records)
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-manifest-packages-audit" (
    id SERIAL PRIMARY KEY,
    original_id INTEGER NOT NULL,
    fk_invoice_id INTEGER NOT NULL,
    manifest_number VARCHAR(100) NOT NULL,
    
    -- Package Details
    package_label VARCHAR(255) NOT NULL,
    package_metrc_id INTEGER NOT NULL,
    batch_id INTEGER NOT NULL,
    line_item_id INTEGER NOT NULL,
    
    -- Manifest Details
    quantity NUMERIC NOT NULL,
    wholesale_price NUMERIC(10, 2) NOT NULL,
    gross_weight NUMERIC(10, 2) NOT NULL,
    
    -- Status Tracking
    package_status manifest_package_status DEFAULT 'manifested',
    
    -- Void Tracking
    voided_at TIMESTAMPTZ,
    voided_by INTEGER,
    
    -- Metadata
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    
    -- Audit metadata
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_by INTEGER REFERENCES users(id),
    deletion_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_manifest_packages_audit_invoice 
    ON "ORDERS-manifest-packages-audit"(fk_invoice_id);

CREATE INDEX IF NOT EXISTS idx_manifest_packages_audit_deleted_at 
    ON "ORDERS-manifest-packages-audit"(deleted_at DESC);

COMMENT ON TABLE "ORDERS-manifest-packages-audit" IS 
    'Audit table for deleted manifest package records when manifest_void_strategy is set to delete_records. Preserves historical data for compliance.';

-- =====================================================
-- 2.6 Rejected Package Tracking Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-rejected_packages" (
    id SERIAL PRIMARY KEY,
    
    -- Invoice reference
    fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id) ON DELETE CASCADE,
    
    -- Package Info
    packagelabel VARCHAR(255) NOT NULL,
    package_metrc_id INTEGER,
    batch_id INTEGER NOT NULL REFERENCES "ORDERS-batches"(id),
    
    -- Manifest Info
    manifestnumber VARCHAR(100) NOT NULL,
    synclicense VARCHAR(50) NOT NULL,
    
    -- Rejection Details
    rejection_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rejection_reason TEXT,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Inventory Recovery
    returned_to_inventory BOOLEAN DEFAULT false,
    inventory_restored_at TIMESTAMPTZ,
    inventory_restored_by INTEGER REFERENCES users(id),
    admin_verified BOOLEAN DEFAULT false,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint: same package can't be rejected twice for same manifest
    CONSTRAINT uq_rejected_package UNIQUE (synclicense, packagelabel, manifestnumber),
    
    -- Validation constraints
    CONSTRAINT chk_rejected_package_label_format 
    CHECK (packagelabel ~ '^[A-Z0-9]{24}$'),
    -- 24 alphanumeric characters (METRC standard)
    
    CONSTRAINT chk_rejected_package_metrc_id 
    CHECK (package_metrc_id IS NULL OR package_metrc_id > 0),
    -- Must be positive integer if provided
    
    CONSTRAINT chk_rejected_package_inventory_returned 
    CHECK (returned_to_inventory = false OR admin_verified = true)
    -- Cannot return to inventory without admin verification
);

CREATE INDEX IF NOT EXISTS idx_rejected_packages_label 
    ON "ORDERS-rejected_packages"(packagelabel, synclicense);

CREATE INDEX IF NOT EXISTS idx_rejected_packages_manifest 
    ON "ORDERS-rejected_packages"(manifestnumber, synclicense);

CREATE INDEX IF NOT EXISTS idx_rejected_packages_batch 
    ON "ORDERS-rejected_packages"(batch_id);

CREATE INDEX IF NOT EXISTS idx_rejected_packages_not_restored 
    ON "ORDERS-rejected_packages"(returned_to_inventory) 
    WHERE returned_to_inventory = false;

COMMENT ON TABLE "ORDERS-rejected_packages" IS 
    'Tracks packages that were rejected by receiving facility. Used for inventory recovery tracking.';

-- =====================================================
-- 6. Update Invoice History Modification Type Enum
-- =====================================================

DO $$ BEGIN
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'package_scanned';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'package_removed';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'scanning_cancelled';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'manifests_created';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'manifest_voided';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'manifest_updated';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'transportation_details_entered';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'scan_error';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'global_issue_requested';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'global_issue_acknowledged';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'cancelled_after_ship';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'packages_returned_confirmed';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'driver_incident_reported';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'destroyed_packages_finalized';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'manifest_validation_failed';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'partial_manifest_failure';
    ALTER TYPE modification_type ADD VALUE IF NOT EXISTS 'kicked_back_to_fulfillment';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- 7. Add Indexes for Package Lookup Performance
-- =====================================================

-- Index for activepackages lookup during scanning
-- Handle both synclicense (dev) and sync_license (prod) column names
DO $$ 
BEGIN
    -- Check which column name exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'activepackages' 
        AND column_name = 'sync_license'
    ) THEN
        -- Production: use sync_license
        CREATE INDEX IF NOT EXISTS idx_activepackages_label_lookup 
            ON activepackages(label, sync_license) 
            WHERE isarchived = FALSE AND isfinished = FALSE;
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'activepackages' 
        AND column_name = 'synclicense'
    ) THEN
        -- Development: use synclicense
        CREATE INDEX IF NOT EXISTS idx_activepackages_label_lookup 
            ON activepackages(label, synclicense) 
            WHERE isarchived = FALSE AND isfinished = FALSE;
    END IF;
END $$;

-- Index for line items with assigned packages (GIN index for JSONB)
CREATE INDEX IF NOT EXISTS idx_line_items_assigned_packages 
    ON "ORDERS-invoice-line-items" USING GIN(assigned_package_labels)
    WHERE assigned_package_labels IS NOT NULL;

-- =====================================================
-- 8. Success Message
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Module 5 fulfillment schema created successfully';
END $$;

