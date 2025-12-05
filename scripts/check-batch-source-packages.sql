-- Check for batches with missing source packages
SELECT 
    b.id,
    b.batch_name,
    b.metrc_item_name,
    b.first_sourcepackage_label,
    b.sourcepackagelabels,
    b.quantity,
    b.status,
    p.name as product_name,
    -- Check if source package exists
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM activepackages 
            WHERE label = b.first_sourcepackage_label
            AND isarchived = false
            AND isfinished = false
        ) THEN 'EXISTS'
        ELSE 'MISSING'
    END as source_package_status,
    -- Check if any packages from sourcepackagelabels exist
    (
        SELECT COUNT(*) 
        FROM activepackages 
        WHERE label = ANY(string_to_array(b.sourcepackagelabels, ','))
        AND isarchived = false
        AND isfinished = false
    ) as existing_package_count
FROM "ORDERS-batches" b
LEFT JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
WHERE b.first_sourcepackage_label = '1A40C03000049D5000093082'
   OR b.batch_name LIKE '%1A40C03000049D5000093082%'
   OR b.sourcepackagelabels LIKE '%1A40C03000049D5000093082%'
ORDER BY b.id DESC;
