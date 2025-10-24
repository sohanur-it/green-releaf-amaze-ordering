-- METRC Sync Tables for Green Releaf Development
-- This script creates all the tables needed for METRC data synchronization

-- Create METRC schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS metrc;

-- Set search path to include metrc schema
SET search_path TO public, metrc;

-- Active Packages Table
CREATE TABLE IF NOT EXISTS activepackages (
    id SERIAL PRIMARY KEY,
    metrcid INTEGER UNIQUE NOT NULL,
    label VARCHAR(255) NOT NULL,
    item VARCHAR(255),
    itemcategory VARCHAR(100),
    quantity DECIMAL(15,6),
    unitofmeasure VARCHAR(50),
    unitofmeasureabbreviation VARCHAR(10),
    packageadjustmentamount DECIMAL(15,6),
    packageadjustmentunitofmeasure VARCHAR(50),
    packageadjustmentunitofmeasureabbreviation VARCHAR(10),
    productrequiresreminder BOOLEAN DEFAULT FALSE,
    containsseeds BOOLEAN DEFAULT FALSE,
    isproductionbatch BOOLEAN DEFAULT FALSE,
    productionbatchnumber VARCHAR(255),
    productionbatchrunnumber VARCHAR(255),
    productionbatchrunstartdate TIMESTAMP,
    productionbatchrunenddate TIMESTAMP,
    receiveddatetime TIMESTAMP,
    receivedunitofmeasure VARCHAR(50),
    receivedunitofmeasureabbreviation VARCHAR(10),
    receivedquantity DECIMAL(15,6),
    isonhold BOOLEAN DEFAULT FALSE,
    createdbyuserid INTEGER,
    createddatetime TIMESTAMP,
    lastmodified TIMESTAMP,
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inactive Packages Table
CREATE TABLE IF NOT EXISTS inactivepackages (
    id SERIAL PRIMARY KEY,
    metrcid INTEGER UNIQUE NOT NULL,
    label VARCHAR(255) NOT NULL,
    item VARCHAR(255),
    itemcategory VARCHAR(100),
    quantity DECIMAL(15,6),
    unitofmeasure VARCHAR(50),
    unitofmeasureabbreviation VARCHAR(10),
    packageadjustmentamount DECIMAL(15,6),
    packageadjustmentunitofmeasure VARCHAR(50),
    packageadjustmentunitofmeasureabbreviation VARCHAR(10),
    productrequiresreminder BOOLEAN DEFAULT FALSE,
    containsseeds BOOLEAN DEFAULT FALSE,
    isproductionbatch BOOLEAN DEFAULT FALSE,
    productionbatchnumber VARCHAR(255),
    productionbatchrunnumber VARCHAR(255),
    productionbatchrunstartdate TIMESTAMP,
    productionbatchrunenddate TIMESTAMP,
    receiveddatetime TIMESTAMP,
    receivedunitofmeasure VARCHAR(50),
    receivedunitofmeasureabbreviation VARCHAR(10),
    receivedquantity DECIMAL(15,6),
    isonhold BOOLEAN DEFAULT FALSE,
    createdbyuserid INTEGER,
    createddatetime TIMESTAMP,
    lastmodified TIMESTAMP,
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transferred Packages Table
CREATE TABLE IF NOT EXISTS transferredpackages (
    id SERIAL PRIMARY KEY,
    metrcid INTEGER UNIQUE NOT NULL,
    label VARCHAR(255) NOT NULL,
    item VARCHAR(255),
    itemcategory VARCHAR(100),
    quantity DECIMAL(15,6),
    unitofmeasure VARCHAR(50),
    unitofmeasureabbreviation VARCHAR(10),
    packageadjustmentamount DECIMAL(15,6),
    packageadjustmentunitofmeasure VARCHAR(50),
    packageadjustmentunitofmeasureabbreviation VARCHAR(10),
    productrequiresreminder BOOLEAN DEFAULT FALSE,
    containsseeds BOOLEAN DEFAULT FALSE,
    isproductionbatch BOOLEAN DEFAULT FALSE,
    productionbatchnumber VARCHAR(255),
    productionbatchrunnumber VARCHAR(255),
    productionbatchrunstartdate TIMESTAMP,
    productionbatchrunenddate TIMESTAMP,
    receiveddatetime TIMESTAMP,
    receivedunitofmeasure VARCHAR(50),
    receivedunitofmeasureabbreviation VARCHAR(10),
    receivedquantity DECIMAL(15,6),
    isonhold BOOLEAN DEFAULT FALSE,
    createdbyuserid INTEGER,
    createddatetime TIMESTAMP,
    lastmodified TIMESTAMP,
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- In-Transit Packages Table
CREATE TABLE IF NOT EXISTS intransitpackages (
    id SERIAL PRIMARY KEY,
    metrcid INTEGER UNIQUE NOT NULL,
    label VARCHAR(255) NOT NULL,
    item VARCHAR(255),
    itemcategory VARCHAR(100),
    quantity DECIMAL(15,6),
    unitofmeasure VARCHAR(50),
    unitofmeasureabbreviation VARCHAR(10),
    packageadjustmentamount DECIMAL(15,6),
    packageadjustmentunitofmeasure VARCHAR(50),
    packageadjustmentunitofmeasureabbreviation VARCHAR(10),
    productrequiresreminder BOOLEAN DEFAULT FALSE,
    containsseeds BOOLEAN DEFAULT FALSE,
    isproductionbatch BOOLEAN DEFAULT FALSE,
    productionbatchnumber VARCHAR(255),
    productionbatchrunnumber VARCHAR(255),
    productionbatchrunstartdate TIMESTAMP,
    productionbatchrunenddate TIMESTAMP,
    receiveddatetime TIMESTAMP,
    receivedunitofmeasure VARCHAR(50),
    receivedunitofmeasureabbreviation VARCHAR(10),
    receivedquantity DECIMAL(15,6),
    isonhold BOOLEAN DEFAULT FALSE,
    createdbyuserid INTEGER,
    createddatetime TIMESTAMP,
    lastmodified TIMESTAMP,
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Outgoing Transfers Table
CREATE TABLE IF NOT EXISTS activeoutgoingtransfers (
    id SERIAL PRIMARY KEY,
    metrcid INTEGER UNIQUE NOT NULL,
    manifestnumber VARCHAR(255),
    shipperfacilitylicense VARCHAR(255),
    shipperfacilityname VARCHAR(255),
    shipperfacilityaddress VARCHAR(500),
    shipperfacilitycity VARCHAR(255),
    shipperfacilitystate VARCHAR(100),
    shipperfacilityzipcode VARCHAR(20),
    receiverfacilitylicense VARCHAR(255),
    receiverfacilityname VARCHAR(255),
    receiverfacilityaddress VARCHAR(500),
    receiverfacilitycity VARCHAR(255),
    receiverfacilitystate VARCHAR(100),
    receiverfacilityzipcode VARCHAR(20),
    driveroccupationallicensenumber VARCHAR(255),
    driveroccupationallicensestate VARCHAR(100),
    driverfirstname VARCHAR(255),
    driverlastname VARCHAR(255),
    driverphone VARCHAR(50),
    vehiclemake VARCHAR(255),
    vehiclemodel VARCHAR(255),
    vehicleyear INTEGER,
    vehicleregistration VARCHAR(255),
    vehicleregistrationstate VARCHAR(100),
    actualdeparturedatetime TIMESTAMP,
    actualarrivaldatetime TIMESTAMP,
    estimateddeparturedatetime TIMESTAMP,
    estimatedarrivaldatetime TIMESTAMP,
    deliverycount INTEGER,
    receiveddatetime TIMESTAMP,
    receivedby VARCHAR(255),
    packagecount INTEGER,
    totalpackageweight DECIMAL(15,6),
    totalpackageweightunitofmeasure VARCHAR(50),
    totalpackageweightunitofmeasureabbreviation VARCHAR(10),
    createdbyuserid INTEGER,
    createddatetime TIMESTAMP,
    lastmodified TIMESTAMP,
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Items Table
CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    metrcid INTEGER UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    itemcategory VARCHAR(100),
    unitofmeasure VARCHAR(50),
    unitofmeasureabbreviation VARCHAR(10),
    strain VARCHAR(255),
    strainmetrcid INTEGER,
    itembrand VARCHAR(255),
    itembrandmetrcid INTEGER,
    administrationmethod VARCHAR(100),
    unitcbdpercent DECIMAL(5,2),
    unitcbdcontent DECIMAL(15,6),
    unitcbdcontentunitofmeasure VARCHAR(50),
    unitcbdcontentunitofmeasureabbreviation VARCHAR(10),
    unitthcpercent DECIMAL(5,2),
    unitthccontent DECIMAL(15,6),
    unitthccontentunitofmeasure VARCHAR(50),
    unitthccontentunitofmeasureabbreviation VARCHAR(10),
    servingsperunit INTEGER,
    unitvolume DECIMAL(15,6),
    unitvolumeunitofmeasure VARCHAR(50),
    unitvolumeunitofmeasureabbreviation VARCHAR(10),
    unitweight DECIMAL(15,6),
    unitweightunitofmeasure VARCHAR(50),
    unitweightunitofmeasureabbreviation VARCHAR(10),
    unitdensity DECIMAL(15,6),
    unitdensityunitofmeasure VARCHAR(50),
    unitdensityunitofmeasureabbreviation VARCHAR(10),
    unitssold DECIMAL(15,6),
    unitssoldunitofmeasure VARCHAR(50),
    unitssoldunitofmeasureabbreviation VARCHAR(10),
    createdbyuserid INTEGER,
    createddatetime TIMESTAMP,
    lastmodified TIMESTAMP,
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Strains Table
CREATE TABLE IF NOT EXISTS strains (
    id SERIAL PRIMARY KEY,
    metrcid INTEGER UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    testingstatus VARCHAR(100),
    thcpercent DECIMAL(5,2),
    cbdpercent DECIMAL(5,2),
    indicaspercent DECIMAL(5,2),
    sativapercent DECIMAL(5,2),
    genetics VARCHAR(500),
    createdbyuserid INTEGER,
    createddatetime TIMESTAMP,
    lastmodified TIMESTAMP,
    synclicense VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_activepackages_metrcid ON activepackages(metrcid);
CREATE INDEX IF NOT EXISTS idx_activepackages_label ON activepackages(label);
CREATE INDEX IF NOT EXISTS idx_activepackages_synclicense ON activepackages(synclicense);
CREATE INDEX IF NOT EXISTS idx_activepackages_lastmodified ON activepackages(lastmodified);

CREATE INDEX IF NOT EXISTS idx_inactivepackages_metrcid ON inactivepackages(metrcid);
CREATE INDEX IF NOT EXISTS idx_inactivepackages_label ON inactivepackages(label);
CREATE INDEX IF NOT EXISTS idx_inactivepackages_synclicense ON inactivepackages(synclicense);

CREATE INDEX IF NOT EXISTS idx_transferredpackages_metrcid ON transferredpackages(metrcid);
CREATE INDEX IF NOT EXISTS idx_transferredpackages_label ON transferredpackages(label);
CREATE INDEX IF NOT EXISTS idx_transferredpackages_synclicense ON transferredpackages(synclicense);
CREATE INDEX IF NOT EXISTS idx_transferredpackages_lastmodified ON transferredpackages(lastmodified);

CREATE INDEX IF NOT EXISTS idx_intransitpackages_metrcid ON intransitpackages(metrcid);
CREATE INDEX IF NOT EXISTS idx_intransitpackages_label ON intransitpackages(label);
CREATE INDEX IF NOT EXISTS idx_intransitpackages_synclicense ON intransitpackages(synclicense);

CREATE INDEX IF NOT EXISTS idx_activeoutgoingtransfers_metrcid ON activeoutgoingtransfers(metrcid);
CREATE INDEX IF NOT EXISTS idx_activeoutgoingtransfers_manifestnumber ON activeoutgoingtransfers(manifestnumber);
CREATE INDEX IF NOT EXISTS idx_activeoutgoingtransfers_synclicense ON activeoutgoingtransfers(synclicense);
CREATE INDEX IF NOT EXISTS idx_activeoutgoingtransfers_lastmodified ON activeoutgoingtransfers(lastmodified);

CREATE INDEX IF NOT EXISTS idx_items_metrcid ON items(metrcid);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
CREATE INDEX IF NOT EXISTS idx_items_synclicense ON items(synclicense);
CREATE INDEX IF NOT EXISTS idx_items_lastmodified ON items(lastmodified);

CREATE INDEX IF NOT EXISTS idx_strains_metrcid ON strains(metrcid);
CREATE INDEX IF NOT EXISTS idx_strains_name ON strains(name);
CREATE INDEX IF NOT EXISTS idx_strains_synclicense ON strains(synclicense);
CREATE INDEX IF NOT EXISTS idx_strains_lastmodified ON strains(lastmodified);

-- Create triggers for updated_at
CREATE TRIGGER update_activepackages_updated_at BEFORE UPDATE ON activepackages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inactivepackages_updated_at BEFORE UPDATE ON inactivepackages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_transferredpackages_updated_at BEFORE UPDATE ON transferredpackages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_intransitpackages_updated_at BEFORE UPDATE ON intransitpackages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_activeoutgoingtransfers_updated_at BEFORE UPDATE ON activeoutgoingtransfers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_items_updated_at BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_strains_updated_at BEFORE UPDATE ON strains FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;

-- Log successful creation
INSERT INTO audit_log (action, resource, details) VALUES
    ('metrc.tables.create', 'database', '{"message": "METRC sync tables created successfully", "tables": ["activepackages", "inactivepackages", "transferredpackages", "intransitpackages", "activeoutgoingtransfers", "items", "strains"]}');
