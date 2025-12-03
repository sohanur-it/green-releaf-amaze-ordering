-- Module 5: Order Fulfillment & Manifesting
-- Complete database schema for fulfillment, scanning, and manifest creation
-- This script creates all tables, extensions, and indexes for Module 5

-- =====================================================
-- 1. Extend Invoice Status Enum
-- =====================================================

DO $$ BEGIN
    ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Partially_Voided';
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
    ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id);

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
    ADD COLUMN IF NOT EXISTS global_issue_requested_by INTEGER REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS global_issue_requested_at TIMESTAMPTZ;

-- Add inventory finalization flag
ALTER TABLE "ORDERS-invoices"
    ADD COLUMN IF NOT EXISTS inventory_finalized BOOLEAN DEFAULT false;

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
-- 3. Create Scanning Sessions Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-scanning-sessions" (
    id SERIAL PRIMARY KEY,
    fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id) ON DELETE CASCADE,
    fk_user_id INTEGER NOT NULL REFERENCES users(id),
    
    -- Session State
    session_status VARCHAR(20) NOT NULL DEFAULT 'active',
    -- Values: 'active', 'completed', 'cancelled', 'abandoned'
    
    -- Real-time Coordination
    currently_locked_packages JSONB DEFAULT '[]'::jsonb,
    -- Array of package labels: ["1A40E0100000067000001234", "1A40E0100000067000001235"]
    
    -- Activity Tracking
    last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Session Lifecycle
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    
    -- Metadata
    websocket_connection_id VARCHAR(255)
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
-- 4. Create Cancelled Shipment Package Tracking Table
-- =====================================================

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
    incident_type VARCHAR(50),
    -- Values: 'customer_cancel', 'driver_accident', 'other'
    
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
    
    CONSTRAINT uq_cancelled_pkg UNIQUE (fk_invoice_id, package_label)
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
-- 5. Create Manifest Packages Junction Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-manifest-packages" (
    id SERIAL PRIMARY KEY,
    fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id),
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
    package_status VARCHAR(50) DEFAULT 'manifested',
    -- Values: 'manifested', 'delivered', 'rejected', 'returned', 'voided'
    
    -- Void Tracking (if manifest voided)
    voided_at TIMESTAMPTZ,
    voided_by INTEGER REFERENCES users(id),
    
    -- Metadata
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uq_manifest_package UNIQUE (manifest_number, package_label, synclicense)
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

COMMENT ON TABLE "ORDERS-manifest-packages" IS 
    'Junction table recording which packages were on each manifest. Critical for rejection detection and cancelled shipment verification. Populated immediately after successful manifest creation.';

-- =====================================================
-- 2.6 Rejected Package Tracking Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-rejected_packages" (
    id SERIAL PRIMARY KEY,
    
    -- Package Info
    packagelabel VARCHAR(255) NOT NULL,
    package_metrc_id INTEGER,
    batch_id INTEGER REFERENCES "ORDERS-batches"(id),
    
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
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint: same package can't be rejected twice for same manifest
    CONSTRAINT uq_rejected_package UNIQUE (synclicense, packagelabel, manifestnumber)
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

