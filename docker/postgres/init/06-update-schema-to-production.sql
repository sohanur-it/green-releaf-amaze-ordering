-- Update Local Database Schema to Match Production RDS
-- This script renames columns to match the production database naming convention

-- Update strains table columns
ALTER TABLE strains RENAME COLUMN testingstatus TO testing_status;
ALTER TABLE strains RENAME COLUMN thcpercent TO thc_level;
ALTER TABLE strains RENAME COLUMN cbdpercent TO cbd_level;
ALTER TABLE strains RENAME COLUMN indicaspercent TO indica_percentage;
ALTER TABLE strains RENAME COLUMN sativapercent TO sativa_percentage;
ALTER TABLE strains RENAME COLUMN createdbyuserid TO created_by_user_id;
ALTER TABLE strains RENAME COLUMN createddatetime TO created_date_time;
ALTER TABLE strains RENAME COLUMN lastmodified TO last_modified;
ALTER TABLE strains RENAME COLUMN synclicense TO sync_license;

-- Update items table columns
ALTER TABLE items RENAME COLUMN itemcategory TO item_category;
ALTER TABLE items RENAME COLUMN unitofmeasure TO unit_of_measure;
ALTER TABLE items RENAME COLUMN unitofmeasureabbreviation TO unit_of_measure_abbreviation;
ALTER TABLE items RENAME COLUMN createdbyuserid TO created_by_user_id;
ALTER TABLE items RENAME COLUMN createddatetime TO created_date_time;
ALTER TABLE items RENAME COLUMN lastmodified TO last_modified;
ALTER TABLE items RENAME COLUMN synclicense TO sync_license;

-- Update transferredpackages table columns
ALTER TABLE transferredpackages RENAME COLUMN itemcategory TO item_category;
ALTER TABLE transferredpackages RENAME COLUMN unitofmeasure TO unit_of_measure;
ALTER TABLE transferredpackages RENAME COLUMN createdbyuserid TO created_by_user_id;
ALTER TABLE transferredpackages RENAME COLUMN createddatetime TO created_date_time;
ALTER TABLE transferredpackages RENAME COLUMN lastmodified TO last_modified;
ALTER TABLE transferredpackages RENAME COLUMN synclicense TO sync_license;

-- Update intransitpackages table columns
ALTER TABLE intransitpackages RENAME COLUMN itemcategory TO item_category;
ALTER TABLE intransitpackages RENAME COLUMN unitofmeasure TO unit_of_measure;
ALTER TABLE intransitpackages RENAME COLUMN createdbyuserid TO created_by_user_id;
ALTER TABLE intransitpackages RENAME COLUMN createddatetime TO created_date_time;
ALTER TABLE intransitpackages RENAME COLUMN lastmodified TO last_modified;
ALTER TABLE intransitpackages RENAME COLUMN synclicense TO sync_license;

-- Update activepackages table columns (if needed)
ALTER TABLE activepackages RENAME COLUMN itemcategory TO item_category;
ALTER TABLE activepackages RENAME COLUMN unitofmeasure TO unit_of_measure;
ALTER TABLE activepackages RENAME COLUMN unitofmeasureabbreviation TO unit_of_measure_abbreviation;
ALTER TABLE activepackages RENAME COLUMN packageadjustmentamount TO package_adjustment_amount;
ALTER TABLE activepackages RENAME COLUMN packageadjustmentunitofmeasure TO package_adjustment_unit_of_measure;
ALTER TABLE activepackages RENAME COLUMN packageadjustmentunitofmeasureabbreviation TO package_adjustment_unit_of_measure_abbreviation;
ALTER TABLE activepackages RENAME COLUMN productrequiresreminder TO product_requires_reminder;
ALTER TABLE activepackages RENAME COLUMN containsseeds TO contains_seeds;
ALTER TABLE activepackages RENAME COLUMN isproductionbatch TO is_production_batch;
ALTER TABLE activepackages RENAME COLUMN productionbatchnumber TO production_batch_number;
ALTER TABLE activepackages RENAME COLUMN productionbatchrunnumber TO production_batch_run_number;
ALTER TABLE activepackages RENAME COLUMN productionbatchrunstartdate TO production_batch_run_start_date;
ALTER TABLE activepackages RENAME COLUMN productionbatchrunenddate TO production_batch_run_end_date;
ALTER TABLE activepackages RENAME COLUMN receiveddatetime TO received_date_time;
ALTER TABLE activepackages RENAME COLUMN receivedunitofmeasure TO received_unit_of_measure;
ALTER TABLE activepackages RENAME COLUMN receivedunitofmeasureabbreviation TO received_unit_of_measure_abbreviation;
ALTER TABLE activepackages RENAME COLUMN receivedquantity TO received_quantity;
ALTER TABLE activepackages RENAME COLUMN isonhold TO is_on_hold;
ALTER TABLE activepackages RENAME COLUMN createdbyuserid TO created_by_user_id;
ALTER TABLE activepackages RENAME COLUMN createddatetime TO created_date_time;
ALTER TABLE activepackages RENAME COLUMN lastmodified TO last_modified;
ALTER TABLE activepackages RENAME COLUMN synclicense TO sync_license;

-- Update activeoutgoingtransfers table columns (if needed)
ALTER TABLE activeoutgoingtransfers RENAME COLUMN transfertype TO transfer_type;
ALTER TABLE activeoutgoingtransfers RENAME COLUMN estimateddeparturedatetime TO estimated_departure_date_time;
ALTER TABLE activeoutgoingtransfers RENAME COLUMN estimatedarrivaldatetime TO estimated_arrival_date_time;
ALTER TABLE activeoutgoingtransfers RENAME COLUMN actualdeparturedatetime TO actual_departure_date_time;
ALTER TABLE activeoutgoingtransfers RENAME COLUMN actualarrivaldatetime TO actual_arrival_date_time;
ALTER TABLE activeoutgoingtransfers RENAME COLUMN deliverycount TO delivery_count;
ALTER TABLE activeoutgoingtransfers RENAME COLUMN packagecount TO package_count;
ALTER TABLE activeoutgoingtransfers RENAME COLUMN createdbyuserid TO created_by_user_id;
ALTER TABLE activeoutgoingtransfers RENAME COLUMN createddatetime TO created_date_time;
ALTER TABLE activeoutgoingtransfers RENAME COLUMN lastmodified TO last_modified;
ALTER TABLE activeoutgoingtransfers RENAME COLUMN synclicense TO sync_license;

-- Update indexes to match new column names
DROP INDEX IF EXISTS idx_strains_lastmodified;
DROP INDEX IF EXISTS idx_strains_synclicense;
DROP INDEX IF EXISTS idx_items_lastmodified;
DROP INDEX IF EXISTS idx_items_synclicense;
DROP INDEX IF EXISTS idx_transferredpackages_lastmodified;
DROP INDEX IF EXISTS idx_transferredpackages_synclicense;
DROP INDEX IF EXISTS idx_intransitpackages_lastmodified;
DROP INDEX IF EXISTS idx_intransitpackages_synclicense;
DROP INDEX IF EXISTS idx_activepackages_lastmodified;
DROP INDEX IF EXISTS idx_activepackages_synclicense;
DROP INDEX IF EXISTS idx_activeoutgoingtransfers_lastmodified;
DROP INDEX IF EXISTS idx_activeoutgoingtransfers_synclicense;

-- Recreate indexes with new column names
CREATE INDEX idx_strains_last_modified ON strains(last_modified);
CREATE INDEX idx_strains_sync_license ON strains(sync_license);
CREATE INDEX idx_items_last_modified ON items(last_modified);
CREATE INDEX idx_items_sync_license ON items(sync_license);
CREATE INDEX idx_transferredpackages_last_modified ON transferredpackages(last_modified);
CREATE INDEX idx_transferredpackages_sync_license ON transferredpackages(sync_license);
CREATE INDEX idx_intransitpackages_last_modified ON intransitpackages(last_modified);
CREATE INDEX idx_intransitpackages_sync_license ON intransitpackages(sync_license);
CREATE INDEX idx_activepackages_last_modified ON activepackages(last_modified);
CREATE INDEX idx_activepackages_sync_license ON activepackages(sync_license);
CREATE INDEX idx_activeoutgoingtransfers_last_modified ON activeoutgoingtransfers(last_modified);
CREATE INDEX idx_activeoutgoingtransfers_sync_license ON activeoutgoingtransfers(sync_license);

-- Update unique constraints to match new column names
ALTER TABLE strains DROP CONSTRAINT IF EXISTS strains_metrcid_key;
ALTER TABLE strains ADD CONSTRAINT strains_metrcid_key UNIQUE (metrcid);

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_metrcid_key;
ALTER TABLE items ADD CONSTRAINT items_metrcid_key UNIQUE (metrcid);

ALTER TABLE transferredpackages DROP CONSTRAINT IF EXISTS transferredpackages_metrcid_key;
ALTER TABLE transferredpackages ADD CONSTRAINT transferredpackages_metrcid_key UNIQUE (metrcid);

ALTER TABLE intransitpackages DROP CONSTRAINT IF EXISTS intransitpackages_metrcid_key;
ALTER TABLE intransitpackages ADD CONSTRAINT intransitpackages_metrcid_key UNIQUE (metrcid);

ALTER TABLE activepackages DROP CONSTRAINT IF EXISTS activepackages_metrcid_key;
ALTER TABLE activepackages ADD CONSTRAINT activepackages_metrcid_key UNIQUE (metrcid);

ALTER TABLE activeoutgoingtransfers DROP CONSTRAINT IF EXISTS activeactiveoutgoingtransfers_metrcid_key;
ALTER TABLE activeoutgoingtransfers ADD CONSTRAINT activeactiveoutgoingtransfers_metrcid_key UNIQUE (metrcid);
