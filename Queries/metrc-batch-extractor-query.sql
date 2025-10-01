-- METRC Batch Extractor Query
--extracts unique batches from METRC inventory with full/partial package detection
--filters for Final Packaging items ready to be sold with M-number approval codes

WITH
--step 1: lets filter the base packages for Final Packaging with the M-number approval codes
filtered_packages AS (
    SELECT *,
           TRIM(SPLIT_PART(sourcepackagelabels, ',', 1)) AS first_sourcepackage_label
    FROM activepackages
    WHERE synclicense IN ('CUL000063', 'MAN000072')
      AND isarchived = false
      AND isfinished = false
      AND quantity > 0
      AND item_productcategoryname ILIKE '%final packaging%'
      AND item_name IS NOT NULL
      AND item_name != ''
      AND sourcepackagelabels IS NOT NULL
      AND sourcepackagelabels != ''
      --MUST have M-number approval code (M followed by at least 8 digits)
      AND item_name ~ 'M\d{8,}'
),

--Step 2: Get THC results, must be parsed from the JSONB
thc_results AS (
    SELECT DISTINCT ON (plr.package_metrcid, plr.synclicense)
        plr.package_metrcid,
        plr.synclicense,
        (test_item->>'testResultLevel')::numeric AS thc_percentage
    FROM packagelabresults plr
             JOIN jsonb_array_elements(plr.tests_json) AS test_item ON TRUE
    WHERE plr.synclicense IN ('CUL000063', 'MAN000072')
      AND plr.overall_passed = TRUE
      AND test_item->>'testTypeName' = 'Total Delta-9 THC (%) Mandatory Cannabinoid % and Totals'
      AND (test_item->>'testResultLevel')::numeric IS NOT NULL
    ORDER BY plr.package_metrcid,
             plr.synclicense,
             plr.result_release_date_time DESC NULLS LAST,
             plr.lab_test_result_last_modified DESC NULLS LAST
),

--Step 3: Get test dates
test_dates AS (
    SELECT DISTINCT ON (plr.package_metrcid, plr.synclicense)
        plr.package_metrcid,
        plr.synclicense,
        plr.result_release_date_time AS test_date
    FROM packagelabresults plr
    WHERE plr.synclicense IN ('CUL000063', 'MAN000072')
      AND plr.overall_passed = TRUE
    ORDER BY plr.package_metrcid,
             plr.synclicense,
             plr.result_release_date_time DESC NULLS LAST
),

--step 4: Join with items table to get unit specifications
packages_with_items AS (
    SELECT
        fp.*,
        i.unit_weight_grams,
        i.unit_count,
        --determine if this category is weight-based or unit-based
        CASE
            WHEN fp.item_productcategoryname ILIKE ANY (ARRAY[
                '%Bud/Flower%(Final Packaging)%',
                '%Shake/Trim%(Final Packaging)%',
                '%Ground%Bud/Flower%(Final Packaging)%',
                '%Ground%Shake/Trim%(Final Packaging)%'
                ]) THEN 'weight_based'
            ELSE 'unit_based'
            END AS package_type,

        --calculate expected full package size
        CASE
            WHEN fp.item_productcategoryname ILIKE ANY (ARRAY[
                '%Bud/Flower%(Final Packaging)%',
                '%Shake/Trim%(Final Packaging)%',
                '%Ground%Bud/Flower%(Final Packaging)%',
                '%Ground%Shake/Trim%(Final Packaging)%'
                ]) THEN i.unit_weight_grams * i.unit_count
            ELSE i.unit_count::numeric
            END AS expected_full_package_size,

        --flags for missing data
        CASE WHEN i.name IS NULL THEN true ELSE false END AS items_table_missing,
        CASE WHEN i.unit_weight_grams IS NULL THEN true ELSE false END AS unit_weight_grams_missing,
        CASE WHEN i.unit_count IS NULL THEN true ELSE false END AS unit_count_missing

    FROM filtered_packages fp
             LEFT JOIN items i ON fp.item_name = i.name AND i.historical = false
),

--step 5: Determine full vs partial packages
packages_classified AS (
    SELECT *,
           CASE
               --if items table data is missing, assume it's a full package
               WHEN items_table_missing = true OR unit_weight_grams_missing = true OR unit_count_missing = true
                   THEN true

               --for weight-based categories: quantity must exactly match expected weight
               WHEN package_type = 'weight_based' AND quantity = expected_full_package_size
                   THEN true

               --for unit-based categories: quantity must exactly match unit count
               WHEN package_type = 'unit_based' AND quantity = expected_full_package_size
                   THEN true

               ELSE false
               END AS is_full_package

    FROM packages_with_items
),

--step 6: Aggregate by batch (item_name, first_sourcepackage_label, synclicense)
batch_aggregation AS (
    SELECT
        --batch identification
        pc.item_name AS name,
        pc.first_sourcepackage_label,
        CONCAT(pc.first_sourcepackage_label, '_', pc.item_name) AS batch_name,
        pc.sourcepackagelabels,
        pc.item_productcategoryname,
        pc.synclicense,

        --package counts
        COUNT(*) AS package_count,
        COUNT(*) FILTER (WHERE is_full_package = true) AS full_package_count,
        COUNT(*) FILTER (WHERE is_full_package = false) AS partial_package_count,

        --aggregated labels as JSONB - separate for full and partial packages
        jsonb_build_object('labels',
                           jsonb_agg(DISTINCT pc.label ORDER BY pc.label)
        ) AS available_labels,

        --full packages with their labels and quantities
        jsonb_build_object('full_packages',
                           jsonb_agg(
                               jsonb_build_object('label', pc.label, 'quantity', pc.quantity)
                               ORDER BY pc.label
                           ) FILTER (WHERE pc.is_full_package = true)
        ) AS full_package_details,

        --partial packages with their labels and quantities
        jsonb_build_object('partial_packages',
                           jsonb_agg(
                               jsonb_build_object('label', pc.label, 'quantity', pc.quantity)
                               ORDER BY pc.label
                           ) FILTER (WHERE pc.is_full_package = false)
        ) AS partial_package_details,

        --date information
        MIN(pc.packageddate) AS production_date,
        (MIN(pc.packageddate) + INTERVAL '1 year') AS calculated_best_by_date,
        MAX(pc.lastmodified) AS last_modified,

        --location info
        MAX(pc.locationname) AS storage_location,

        --flags for missing data (true if ANY package in batch is missing data)
        bool_or(items_table_missing) AS items_table_missing,
        bool_or(unit_weight_grams_missing) AS unit_weight_grams_missing,
        bool_or(unit_count_missing) AS unit_count_missing,

        --business logic quantity: count of full packages available for sale
        COUNT(*) FILTER (WHERE is_full_package = true) AS quantity

    FROM packages_classified pc
    GROUP BY
        pc.item_name,
        pc.first_sourcepackage_label,
        pc.sourcepackagelabels,
        pc.item_productcategoryname,
        pc.synclicense
)

--final SELECT with THC data joined
SELECT
    ba.batch_name,
    ba.name,
    ba.sourcepackagelabels,
    ba.package_count,
    ba.quantity,
    ba.full_package_count,
    ba.partial_package_count,
    ba.available_labels,
    ba.full_package_details,
    ba.partial_package_details,

    --THC percentage
    AVG(tr.thc_percentage) AS thc_percentage,

    --Date information
    ba.production_date,
    MAX(td.test_date) AS test_date,
    ba.calculated_best_by_date AS best_by_date,
    ba.last_modified,

    --Product and location info
    ba.item_productcategoryname,
    ba.synclicense,
    ba.storage_location,

    --Missing data flags
    ba.items_table_missing,
    ba.unit_weight_grams_missing,
    ba.unit_count_missing

FROM batch_aggregation ba
--Join THC results
         LEFT JOIN packages_classified pc ON ba.name = pc.item_name
    AND ba.first_sourcepackage_label = pc.first_sourcepackage_label
    AND ba.synclicense = pc.synclicense
         LEFT JOIN thc_results tr ON pc.metrcid = tr.package_metrcid
    AND pc.synclicense = tr.synclicense
         LEFT JOIN test_dates td ON pc.metrcid = td.package_metrcid
    AND pc.synclicense = td.synclicense

GROUP BY
    ba.batch_name,
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
    ba.synclicense,
    ba.storage_location,
    ba.items_table_missing,
    ba.unit_weight_grams_missing,
    ba.unit_count_missing

ORDER BY
    ba.name,
    ba.first_sourcepackage_label;