-- Create Order Items Table (Module 4 Preview)
-- This table tracks which batches are allocated to which orders

CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    batch_id INTEGER NOT NULL REFERENCES "ORDERS-batches"(id) ON DELETE CASCADE,
    requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
    allocated_quantity INTEGER NOT NULL DEFAULT 0,
    fulfilled_quantity INTEGER NOT NULL DEFAULT 0,
    unit_price NUMERIC(10, 2),
    total_price NUMERIC(10, 2),
    
    -- Tracking
    allocated_at TIMESTAMPTZ,
    fulfilled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(order_id, batch_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_batch_id ON order_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items(allocated_at, fulfilled_at);

-- Add updated_at trigger
CREATE TRIGGER update_order_items_updated_at
    BEFORE UPDATE ON order_items
    FOR EACH ROW
    EXECUTE FUNCTION update_orders_updated_at();

-- Grant permissions (conditional on role existence)
DO $$
BEGIN
    -- Grant to postgres if it exists (local development)
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON order_items TO postgres;
        GRANT USAGE ON SEQUENCE order_items_id_seq TO postgres;
    END IF;
    
    -- Grant to master if it exists (production RDS)
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'master') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON order_items TO master;
        GRANT USAGE ON SEQUENCE order_items_id_seq TO master;
    END IF;
END $$;

-- Add comments
COMMENT ON TABLE order_items IS 'Links orders to batches that have been allocated';
COMMENT ON COLUMN order_items.requested_quantity IS 'Number of units requested by the order';
COMMENT ON COLUMN order_items.allocated_quantity IS 'Number of units actually allocated (may be less than requested if insufficient inventory)';
COMMENT ON COLUMN order_items.fulfilled_quantity IS 'Number of units that have been physically fulfilled/shipped';

