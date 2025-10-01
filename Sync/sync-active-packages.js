const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

const API_BASE_URL = process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
const DB_CONFIG = {
    user: process.env.DB_USER || 'master',
    host: process.env.DB_HOST || 'n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || 'GreenReleaf123!',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
};
const API_CREDENTIALS = {
    hostname: process.env.T3_HOSTNAME || 'mo.metrc.com',
    username: process.env.T3_USERNAME || 'AGT007392',
    password: process.env.T3_PASSWORD || 'Metalhead3!',
};
const LOG_LEVEL_CONFIG = process.env.LOG_LEVEL || 'INFO';
const MAX_CONCURRENT_API_REQUESTS = parseInt(process.env.MAX_CONCURRENT_API_REQUESTS, 10) || 3;

let currentAccessToken = null;
let currentRefreshToken = null;
let isRefreshingToken = false;
let tokenRefreshSubscribers = [];

const pool = new Pool(DB_CONFIG);

const LOG_LEVELS = { DEBUG: 0, INFO: 1, STEP: 1, PROCESS: 1, FETCH: 1, AUTH: 1, DB: 1, API: 1, WARN: 2, ERROR: 3, FAIL: 3, DONE: 1, FUN: 1, CLEANUP: 1, SYNC: 1, INSERT: 1, UPDATE: 1, DELETE: 1, RETRY: 1 };

class ApiRequestTracker {
    constructor() {
        this.requestTimes = [];
        this.maxSamples = 50;
    }

    addRequestTime(timeMs) {
        this.requestTimes.push(timeMs);
        if (this.requestTimes.length > this.maxSamples) {
            this.requestTimes.shift();
        }
    }

    getAverageTime() {
        if (this.requestTimes.length === 0) return 5000;
        return this.requestTimes.reduce((a, b) => a + b, 0) / this.requestTimes.length;
    }

    isRequestHanging(timeMs) {
        const average = this.getAverageTime();
        return timeMs > (average * 20);
    }

    getExtendedTimeout() {
        const average = this.getAverageTime();
        return Math.max(average * 50, 300000);
    }
}

const apiTracker = new ApiRequestTracker();

async function makeApiRequestWithRetry(requestFunc, maxRetries = 3, extendedRetries = 3) {
    let normalAttempts = 0;
    let extendedAttempts = 0;

    while (normalAttempts < maxRetries) {
        const startTime = Date.now();
        try {
            const result = await requestFunc();
            const duration = Date.now() - startTime;
            apiTracker.addRequestTime(duration);
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;

            if (error.code === 'ECONNABORTED' || apiTracker.isRequestHanging(duration)) {
                normalAttempts++;
                logFun(`API request timed out or hanging (${duration}ms vs avg ${apiTracker.getAverageTime().toFixed(0)}ms). Normal attempt ${normalAttempts}/${maxRetries}`, 'RETRY');
                if (normalAttempts < maxRetries) continue;
            } else {
                apiTracker.addRequestTime(duration);
                throw error;
            }
        }
    }

    while (extendedAttempts < extendedRetries) {
        const startTime = Date.now();
        const extendedTimeout = apiTracker.getExtendedTimeout();

        try {
            const result = await requestFunc(extendedTimeout);
            const duration = Date.now() - startTime;
            apiTracker.addRequestTime(duration);
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            extendedAttempts++;
            logFun(`Extended API request failed (${duration}ms with ${extendedTimeout}ms timeout). Extended attempt ${extendedAttempts}/${extendedRetries}`, 'RETRY');

            if (extendedAttempts < extendedRetries) continue;

            logFun(`API request failed after all retries. Skipping this request.`, 'FAIL');
            return null;
        }
    }

    return null;
}

pool.on('error', (err, client) => {
    logFun(`DATABASE POOL ERROR: ${err.message}`, 'ERROR', err.stack);
    process.exit(-1);
});

function logFun(message, level = 'INFO', details = '') {
    if (LOG_LEVELS[level] === undefined || LOG_LEVELS[LOG_LEVEL_CONFIG] === undefined) {
        console.log(`UNKNOWN_LOG_LEVEL ${level}: ${message}${details ? `\n${details}` : ''}`);
        return;
    }
    if (LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL_CONFIG]) {
        const prefixes = {
            INFO: 'ℹ️  INFO:', WARN: '⚠️  WARN:', ERROR: '❌ ERROR:', FUN: '🎉 FUN:', STEP: '🚀 STEP:',
            DB: '💾 DB:', API: '☁️  API:', AUTH: '🔑 AUTH:', FETCH: '🎣 FETCH:', PROCESS: '⚙️  PROCESS:',
            SYNC: '🔄 SYNC:', DONE: '✅ DONE:', FAIL: '💥 FAIL:', RETRY: '🔄 RETRY:', CLEANUP: '🧼 CLEANUP:',
            INSERT: '➕ INSERT:', UPDATE: '✍️ UPDATE:', DELETE: '➖ DELETE:', DEBUG: '🐞 DEBUG:'
        };
        console.log(`${prefixes[level] || prefixes['INFO']} ${message}${details ? `\n${details}` : ''}`);
    }
}

function areValuesDifferent(val1, val2, columnType = 'string', compareDateOnly = false) {
    const val1IsNull = (val1 === null || val1 === undefined);
    const val2IsNull = (val2 === null || val2 === undefined);
    if (val1IsNull && val2IsNull) return false;
    if (val1IsNull || val2IsNull) return true;

    try {
        if (columnType === 'date') {
            const date1 = new Date(val1);
            const date2 = new Date(val2);
            const isDate1Invalid = isNaN(date1.getTime());
            const isDate2Invalid = isNaN(date2.getTime());
            if (isDate1Invalid && isDate2Invalid) return false;
            if (isDate1Invalid || isDate2Invalid) return true;

            if (compareDateOnly) {
                const date1_ymd = `${date1.getUTCFullYear()}-${String(date1.getUTCMonth() + 1).padStart(2, '0')}-${String(date1.getUTCDate()).padStart(2, '0')}`;
                const date2_ymd = `${date2.getUTCFullYear()}-${String(date2.getUTCMonth() + 1).padStart(2, '0')}-${String(date2.getUTCDate()).padStart(2, '0')}`;
                return date1_ymd !== date2_ymd;
            } else {
                return date1.getTime() !== date2.getTime();
            }
        } else if (columnType === 'number') {
            const num1 = Number(val1);
            const num2 = Number(val2);
            if (isNaN(num1) && isNaN(num2)) return false;
            if (isNaN(num1) || isNaN(num2)) return true;
            return num1 !== num2;
        } else if (columnType === 'boolean') {
            const bool1 = /^(true|1|t|y)$/i.test(String(val1).trim());
            const bool2 = /^(true|1|t|y)$/i.test(String(val2).trim());
            return bool1 !== bool2;
        } else {
            const str1 = (val1 === null || val1 === undefined) ? '' : String(val1).trim();
            const str2 = (val2 === null || val2 === undefined) ? '' : String(val2).trim();
            return str1 !== str2;
        }
    } catch (e) {
        logFun(`Comparison error for type '${columnType}' values '${val1}' (${typeof val1}) and '${val2}' (${typeof val2}): ${e.message}. Assuming different.`, 'WARN');
        return true;
    }
}

async function getJwtToken(needsRefresh = false) {
    if (isRefreshingToken) {
        return new Promise(resolve => tokenRefreshSubscribers.push(resolve));
    }
    if (needsRefresh && !currentRefreshToken) {
        logFun('Refresh requested but no refresh token available. Getting new token.', 'AUTH');
        needsRefresh = false;
    }
    isRefreshingToken = true;
    logFun('Initiating Authentication Process for Active Packages...', 'STEP');
    logFun(`Auth Type: ${needsRefresh ? 'TOKEN REFRESH' : 'NEW TOKEN WITH CREDENTIALS'}`, 'AUTH');

    const makeAuthRequest = async (customTimeout = null) => {
        const timeout = customTimeout || 30000;
        if (needsRefresh && currentRefreshToken) {
            logFun('Sending refresh token request...', 'API');
            return await axios.post(`${API_BASE_URL}/auth/refresh`, {}, {
                headers: { 'Authorization': `Bearer ${currentRefreshToken}`, 'accept': 'application/json' },
                timeout: timeout
            });
        } else {
            logFun('Sending credential authentication request...', 'API');
            return await axios.post(`${API_BASE_URL}/auth/credentials`, API_CREDENTIALS, {
                headers: {'Content-Type': 'application/json', 'accept': 'application/json'},
                timeout: timeout
            });
        }
    };

    try {
        const response = await makeApiRequestWithRetry(makeAuthRequest);

        if (!response) {
            throw new Error('Authentication failed after all retries');
        }

        if (response.data && response.data.accessToken) {
            currentAccessToken = response.data.accessToken;
            currentRefreshToken = response.data.refreshToken || currentRefreshToken;
            logFun('Authentication successful!', 'DONE');
            isRefreshingToken = false;
            tokenRefreshSubscribers.forEach(resolve => resolve(currentAccessToken));
            tokenRefreshSubscribers = [];
            return currentAccessToken;
        } else {
            throw new Error('Token data missing from auth response.');
        }
    } catch (error) {
        isRefreshingToken = false;
        tokenRefreshSubscribers.forEach(resolve => resolve(null));
        tokenRefreshSubscribers = [];
        logFun('Authentication Error!', 'FAIL', error.message + (error.response ? `\nStatus: ${error.response.status} Data: ${JSON.stringify(error.response.data)}` : ''));
        throw new Error('JWT acquisition/refresh failed.');
    }
}

async function fetchPageDataActivePackages(syncLicense, page, pageSize) {
    if (!currentAccessToken) {
        logFun("No access token found, fetching initial token for Active Packages page fetch.", 'AUTH');
        await getJwtToken(false);
        if(!currentAccessToken) throw new Error("Failed to get token for Active Packages page fetch.");
    }

    const url = `${API_BASE_URL}/packages/active`;
    const params = {
        licenseNumber: syncLicense,
        strictPagination: true,
        pageSize: pageSize,
        page: page,
    };

    logFun(`Fetching Active Packages Page ${page} for license ${syncLicense}`, 'FETCH');

    const makePageRequest = async (customTimeout = null) => {
        const timeout = customTimeout || 180000;
        return await axios.get(url, {
            params: params,
            headers: { 'Authorization': `Bearer ${currentAccessToken}`, 'accept': 'application/json' },
            timeout: timeout
        });
    };

    let retries = 1;
    while(retries >= 0) {
        try {
            const response = await makeApiRequestWithRetry(makePageRequest);

            if (!response) {
                if (retries > 0) {
                    logFun(`Page request failed after retries, attempting token refresh...`, 'RETRY');
                    try {
                        await getJwtToken(true);
                        retries--;
                        continue;
                    } catch (refreshError) {
                        logFun(`Token refresh failed: ${refreshError.message}`, 'FAIL');
                        throw refreshError;
                    }
                } else {
                    logFun(`Page ${page} request failed after all attempts`, 'FAIL');
                    return { data: [], total: 0 };
                }
            }

            logFun(`API request for Active Packages page ${page} completed. Status: ${response.status}`, 'API');
            return response.data;
        } catch (error) {
            logFun(`API Error during fetch for Active Packages page ${page}!`, 'FAIL', error.message);
            if (error.response) {
                logFun(`Status: ${error.response.status}`, 'FAIL');
                const responseData = error.response.data;
                const errorMessage = responseData?.error?.message || responseData?.msg || '';
                const needsTokenRefresh = error.response.status === 401 || error.response.status === 422 || errorMessage.includes("Not enough segments");

                if (needsTokenRefresh && retries > 0) {
                    logFun('Token expired/invalid. Attempting refresh...', 'RETRY');
                    try {
                        await getJwtToken(true);
                        logFun(`Retrying fetch for Active Packages page ${page}`, 'RETRY');
                        retries--;
                        continue;
                    } catch (refreshError) {
                        logFun(`Token refresh failed: ${refreshError.message}`, 'FAIL');
                        throw refreshError;
                    }
                } else if (error.response.status === 400) {
                    logFun('Received 400 Bad Request for Active Packages, assuming end of pagination.', 'FETCH');
                    return { data: [], total: 0 };
                }
            }
            throw error;
        }
    }
}

async function fetchAllActivePackages(syncLicense) {
    logFun('Starting Data Fetch for Active Packages (Full)...', 'STEP');
    let allData = [];
    let currentPage = 1;
    const pageSize = 500;
    let totalItems = 0;
    let totalPages = 0;

    const firstPageData = await fetchPageDataActivePackages(syncLicense, currentPage, pageSize);
    if (firstPageData && firstPageData.data) {
        allData = allData.concat(firstPageData.data);
        totalItems = firstPageData.total || 0;
        totalPages = totalItems > 0 ? Math.ceil(totalItems / pageSize) : 0;
        logFun(`Active Packages First page: ${firstPageData.data.length} items. Total items: ${totalItems}. Total pages: ${totalPages}.`, 'FETCH');
        if (firstPageData.data.length > 0 && currentPage === 1) {
            const sampleItem = firstPageData.data[0];
            const sampleFields = { id: sampleItem.id, label: sampleItem.label, item: { name: sampleItem.item?.name }, quantity: sampleItem.quantity, unitOfMeasureAbbreviation: sampleItem.unitOfMeasureAbbreviation, lastModified: sampleItem.lastModified };
            logFun(`Sample API Data (first item): ${JSON.stringify(sampleFields)}`, 'DEBUG');
        }
    } else {
        logFun('No data or unexpected format from Active Packages first page fetch.', 'WARN');
        return [];
    }

    if (totalPages <= 1) {
        logFun(`Total Active Packages fetched: ${allData.length}`, 'DONE');
        return allData;
    }

    const pagePromises = [];
    for (let i = currentPage + 1; i <= totalPages; i++) {
        pagePromises.push(fetchPageDataActivePackages(syncLicense, i, pageSize));
    }

    const results = await Promise.allSettled(pagePromises);
    results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value && result.value.data) {
            allData = allData.concat(result.value.data);
            logFun(`Fetched Active Packages page ${index + 2} with ${result.value.data.length} items.`, 'DEBUG');
        } else {
            logFun(`Failed to fetch Active Packages page ${index + 2}: ${result.reason ? result.reason.message : 'Unknown error'}`, 'WARN');
        }
    });

    logFun(`Total Active Packages items fetched after all pages: ${allData.length}`, 'DONE');
    return allData;
}

async function fetchDbActivePackages(client, syncLicense) {
    logFun(`Fetching existing DB data from 'activepackages' for license: ${syncLicense}`, 'FETCH');
    try {
        const query = "SELECT * FROM activepackages WHERE synclicense = $1";
        const result = await client.query(query, [syncLicense]);
        logFun(`Found ${result.rowCount} existing DB records for active packages.`, 'DONE');
        if (result.rowCount > 0) {
            const sample = result.rows[0];
            logFun(`Sample DB Data (first item): ${JSON.stringify({ metrcid: sample.metrcid, label: sample.label, item_name: sample.item_name, lastmodified: sample.lastmodified })}`, 'DEBUG');
        }
        return result.rows;
    } catch (error) {
        logFun(`Error fetching existing activepackages DB data: ${error.message}`, 'FAIL');
        throw error;
    }
}

async function fetchInactivePackageLabels(client, syncLicense) {
    logFun(`Fetching inactive package labels for license: ${syncLicense}`, 'FETCH');
    try {
        const query = "SELECT label FROM inactivepackages WHERE synclicense = $1 AND label IS NOT NULL";
        const result = await client.query(query, [syncLicense]);
        const labels = new Set(result.rows.map(row => row.label));
        logFun(`Found ${labels.size} unique inactive package labels.`, 'DONE');
        return labels;
    } catch (error) {
        logFun(`Error fetching inactive package labels: ${error.message}`, 'FAIL');
        logFun('Continuing sync without inactive package filter. This may result in incorrect data.', 'WARN');
        return new Set();
    }
}

function mapDbColToApiKey_ActivePackages(dbColumn) {
    const map = {
        metrcid: 'id', containsdecontaminatedproduct: 'containsDecontaminatedProduct', containsremediatedproduct: 'containsRemediatedProduct', haspartial: 'hasPartial', isarchived: 'isArchived',
        isdonation: 'isDonation', isdonationpersistent: 'isDonationPersistent', isfinished: 'isFinished', isintransit: 'isInTransit', isonhold: 'isOnHold',
        isonrecall: 'isOnRecall', isonretailerdelivery: 'isOnRetailerDelivery', isontrip: 'isOnTrip', ispartial: 'isPartial',
        isprocessvalidationtestingsample: 'isProcessValidationTestingSample', isproductionbatch: 'isProductionBatch', istestingsample: 'isTestingSample',
        istradesample: 'isTradeSample', istradesamplepersistent: 'isTradeSamplePersistent', item_isarchived: 'item.isArchived', item_isused: 'item.isUsed',
        item_productcategoryrequiresapproval: 'item.productCategoryRequiresApproval', multiharvest: 'multiHarvest', multipackage: 'multiPackage',
        multiprocessingjob: 'multiProcessingJob', multiproductionbatch: 'multiProductionBatch', packageforproductdestruction: 'packageForProductDestruction',
        productrequiresdecontamination: 'productRequiresDecontamination', productrequiresremediation: 'productRequiresRemediation',
        sourcepackageisdonation: 'sourcePackageIsDonation', sourcepackageistradesample: 'sourcePackageIsTradeSample', quantity: 'quantity', unitofmeasureid: 'unitOfMeasureId',
        sourceharvestcount: 'sourceHarvestCount', sourcepackagecount: 'sourcePackageCount', sourceprocessingjobcount: 'sourceProcessingJobCount', labteststageid: 'labTestStageId',
        processingjobtypeid: 'processingJobTypeId', item_expirationdatedaysinadvance: 'item.expirationDateDaysInAdvance', item_id: 'item.id', item_itembrandid: 'item.itemBrandId',
        item_numberofdoses: 'item.numberOfDoses', item_processingjobcategoryid: 'item.processingJobCategoryId', item_processingjobtypeid: 'item.processingJobTypeId',
        item_productcategoryid: 'item.productCategoryId', item_sellbydatedaysinadvance: 'item.sellByDateDaysInAdvance', item_strainid: 'item.strainId',
        item_supplydurationdays: 'item.supplyDurationDays', item_unitcbdcontent: 'item.unitCbdContent', item_unitcbdcontentdose: 'item.unitCbdContentDose',
        item_unitofmeasureid: 'item.unitOfMeasureId', item_unitquantity: 'item.unitQuantity', item_unitthccontent: 'item.unitThcContent', item_unitthcpercent: 'item.unitThcPercent',
        item_unitweight: 'item.unitWeight', item_usebydatedaysinadvance: 'item.useByDateDaysInAdvance', archiveddate: 'archivedDate', decontaminationdate: 'decontaminationDate',
        expirationdate: 'expirationDate', finisheddate: 'finishedDate', item_approvalstatusdatetime: 'item.approvalStatusDateTime', item_lastmodified: 'item.lastModified',
        labtestresultexpirationdatetime: 'labTestResultExpirationDateTime', labtestingperformeddate: 'labTestingPerformedDate', labtestingrecordeddate: 'labTestingRecordedDate',
        labtestingstatedate: 'labTestingStateDate', lastmodified: 'lastModified', packageddate: 'packagedDate', receiveddatetime: 'receivedDateTime', remediationdate: 'remediationDate',
        retrievedat: 'retrievedAt', sellbydate: 'sellByDate', usebydate: 'useByDate', datamodel: 'dataModel', donationfacilitylicensenumber: 'donationFacilityLicenseNumber',
        donationfacilityname: 'donationFacilityName', facilitylicensenumber: 'facilityLicenseNumber', facilityname: 'facilityName', intransitstatus: 'inTransitStatus',
        index: 'index', initiallabtestingstate: 'initialLabTestingState', item_administrationmethod: 'item.administrationMethod',
        item_administrationmethodoverride: 'item.administrationMethodOverride', item_allergens: 'item.allergens', item_allergensoverride: 'item.allergensOverride',
        item_approvalstatusname: 'item.approvalStatusName', item_brandname: 'item.brandName', item_defaultlabtestingstatename: 'item.defaultLabTestingStateName',
        item_description: 'item.description', item_descriptionoverride: 'item.descriptionOverride', item_expirationconfigurationstate: 'item.expirationConfigurationState',
        item_expirationdateconfiguration: 'item.expirationDateConfiguration', item_facilitylicensenumber: 'item.facilityLicenseNumber', item_facilityname: 'item.facilityName',
        item_globalproductid: 'item.globalProductId', item_globalproductname: 'item.globalProductName', item_itembrandname: 'item.itemBrandName', item_name: 'item.name',
        item_processingjobcategoryname: 'item.processingJobCategoryName', item_processingjobtypename: 'item.processingJobTypeName', item_productbrandname: 'item.productBrandName',
        item_productcategoryname: 'item.productCategoryName', item_productcategorytypename: 'item.productCategoryTypeName', item_publicingredients: 'item.publicIngredients',
        item_publicingredientsoverride: 'item.publicIngredientsOverride', item_quantitytypename: 'item.quantityTypeName', item_sellbyconfigurationstate: 'item.sellByConfigurationState',
        item_sellbydateconfiguration: 'item.sellByDateConfiguration', item_servingsize: 'item.servingSize', item_strainname: 'item.strainName',
        item_unitofmeasurename: 'item.unitOfMeasureName', item_usebyconfigurationstate: 'item.useByConfigurationState', item_usebydateconfiguration: 'item.useByDateConfiguration',
        itemfromfacilitylicensenumber: 'itemFromFacilityLicenseNumber', itemfromfacilityname: 'itemFromFacilityName', labtestresultdocumentfileid: 'labTestResultDocumentFileId',
        labteststage: 'labTestStage', labtestingstatename: 'labTestingStateName', label: 'label', licensenumber: 'licenseNumber', locationname: 'locationName',
        locationtypename: 'locationTypeName', note: 'note', packagetype: 'packageType', packagedbyfacilitylicensenumber: 'packagedByFacilityLicenseNumber',
        packagedbyfacilityname: 'packagedByFacilityName', patientlicensenumber: 'patientLicenseNumber', productlabel: 'productLabel',
        productionbatchnumber: 'productionBatchNumber', receivedfromfacilitylicensenumber: 'receivedFromFacilityLicenseNumber', receivedfromfacilityname: 'receivedFromFacilityName',
        receivedfrommanifestnumber: 'receivedFromManifestNumber', sourceharvestnames: 'sourceHarvestNames', sourcepackagelabels: 'sourcePackageLabels',
        sourceprocessingjobnames: 'sourceProcessingJobNames', sourceprocessingjobnumbers: 'sourceProcessingJobNumbers', sourceproductionbatchnumbers: 'sourceProductionBatchNumbers',
        tradesamplefacilitylicensenumber: 'tradeSampleFacilityLicenseNumber', tradesamplefacilityname: 'tradeSampleFacilityName', transfermanifestnumber: 'transferManifestNumber',
        trip: 'trip', unitofmeasureabbreviation: 'unitOfMeasureAbbreviation', unitofmeasurequantitytype: 'unitOfMeasureQuantityType'
    };
    return map[dbColumn] || dbColumn;
}

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

const ACTIVE_PACKAGE_COLUMNS = [
    { name: "metrcid", type: "number", isId: true }, { name: "containsdecontaminatedproduct", type: "boolean" }, { name: "containsremediatedproduct", type: "boolean" },
    { name: "haspartial", type: "boolean" }, { name: "isarchived", type: "boolean" }, { name: "isdonation", type: "boolean" }, { name: "isdonationpersistent", type: "boolean" },
    { name: "isfinished", type: "boolean" }, { name: "isintransit", type: "boolean" }, { name: "isonhold", type: "boolean" }, { name: "isonrecall", type: "boolean" },
    { name: "isonretailerdelivery", type: "boolean" }, { name: "isontrip", type: "boolean" }, { name: "ispartial", type: "boolean" },
    { name: "isprocessvalidationtestingsample", type: "boolean" }, { name: "isproductionbatch", type: "boolean" }, { name: "istestingsample", type: "boolean" },
    { name: "istradesample", type: "boolean" }, { name: "istradesamplepersistent", type: "boolean" }, { name: "item_isarchived", type: "boolean" },
    { name: "item_isused", type: "boolean" }, { name: "item_productcategoryrequiresapproval", type: "boolean" }, { name: "multiharvest", type: "boolean" },
    { name: "multipackage", type: "boolean" }, { name: "multiprocessingjob", type: "boolean" }, { name: "multiproductionbatch", type: "boolean" },
    { name: "packageforproductdestruction", type: "boolean" }, { name: "productrequiresdecontamination", type: "boolean" },
    { name: "productrequiresremediation", type: "boolean" }, { name: "sourcepackageisdonation", type: "boolean" }, { name: "sourcepackageistradesample", type: "boolean" },
    { name: "quantity", type: "number" }, { name: "unitofmeasureid", type: "number" }, { name: "sourceharvestcount", type: "number" },
    { name: "sourcepackagecount", type: "number" }, { name: "sourceprocessingjobcount", type: "number" }, { name: "labteststageid", type: "number" },
    { name: "processingjobtypeid", type: "number" }, { name: "item_expirationdatedaysinadvance", type: "number" }, { name: "item_id", type: "number" },
    { name: "item_itembrandid", type: "number" }, { name: "item_numberofdoses", type: "number" }, { name: "item_processingjobcategoryid", type: "number" },
    { name: "item_processingjobtypeid", type: "number" }, { name: "item_productcategoryid", type: "number" }, { name: "item_sellbydatedaysinadvance", type: "number" },
    { name: "item_strainid", type: "number" }, { name: "item_supplydurationdays", type: "number" }, { name: "item_unitcbdcontent", type: "number" },
    { name: "item_unitcbdcontentdose", type: "number" }, { name: "item_unitofmeasureid", type: "number" }, { name: "item_unitquantity", type: "number" },
    { name: "item_unitthccontent", type: "number" }, { name: "item_unitthcpercent", type: "number" }, { name: "item_unitweight", type: "number" },
    { name: "item_usebydatedaysinadvance", type: "number" }, { name: "archiveddate", type: "date", compareDateOnly: true },
    { name: "decontaminationdate", type: "date", compareDateOnly: true }, { name: "expirationdate", type: "date", compareDateOnly: true },
    { name: "finisheddate", type: "date", compareDateOnly: true }, { name: "item_approvalstatusdatetime", type: "date" }, { name: "item_lastmodified", type: "date" },
    { name: "labtestresultexpirationdatetime", type: "date" }, { name: "labtestingperformeddate", type: "date", compareDateOnly: true },
    { name: "labtestingrecordeddate", type: "date", compareDateOnly: true }, { name: "labtestingstatedate", type: "date", compareDateOnly: true },
    { name: "lastmodified", type: "date" }, { name: "packageddate", type: "date", compareDateOnly: true }, { name: "receiveddatetime", type: "date" },
    { name: "remediationdate", type: "date", compareDateOnly: true }, { name: "retrievedat", type: "date", excludeFromComparison: true },
    { name: "sellbydate", type: "date", compareDateOnly: true }, { name: "usebydate", type: "date", compareDateOnly: true }, { name: "datamodel", type: "string" },
    { name: "donationfacilitylicensenumber", type: "string" }, { name: "donationfacilityname", type: "string" }, { name: "facilitylicensenumber", type: "string" },
    { name: "facilityname", type: "string" }, { name: "intransitstatus", type: "string" }, { name: "index", type: "string" }, { name: "initiallabtestingstate", type: "string" },
    { name: "item_administrationmethod", type: "string" }, { name: "item_administrationmethodoverride", type: "string" }, { name: "item_allergens", type: "string" },
    { name: "item_allergensoverride", type: "string" }, { name: "item_approvalstatusname", type: "string" }, { name: "item_brandname", type: "string" },
    { name: "item_defaultlabtestingstatename", type: "string" }, { name: "item_description", type: "string" }, { name: "item_descriptionoverride", type: "string" },
    { name: "item_expirationconfigurationstate", type: "string" }, { name: "item_expirationdateconfiguration", type: "string" },
    { name: "item_facilitylicensenumber", type: "string" }, { name: "item_facilityname", type: "string" }, { name: "item_globalproductid", type: "string" },
    { name: "item_globalproductname", type: "string" }, { name: "item_itembrandname", type: "string" }, { name: "item_name", type: "string" },
    { name: "item_processingjobcategoryname", type: "string" }, { name: "item_processingjobtypename", type: "string" }, { name: "item_productbrandname", type: "string" },
    { name: "item_productcategoryname", type: "string" }, { name: "item_productcategorytypename", type: "string" }, { name: "item_publicingredients", type: "string" },
    { name: "item_publicingredientsoverride", type: "string" }, { name: "item_quantitytypename", type: "string" }, { name: "item_sellbyconfigurationstate", type: "string" },
    { name: "item_sellbydateconfiguration", type: "string" }, { name: "item_servingsize", type: "string" }, { name: "item_strainname", type: "string" },
    { name: "item_unitofmeasurename", type: "string" }, { name: "item_usebyconfigurationstate", type: "string" }, { name: "item_usebydateconfiguration", type: "string" },
    { name: "itemfromfacilitylicensenumber", type: "string" }, { name: "itemfromfacilityname", type: "string" }, { name: "labtestresultdocumentfileid", type: "string" },
    { name: "labteststage", type: "string" }, { name: "labtestingstatename", type: "string" }, { name: "label", type: "string" }, { name: "licensenumber", type: "string" },
    { name: "locationname", type: "string" }, { name: "locationtypename", type: "string" }, { name: "note", type: "string" }, { name: "packagetype", type: "string" },
    { name: "packagedbyfacilitylicensenumber", type: "string" }, { name: "packagedbyfacilityname", type: "string" }, { name: "patientlicensenumber", type: "string" },
    { name: "productlabel", type: "string" }, { name: "productionbatchnumber", type: "string" }, { name: "receivedfromfacilitylicensenumber", type: "string" },
    { name: "receivedfromfacilityname", type: "string" }, { name: "receivedfrommanifestnumber", type: "string" }, { name: "sourceharvestnames", type: "string" },
    { name: "sourcepackagelabels", type: "string" }, { name: "sourceprocessingjobnames", type: "string" }, { name: "sourceprocessingjobnumbers", type: "string" },
    { name: "sourceproductionbatchnumbers", type: "string" }, { name: "tradesamplefacilitylicensenumber", type: "string" },
    { name: "tradesamplefacilityname", type: "string" }, { name: "transfermanifestnumber", type: "string" }, { name: "trip", type: "string" },
    { name: "unitofmeasureabbreviation", type: "string" }, { name: "unitofmeasurequantitytype", type: "string" }
];

const PACKAGE_COLUMNS_TO_ROUND = [
    "quantity", "item_numberofdoses", "item_unitcbdcontent", "item_unitcbdcontentdose",
    "item_unitquantity", "item_unitthccontent", "item_unitthcpercent", "item_unitweight"
];

function prepareValue_Packages(item, columnDef, syncLicense) {
    const { name: dbCol, type } = columnDef;
    if (dbCol === 'synclicense') return syncLicense;

    const apiKeyPath = mapDbColToApiKey_ActivePackages(dbCol);
    const val = getNestedValue(item, apiKeyPath);

    if (val === undefined || val === null) return null;

    const needsRounding = PACKAGE_COLUMNS_TO_ROUND.includes(dbCol);

    if (needsRounding && type === 'number') {
        const num = Number(val);
        return !isNaN(num) ? Math.round(num) : null;
    }
    if (type === 'number') {
        const num = Number(val);
        return !isNaN(num) ? num : null;
    }
    if (type === 'boolean') {
        return /^(true|1|t|y)$/i.test(String(val).trim());
    }
    if (type === 'date') {
        try {
            const date = new Date(val);
            if (!isNaN(date.getTime())) return date.toISOString();
            if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
                const dateOnly = new Date(val + 'T00:00:00Z');
                if (!isNaN(dateOnly.getTime())) return dateOnly.toISOString();
            }
            return null;
        } catch (e) {
            logFun(`Error parsing date value '${val}' for column ${dbCol}: ${e.message}`, 'WARN');
            return null;
        }
    }
    return String(val).trim();
}

async function compareAndSyncData_Packages(apiData, dbData, syncLicense, client) {
    logFun(`Starting Package Data Comparison & Sync (API: ${apiData.length}, DB: ${dbData.length})...`, 'STEP');

    const dbDataMap = new Map(dbData.map(item => [item.metrcid, item]));
    const recordsToInsert = [];
    const recordsToUpdate = [];
    const metrcIdsToDelete = [];
    let processedApiCount = 0;

    const idColumnDef = ACTIVE_PACKAGE_COLUMNS.find(c => c.isId);
    if (!idColumnDef) throw new Error("ID column definition missing in ACTIVE_PACKAGE_COLUMNS");
    const idApiKeyPath = mapDbColToApiKey_ActivePackages(idColumnDef.name);

    for (const apiItem of apiData) {
        processedApiCount++;
        const apiMetrcId = getNestedValue(apiItem, idApiKeyPath);
        if (apiMetrcId === undefined || apiMetrcId === null) {
            logFun(`Skipping API item ${processedApiCount} due to missing ID ('${idApiKeyPath}')`, 'WARN');
            continue;
        }

        const dbItem = dbDataMap.get(apiMetrcId);
        if (dbItem) {
            let needsUpdate = false;
            const updateValues = { metrcid: apiMetrcId };
            for (const colDef of ACTIVE_PACKAGE_COLUMNS) {
                if (colDef.isId || colDef.excludeFromComparison) continue;
                const dbValue = dbItem[colDef.name];
                const apiValuePrepared = prepareValue_Packages(apiItem, colDef, syncLicense);
                if (areValuesDifferent(dbValue, apiValuePrepared, colDef.type, colDef.compareDateOnly || false)) {
                    needsUpdate = true;
                    updateValues[colDef.name] = apiValuePrepared;
                }
            }
            if (needsUpdate) recordsToUpdate.push(updateValues);
            dbDataMap.delete(apiMetrcId);
        } else {
            const insertValues = {};
            for (const colDef of ACTIVE_PACKAGE_COLUMNS) {
                insertValues[colDef.name] = prepareValue_Packages(apiItem, colDef, syncLicense);
            }
            insertValues.synclicense = syncLicense;
            recordsToInsert.push(insertValues);
        }
    }

    dbDataMap.forEach((_value, key) => metrcIdsToDelete.push(key));
    logFun(`Comparison complete: ${recordsToInsert.length} Inserts, ${recordsToUpdate.length} Updates, ${metrcIdsToDelete.length} Deletes.`, 'PROCESS');

    await client.query('BEGIN');
    let insertCount = 0; let updateCount = 0; let deleteCount = 0;
    let errorCount = 0; let firstError = null;

    try {
        if (recordsToInsert.length > 0) {
            logFun(`Executing ${recordsToInsert.length} INSERTs in chunks...`, 'INSERT');
            const columns = ACTIVE_PACKAGE_COLUMNS.map(c => c.name).concat(['synclicense']);
            const columnNames = columns.map(c => `"${c}"`).join(', ');
            const numColumns = columns.length;
            const PG_PARAMETER_LIMIT = 65000;
            const chunkSize = Math.floor(PG_PARAMETER_LIMIT / numColumns);
            logFun(`Calculated chunk size: ${chunkSize} rows per batch.`, 'DEBUG');

            for (let i = 0; i < recordsToInsert.length; i += chunkSize) {
                const chunk = recordsToInsert.slice(i, i + chunkSize);
                const chunkNumber = (i / chunkSize) + 1;
                const totalChunks = Math.ceil(recordsToInsert.length / chunkSize);
                logFun(`Inserting chunk ${chunkNumber} of ${totalChunks} (${chunk.length} rows)...`, 'INSERT');

                const allChunkValuesFlat = [];
                const valuePlaceholdersRows = [];
                let placeholderCounter = 1;

                for (const record of chunk) {
                    const currentRowPlaceholders = [];
                    for (const colName of columns) {
                        allChunkValuesFlat.push(record[colName]);
                        currentRowPlaceholders.push(`$${placeholderCounter++}`);
                    }
                    valuePlaceholdersRows.push(`(${currentRowPlaceholders.join(', ')})`);
                }

                if (valuePlaceholdersRows.length > 0) {
                    const insertQuery = `INSERT INTO activepackages (${columnNames}) VALUES ${valuePlaceholdersRows.join(', ')};`;
                    const result = await client.query(insertQuery, allChunkValuesFlat);
                    insertCount += result.rowCount;
                }
            }
        }

        if (recordsToUpdate.length > 0) {
            logFun(`Executing ${recordsToUpdate.length} UPDATEs (individually)...`, 'UPDATE');
            for (const record of recordsToUpdate) {
                const updateCols = Object.keys(record).filter(k => k !== 'metrcid');
                if (updateCols.length === 0) continue;
                const setClause = updateCols.map((col, i) => `"${col}" = $${i + 1}`).join(', ');
                const values = updateCols.map(col => record[col]); values.push(record.metrcid);
                const updateQuery = `UPDATE activepackages SET ${setClause} WHERE metrcid = $${values.length};`;
                try {
                    const result = await client.query(updateQuery, values);
                    if(result.rowCount > 0) updateCount++;
                } catch (dbError) {
                    errorCount++;
                    logFun(`Failed to UPDATE package ${record.metrcid}. Error: ${dbError.message}`, 'FAIL');
                    if (!firstError) firstError = dbError;
                }
            }
        }

        if (metrcIdsToDelete.length > 0) {
            logFun(`Executing ${metrcIdsToDelete.length} DELETEs...`, 'DELETE');
            const deleteQuery = `DELETE FROM activepackages WHERE metrcid = ANY($1::int[]) AND synclicense = $2`;
            try {
                const result = await client.query(deleteQuery, [metrcIdsToDelete, syncLicense]);
                deleteCount = result.rowCount;
            } catch (dbError) {
                errorCount++;
                logFun(`Failed to bulk DELETE packages. Error: ${dbError.message}`, 'FAIL');
                if(!firstError) firstError = dbError;
            }
        }

        if (errorCount > 0) {
            logFun(`Rolling back transaction due to ${errorCount} errors.`, 'FAIL');
            await client.query('ROLLBACK');
        } else {
            logFun('Committing transaction.', 'DB');
            await client.query('COMMIT');
        }
    } catch (error) {
        logFun(`Critical error during transaction. Rolling back. Error: ${error.message}`, 'FAIL');
        try { await client.query('ROLLBACK'); } catch (rollbackError) { logFun(`Rollback failed: ${rollbackError.message}`, 'FAIL'); }
        throw error;
    }

    logFun('Package Database Sync Operations Complete!', 'STEP');
    return { success: errorCount === 0, inserts: insertCount, updates: updateCount, deletes: deleteCount, errors: errorCount, firstError: firstError, processedApiRecords: processedApiCount, initialDbRecords: dbData.length };
}

async function syncActivePackages(syncLicense) {
    logFun(`🚀 STARTING ACTIVE PACKAGES SYNC FOR LICENSE: ${syncLicense} 🚀`, 'STEP');
    const overallStartTime = Date.now();
    let success = true;
    let client;
    let syncResult = { success: false, inserts: 0, updates: 0, deletes: 0, errors: 0, processedApiRecords: 0, initialDbRecords: 0};

    try {
        client = await pool.connect(); logFun('Database connection established', 'DB');

        const [fetchedApiData, existingDbData, inactiveLabels] = await Promise.all([
            fetchAllActivePackages(syncLicense),
            fetchDbActivePackages(client, syncLicense),
            fetchInactivePackageLabels(client, syncLicense)
        ]);

        if (Array.isArray(fetchedApiData)) {
            logFun(`Filtering API data against ${inactiveLabels.size} inactive package labels.`, 'PROCESS');
            const initialApiCount = fetchedApiData.length;
            const filteredApiData = fetchedApiData.filter(pkg => {
                if (!pkg.label) {
                    logFun(`API package with ID ${pkg.id} has no label, cannot check against inactive list. It will be included.`, 'DEBUG');
                    return true;
                }
                const isInactive = inactiveLabels.has(pkg.label);
                if (isInactive) {
                    logFun(`Excluding package with label '${pkg.label}' (ID: ${pkg.id}) because it is in the inactivepackages table.`, 'DEBUG');
                }
                return !isInactive;
            });
            const filteredCount = initialApiCount - filteredApiData.length;
            logFun(`Filtered out ${filteredCount} packages. API data size reduced from ${initialApiCount} to ${filteredApiData.length}.`, 'PROCESS');

            syncResult = await compareAndSyncData_Packages(filteredApiData, existingDbData, syncLicense, client);
            if (!syncResult.success) success = false;
        } else {
            logFun('API fetch did not return valid data. Skipping comparison.', 'WARN');
            success = false;
            syncResult = { success: false, errors: 1, firstError: new Error("API Fetch failed") };
        }
    } catch (error) {
        success = false;
        logFun(`❌ UNEXPECTED ERROR DURING SYNC FOR LICENSE ${syncLicense} ❌`, 'FAIL', error.message + (error.stack ? `\nStack: ${error.stack}`: ''));
        if(client) { try { await client.query('ROLLBACK'); } catch(e){} }
        if (!syncResult.firstError) { syncResult.success = false; syncResult.errors = (syncResult.errors || 0) + 1; syncResult.firstError = error; }
    } finally {
        if (client) { client.release(); logFun('Main database connection released', 'DB'); }
    }

    const overallEndTime = Date.now(); const duration = (overallEndTime - overallStartTime) / 1000;
    logFun('========================================', 'FUN');
    if (success && syncResult.success) {
        logFun(`✅ ACTIVE PACKAGES SYNC SUCCESSFULLY COMPLETED FOR LICENSE: ${syncLicense} ✅`, 'DONE');
    } else {
        logFun(`❌ ACTIVE PACKAGES SYNC FAILED FOR LICENSE: ${syncLicense} ❌`, 'FAIL');
        if (syncResult.firstError) logFun(`First error: ${syncResult.firstError.message}`, 'FAIL');
    }
    logFun(`Sync Summary: API Records: ${syncResult.processedApiRecords || 'N/A'}, DB Records (Initial): ${syncResult.initialDbRecords || 'N/A'}`, 'INFO');
    logFun(`DB Ops: Inserts: ${syncResult.inserts || 0}, Updates: ${syncResult.updates || 0}, Deletes: ${syncResult.deletes || 0}, Errors: ${syncResult.errors || 0}`, 'INFO');
    logFun(`⏱️ Total execution time: ${duration.toFixed(2)} seconds`, 'FUN');
    logFun('========================================', 'FUN');
}

async function main() {
    const licenseToSync = process.env.SYNC_LICENSE || 'CUL000063'; //
    console.log('\n=== SCRIPT INITIALIZATION (Active Packages) ===');
    console.log(`📝 Current Date/Time: ${new Date().toISOString()}`);
    console.log(`📝 Node.js Version: ${process.version}`);
    console.log(`📝 API Base URL: ${API_BASE_URL}`);
    console.log(`📝 Target License: ${licenseToSync || 'NOT SET'}`);
    console.log(`📝 Log Level: ${LOG_LEVEL_CONFIG}`);
    console.log(`📝 Max Concurrent API Requests: ${MAX_CONCURRENT_API_REQUESTS}`);
    console.log('============================================');

    if (!licenseToSync) {
        logFun("ERROR: SYNC_LICENSE environment variable is not set. Exiting.", 'ERROR');
        process.exit(1);
    }

    try {
        await syncActivePackages(licenseToSync);
        logFun('Active Packages script execution finished.', 'DONE');
    } catch (err) {
        logFun('Active Packages script execution failed with unhandled error.', 'ERROR', err.message + (err.stack ? `\nStack: ${err.stack}` : ''));
    } finally {
        logFun('Closing database pool connections for Active Packages script...', 'INFO');
        try {
            await pool.end();
            logFun('All DB connections closed for Active Packages script.', 'DONE');
        } catch (err) {
            logFun('Error closing DB pool for Active Packages script.', 'ERROR', err.message);
        }
        logFun('Goodbye from Active Packages script! 👋\n', 'FUN');
        process.exit(0);
    }
}

main();