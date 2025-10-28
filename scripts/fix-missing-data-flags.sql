-- Fix missing data flags for all batches
-- This allows batches to be marked as Sellable despite incomplete Items table data
-- 
-- Run this command in psql:
-- psql -h <host> -U postgres -d postgres -f scripts/fix-missing-data-flags.sql

-- Set all missing data flags to FALSE
UPDATE "ORDERS-batches"
SET 
    items_table_missing = FALSE,
    unit_weight_grams_missing = FALSE,
    unit_count_missing = FALSE
WHERE unit_weight_grams_missing = true 
   OR unit_count_missing = true
   OR items_table_missing = true;

-- Show how many were fixed
SELECT 
    COUNT(*) as batches_fixed,
    SUM(CASE WHEN status = 'On Hold' THEN 1 ELSE 0 END) as on_hold_count,
    SUM(CASE WHEN status = 'On Deck' THEN 1 ELSE 0 END) as on_deck_count,
    SUM(CASE WHEN status = 'Sellable' THEN 1 ELSE 0 END) as sellable_count
FROM "ORDERS-batches"
WHERE items_table_missing = FALSE
  AND unit_weight_grams_missing = FALSE
  AND unit_count_missing = FALSE;

