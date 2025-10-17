-- Create orders table with manifest support
-- This table stores order information and manifest details

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    order_date TIMESTAMP NOT NULL DEFAULT NOW(),
    status VARCHAR(50) NOT NULL DEFAULT 'Draft',
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    
    -- Manifest related columns
    manifest_number VARCHAR(100),
    manifested_at TIMESTAMP,
    manifested_by INTEGER REFERENCES users(id),
    
    -- Audit columns
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_name ON orders(customer_name);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_manifest_number ON orders(manifest_number);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_orders_updated_at();

-- Add comments for documentation
COMMENT ON TABLE orders IS 'Orders table with manifest creation support';
COMMENT ON COLUMN orders.status IS 'Order status: Draft, Approved for Fulfillment, Manifested, Shipped, Delivered';
COMMENT ON COLUMN orders.manifest_number IS 'METRC manifest number after creation';
COMMENT ON COLUMN orders.manifested_at IS 'When the manifest was created';
COMMENT ON COLUMN orders.manifested_by IS 'User who created the manifest';
