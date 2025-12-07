-- Add metrc_license_number column to ORDERS-buyer_locations table
-- This stores the METRC facility license number (e.g., CUL000027) used for API calls
-- Different from state_license (e.g., DIS000085) which is the store identifier
-- Migration script to add the metrc_license_number field

ALTER TABLE "ORDERS-buyer_locations"
    ADD COLUMN IF NOT EXISTS metrc_license_number VARCHAR(50);

-- Add comment for documentation
COMMENT ON COLUMN "ORDERS-buyer_locations".metrc_license_number IS 'METRC facility license number (e.g., CUL000027) used for API calls to find recipientId. Different from state_license (DIS000085) which is the store identifier.';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_buyer_locations_metrc_license 
    ON "ORDERS-buyer_locations"(metrc_license_number) 
    WHERE metrc_license_number IS NOT NULL;


