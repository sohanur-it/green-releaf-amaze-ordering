-- Module 4: Order Creation & Management (The Invoice Engine)
-- Complete database schema for invoice/invoice system
-- This script creates all tables, types, indexes, and triggers for Module 4

-- =====================================================
-- 1. Create ENUM Types
-- =====================================================

-- Invoice status enum
DO $$ BEGIN
    CREATE TYPE invoice_status AS ENUM (
        'Draft',                    -- External: in cart, not submitted
        'Pending_Approval',         -- External: submitted, awaiting sales rep
        'Approved',                 -- Ready for fulfillment
        'Fulfillment_Accepted',     -- Fulfillment team claimed it
        'Fulfillment_Issue',        -- Problem reported by fulfillment
        'Manifested',               -- METRC manifest created
        'Shipped',                  -- In transit
        'Delivered',                -- Received by customer
        'Partially_Rejected',       -- Some items rejected by customer
        'Fully_Rejected',           -- Entire shipment rejected
        'Cancelled',                -- Cancelled before ship
        'Cancelled_After_Ship',     -- Cancelled post-ship (needs inventory recovery)
        'Issue_After_Shipped',     -- Problem reported post-delivery
        'Paid'                      -- Final state
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Invoice source enum
DO $$ BEGIN
    CREATE TYPE invoice_source AS ENUM ('Internal', 'External');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Discount type enum
DO $$ BEGIN
    CREATE TYPE discount_type AS ENUM ('Percentage', 'Fixed_Amount', 'BOGO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Modification type enum
DO $$ BEGIN
    CREATE TYPE modification_type AS ENUM (
        'line_item_added',
        'line_item_removed',
        'line_item_quantity_changed',
        'discount_applied',
        'discount_removed',
        'credit_applied',
        'status_changed',
        'fulfillment_issue_reported',
        'fulfillment_issue_resolved',
        'cancelled',
        'cloned_from',
        'metrc_allocation_conflict'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- 2. Create Invoices Table (The Hub)
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-invoices" (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) UNIQUE NOT NULL, -- e.g., "INV-2025-00123"
    
    -- Customer Information
    fk_buyer_id INTEGER NOT NULL REFERENCES "ORDERS-buyers"(entry_id),
    fk_location_id INTEGER NOT NULL,     -- Which dispensary location
    location_license_number VARCHAR(50) NOT NULL, -- For METRC manifest
    
    -- Source & Ownership
    source invoice_source NOT NULL,
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    assigned_sales_rep_id INTEGER REFERENCES users(id), -- Who manages this invoice
    
    -- Status & Lifecycle
    status invoice_status NOT NULL DEFAULT 'Draft',
    status_updated_at TIMESTAMPTZ,
    
    -- Financial Totals
    subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    credit_applied NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    
    -- Shopping Cart Management (External orders only)
    cart_created_at TIMESTAMPTZ,
    cart_expires_at TIMESTAMPTZ,
    cart_extended BOOLEAN DEFAULT false, -- Can only extend once
    
    -- Purchase Limits (External validation)
    purchase_limit_validated BOOLEAN DEFAULT false,
    outstanding_invoice_count_at_creation INTEGER,
    
    -- Approval Tracking
    approved_at TIMESTAMPTZ,
    approved_by_user_id INTEGER REFERENCES users(id),
    
    -- Fulfillment Tracking
    fulfillment_accepted_at TIMESTAMPTZ,
    fulfillment_accepted_by INTEGER REFERENCES users(id),
    fulfillment_issue_reported_at TIMESTAMPTZ,
    fulfillment_issue_note TEXT,
    
    -- Manifest & Shipping
    metrc_manifest_number VARCHAR(100),
    manifest_created_at TIMESTAMPTZ,
    shipped_at TIMESTAMPTZ,
    estimated_delivery TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    
    -- Payment
    paid_at TIMESTAMPTZ,
    payment_method VARCHAR(50),
    quickbooks_invoice_id VARCHAR(100), -- For Module 6 integration
    
    -- Metadata
    internal_notes TEXT,
    customer_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Critical indexes
CREATE INDEX IF NOT EXISTS idx_invoices_buyer ON "ORDERS-invoices" (fk_buyer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_location ON "ORDERS-invoices" (fk_location_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON "ORDERS-invoices" (status);
CREATE INDEX IF NOT EXISTS idx_invoices_sales_rep ON "ORDERS-invoices" (assigned_sales_rep_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON "ORDERS-invoices" (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_cart_expiry ON "ORDERS-invoices" (cart_expires_at) 
    WHERE status = 'Draft' AND source = 'External';
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON "ORDERS-invoices" (invoice_number);

-- Update timestamp trigger
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON "ORDERS-invoices" 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 3. Create Standing Discounts Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "orders-standing-discounts" (
    id SERIAL PRIMARY KEY,
    
    -- Scope
    fk_location_id INTEGER NOT NULL,      -- Which dispensary gets this discount
    fk_master_product_id INTEGER NOT NULL REFERENCES "ORDERS-products"(entry_id),
    
    -- Discount Configuration
    discount_type discount_type NOT NULL,
    discount_value NUMERIC(10, 2) NOT NULL,  -- 15.00 for 15%, or dollar amount
    
    -- BOGO Specific
    bogo_buy_quantity INTEGER,      -- Buy X
    bogo_get_quantity INTEGER,      -- Get Y
    bogo_discount_percent NUMERIC(5, 2),  -- % off the Y items (often 100% = free)
    
    -- Validity Period
    valid_from DATE,
    valid_until DATE,
    is_active BOOLEAN DEFAULT true,
    
    -- Metadata
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_standing_discounts_location_product 
    ON "orders-standing-discounts"(fk_location_id, fk_master_product_id);
CREATE INDEX IF NOT EXISTS idx_standing_discounts_active 
    ON "orders-standing-discounts"(is_active) WHERE is_active = true;

-- =====================================================
-- 4. Create Invoice Line Items Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-invoice-line-items" (
    id SERIAL PRIMARY KEY,
    fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id) ON DELETE CASCADE,
    
    -- Product & Batch Reference
    fk_master_product_id INTEGER NOT NULL REFERENCES "ORDERS-products"(entry_id),
    fk_batch_id INTEGER NOT NULL REFERENCES "ORDERS-batches"(id),
    
    -- Quantities
    quantity_ordered INTEGER NOT NULL,  -- What they want
    quantity_allocated INTEGER NOT NULL DEFAULT 0,  -- Reserved from batch
    quantity_fulfilled INTEGER DEFAULT 0,  -- What actually shipped (set during manifest)
    
    -- Pricing (locked at line item creation)
    unit_price NUMERIC(10, 2) NOT NULL,
    line_discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    line_total NUMERIC(10, 2) NOT NULL,
    
    -- Discount Tracking
    standing_discount_applied BOOLEAN DEFAULT false,
    standing_discount_id INTEGER REFERENCES "orders-standing-discounts"(id),
    manual_discount_applied BOOLEAN DEFAULT false,
    manual_discount_reason TEXT,
    
    -- Credit Proportioning (calculated when credit applied to invoice)
    credit_portion NUMERIC(10, 2) DEFAULT 0.00,
    
    -- Fulfillment Package Assignment (populated during scanning)
    assigned_package_labels JSONB,  -- Array of METRC package tags actually used during fulfillment
    
    -- NEW: Partial Package Specific Selection
    specific_package_labels JSONB DEFAULT NULL,
    -- For partial packages ONLY: JSONB array of specific package labels sales rep selected
    -- Example: ["1A40E0100000067000001234", "1A40E0100000067000001235"]
    -- NULL = any full packages from batch acceptable (standard behavior)
    -- NOT NULL = fulfillment MUST scan these exact labels (partial package requirement)
    
    -- Modification Tracking
    was_modified BOOLEAN DEFAULT false,
    original_quantity INTEGER,  -- Store original if modified post-approval
    modification_reason TEXT,
    modified_at TIMESTAMPTZ,
    modified_by INTEGER REFERENCES users(id),
    
    -- Metadata
    line_item_order INTEGER NOT NULL,  -- Display order
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_items_invoice ON "ORDERS-invoice-line-items"(fk_invoice_id);
CREATE INDEX IF NOT EXISTS idx_line_items_batch ON "ORDERS-invoice-line-items"(fk_batch_id);
CREATE INDEX IF NOT EXISTS idx_line_items_product ON "ORDERS-invoice-line-items"(fk_master_product_id);

-- Index for querying line items with specific package requirements
CREATE INDEX IF NOT EXISTS idx_line_items_specific_packages ON "ORDERS-invoice-line-items"(fk_invoice_id) 
    WHERE specific_package_labels IS NOT NULL;

COMMENT ON COLUMN "ORDERS-invoice-line-items".specific_package_labels IS 
    'For partial packages: JSONB array of specific package labels sales rep selected. 
     Example: ["1A40E0100000067000001234", "1A40E0100000067000001235"] 
     NULL for full package line items (any full package from batch is acceptable). 
     When NOT NULL, fulfillment scanning MUST validate against these exact labels. 
     This prevents substitution of partial packages which have non-standard quantities.';

-- Update timestamp trigger
CREATE TRIGGER update_line_items_updated_at BEFORE UPDATE ON "ORDERS-invoice-line-items" 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 5. Create Account Credits Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "ORDERS-account-credits" (
    id SERIAL PRIMARY KEY,
    fk_location_id INTEGER NOT NULL,  -- Credits are location-specific
    
    -- Credit Details
    credit_amount NUMERIC(10, 2) NOT NULL,
    remaining_balance NUMERIC(10, 2) NOT NULL,
    
    -- Issuance
    issued_by INTEGER NOT NULL REFERENCES users(id),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason TEXT NOT NULL,
    related_invoice_id INTEGER REFERENCES "ORDERS-invoices"(id),  -- If issued due to problem
    
    -- Expiration
    expires_at TIMESTAMPTZ,
    is_expired BOOLEAN DEFAULT false,
    
    -- Status
    is_fully_used BOOLEAN DEFAULT false,
    fully_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_credits_location ON "ORDERS-account-credits"(fk_location_id);
CREATE INDEX IF NOT EXISTS idx_credits_active ON "ORDERS-account-credits"(remaining_balance, is_expired, is_fully_used) 
    WHERE remaining_balance > 0 AND is_expired = false AND is_fully_used = false;
CREATE INDEX IF NOT EXISTS idx_credits_issued_at ON "ORDERS-account-credits"(issued_at ASC);

-- =====================================================
-- 6. Create Credit Applications Table (Audit Trail)
-- =====================================================

CREATE TABLE IF NOT EXISTS "orders-credit-applications" (
    id SERIAL PRIMARY KEY,
    fk_credit_id INTEGER NOT NULL REFERENCES "ORDERS-account-credits"(id),
    fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id),
    amount_applied NUMERIC(10, 2) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_apps_invoice ON "orders-credit-applications"(fk_invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_apps_credit ON "orders-credit-applications"(fk_credit_id);

-- =====================================================
-- 7. Create Purchase Limits Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "orders-purchase-limits" (
    id SERIAL PRIMARY KEY,
    fk_location_id INTEGER NOT NULL UNIQUE,  -- One set of limits per location
    
    -- Limits (NULL means use system defaults)
    max_order_total NUMERIC(10, 2) DEFAULT 20000.00,
    max_unshipped_orders INTEGER DEFAULT 3,
    max_unpaid_invoices INTEGER DEFAULT 6,
    
    -- Override Tracking
    last_modified_by INTEGER REFERENCES users(id),
    last_modified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_purchase_limits_location ON "orders-purchase-limits"(fk_location_id);

-- =====================================================
-- 8. Create Invoice Modification History Table
-- =====================================================

CREATE TABLE IF NOT EXISTS "orders-invoice-history" (
    id BIGSERIAL PRIMARY KEY,
    fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id) ON DELETE CASCADE,
    
    -- What Changed
    modification_type modification_type NOT NULL,
    field_name VARCHAR(100),  -- e.g., 'status', 'line_item_id_123'
    old_value TEXT,
    new_value TEXT,
    change_details JSONB,  -- Flexible storage for complex changes
    
    -- Context
    reason TEXT,
    triggered_by_fulfillment_issue BOOLEAN DEFAULT false,
    
    -- Who & When
    changed_by_user_id INTEGER REFERENCES users(id),
    changed_by_system BOOLEAN DEFAULT false,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_history_invoice ON "orders-invoice-history"(fk_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_history_timestamp ON "orders-invoice-history"(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_history_type ON "orders-invoice-history"(modification_type);
CREATE INDEX IF NOT EXISTS idx_invoice_history_fulfillment_issue ON "orders-invoice-history"(triggered_by_fulfillment_issue) 
    WHERE triggered_by_fulfillment_issue = true;

-- =====================================================
-- 9. Comments for Documentation
-- =====================================================

COMMENT ON TABLE "ORDERS-invoices" IS 'Main invoice hub - represents orders from creation through payment';
COMMENT ON TABLE "ORDERS-invoice-line-items" IS 'Line items linking invoices to specific batches with allocation tracking';
COMMENT ON TABLE "orders-standing-discounts" IS 'Pre-configured discount rules that auto-apply based on location and product';
COMMENT ON TABLE "ORDERS-account-credits" IS 'Location-specific credits for handling post-delivery issues';
COMMENT ON TABLE "orders-credit-applications" IS 'Audit trail of credit applications to invoices';
COMMENT ON TABLE "orders-purchase-limits" IS 'Per-location purchase limits for external portal orders';
COMMENT ON TABLE "orders-invoice-history" IS 'Complete audit trail of all invoice modifications';

DO $$
BEGIN
    RAISE NOTICE 'Module 4 core schema created successfully';
END $$;

