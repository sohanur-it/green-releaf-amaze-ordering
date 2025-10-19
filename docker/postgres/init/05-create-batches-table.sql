-- Create batches table for batch status management
-- This table stores batch information and status tracking

CREATE TABLE IF NOT EXISTS batches (
    id SERIAL PRIMARY KEY,
    batch_number VARCHAR(100) NOT NULL UNIQUE,
    product_id INTEGER NOT NULL,
    quantity DECIMAL(10,3) NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'On Deck',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    notes TEXT,
    metadata JSONB
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS "idx_batches_product_id" ON batches(product_id);
CREATE INDEX IF NOT EXISTS "idx_batches_status" ON batches(status);
CREATE INDEX IF NOT EXISTS "idx_batches_created_at" ON batches(created_at);
CREATE INDEX IF NOT EXISTS "idx_batches_updated_at" ON batches(updated_at);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_batches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_batches_updated_at
    BEFORE UPDATE ON batches
    FOR EACH ROW
    EXECUTE FUNCTION update_batches_updated_at();

-- Add comments for documentation
COMMENT ON TABLE batches IS 'Batch inventory tracking with status management';
COMMENT ON COLUMN batches.batch_number IS 'Unique batch identifier';
COMMENT ON COLUMN batches.product_id IS 'Reference to product this batch belongs to';
COMMENT ON COLUMN batches.quantity IS 'Available quantity in this batch';
COMMENT ON COLUMN batches.status IS 'Current status: On Deck, Sellable, On Hold, Sold, Destroyed';
COMMENT ON COLUMN batches.created_by IS 'User who created this batch';
COMMENT ON COLUMN batches.updated_by IS 'User who last updated this batch';
COMMENT ON COLUMN batches.metadata IS 'Additional batch information in JSON format';

-- Insert some sample data for testing
INSERT INTO batches (batch_number, product_id, quantity, status, notes) VALUES
('BATCH-001', 1, 100.0, 'Sellable', 'Initial inventory batch'),
('BATCH-002', 1, 50.0, 'On Deck', 'Ready for promotion when inventory depleted'),
('BATCH-003', 1, 75.0, 'On Deck', 'Secondary batch for promotion'),
('BATCH-004', 2, 200.0, 'Sellable', 'Product 2 inventory'),
('BATCH-005', 2, 30.0, 'On Deck', 'Product 2 On Deck batch'),
('BATCH-006', 1, 25.0, 'On Hold', 'Quality control hold'),
('BATCH-007', 3, 150.0, 'Sellable', 'Product 3 inventory')
ON CONFLICT (batch_number) DO NOTHING;
