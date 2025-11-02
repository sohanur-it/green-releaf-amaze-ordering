-- Module 4: External Portal Access Table
-- UUID-based authentication for external buyer portal
-- Buyers access portal via /external/store/{uuid} without passwords

CREATE TABLE IF NOT EXISTS "ORDERS-portal-access" (
    id SERIAL PRIMARY KEY,
    
    -- UUID for URL access (e.g., /external/store/{uuid})
    access_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    
    -- Buyer & Location Link
    fk_buyer_id INTEGER NOT NULL REFERENCES "ORDERS-buyers"(entry_id),
    fk_location_id INTEGER NOT NULL,  -- Which dispensary location
    
    -- Access Control
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMPTZ,  -- Optional expiration (NULL = no expiration)
    
    -- Usage Tracking
    first_accessed_at TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ,
    access_count INTEGER DEFAULT 0,
    
    -- Metadata
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT  -- Admin notes about this access link
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_portal_access_uuid ON "ORDERS-portal-access"(access_uuid);
CREATE INDEX IF NOT EXISTS idx_portal_access_buyer_location ON "ORDERS-portal-access"(fk_buyer_id, fk_location_id);
CREATE INDEX IF NOT EXISTS idx_portal_access_active ON "ORDERS-portal-access"(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_portal_access_expires ON "ORDERS-portal-access"(expires_at) WHERE expires_at IS NOT NULL;

-- Comments
COMMENT ON TABLE "ORDERS-portal-access" IS 'UUID-based access tokens for external buyer portal. Buyers access via /external/store/{uuid} without passwords.';
COMMENT ON COLUMN "ORDERS-portal-access".access_uuid IS 'Cryptographically secure UUID used in portal URL';
COMMENT ON COLUMN "ORDERS-portal-access".fk_location_id IS 'Location-specific access - each location gets its own UUID';
COMMENT ON COLUMN "ORDERS-portal-access".expires_at IS 'Optional expiration date. NULL means no expiration.';

DO $$
BEGIN
    RAISE NOTICE 'Module 4 portal access table created successfully';
END $$;

