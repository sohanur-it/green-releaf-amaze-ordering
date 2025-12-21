-- Module 5: Manifest Packages Improvements
-- This script adds enum type, system_config table, archive table, and index
-- Run this on both development and production databases

-- =====================================================
-- 1.4.1 Create Enum Type for Package Status
-- =====================================================

DO $$ BEGIN
    CREATE TYPE manifest_package_status AS ENUM ('manifested', 'delivered', 'rejected', 'in_transit', 'voided');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- 1.4.2 Add ON DELETE CASCADE to fk_invoice_id
-- =====================================================

DO $$ 
DECLARE
    constraint_name_var TEXT;
BEGIN
    -- Find the actual constraint name
    SELECT tc.constraint_name INTO constraint_name_var
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'ORDERS-manifest-packages'
        AND kcu.column_name = 'fk_invoice_id'
        AND tc.constraint_type = 'FOREIGN KEY'
    LIMIT 1;
    
    -- Drop existing constraint if it exists
    IF constraint_name_var IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "ORDERS-manifest-packages" DROP CONSTRAINT IF EXISTS %I', constraint_name_var);
    END IF;
    
    -- Recreate with ON DELETE CASCADE
    ALTER TABLE "ORDERS-manifest-packages"
    ADD CONSTRAINT "ORDERS-manifest-packages_fk_invoice_id_fkey" 
    FOREIGN KEY (fk_invoice_id) REFERENCES "ORDERS-invoices"(id) ON DELETE CASCADE;
END $$;

-- =====================================================
-- 1.4.3 Migrate package_status from VARCHAR to Enum
-- =====================================================

DO $$ 
DECLARE
    col_type TEXT;
BEGIN
    -- Check current column type
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_name = 'ORDERS-manifest-packages'
    AND column_name = 'package_status';
    
    -- If it's still VARCHAR, we need to convert it
    IF col_type = 'character varying' THEN
        -- First, ensure all values are valid
        UPDATE "ORDERS-manifest-packages"
        SET package_status = 'manifested'
        WHERE package_status NOT IN ('manifested', 'delivered', 'rejected', 'in_transit', 'voided');
        
        -- Add a temporary column with enum type
        ALTER TABLE "ORDERS-manifest-packages"
        ADD COLUMN package_status_new manifest_package_status;
        
        -- Copy data with explicit cast
        UPDATE "ORDERS-manifest-packages"
        SET package_status_new = package_status::manifest_package_status;
        
        -- Drop old column and rename new one
        ALTER TABLE "ORDERS-manifest-packages"
        DROP COLUMN package_status;
        
        ALTER TABLE "ORDERS-manifest-packages"
        RENAME COLUMN package_status_new TO package_status;
        
        -- Set DEFAULT
        ALTER TABLE "ORDERS-manifest-packages"
        ALTER COLUMN package_status SET DEFAULT 'manifested';
    END IF;
END $$;

-- =====================================================
-- 1.4.4 Add CHECK Constraint (backup validation)
-- =====================================================

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_manifest_package_status'
        AND table_name = 'ORDERS-manifest-packages'
    ) THEN
        ALTER TABLE "ORDERS-manifest-packages"
        ADD CONSTRAINT chk_manifest_package_status 
        CHECK (package_status IN ('manifested', 'delivered', 'rejected', 'in_transit', 'voided'));
    END IF;
END $$;

-- =====================================================
-- 1.4.5 Add Index for Recent Records
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_manifest_packages_recent 
    ON "ORDERS-manifest-packages"(created_at DESC);

-- =====================================================
-- 1.4.6 Create System Configuration Table
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
-- 1.4.7 Create Archive Table
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
-- 1.4.8 Create Archive Function
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
-- 1.4.9 Create Audit Table (for Option B: delete_records)
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
-- Success Message
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Manifest packages improvements added successfully';
END $$;


