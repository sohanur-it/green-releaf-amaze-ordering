-- Module 5: Scanning Sessions Improvements
-- This script adds enum type, abandoned_at field, and archive table
-- Run this on both development and production databases

-- =====================================================
-- 1.2.1 Create Enum Type for Session Status
-- =====================================================

DO $$ BEGIN
    CREATE TYPE scanning_session_status AS ENUM ('active', 'completed', 'cancelled', 'abandoned');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- 1.2.2 Add abandoned_at Field
-- =====================================================

ALTER TABLE "ORDERS-scanning-sessions"
    ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMPTZ;

-- =====================================================
-- 1.2.3 Migrate session_status from VARCHAR to Enum
-- =====================================================

DO $$ 
DECLARE
    col_type TEXT;
BEGIN
    -- Check current column type
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_name = 'ORDERS-scanning-sessions'
    AND column_name = 'session_status';
    
    -- If it's still VARCHAR, we need to convert it
    IF col_type = 'character varying' THEN
        -- First, ensure all values are valid
        UPDATE "ORDERS-scanning-sessions"
        SET session_status = 'active'
        WHERE session_status NOT IN ('active', 'completed', 'cancelled', 'abandoned');
        
        -- Add a temporary column with enum type
        ALTER TABLE "ORDERS-scanning-sessions"
        ADD COLUMN session_status_new scanning_session_status;
        
        -- Copy data with explicit cast
        UPDATE "ORDERS-scanning-sessions"
        SET session_status_new = session_status::scanning_session_status;
        
        -- Drop old column and rename new one
        ALTER TABLE "ORDERS-scanning-sessions"
        DROP COLUMN session_status;
        
        ALTER TABLE "ORDERS-scanning-sessions"
        RENAME COLUMN session_status_new TO session_status;
        
        -- Set NOT NULL and DEFAULT
        ALTER TABLE "ORDERS-scanning-sessions"
        ALTER COLUMN session_status SET NOT NULL,
        ALTER COLUMN session_status SET DEFAULT 'active';
    END IF;
END $$;

-- =====================================================
-- 1.2.4 Add CHECK Constraint (backup validation)
-- =====================================================

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'chk_scanning_session_status'
        AND table_name = 'ORDERS-scanning-sessions'
    ) THEN
        ALTER TABLE "ORDERS-scanning-sessions"
        ADD CONSTRAINT chk_scanning_session_status 
        CHECK (session_status IN ('active', 'completed', 'cancelled', 'abandoned'));
    END IF;
END $$;

-- =====================================================
-- 1.2.5 Create Archive Table
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
-- 1.2.6 Create Archive Function
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
-- Success Message
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Scanning sessions improvements added successfully';
END $$;


