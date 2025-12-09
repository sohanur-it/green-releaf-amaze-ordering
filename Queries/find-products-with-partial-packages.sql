-- Find products that have batches with partial packages
-- Useful for testing the partial package selection feature

SELECT 
    p.entry_id as product_id,
    p.name as product_name,
    p.brand_name,
    p.product_type_name,
    b.id as batch_id,
    b.batch_name,
    b.partial_package_count,
    b.quantity as batch_quantity,
    b.allocated_quantity,
    (b.quantity - b.allocated_quantity) as available_quantity,
    b.status as batch_status,
    b.partial_package_details
FROM "ORDERS-products" p
INNER JOIN "ORDERS-batches" b ON p.entry_id = b.fk_master_product_id
WHERE b.partial_package_count > 0
  AND b.status = 'Sellable'
  AND (b.quantity - b.allocated_quantity) > 0
ORDER BY p.name, b.batch_name;

-- To see just the product names (grouped):
-- SELECT DISTINCT
--     p.entry_id as product_id,
--     p.brand_name || ' ' || p.name as product_full_name,
--     COUNT(b.id) as batches_with_partials
-- FROM "ORDERS-products" p
-- INNER JOIN "ORDERS-batches" b ON p.entry_id = b.fk_master_product_id
-- WHERE b.partial_package_count > 0
--   AND b.status = 'Sellable'
--   AND (b.quantity - b.allocated_quantity) > 0
-- GROUP BY p.entry_id, p.brand_name, p.name
-- ORDER BY p.name;

