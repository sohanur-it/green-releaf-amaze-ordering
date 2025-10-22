-- METRC Batch Extraction Query
-- This query transforms raw METRC package data into sellable batches
-- It implements the business logic described in Module 3 requirements

WITH filtered_packages AS (
    -- Step 1: Filter base packages with business rules
    SELECT *,
           trim(split_part(sourcepackagelabels, ',', 1)) AS first_sourcepackage_label
    FROM activepackages
    WHERE sync_license IN ('CUL000063', 'MAN000072')
      AND isarchived = false
      AND isfinished = false
      AND quantity > 0
      AND item_productcategoryname ilike '%final packaging%'
      AND item_name IS NOT NULL
      AND item_name != ''
      AND sourcepackagelabels IS NOT NULL
      AND sourcepackagelabels != ''
      -- CRITICAL: Must have M-number approval code (M followed by at least 8 digits)
      AND item_name ~ 'M\d{8,}'
),

thc_results AS (
    -- Step 2: Get lab results for THC percentage
    SELECT DISTINCT ON (plr.package_metrcid, plr.synclicense) 
           plr.package_metrcid,
           plr.synclicense,
           (test_item->>'testResultLevel')::numeric AS thc_percentage
    FROM packagelabresults plr
    JOIN jsonb_array_elements(plr.tests_json) AS test_item ON true
    WHERE plr.synclicense IN ('CUL000063', 'MAN000072')
      AND plr.overall_passed = true
      AND test_item->>'testTypeName' = 'Total Delta-9 THC (%) Mandatory Cannabinoid % and Totals'
      AND (test_item->>'testResultLevel')::numeric IS NOT NULL
    ORDER BY plr.package_metrcid,
             plr.synclicense,
             plr.result_release_date_time DESC nulls last,
             plr.lab_test_result_last_modified DESC nulls last
),

test_dates AS (
    -- Step 3: Get test dates for each package
    SELECT DISTINCT ON (plr.package_metrcid, plr.synclicense)
           plr.package_metrcid,
           plr.synclicense,
           plr.result_release_date_time AS test_date
    FROM packagelabresults plr
    WHERE plr.synclicense IN ('CUL000063', 'MAN000072')
      AND plr.overall_passed = true
      AND plr.result_release_date_time IS NOT NULL
    ORDER BY plr.package_metrcid,
             plr.synclicense,
             plr.result_release_date_time DESC
),

packages_with_items AS (
    -- Step 4: Determine package type & full vs partial
    SELECT fp.*,
           i.unit_weight_grams,
           i.unit_count,
           -- Classify package type
           CASE
               WHEN fp.item_productcategoryname ilike ANY (array[
                   '%Bud/Flower%(Final Packaging)%', 
                   '%Shake/Trim%(Final Packaging)%',
                   '%Ground%Bud/Flower%(Final Packaging)%', 
                   '%Ground%Shake/Trim%(Final Packaging)%'
               ]) THEN 'weight_based'
               ELSE 'unit_based'
           END AS package_type,
           -- Calculate expected full package size
           CASE
               WHEN fp.item_productcategoryname ilike ANY (array[
                   '%Bud/Flower%(Final Packaging)%',
                   '%Shake/Trim%(Final Packaging)%', 
                   '%Ground%Bud/Flower%(Final Packaging)%', 
                   '%Ground%Shake/Trim%(Final Packaging)%'
               ]) THEN i.unit_weight_grams * i.unit_count
               ELSE i.unit_count::numeric
           END AS expected_full_package_size,
           -- Missing data flags
           CASE WHEN i.name IS NULL THEN true ELSE false END AS items_table_missing,
           CASE WHEN i.unit_weight_grams IS NULL THEN true ELSE false END AS unit_weight_grams_missing,
           CASE WHEN i.unit_count IS NULL THEN true ELSE false END AS unit_count_missing
    FROM filtered_packages fp
    LEFT JOIN items i ON fp.item_name = i.name AND i.historical = false
),

packages_classified AS (
    -- Step 5: Classify packages as full or partial
    SELECT *,
           CASE
               -- If items data is missing, assume full package (fail-safe)
               WHEN items_table_missing = true
                    OR unit_weight_grams_missing = true
                    OR unit_count_missing = true THEN true
               -- For weight-based: quantity must exactly match expected weight
               WHEN package_type = 'weight_based'
                    AND quantity = expected_full_package_size THEN true
               -- For unit-based: quantity must exactly match unit count
               WHEN package_type = 'unit_based'
                    AND quantity = expected_full_package_size THEN true
               ELSE false
           END AS is_full_package
    FROM packages_with_items
),

batch_aggregation AS (
    -- Step 6: Aggregate packages into batches
    SELECT
        -- Batch identification
        pc.item_name AS name,
        pc.first_sourcepackage_label,
        concat(pc.first_sourcepackage_label, '_', pc.item_name) AS batch_name,
        pc.sourcepackagelabels,
        pc.item_productcategoryname,
        pc.sync_license,
        -- Package counts
        count(*) AS package_count,
        count(*) FILTER (WHERE is_full_package = true) AS full_package_count,
        count(*) FILTER (WHERE is_full_package = false) AS partial_package_count,
        -- Aggregated package details as JSONB
        jsonb_build_object(
            'labels', 
            jsonb_agg(DISTINCT pc.label ORDER BY pc.label)
        ) AS available_labels,
        jsonb_build_object(
            'full_packages', 
            jsonb_agg(
                jsonb_build_object('label', pc.label, 'quantity', pc.quantity) 
                ORDER BY pc.label
            ) FILTER (WHERE pc.is_full_package = true)
        ) AS full_package_details,
        jsonb_build_object(
            'partial_packages', 
            jsonb_agg(
                jsonb_build_object('label', pc.label, 'quantity', pc.quantity) 
                ORDER BY pc.label
            ) FILTER (WHERE pc.is_full_package = false)
        ) AS partial_package_details,
        -- Date information
        min(pc.packageddate) AS production_date,
        (min(pc.packageddate) + interval '1 year') AS calculated_best_by_date,
        max(pc.lastmodified) AS last_modified,
        -- Location
        max(pc.locationname) AS storage_location,
        -- Data quality flags
        bool_or(items_table_missing) AS items_table_missing,
        bool_or(unit_weight_grams_missing) AS unit_weight_grams_missing,
        bool_or(unit_count_missing) AS unit_count_missing,
        -- Business quantity: ONLY full packages
        count(*) FILTER (WHERE is_full_package = true) AS quantity
    FROM packages_classified pc
    GROUP BY pc.item_name,
             pc.first_sourcepackage_label,
             pc.sourcepackagelabels,
             pc.item_productcategoryname,
             pc.sync_license
)

-- Final output with THC data
SELECT 
    ba.batch_name,
    ba.name,
    ba.first_sourcepackage_label,
    ba.sourcepackagelabels,
    ba.package_count,
    ba.quantity, -- Full packages only
    ba.full_package_count,
    ba.partial_package_count,
    ba.available_labels,
    ba.full_package_details,
    ba.partial_package_details,
    -- THC percentage (averaged across all packages in batch)
    avg(tr.thc_percentage) AS thc_percentage,
    -- Dates
    ba.production_date,
    max(td.test_date) AS test_date,
    ba.calculated_best_by_date AS best_by_date,
    ba.last_modified,
    -- Product and location
    ba.item_productcategoryname,
    ba.sync_license,
    ba.storage_location,
    -- Missing data flags
    ba.items_table_missing,
    ba.unit_weight_grams_missing,
    ba.unit_count_missing
FROM batch_aggregation ba
LEFT JOIN packages_classified pc ON ba.name = pc.item_name
    AND ba.first_sourcepackage_label = pc.first_sourcepackage_label
    AND ba.sync_license = pc.sync_license
LEFT JOIN thc_results tr ON pc.metrcid = tr.package_metrcid
    AND pc.sync_license = tr.synclicense
LEFT JOIN test_dates td ON pc.metrcid = td.package_metrcid
    AND pc.sync_license = td.synclicense
GROUP BY ba.batch_name,
         ba.name,
         ba.first_sourcepackage_label,
         ba.sourcepackagelabels,
         ba.package_count,
         ba.quantity,
         ba.full_package_count,
         ba.partial_package_count,
         ba.available_labels,
         ba.full_package_details,
         ba.partial_package_details,
         ba.production_date,
         ba.calculated_best_by_date,
         ba.last_modified,
         ba.item_productcategoryname,
         ba.sync_license,
         ba.storage_location,
         ba.items_table_missing,
         ba.unit_weight_grams_missing,
         ba.unit_count_missing
ORDER BY ba.name, ba.first_sourcepackage_label;