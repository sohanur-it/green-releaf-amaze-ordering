-- Module 3: Product & Inventory Management Schema
-- This script implements the complete database schema for Module 3

-- =============================================
-- 1. CREATE BATCH_STATUS ENUM TYPE
-- =============================================
DO $$ BEGIN
    CREATE TYPE batch_status AS enum ('Sellable', 'On Deck', 'On Hold');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 2. EXTEND ORDERS-PRODUCTS TABLE
-- =============================================
-- Add new columns to existing ORDERS-products table
ALTER TABLE "ORDERS-products" 
ADD COLUMN IF NOT EXISTS metrc_linked_items jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS default_price numeric(10, 2),
ADD COLUMN IF NOT EXISTS price_updated_at timestamptz,
ADD COLUMN IF NOT EXISTS price_updated_by integer REFERENCES users(id);

-- Add comment for documentation
COMMENT ON COLUMN "ORDERS-products".metrc_linked_items IS 'JSONB array of linked METRC item names. Example: ["V1 Amaze Orange 3.5g", "V2 Amaze Orange 3.5g"]';

-- =============================================
-- 3. CREATE ORDERS-BATCHES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS "ORDERS-batches" (
    id                        SERIAL PRIMARY KEY,
    -- Batch Identification (from METRC extraction query)
    batch_name                VARCHAR(255) UNIQUE NOT NULL,
    -- e.g., "1A40E01...123_V1 Amaze Orange 3.5g"
    metrc_item_name           TEXT NOT NULL,
    -- The METRC item this batch belongs to
    first_sourcepackage_label VARCHAR(255) NOT NULL,
    sourcepackagelabels       TEXT,
    -- Comma-separated list of all source packages
    -- Master Product Link
    fk_master_product_id      INTEGER REFERENCES "ORDERS-products"(entry_id) ON DELETE SET NULL,
    -- Inventory Quantities
    quantity                  INTEGER NOT NULL DEFAULT 0,
    -- Full packages available for sale
    allocated_quantity        INTEGER NOT NULL DEFAULT 0,
    -- Reserved by orders, not yet fulfilled
    package_count             INTEGER NOT NULL,
    -- Total packages (full + partial)
    full_package_count        INTEGER NOT NULL,
    partial_package_count     INTEGER NOT NULL,
    -- Package Details (JSONB for flexibility)
    available_labels          JSONB,
    -- All package labels for this batch
    full_package_details      JSONB,
    -- [{label: "1A...", quantity: 3.5}, ...]
    partial_package_details   JSONB,
    -- Product Information
    item_productcategoryname  VARCHAR(255),
    synclicense               VARCHAR(50) NOT NULL,
    storage_location          VARCHAR(255),
    -- Test Results & Dates
    thc_percentage            NUMERIC(5, 2),
    -- Can be NULL if missing from METRC
    thc_override              NUMERIC(5, 2),
    -- Inventory Manager can manually set
    thc_override_by           INTEGER REFERENCES users(id),
    thc_override_at           TIMESTAMPTZ,
    production_date           DATE,
    test_date                 DATE,
    best_by_date              DATE,
    -- Business Logic Fields
    status                    BATCH_STATUS NOT NULL DEFAULT 'On Hold',
    override_price            NUMERIC(10, 2),
    -- Batch-specific price (overrides master product default)
    -- Data Quality Flags
    items_table_missing       BOOLEAN DEFAULT false,
    unit_weight_grams_missing BOOLEAN DEFAULT false,
    unit_count_missing        BOOLEAN DEFAULT false,
    -- Metadata
    last_modified             TIMESTAMPTZ,
    -- From METRC
    last_synced               TIMESTAMPTZ DEFAULT Now(),
    created_at                TIMESTAMPTZ DEFAULT Now()
);

-- =============================================
-- 4. CREATE ORDERS-BATCH-HISTORY TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS "ORDERS-batch-history" (
    id                    BIGSERIAL PRIMARY KEY,
    batch_id              INTEGER NOT NULL REFERENCES "ORDERS-batches"(id) ON DELETE CASCADE,
    -- What changed
    change_type           VARCHAR(50) NOT NULL,
    -- 'package_removed', 'status_changed', 'quantity_adjusted', 'allocation_changed'
    -- Details of the change
    field_name            VARCHAR(50),
    -- e.g., 'quantity', 'status', 'allocated_quantity'
    old_value             TEXT,
    new_value             TEXT,
    change_details        JSONB,
    -- Flexible field for complex changes
    -- Context: WHY did it change?
    reason                VARCHAR(255),
    -- 'Sync detected package transfer', 'Allocated to invoice #12345', 'Manual adjustment'
    related_invoice_id    INTEGER,
    -- If change was due to an order allocation
    related_package_label VARCHAR(255),
    -- If a specific package was involved
    -- Who/What made the change
    changed_by_user_id    INTEGER REFERENCES users(id),
    -- NULL for system changes
    changed_by_system     BOOLEAN DEFAULT false,
    timestamp             TIMESTAMPTZ NOT NULL DEFAULT Now()
);

-- =============================================
-- 5. CREATE ORDERS-PRODUCT-CATEGORIES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS "ORDERS-product-categories" (
    id                     SERIAL PRIMARY KEY,
    category_name          VARCHAR(255) UNIQUE NOT NULL,
    -- e.g., "1g Resin Carts"
    metrc_category_pattern VARCHAR(255),
    -- The METRC category name pattern to match
    created_at             TIMESTAMPTZ DEFAULT Now()
);

-- Add foreign key to products table
ALTER TABLE "ORDERS-products"
ADD COLUMN IF NOT EXISTS fk_category_id INTEGER REFERENCES "ORDERS-product-categories"(id);

-- =============================================
-- 6. CREATE CRITICAL INDEXES FOR PERFORMANCE
-- =============================================

-- ORDERS-batches indexes
CREATE INDEX IF NOT EXISTS idx_batches_master_product ON "ORDERS-batches"(fk_master_product_id);
CREATE INDEX IF NOT EXISTS idx_batches_status ON "ORDERS-batches"(status);
CREATE INDEX IF NOT EXISTS idx_batches_metrc_item ON "ORDERS-batches"(metrc_item_name);
CREATE INDEX IF NOT EXISTS idx_batches_production_date ON "ORDERS-batches"(production_date);
CREATE INDEX IF NOT EXISTS idx_batches_synclicense ON "ORDERS-batches"(synclicense);

-- Composite index for common queries (sellable inventory by product)
CREATE INDEX IF NOT EXISTS idx_batches_product_status_qty ON "ORDERS-batches"(fk_master_product_id, status, quantity) 
WHERE quantity > allocated_quantity;

-- ORDERS-batch-history indexes
CREATE INDEX IF NOT EXISTS idx_batch_history_batch_id ON "ORDERS-batch-history"(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_history_timestamp ON "ORDERS-batch-history"(timestamp);
CREATE INDEX IF NOT EXISTS idx_batch_history_change_type ON "ORDERS-batch-history"(change_type);

-- ORDERS-products indexes for new columns
CREATE INDEX IF NOT EXISTS idx_products_metrc_linked_items ON "ORDERS-products" USING GIN (metrc_linked_items);
CREATE INDEX IF NOT EXISTS idx_products_default_price ON "ORDERS-products"(default_price);

-- =============================================
-- 7. INSERT SAMPLE PRODUCT CATEGORIES
-- =============================================
INSERT INTO "ORDERS-product-categories" (category_name, metrc_category_pattern) VALUES
('Flower - 3.5g Jars', '%Flower%(Final Packaging)%'),
('Flower - 1g Jars', '%Flower%(Final Packaging)%'),
('Cartridges - 1g', '%Cartridge%(Final Packaging)%'),
('Edibles - Gummies', '%Edible%(Final Packaging)%'),
('Concentrates - Resin', '%Concentrate%(Final Packaging)%')
ON CONFLICT (category_name) DO NOTHING;

-- =============================================
-- 8. CREATE HELPER FUNCTIONS
-- =============================================

-- Function to get effective price for a batch
CREATE OR REPLACE FUNCTION get_effective_price(batch_id INTEGER)
RETURNS NUMERIC AS $$
DECLARE
    batch_override_price NUMERIC;
    product_default_price NUMERIC;
BEGIN
    -- Get batch override price and product default price
    SELECT b.override_price, p.default_price
    INTO batch_override_price, product_default_price
    FROM "ORDERS-batches" b
    LEFT JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
    WHERE b.id = batch_id;
    
    -- Return override price if available, otherwise default price
    RETURN COALESCE(batch_override_price, product_default_price, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to check if batch can be marked as Sellable
CREATE OR REPLACE FUNCTION can_batch_be_sellable(batch_id INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    batch_record RECORD;
BEGIN
    SELECT items_table_missing, unit_weight_grams_missing, unit_count_missing, 
           thc_percentage, thc_override
    INTO batch_record
    FROM "ORDERS-batches"
    WHERE id = batch_id;
    
    -- Cannot be sellable if critical data is missing
    IF batch_record.items_table_missing OR 
       batch_record.unit_weight_grams_missing OR 
       batch_record.unit_count_missing THEN
        RETURN FALSE;
    END IF;
    
    -- Can be sellable even without THC data (warning will be shown)
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- 9. CREATE TRIGGERS FOR AUDIT LOGGING
-- =============================================

-- Trigger function for batch history logging
CREATE OR REPLACE FUNCTION log_batch_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- Log status changes
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO "ORDERS-batch-history" (
            batch_id, change_type, field_name, old_value, new_value, 
            reason, changed_by_system
        ) VALUES (
            NEW.id, 'status_changed', 'status', 
            OLD.status::text, NEW.status::text,
            'Status changed', false
        );
    END IF;
    
    -- Log quantity changes
    IF OLD.quantity IS DISTINCT FROM NEW.quantity THEN
        INSERT INTO "ORDERS-batch-history" (
            batch_id, change_type, field_name, old_value, new_value,
            reason, changed_by_system
        ) VALUES (
            NEW.id, 'quantity_adjusted', 'quantity',
            OLD.quantity::text, NEW.quantity::text,
            'Quantity updated', false
        );
    END IF;
    
    -- Log allocation changes
    IF OLD.allocated_quantity IS DISTINCT FROM NEW.allocated_quantity THEN
        INSERT INTO "ORDERS-batch-history" (
            batch_id, change_type, field_name, old_value, new_value,
            reason, changed_by_system
        ) VALUES (
            NEW.id, 'allocation_changed', 'allocated_quantity',
            OLD.allocated_quantity::text, NEW.allocated_quantity::text,
            'Allocation updated', false
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for batch changes
DROP TRIGGER IF EXISTS trigger_log_batch_changes ON "ORDERS-batches";
CREATE TRIGGER trigger_log_batch_changes
    AFTER UPDATE ON "ORDERS-batches"
    FOR EACH ROW
    EXECUTE FUNCTION log_batch_changes();

-- =============================================
-- 10. GRANT PERMISSIONS
-- =============================================
-- Grant necessary permissions to application user (if postgres role exists)
DO $$
BEGIN
    -- Grant permissions to postgres if it exists (local development)
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON "ORDERS-batches" TO postgres;
        GRANT SELECT, INSERT, UPDATE, DELETE ON "ORDERS-batch-history" TO postgres;
        GRANT SELECT, INSERT, UPDATE, DELETE ON "ORDERS-product-categories" TO postgres;
        GRANT USAGE ON SEQUENCE "ORDERS-batches_id_seq" TO postgres;
        GRANT USAGE ON SEQUENCE "ORDERS-batch-history_id_seq" TO postgres;
        GRANT USAGE ON SEQUENCE "ORDERS-product-categories_id_seq" TO postgres;
    END IF;
    
    -- Grant permissions to master if it exists (production RDS)
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'master') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON "ORDERS-batches" TO master;
        GRANT SELECT, INSERT, UPDATE, DELETE ON "ORDERS-batch-history" TO master;
        GRANT SELECT, INSERT, UPDATE, DELETE ON "ORDERS-product-categories" TO master;
        GRANT USAGE ON SEQUENCE "ORDERS-batches_id_seq" TO master;
        GRANT USAGE ON SEQUENCE "ORDERS-batch-history_id_seq" TO master;
        GRANT USAGE ON SEQUENCE "ORDERS-product-categories_id_seq" TO master;
    END IF;
END $$;

-- =============================================
-- COMPLETION MESSAGE
-- =============================================
DO $$
BEGIN
    RAISE NOTICE 'Module 3 database schema created successfully!';
    RAISE NOTICE 'Tables created: ORDERS-batches, ORDERS-batch-history, ORDERS-product-categories';
    RAISE NOTICE 'ORDERS-products table extended with new columns';
    RAISE NOTICE 'All indexes and triggers created';
    RAISE NOTICE 'Sample product categories inserted';
END $$;

