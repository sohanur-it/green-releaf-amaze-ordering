-- Add metrc_recipient_facility_id column to ORDERS-buyer_locations table
-- This stores the METRC facility ID (recipientId) for each location
-- Migration script to add the metrc_recipient_facility_id field

ALTER TABLE "ORDERS-buyer_locations"
    ADD COLUMN IF NOT EXISTS metrc_recipient_facility_id INTEGER;

-- Add comment for documentation
COMMENT ON COLUMN "ORDERS-buyer_locations".metrc_recipient_facility_id IS 'METRC facility ID (recipientId) for this location. Used for manifest creation.';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_buyer_locations_metrc_recipient_id 
    ON "ORDERS-buyer_locations"(metrc_recipient_facility_id) 
    WHERE metrc_recipient_facility_id IS NOT NULL;


