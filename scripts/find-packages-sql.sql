-- SQL Queries to Find Packages for Invoice 215
-- Run these directly in your production database

-- ============================================
-- 1. Check which license column exists
-- ============================================
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'activepackages' 
    AND column_name IN ('sync_license', 'synclicense')
LIMIT 1;

-- ============================================
-- 2. Get Invoice 215 Details
-- ============================================
SELECT 
    id, 
    invoice_number, 
    status, 
    fulfillment_accepted_by 
FROM "ORDERS-invoices" 
WHERE id = 215;

-- ============================================
-- 3. Get Line Items with Batch Info for Invoice 215
-- ============================================
SELECT 
    li.id as line_item_id,
    li.quantity_ordered,
    li.assigned_package_labels,
    li.specific_package_labels,
    b.batch_name,
    b.available_labels,
    b.full_package_details,
    b.partial_package_details,
    b.first_sourcepackage_label,
    p.name as product_name
FROM "ORDERS-invoice-line-items" li
JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
LEFT JOIN "ORDERS-products" p ON li.fk_master_product_id = p.entry_id
WHERE li.fk_invoice_id = 215
ORDER BY li.line_item_order;

-- ============================================
-- 4. Get Available Package Labels from Batch
-- ============================================
-- Replace 'YOUR_BATCH_NAME' with the actual batch name from query #3
-- Example: '1A40C03000049D5000093154_M00002207839: V2 Nugz 3.5g - Blue Burger'

SELECT 
    batch_name,
    available_labels->'labels' as package_labels,
    jsonb_array_length(available_labels->'labels') as total_packages
FROM "ORDERS-batches"
WHERE batch_name LIKE '%1A40C03000049D5000093154%';

-- ============================================
-- 5. Get Full Packages from Batch (for full package orders)
-- ============================================
SELECT 
    batch_name,
    full_package_details->'full_packages' as full_packages
FROM "ORDERS-batches"
WHERE batch_name LIKE '%1A40C03000049D5000093154%';

-- ============================================
-- 6. Check if Package "1A40C03000049D5000093154" exists in activepackages
-- ============================================
-- Use sync_license if in production, synclicense if in development

-- For PRODUCTION (use sync_license):
SELECT 
    label,
    item_name,
    quantity,
    sync_license,
    isarchived,
    isfinished,
    CASE 
        WHEN isarchived = true THEN 'Archived'
        WHEN isfinished = true THEN 'Finished'
        WHEN sync_license NOT IN ('CUL000063', 'MAN000072') THEN 'Wrong License'
        ELSE 'Active'
    END as status
FROM activepackages
WHERE label = '1A40C03000049D5000093154';

-- For DEVELOPMENT (use synclicense):
-- SELECT 
--     label,
--     item_name,
--     quantity,
--     synclicense,
--     isarchived,
--     isfinished,
--     CASE 
--         WHEN isarchived = true THEN 'Archived'
--         WHEN isfinished = true THEN 'Finished'
--         WHEN synclicense NOT IN ('CUL000063', 'MAN000072') THEN 'Wrong License'
--         ELSE 'Active'
--     END as status
-- FROM activepackages
-- WHERE label = '1A40C03000049D5000093154';

-- ============================================
-- 7. Find All Active Packages for Scanning (First 20)
-- ============================================
-- For PRODUCTION:
SELECT 
    label,
    item_name,
    quantity,
    sync_license
FROM activepackages
WHERE sync_license IN ('CUL000063', 'MAN000072')
    AND isarchived = false
    AND isfinished = false
ORDER BY label
LIMIT 20;

-- For DEVELOPMENT (uncomment if needed):
-- SELECT 
--     label,
--     item_name,
--     quantity,
--     synclicense
-- FROM activepackages
-- WHERE synclicense IN ('CUL000063', 'MAN000072')
--     AND isarchived = false
--     AND isfinished = false
-- ORDER BY label
-- LIMIT 20;

-- ============================================
-- 8. Get Packages from Batch's available_labels (JSONB extraction)
-- ============================================
SELECT 
    batch_name,
    jsonb_array_elements_text(available_labels->'labels') as package_label
FROM "ORDERS-batches"
WHERE batch_name LIKE '%1A40C03000049D5000093154%'
LIMIT 50;

