#!/usr/bin/env node

/**
 * Enhanced Sync Active Packages from METRC T3 API
 * 
 * This script implements Full Mirror Sync strategy for active packages.
 * It fetches all active packages, compares them with local data based on
 * metrcid and lastmodified timestamps, and performs atomic INSERTs, UPDATEs, and DELETEs.
 * 
 * Usage: node scripts/sync/sync-active-packages-enhanced.js
 */

const axios = require('axios');
const { Pool } = require('pg');
const path = require('path');

// Load environment variables FIRST
if (process.env.NODE_ENV === 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../../config/production.env') });
} else {
    require('dotenv').config({ path: path.join(__dirname, '../../config/local.env') });
}

// Import centralized METRC authentication service AFTER environment variables are loaded
const metrcAuth = require('../../Server/Services/metrcAuth');

// Database configuration
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'green_releaf_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false }
};

// METRC API configuration
const METRC_CONFIG = {
    baseURL: process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2',
    hostname: process.env.T3_HOSTNAME || 'mo.metrc.com',
    username: process.env.T3_USERNAME,
    password: process.env.T3_PASSWORD,
    licenseNumber: process.env.T3_LICENSE_NUMBER || 'CUL000063'
};

// Create database pool
const pool = new Pool(DB_CONFIG);

// Using centralized metrcAuth service - no local token cache needed

/**
 * Get the last sync timestamp for incremental sync
 */
async function getLastSyncTimestamp(client) {
    try {
        const query = `
            SELECT last_timestamp 
            FROM sync_progress 
            WHERE sync_type = 'active_packages' AND license = $1
        `;
        
        const result = await client.query(query, [METRC_CONFIG.licenseNumber]);
        
        if (result.rows.length > 0 && result.rows[0].last_timestamp) {
            const lastSync = new Date(result.rows[0].last_timestamp);
            // Add a 5-minute buffer to account for potential delays
            const bufferTime = new Date(lastSync.getTime() - 5 * 60 * 1000);
            console.log(`📅 Last sync: ${lastSync.toISOString()}, using buffer: ${bufferTime.toISOString()}`);
            return bufferTime;
        } else {
            console.log('📅 No previous sync found, fetching all packages');
            return null;
        }
    } catch (error) {
        console.error('❌ Error getting last sync timestamp:', error.message);
        return null;
    }
}

/**
 * Fetch active packages from METRC API with pagination and incremental sync support
 */
async function fetchActivePackages() {
    try {
        // Ensure we have a valid token before starting
        const authSuccess = await metrcAuth.ensureValidToken();
            if (!authSuccess) {
                throw new Error('Failed to authenticate');
        }

        console.log('📡 Fetching all active packages from METRC API...');
        
        let allPackages = [];
        let page = 1;
        let hasMorePages = true;
        const pageSize = 500; // Maximum allowed by API (500 packages per page)
        
        while (hasMorePages) {
            console.log(`📄 Fetching page ${page}...`);
            
            let retries = 3;
            let success = false;
            
            while (retries > 0 && !success) {
                try {
                    const response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: `${METRC_CONFIG.baseURL}/packages/active`,
                        params: {
                            licenseNumber: METRC_CONFIG.licenseNumber,
                            page: page,
                            pageSize: pageSize
                        }
                    });

                    if (response.data && response.data.data) {
                        const packages = response.data.data;
                        allPackages = allPackages.concat(packages);
                        
                        console.log(`✅ Retrieved ${packages.length} packages from page ${page} (total: ${allPackages.length})`);
                        
                        // Check if there are more pages
                        const totalPages = response.data.totalPages || Math.ceil(response.data.total / pageSize);
                        hasMorePages = page < totalPages;
                        page++;
                        success = true;
                        
                        // Small delay to avoid rate limiting
                        if (hasMorePages) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    } else {
                        console.log('⚠️ No active packages data received for page', page);
                        hasMorePages = false;
                        success = true;
                    }
                } catch (error) {
                    retries--;
                    if (retries > 0) {
                        console.log(`⚠️ API error on page ${page}, retrying in 2 seconds... (${retries} retries left)`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
                        console.error(`❌ Failed to fetch page ${page} after 3 retries:`, error.message);
                        throw error;
                    }
                }
            }
        }

        console.log(`✅ Retrieved ${allPackages.length} total active packages across ${page - 1} pages`);
        return allPackages;
        
    } catch (error) {
        console.error('❌ Error fetching active packages:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        throw error;
    }
}

/**
 * Get existing packages from local database
 */
async function getExistingPackages(client) {
    try {
        const query = `
            SELECT metrcid, lastmodified 
            FROM activepackages 
            WHERE sync_license = $1
        `;
        
        const result = await client.query(query, [METRC_CONFIG.licenseNumber]);
        
        const existingPackages = new Map();
        result.rows.forEach(row => {
            existingPackages.set(row.metrcid, {
                lastmodified: row.lastmodified,
                exists: true
            });
        });
        
        console.log(`📊 Found ${existingPackages.size} existing packages in local database`);
        return existingPackages;
        
    } catch (error) {
        console.error('❌ Error getting existing packages:', error.message);
        throw error;
    }
}

/**
 * Process records in chunks to prevent database locks
 */
async function processRecordsInChunks(client, records, operation = 'INSERT') {
    const CHUNK_SIZE = 500;
    const DELAY_BETWEEN_CHUNKS = 100; // milliseconds
    
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);
        
        try {
            if (operation === 'INSERT') {
                await performBulkInsert(client, chunk);
            } else if (operation === 'UPDATE') {
                await performBulkUpdate(client, chunk);
            }
            
            console.log(`✅ Processed chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(records.length / CHUNK_SIZE)} (${chunk.length} records)`);
            
            // Small delay to release database locks
            if (i + CHUNK_SIZE < records.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS));
            }
            
        } catch (error) {
            console.error(`❌ Error processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}:`, error.message);
            throw error;
        }
    }
}

/**
 * Truncate string to specified length
 */
function truncateString(str, maxLength) {
    if (!str) return str;
    return str.length > maxLength ? str.substring(0, maxLength) : str;
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj, path) {
    if (!path) return null;
    const properties = path.split('.');
    let value = obj;
    for (const prop of properties) {
        if (value === null || typeof value !== 'object') return null;
        value = value[prop];
        if (value === undefined) return null;
    }
    return value;
}

/**
 * Prepare value for database insertion with proper type handling
 */
function prepareValue(pkg, fieldName, fieldType = 'string') {
    const fieldMapping = {
        // Basic fields
        metrcid: 'id',
        label: 'label',
        quantity: 'quantity',
        lastmodified: 'lastModified',
        sync_license: 'license_number',
        
        // Item fields (nested)
        item_name: 'item.name',
        item_productcategoryname: 'item.productCategoryName',
        item_unitofmeasurename: 'item.unitOfMeasureName',
        unit_of_measure_abbreviation: 'unitOfMeasureAbbreviation',
        
        // Boolean fields
        productrequiresreminder: 'productRequiresReminder',
        containsseeds: 'containsSeeds',
        isproductionbatch: 'isProductionBatch',
        isonhold: 'isOnHold',
        
        // String fields
        productionbatchnumber: 'productionBatchNumber',
        
        // Date fields
        receiveddatetime: 'receivedDateTime',
        createddatetime: 'createdDateTime'
    };
    
    const apiPath = fieldMapping[fieldName];
    if (!apiPath) return null;
    
    const value = getNestedValue(pkg, apiPath);
    if (value === null || value === undefined) return null;
    
    // Handle different data types
    if (fieldType === 'boolean') {
        return /^(true|1|t|y)$/i.test(String(value).trim());
    } else if (fieldType === 'number') {
        const num = Number(value);
        return isNaN(num) ? null : num;
    } else if (fieldType === 'date') {
        try {
            const date = new Date(value);
            return isNaN(date.getTime()) ? null : date.toISOString();
        } catch (e) {
            return null;
        }
    } else {
        // String field
        const str = String(value).trim();
        return str.length === 0 ? null : truncateString(str, 255);
    }
}

/**
 * Perform bulk INSERT operation with comprehensive field mapping
 */
async function performBulkInsert(client, packages) {
    if (packages.length === 0) return;
    
    // Process packages in smaller chunks to avoid parameter limits
    const CHUNK_SIZE = 50; // Reduced chunk size for better performance
    
    for (let i = 0; i < packages.length; i += CHUNK_SIZE) {
        const chunk = packages.slice(i, i + CHUNK_SIZE);
        await insertPackageChunk(client, chunk);
        console.log(`✅ Inserted chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(packages.length / CHUNK_SIZE)} (${chunk.length} packages)`);
    }
}

/**
 * Insert a chunk of packages with simplified field mapping (matching actual DB schema)
 */
async function insertPackageChunk(client, packages) {
    const insertQuery = `
        INSERT INTO activepackages (
            metrcid, label, quantity, lastmodified, sync_license,
            item_name, item_productcategoryname, unit_of_measure_abbreviation,
            isproductionbatch, productionbatchnumber, receiveddatetime, isonhold
        )
        VALUES ${packages.map((_, index) => 
            `($${index * 12 + 1}, $${index * 12 + 2}, $${index * 12 + 3}, $${index * 12 + 4}, $${index * 12 + 5}, $${index * 12 + 6}, $${index * 12 + 7}, $${index * 12 + 8}, $${index * 12 + 9}, $${index * 12 + 10}, $${index * 12 + 11}, $${index * 12 + 12})`
        ).join(', ')}
        ON CONFLICT (metrcid) DO NOTHING
    `;
    
    const values = [];
    packages.forEach(pkg => {
        // Map to actual database columns that exist
        const fieldValues = [
            pkg.id, // metrcid
            prepareValue(pkg, 'label'), // label
            prepareValue(pkg, 'quantity', 'number'), // quantity
            prepareValue(pkg, 'lastmodified', 'date'), // lastmodified
            METRC_CONFIG.licenseNumber, // sync_license
            prepareValue(pkg, 'item_name'), // item_name
            prepareValue(pkg, 'item_productcategoryname'), // item_productcategoryname
            prepareValue(pkg, 'unit_of_measure_abbreviation'), // unit_of_measure_abbreviation
            prepareValue(pkg, 'isproductionbatch', 'boolean'), // isproductionbatch
            prepareValue(pkg, 'productionbatchnumber'), // productionbatchnumber
            prepareValue(pkg, 'receiveddatetime', 'date'), // receiveddatetime
            prepareValue(pkg, 'isonhold', 'boolean') // isonhold
        ];
        
        values.push(...fieldValues);
    });
    
    await client.query(insertQuery, values);
}

/**
 * Perform bulk UPDATE operation with comprehensive field mapping
 */
async function performBulkUpdate(client, packages) {
    if (packages.length === 0) return;
    
    // Process packages in smaller chunks to avoid parameter limits
    const CHUNK_SIZE = 50;
    
    for (let i = 0; i < packages.length; i += CHUNK_SIZE) {
        const chunk = packages.slice(i, i + CHUNK_SIZE);
        await updatePackageChunk(client, chunk);
        console.log(`✅ Updated chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(packages.length / CHUNK_SIZE)} (${chunk.length} packages)`);
    }
}

/**
 * Update a chunk of packages with comprehensive field mapping
 */
async function updatePackageChunk(client, packages) {
    for (const pkg of packages) {
        const updateQuery = `
            UPDATE activepackages 
            SET 
                label = $1, quantity = $2, lastmodified = $3,
                item_name = $4, item_productcategoryname = $5, item_unitofmeasurename = $6, item_strainname = $7,
                item_brandname = $8, item_description = $9, item_administrationmethod = $10, item_allergens = $11,
                item_approvalstatusname = $12, item_defaultlabtestingstatename = $13, item_expirationconfigurationstate = $14,
                item_expirationdateconfiguration = $15, item_facilitylicensenumber = $16, item_facilityname = $17,
                item_globalproductid = $18, item_globalproductname = $19, item_itembrandname = $20,
                item_processingjobcategoryname = $21, item_processingjobtypename = $22, item_productbrandname = $23,
                item_productcategorytypename = $24, item_publicingredients = $25, item_quantitytypename = $26,
                item_sellbyconfigurationstate = $27, item_sellbydateconfiguration = $28, item_servingsize = $29,
                item_usebyconfigurationstate = $30, item_usebydateconfiguration = $31,
                containsdecontaminatedproduct = $32, containsremediatedproduct = $33, haspartial = $34, isarchived = $35,
                isdonation = $36, isdonationpersistent = $37, isfinished = $38, isintransit = $39, isonhold = $40, isonrecall = $41,
                isonretailerdelivery = $42, isontrip = $43, ispartial = $44, isprocessvalidationtestingsample = $45,
                isproductionbatch = $46, istestingsample = $47, istradesample = $48, istradesamplepersistent = $49,
                item_isarchived = $50, item_isused = $51, item_productcategoryrequiresapproval = $52, multiharvest = $53,
                multipackage = $54, multiprocessingjob = $55, multiproductionbatch = $56, packageforproductdestruction = $57,
                productrequiresdecontamination = $58, productrequiresremediation = $59, sourcepackageisdonation = $60,
                sourcepackageistradesample = $61, unitofmeasureid = $62, sourceharvestcount = $63, sourcepackagecount = $64,
                sourceprocessingjobcount = $65, labteststageid = $66, processingjobtypeid = $67, item_expirationdatedaysinadvance = $68,
                item_id = $69, item_itembrandid = $70, item_numberofdoses = $71, item_processingjobcategoryid = $72,
                item_processingjobtypeid = $73, item_productcategoryid = $74, item_sellbydatedaysinadvance = $75,
                item_strainid = $76, item_supplydurationdays = $77, item_unitcbdcontent = $78, item_unitcbdcontentdose = $79,
                item_unitofmeasureid = $80, item_unitquantity = $81, item_unitthccontent = $82, item_unitthcpercent = $83,
                item_unitweight = $84, item_usebydatedaysinadvance = $85, archiveddate = $86, decontaminationdate = $87,
                expirationdate = $88, finisheddate = $89, item_approvalstatusdatetime = $90, item_lastmodified = $91,
                labtestresultexpirationdatetime = $92, labtestingperformeddate = $93, labtestingrecordeddate = $94,
                labtestingstatedate = $95, packageddate = $96, receiveddatetime = $97, remediationdate = $98, sellbydate = $99,
                usebydate = $100, datamodel = $101, donationfacilitylicensenumber = $102, donationfacilityname = $103,
                facilitylicensenumber = $104, facilityname = $105, intransitstatus = $106, index = $107, initiallabtestingstate = $108,
                labtestresultdocumentfileid = $109, labteststage = $110, labtestingstatename = $111, licensenumber = $112,
                locationname = $113, locationtypename = $114, note = $115, packagetype = $116, packagedbyfacilitylicensenumber = $117,
                packagedbyfacilityname = $118, patientlicensenumber = $119, productlabel = $120, productionbatchnumber = $121,
                receivedfromfacilitylicensenumber = $122, receivedfromfacilityname = $123, receivedfrommanifestnumber = $124,
                sourceharvestnames = $125, sourcepackagelabels = $126, sourceprocessingjobnames = $127, sourceprocessingjobnumbers = $128,
                sourceproductionbatchnumbers = $129, tradesamplefacilitylicensenumber = $130, tradesamplefacilityname = $131,
                transfermanifestnumber = $132, trip = $133, unit_of_measure_abbreviation = $134, unitofmeasurequantitytype = $135
            WHERE metrcid = $136 AND sync_license = $137
        `;
        
        try {
            await client.query(updateQuery, [
                prepareValue(pkg, 'label'), // 1
                prepareValue(pkg, 'quantity', 'number'), // 2
                prepareValue(pkg, 'lastmodified', 'date'), // 3
                prepareValue(pkg, 'item_name'), // 4
                prepareValue(pkg, 'item_productcategoryname'), // 5
                prepareValue(pkg, 'item_unitofmeasurename'), // 6
                prepareValue(pkg, 'item_strainname'), // 7
                prepareValue(pkg, 'item_brandname'), // 8
                prepareValue(pkg, 'item_description'), // 9
                prepareValue(pkg, 'item_administrationmethod'), // 10
                prepareValue(pkg, 'item_allergens'), // 11
                prepareValue(pkg, 'item_approvalstatusname'), // 12
                prepareValue(pkg, 'item_defaultlabtestingstatename'), // 13
                prepareValue(pkg, 'item_expirationconfigurationstate'), // 14
                prepareValue(pkg, 'item_expirationdateconfiguration'), // 15
                prepareValue(pkg, 'item_facilitylicensenumber'), // 16
                prepareValue(pkg, 'item_facilityname'), // 17
                prepareValue(pkg, 'item_globalproductid'), // 18
                prepareValue(pkg, 'item_globalproductname'), // 19
                prepareValue(pkg, 'item_itembrandname'), // 20
                prepareValue(pkg, 'item_processingjobcategoryname'), // 21
                prepareValue(pkg, 'item_processingjobtypename'), // 22
                prepareValue(pkg, 'item_productbrandname'), // 23
                prepareValue(pkg, 'item_productcategorytypename'), // 24
                prepareValue(pkg, 'item_publicingredients'), // 25
                prepareValue(pkg, 'item_quantitytypename'), // 26
                prepareValue(pkg, 'item_sellbyconfigurationstate'), // 27
                prepareValue(pkg, 'item_sellbydateconfiguration'), // 28
                prepareValue(pkg, 'item_servingsize'), // 29
                prepareValue(pkg, 'item_usebyconfigurationstate'), // 30
                prepareValue(pkg, 'item_usebydateconfiguration'), // 31
                prepareValue(pkg, 'containsdecontaminatedproduct', 'boolean'), // 32
                prepareValue(pkg, 'containsremediatedproduct', 'boolean'), // 33
                prepareValue(pkg, 'haspartial', 'boolean'), // 34
                prepareValue(pkg, 'isarchived', 'boolean'), // 35
                prepareValue(pkg, 'isdonation', 'boolean'), // 36
                prepareValue(pkg, 'isdonationpersistent', 'boolean'), // 37
                prepareValue(pkg, 'isfinished', 'boolean'), // 38
                prepareValue(pkg, 'isintransit', 'boolean'), // 39
                prepareValue(pkg, 'isonhold', 'boolean'), // 40
                prepareValue(pkg, 'isonrecall', 'boolean'), // 41
                prepareValue(pkg, 'isonretailerdelivery', 'boolean'), // 42
                prepareValue(pkg, 'isontrip', 'boolean'), // 43
                prepareValue(pkg, 'ispartial', 'boolean'), // 44
                prepareValue(pkg, 'isprocessvalidationtestingsample', 'boolean'), // 45
                prepareValue(pkg, 'isproductionbatch', 'boolean'), // 46
                prepareValue(pkg, 'istestingsample', 'boolean'), // 47
                prepareValue(pkg, 'istradesample', 'boolean'), // 48
                prepareValue(pkg, 'istradesamplepersistent', 'boolean'), // 49
                prepareValue(pkg, 'item_isarchived', 'boolean'), // 50
                prepareValue(pkg, 'item_isused', 'boolean'), // 51
                prepareValue(pkg, 'item_productcategoryrequiresapproval', 'boolean'), // 52
                prepareValue(pkg, 'multiharvest', 'boolean'), // 53
                prepareValue(pkg, 'multipackage', 'boolean'), // 54
                prepareValue(pkg, 'multiprocessingjob', 'boolean'), // 55
                prepareValue(pkg, 'multiproductionbatch', 'boolean'), // 56
                prepareValue(pkg, 'packageforproductdestruction', 'boolean'), // 57
                prepareValue(pkg, 'productrequiresdecontamination', 'boolean'), // 58
                prepareValue(pkg, 'productrequiresremediation', 'boolean'), // 59
                prepareValue(pkg, 'sourcepackageisdonation', 'boolean'), // 60
                prepareValue(pkg, 'sourcepackageistradesample', 'boolean'), // 61
                prepareValue(pkg, 'unitofmeasureid', 'number'), // 62
                prepareValue(pkg, 'sourceharvestcount', 'number'), // 63
                prepareValue(pkg, 'sourcepackagecount', 'number'), // 64
                prepareValue(pkg, 'sourceprocessingjobcount', 'number'), // 65
                prepareValue(pkg, 'labteststageid', 'number'), // 66
                prepareValue(pkg, 'processingjobtypeid', 'number'), // 67
                prepareValue(pkg, 'item_expirationdatedaysinadvance', 'number'), // 68
                prepareValue(pkg, 'item_id', 'number'), // 69
                prepareValue(pkg, 'item_itembrandid', 'number'), // 70
                prepareValue(pkg, 'item_numberofdoses', 'number'), // 71
                prepareValue(pkg, 'item_processingjobcategoryid', 'number'), // 72
                prepareValue(pkg, 'item_processingjobtypeid', 'number'), // 73
                prepareValue(pkg, 'item_productcategoryid', 'number'), // 74
                prepareValue(pkg, 'item_sellbydatedaysinadvance', 'number'), // 75
                prepareValue(pkg, 'item_strainid', 'number'), // 76
                prepareValue(pkg, 'item_supplydurationdays', 'number'), // 77
                prepareValue(pkg, 'item_unitcbdcontent', 'number'), // 78
                prepareValue(pkg, 'item_unitcbdcontentdose', 'number'), // 79
                prepareValue(pkg, 'item_unitofmeasureid', 'number'), // 80
                prepareValue(pkg, 'item_unitquantity', 'number'), // 81
                prepareValue(pkg, 'item_unitthccontent', 'number'), // 82
                prepareValue(pkg, 'item_unitthcpercent', 'number'), // 83
                prepareValue(pkg, 'item_unitweight', 'number'), // 84
                prepareValue(pkg, 'item_usebydatedaysinadvance', 'number'), // 85
                prepareValue(pkg, 'archiveddate', 'date'), // 86
                prepareValue(pkg, 'decontaminationdate', 'date'), // 87
                prepareValue(pkg, 'expirationdate', 'date'), // 88
                prepareValue(pkg, 'finisheddate', 'date'), // 89
                prepareValue(pkg, 'item_approvalstatusdatetime', 'date'), // 90
                prepareValue(pkg, 'item_lastmodified', 'date'), // 91
                prepareValue(pkg, 'labtestresultexpirationdatetime', 'date'), // 92
                prepareValue(pkg, 'labtestingperformeddate', 'date'), // 93
                prepareValue(pkg, 'labtestingrecordeddate', 'date'), // 94
                prepareValue(pkg, 'labtestingstatedate', 'date'), // 95
                prepareValue(pkg, 'packageddate', 'date'), // 96
                prepareValue(pkg, 'receiveddatetime', 'date'), // 97
                prepareValue(pkg, 'remediationdate', 'date'), // 98
                prepareValue(pkg, 'sellbydate', 'date'), // 99
                prepareValue(pkg, 'usebydate', 'date'), // 100
                prepareValue(pkg, 'datamodel'), // 101
                prepareValue(pkg, 'donationfacilitylicensenumber'), // 102
                prepareValue(pkg, 'donationfacilityname'), // 103
                prepareValue(pkg, 'facilitylicensenumber'), // 104
                prepareValue(pkg, 'facilityname'), // 105
                prepareValue(pkg, 'intransitstatus'), // 106
                prepareValue(pkg, 'index'), // 107
                prepareValue(pkg, 'initiallabtestingstate'), // 108
                prepareValue(pkg, 'labtestresultdocumentfileid'), // 109
                prepareValue(pkg, 'labteststage'), // 110
                prepareValue(pkg, 'labtestingstatename'), // 111
                prepareValue(pkg, 'licensenumber'), // 112
                prepareValue(pkg, 'locationname'), // 113
                prepareValue(pkg, 'locationtypename'), // 114
                prepareValue(pkg, 'note'), // 115
                prepareValue(pkg, 'packagetype'), // 116
                prepareValue(pkg, 'packagedbyfacilitylicensenumber'), // 117
                prepareValue(pkg, 'packagedbyfacilityname'), // 118
                prepareValue(pkg, 'patientlicensenumber'), // 119
                prepareValue(pkg, 'productlabel'), // 120
                prepareValue(pkg, 'productionbatchnumber'), // 121
                prepareValue(pkg, 'receivedfromfacilitylicensenumber'), // 122
                prepareValue(pkg, 'receivedfromfacilityname'), // 123
                prepareValue(pkg, 'receivedfrommanifestnumber'), // 124
                prepareValue(pkg, 'sourceharvestnames'), // 125
                prepareValue(pkg, 'sourcepackagelabels'), // 126
                prepareValue(pkg, 'sourceprocessingjobnames'), // 127
                prepareValue(pkg, 'sourceprocessingjobnumbers'), // 128
                prepareValue(pkg, 'sourceproductionbatchnumbers'), // 129
                prepareValue(pkg, 'tradesamplefacilitylicensenumber'), // 130
                prepareValue(pkg, 'tradesamplefacilityname'), // 131
                prepareValue(pkg, 'transfermanifestnumber'), // 132
                prepareValue(pkg, 'trip'), // 133
                prepareValue(pkg, 'unit_of_measure_abbreviation'), // 134
                prepareValue(pkg, 'unitofmeasurequantitytype'), // 135
                pkg.id, // 136 - metrcid
                METRC_CONFIG.licenseNumber // 137 - sync_license
            ]);
        } catch (error) {
            console.error(`❌ Failed to update package ${pkg.id}:`, error.message);
        }
    }
}

/**
 * Update sync progress in the database
 */
async function updateSyncProgress(client, syncType, license, lastTimestamp = null) {
    try {
        const query = `
            INSERT INTO sync_progress (sync_type, license, last_timestamp, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (sync_type, license)
            DO UPDATE SET 
                last_timestamp = COALESCE($3, sync_progress.last_timestamp),
                updated_at = NOW()
        `;
        
        await client.query(query, [syncType, license, lastTimestamp]);
        console.log(`📊 Updated sync progress: ${syncType} for ${license}`);
    } catch (error) {
        console.error('❌ Error updating sync progress:', error.message);
    }
}

/**
 * Create sync job entry
 */
async function createSyncJob(client, scriptName, license, userId = null) {
    try {
        const jobId = require('crypto').randomUUID();
        const query = `
            INSERT INTO sync_jobs (job_id, license_number, script_name, status, start_time, triggered_by_user_id)
            VALUES ($1, $2, $3, 'running', NOW(), $4)
        `;
        
        await client.query(query, [jobId, license, scriptName, userId]);
        console.log(`📋 Created sync job: ${jobId} for ${scriptName}`);
        return jobId;
    } catch (error) {
        console.error('❌ Error creating sync job:', error.message);
        return null;
    }
}

/**
 * Update sync job status
 */
async function updateSyncJob(client, jobId, status, outputLog = null, errorLog = null) {
    try {
        const query = `
            UPDATE sync_jobs 
            SET status = $1, end_time = NOW(), output_log = $2, error_log = $3
            WHERE job_id = $4
        `;
        
        await client.query(query, [status, outputLog, errorLog, jobId]);
        console.log(`📋 Updated sync job: ${jobId} - ${status}`);
    } catch (error) {
        console.error('❌ Error updating sync job:', error.message);
    }
}

/**
 * Create sync history entry
 */
async function createSyncHistory(client, syncType, license, userId = null, scriptName = null) {
    try {
        const query = `
            INSERT INTO sync_history (license_number, sync_type, start_time, status, user_id, script_name)
            VALUES ($1, $2, NOW(), 'started', $3, $4)
            RETURNING id
        `;
        
        const result = await client.query(query, [license, syncType, userId, scriptName]);
        const historyId = result.rows[0].id;
        console.log(`📚 Created sync history: ${historyId} for ${syncType}`);
        return historyId;
    } catch (error) {
        console.error('❌ Error creating sync history:', error.message);
        return null;
    }
}

/**
 * Update sync history entry
 */
async function updateSyncHistory(client, historyId, status, durationMs = null, scriptOutput = null, scriptErrorOutput = null) {
    try {
        const query = `
            UPDATE sync_history 
            SET end_time = NOW(), status = $1, duration_ms = $2, script_output = $3, script_error_output = $4
            WHERE id = $5
        `;
        
        await client.query(query, [status, durationMs, scriptOutput, scriptErrorOutput, historyId]);
        console.log(`📚 Updated sync history: ${historyId} - ${status}`);
    } catch (error) {
        console.error('❌ Error updating sync history:', error.message);
    }
}

/**
 * Create sync batch history entry
 */
async function createSyncBatchHistory(client, syncType, userId = null) {
    try {
        const batchId = require('crypto').randomUUID();
        const query = `
            INSERT INTO sync_batch_history (batch_id, sync_type, overall_start_time, status, user_id)
            VALUES ($1, $2, NOW(), 'started', $3)
        `;
        
        await client.query(query, [batchId, syncType, userId]);
        console.log(`📦 Created sync batch: ${batchId} for ${syncType}`);
        return batchId;
    } catch (error) {
        console.error('❌ Error creating sync batch:', error.message);
        return null;
    }
}

/**
 * Update sync batch history entry
 */
async function updateSyncBatchHistory(client, batchId, status, durationMs = null, errorMessage = null) {
    try {
        const query = `
            UPDATE sync_batch_history 
            SET overall_end_time = NOW(), status = $1, overall_duration_ms = $2, error_message = $3
            WHERE batch_id = $4
        `;
        
        await client.query(query, [status, durationMs, errorMessage, batchId]);
        console.log(`📦 Updated sync batch: ${batchId} - ${status}`);
    } catch (error) {
        console.error('❌ Error updating sync batch:', error.message);
    }
}

/**
 * Enhanced sync active packages using Full Mirror Sync strategy
 */
async function syncActivePackagesEnhanced() {
    const client = await pool.connect();
    const startTime = Date.now();
    let jobId = null;
    let historyId = null;
    let batchId = null;
    let scriptOutput = '';
    let scriptError = '';
    
    try {
        console.log('🔄 Starting enhanced active packages sync (Full Mirror)...');
        
        // Create tracking entries
        jobId = await createSyncJob(client, 'sync-active-packages.js', METRC_CONFIG.licenseNumber);
        historyId = await createSyncHistory(client, 'active_packages', METRC_CONFIG.licenseNumber, null, 'sync-active-packages.js');
        batchId = await createSyncBatchHistory(client, 'active_packages');
        
        // Start transaction
        await client.query('BEGIN');
        
        // Fetch all packages from API (full sync - API doesn't support incremental)
        const apiPackages = await fetchActivePackages();
        
        if (apiPackages.length === 0) {
            console.log('ℹ️ No active packages to sync');
            await client.query('COMMIT');
            return;
        }
        
        // Categorize packages based on sync type
        const packagesToInsert = [];
        const packagesToUpdate = [];
        const packagesToDelete = [];
        
        // FULL SYNC: Compare with all existing packages
        console.log('🔄 Processing full sync - comparing with all existing packages');
        
        // Get existing packages from local database for THIS LICENSE ONLY
        const existingPackages = await getExistingPackages(client);
        
        // Process API packages
        for (const pkg of apiPackages) {
            const existing = existingPackages.get(pkg.id);
            
            if (!existing) {
                // New package - insert
                packagesToInsert.push(pkg);
            } else {
                // Existing package - check if needs update
                const apiLastModified = pkg.lastModified ? new Date(pkg.lastModified) : null;
                const localLastModified = existing.lastmodified;
                
                if (!apiLastModified || !localLastModified || apiLastModified > localLastModified) {
                    packagesToUpdate.push(pkg);
                }
            }
        }
        
        // Find packages to delete (exist locally but not in API)
        for (const [metrcid, existing] of existingPackages) {
            if (!apiPackages.find(pkg => pkg.id === metrcid)) {
                packagesToDelete.push(metrcid);
            }
        }
        
        console.log(`📊 Sync plan: ${packagesToInsert.length} insert, ${packagesToUpdate.length} update, ${packagesToDelete.length} delete`);
        
        // SAFETY CHECK: Prevent mass deletions
        if (packagesToDelete.length > 100) {
            console.error(`🚨 SAFETY CHECK FAILED: Attempting to delete ${packagesToDelete.length} packages. This exceeds the safety limit of 100.`);
            console.error(`🚨 This might indicate a sync logic error. Aborting sync to prevent data loss.`);
            await client.query('ROLLBACK');
            throw new Error(`Safety check failed: Too many deletions (${packagesToDelete.length} > 100). Sync aborted.`);
        }
        
        // Execute operations
        if (packagesToInsert.length > 0) {
            console.log('📥 Inserting new packages...');
            await processRecordsInChunks(client, packagesToInsert, 'INSERT');
        }
        
        if (packagesToUpdate.length > 0) {
            console.log('🔄 Updating existing packages...');
            await processRecordsInChunks(client, packagesToUpdate, 'UPDATE');
        }
        
        if (packagesToDelete.length > 0) {
            console.log('🗑️ Deleting stale packages...');
            const deleteQuery = `
                DELETE FROM activepackages 
                WHERE metrcid = ANY($1) AND sync_license = $2
            `;
            await client.query(deleteQuery, [packagesToDelete, METRC_CONFIG.licenseNumber]);
        }
        
        // Commit transaction
        await client.query('COMMIT');
        
        const duration = Date.now() - startTime;
        scriptOutput = `Active packages sync completed: ${packagesToInsert.length} inserted, ${packagesToUpdate.length} updated, ${packagesToDelete.length} deleted in ${duration}ms`;
        
        // Update all tracking entries
        await updateSyncJob(client, jobId, 'completed', scriptOutput);
        await updateSyncHistory(client, historyId, 'completed', duration, scriptOutput);
        await updateSyncBatchHistory(client, batchId, 'completed', duration);
        await updateSyncProgress(client, 'active_packages', METRC_CONFIG.licenseNumber, new Date());
        
        console.log(`✅ Enhanced sync completed: ${packagesToInsert.length} inserted, ${packagesToUpdate.length} updated, ${packagesToDelete.length} deleted`);
        
    } catch (error) {
        const duration = Date.now() - startTime;
        scriptError = error.message;
        
        console.error('❌ Enhanced sync failed:', error.message);
        await client.query('ROLLBACK');
        
        // Update tracking entries for failed sync
        if (jobId) await updateSyncJob(client, jobId, 'failed', scriptOutput, scriptError);
        if (historyId) await updateSyncHistory(client, historyId, 'failed', duration, scriptOutput, scriptError);
        if (batchId) await updateSyncBatchHistory(client, batchId, 'failed', duration, scriptError);
        
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Main execution function
 */
async function main() {
    try {
        console.log('🚀 Starting METRC Enhanced Active Packages Sync');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏢 License: ${METRC_CONFIG.licenseNumber}`);
        
        await syncActivePackagesEnhanced();
        
        console.log('✅ Enhanced active packages sync completed successfully');
        
    } catch (error) {
        console.error('❌ Enhanced active packages sync failed:', error.message);
        process.exit(1);
    } finally {
            await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
main();
}

module.exports = {
    syncActivePackagesEnhanced,
    fetchActivePackages
};
