-- Product Images Schema
-- This script creates the table for storing product images

-- =============================================
-- 1. CREATE PRODUCT IMAGES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS "ORDERS-product-images" (
    id SERIAL PRIMARY KEY,
    fk_product_id INTEGER NOT NULL REFERENCES "ORDERS-products"(entry_id) ON DELETE CASCADE,
    
    -- Image Information
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL, -- Size in bytes
    mime_type VARCHAR(100) NOT NULL,
    
    -- Display Order
    display_order INTEGER NOT NULL DEFAULT 0, -- First image (order 0) is primary/featured
    
    -- Metadata
    alt_text TEXT, -- For accessibility
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Soft delete
    is_deleted BOOLEAN DEFAULT false,
    deleted_at TIMESTAMPTZ,
    deleted_by INTEGER REFERENCES users(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_product_images_product ON "ORDERS-product-images"(fk_product_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_product_images_display_order ON "ORDERS-product-images"(fk_product_id, display_order) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_product_images_primary ON "ORDERS-product-images"(fk_product_id, display_order) WHERE is_deleted = false AND display_order = 0;

-- Comments for documentation
COMMENT ON TABLE "ORDERS-product-images" IS 'Stores product images. First image (display_order = 0) is the primary/featured image shown in external portal.';
COMMENT ON COLUMN "ORDERS-product-images".display_order IS 'Display order for images. 0 = primary/featured image, 1+ = additional images. Lower numbers appear first.';
COMMENT ON COLUMN "ORDERS-product-images".file_path IS 'Relative path from public directory, e.g., "product/images/filename.jpg"';

