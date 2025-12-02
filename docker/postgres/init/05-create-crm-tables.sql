-- CRM Tables Creation Script
-- Creates all necessary tables for the CRM system

-- Create buyer stages table
CREATE TABLE IF NOT EXISTS "ORDERS-buyer_stages" (
    entry_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) DEFAULT '#007bff',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create deal flows table
CREATE TABLE IF NOT EXISTS "ORDERS-deal_flows" (
    entry_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create sales reps table
CREATE TABLE IF NOT EXISTS "ORDERS-sales_reps" (
    entry_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create buyers table
CREATE TABLE IF NOT EXISTS "ORDERS-buyers" (
    entry_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    website_url VARCHAR(500),
    buyer_type VARCHAR(50),
    zone VARCHAR(100),
    fk_stage_id INTEGER REFERENCES "ORDERS-buyer_stages"(entry_id),
    fk_deal_flow_id INTEGER REFERENCES "ORDERS-deal_flows"(entry_id),
    source VARCHAR(50) DEFAULT 'INTERNAL',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create buyer contacts table
CREATE TABLE IF NOT EXISTS "ORDERS-buyer_contacts" (
    entry_id SERIAL PRIMARY KEY,
    orders_buyer_id INTEGER NOT NULL REFERENCES "ORDERS-buyers"(entry_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    title VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create buyer locations table
CREATE TABLE IF NOT EXISTS "ORDERS-buyer_locations" (
    entry_id SERIAL PRIMARY KEY,
    orders_buyer_id INTEGER NOT NULL REFERENCES "ORDERS-buyers"(entry_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create buyer notes table
CREATE TABLE IF NOT EXISTS "ORDERS-buyer_notes" (
    entry_id SERIAL PRIMARY KEY,
    orders_buyer_id INTEGER NOT NULL REFERENCES "ORDERS-buyers"(entry_id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create buyer tags table
CREATE TABLE IF NOT EXISTS "ORDERS-buyer_tags" (
    entry_id SERIAL PRIMARY KEY,
    orders_buyer_id INTEGER NOT NULL REFERENCES "ORDERS-buyers"(entry_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) DEFAULT '#007bff',
    background_color VARCHAR(7) DEFAULT '#e3f2fd',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create buyer sales rep assignments table
CREATE TABLE IF NOT EXISTS "ORDERS-buyer_sales_rep_assignments" (
    entry_id SERIAL PRIMARY KEY,
    fk_buyer_id INTEGER NOT NULL REFERENCES "ORDERS-buyers"(entry_id) ON DELETE CASCADE,
    fk_sales_rep_id INTEGER NOT NULL REFERENCES "ORDERS-sales_reps"(entry_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(fk_buyer_id, fk_sales_rep_id)
);

-- Insert default buyer stages
INSERT INTO "ORDERS-buyer_stages" (name, color, sort_order) VALUES
    ('Lead', '#28a745', 1),
    ('Qualified', '#17a2b8', 2),
    ('Proposal', '#ffc107', 3),
    ('Negotiation', '#fd7e14', 4),
    ('Closed Won', '#28a745', 5),
    ('Closed Lost', '#dc3545', 6)
ON CONFLICT DO NOTHING;

-- Insert default deal flows
INSERT INTO "ORDERS-deal_flows" (name, description) VALUES
    ('Standard', 'Standard sales process'),
    ('Quick Close', 'Fast-track sales process'),
    ('Enterprise', 'Enterprise sales process')
ON CONFLICT DO NOTHING;

-- Insert sample sales rep
INSERT INTO "ORDERS-sales_reps" (name, email, phone) VALUES
    ('John Doe', 'john@greenreleaf.com', '555-0123'),
    ('Jane Smith', 'jane@greenreleaf.com', '555-0124')
ON CONFLICT DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_buyers_stage_id ON "ORDERS-buyers"(fk_stage_id);
CREATE INDEX IF NOT EXISTS idx_buyers_deal_flow_id ON "ORDERS-buyers"(fk_deal_flow_id);
CREATE INDEX IF NOT EXISTS idx_buyer_contacts_buyer_id ON "ORDERS-buyer_contacts"(orders_buyer_id);
CREATE INDEX IF NOT EXISTS idx_buyer_locations_buyer_id ON "ORDERS-buyer_locations"(orders_buyer_id);
CREATE INDEX IF NOT EXISTS idx_buyer_notes_buyer_id ON "ORDERS-buyer_notes"(orders_buyer_id);
CREATE INDEX IF NOT EXISTS idx_buyer_tags_buyer_id ON "ORDERS-buyer_tags"(orders_buyer_id);
CREATE INDEX IF NOT EXISTS idx_buyer_sales_rep_assignments_buyer_id ON "ORDERS-buyer_sales_rep_assignments"(fk_buyer_id);
CREATE INDEX IF NOT EXISTS idx_buyer_sales_rep_assignments_sales_rep_id ON "ORDERS-buyer_sales_rep_assignments"(fk_sales_rep_id);
