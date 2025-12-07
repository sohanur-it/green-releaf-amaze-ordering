// Server/Services/manifestStatusService.js
// Service to check manifest status from METRC API
// Checks activeoutgoingtransfers and inactiveoutgoingtransfers to determine manifest status

const metrcAuth = require('./metrcAuth');
const { query, pool } = require('../config/database');

class ManifestStatusService {
    constructor() {
        this.apiBaseUrl = metrcAuth.apiBaseUrl;
        this.licenseNumber = process.env.T3_LICENSE_NUMBER || 'CUL000063';
    }

    /**
     * Check manifest status from METRC API
     * Returns status: 'active', 'voided', 'accepted', 'not_found', or 'error'
     */
    async checkManifestStatus(manifestNumber, license = null) {
        try {
            const targetLicense = license || this.licenseNumber;
            
            // Check active outgoing transfers first
            let activeStatus;
            try {
                activeStatus = await this.checkActiveTransfers(manifestNumber, targetLicense);
            } catch (error) {
                // Handle timeout or network errors
                if (error.message && (error.message.includes('timeout') || error.message.includes('504'))) {
                    console.warn(`⚠️ Timeout checking active transfers for ${manifestNumber}: ${error.message}`);
                    return {
                        status: 'error',
                        message: `Timeout checking manifest status in METRC. The manifest may not exist or METRC API is slow.`,
                        data: null,
                        error: error.message
                    };
                }
                throw error;
            }
            
            if (activeStatus) {
                return {
                    status: 'active',
                    message: 'Manifest is active and has not shipped yet',
                    data: activeStatus
                };
            }

            // Check inactive outgoing transfers
            let inactiveStatus;
            try {
                inactiveStatus = await this.checkInactiveTransfers(manifestNumber, targetLicense);
            } catch (error) {
                // Handle timeout or network errors
                if (error.message && (error.message.includes('timeout') || error.message.includes('504'))) {
                    console.warn(`⚠️ Timeout checking inactive transfers for ${manifestNumber}: ${error.message}`);
                    return {
                        status: 'error',
                        message: `Timeout checking manifest status in METRC. The manifest may not exist or METRC API is slow.`,
                        data: null,
                        error: error.message
                    };
                }
                throw error;
            }
            
            if (inactiveStatus) {
                // Check isVoided from the full data if available
                const isVoided = inactiveStatus.isVoided || inactiveStatus.fullData?.isVoided || false;
                if (isVoided) {
                    return {
                        status: 'voided',
                        message: 'Manifest was voided',
                        data: inactiveStatus
                    };
                } else {
                    return {
                        status: 'accepted',
                        message: 'Manifest was accepted by the dispensary',
                        data: inactiveStatus
                    };
                }
            }

            // Not found in either endpoint
            return {
                status: 'not_found',
                message: 'Manifest not found in METRC active or inactive transfers. It may have been created with placeholder data and not actually submitted to METRC.',
                data: null
            };

        } catch (error) {
            console.error(`❌ Error checking manifest status for ${manifestNumber}:`, error.message);
            
            // Check for specific error types
            if (error.response) {
                const status = error.response.status;
                if (status === 504 || status === 408) {
                    return {
                        status: 'error',
                        message: `METRC API timeout. The manifest may not exist in METRC or the API is currently slow.`,
                        data: null,
                        error: `Gateway Timeout (${status})`
                    };
                }
                if (status === 503) {
                    return {
                        status: 'error',
                        message: `METRC API is currently unavailable. Please try again later.`,
                        data: null,
                        error: `Service Unavailable (${status})`
                    };
                }
            }
            
            return {
                status: 'error',
                message: `Error checking manifest status: ${error.message}`,
                data: null,
                error: error.message
            };
        }
    }

    /**
     * Check if manifest is in active outgoing transfers
     */
    async checkActiveTransfers(manifestNumber, license) {
        try {
            let page = 1;
            let hasMorePages = true;
            const pageSize = 500;

            while (hasMorePages) {
                const response = await metrcAuth.makeAuthenticatedRequest({
                    method: 'GET',
                    url: `${this.apiBaseUrl}/transfers/outgoing/active`,
                    params: {
                        licenseNumber: license,
                        page: page,
                        pageSize: pageSize
                    },
                    timeout: 15000  // Reduced timeout to fail faster and avoid 504 errors
                });

                const transfers = response.data?.data || [];
                
                // Search for manifest by manifest number
                const found = transfers.find(t => 
                    t.manifestNumber === manifestNumber || 
                    t.manifest_number === manifestNumber ||
                    t.manifestNumber === manifestNumber.toUpperCase()
                );

                if (found) {
                    // Return the full transfer object so we can check isVoided and other fields
                    return {
                        manifestNumber: found.manifestNumber || found.manifest_number,
                        metrcId: found.id || found.metrcId,
                        estimatedDeparture: found.estimatedDepartureDateTime || found.estimated_departure_date_time,
                        estimatedArrival: found.estimatedArrivalDateTime || found.estimated_arrival_date_time,
                        packageCount: found.packageCount || found.package_count,
                        isVoided: found.isVoided || false,
                        fullData: found  // Include full data for reference
                    };
                }

                // Check if there are more pages
                const total = response.data?.total || 0;
                const currentPageSize = transfers.length;
                hasMorePages = (page * pageSize) < total && currentPageSize === pageSize;
                
                if (hasMorePages) {
                    page++;
                } else {
                    hasMorePages = false;
                }
            }

            return null;
        } catch (error) {
            // If endpoint doesn't exist or returns 404, return null
            if (error.response && error.response.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Check if manifest is in inactive outgoing transfers
     */
    async checkInactiveTransfers(manifestNumber, license) {
        try {
            let page = 1;
            let hasMorePages = true;
            const pageSize = 500;

            while (hasMorePages) {
                const response = await metrcAuth.makeAuthenticatedRequest({
                    method: 'GET',
                    url: `${this.apiBaseUrl}/transfers/outgoing/inactive`,
                    params: {
                        licenseNumber: license,
                        page: page,
                        pageSize: pageSize
                    },
                    timeout: 15000  // Reduced timeout to fail faster and avoid 504 errors
                });

                const transfers = response.data?.data || [];
                
                // Search for manifest by manifest number
                const found = transfers.find(t => 
                    t.manifestNumber === manifestNumber || 
                    t.manifest_number === manifestNumber ||
                    t.manifestNumber === manifestNumber.toUpperCase()
                );

                if (found) {
                    // Check various possible field names for isvoided
                    const isVoided = found.isVoided || 
                                    found.is_voided || 
                                    found.isvoided || 
                                    found.voided === true ||
                                    found.voided === 'true' ||
                                    found.Voided === true;
                    
                    return {
                        manifestNumber: found.manifestNumber || found.manifest_number,
                        metrcId: found.id || found.metrcId,
                        isVoided: isVoided,
                        receivedDateTime: found.receivedDateTime || found.received_date_time,
                        actualArrival: found.actualArrivalDateTime || found.actual_arrival_date_time
                    };
                }

                // Check if there are more pages
                const total = response.data?.total || 0;
                const currentPageSize = transfers.length;
                hasMorePages = (page * pageSize) < total && currentPageSize === pageSize;
                
                if (hasMorePages) {
                    page++;
                } else {
                    hasMorePages = false;
                }
            }

            return null;
        } catch (error) {
            // If endpoint doesn't exist or returns 404, return null
            if (error.response && error.response.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Get manifest statuses for all manifests on an invoice
     */
    async getInvoiceManifestStatuses(invoiceId) {
        const client = await pool.connect();
        try {
            // Get invoice with manifest numbers
            const invoice = await client.query(`
                SELECT 
                    metrc_manifest_numbers,
                    manifest_metrc_ids
                FROM "ORDERS-invoices"
                WHERE id = $1
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                return { success: false, error: 'Invoice not found' };
            }

            const invoiceData = invoice.rows[0];
            
            // Parse manifest numbers
            const manifestNumbers = Array.isArray(invoiceData.metrc_manifest_numbers)
                ? invoiceData.metrc_manifest_numbers
                : (invoiceData.metrc_manifest_numbers ? JSON.parse(invoiceData.metrc_manifest_numbers) : []);

            // Parse manifest METRC IDs for license info
            const manifestMetrcIds = Array.isArray(invoiceData.manifest_metrc_ids)
                ? invoiceData.manifest_metrc_ids
                : (invoiceData.manifest_metrc_ids ? JSON.parse(invoiceData.manifest_metrc_ids) : []);

            if (manifestNumbers.length === 0) {
                return {
                    success: true,
                    manifests: []
                };
            }

            // Create a map of manifest number to license
            const manifestLicenseMap = {};
            manifestMetrcIds.forEach(m => {
                if (m.number && m.license) {
                    manifestLicenseMap[m.number] = m.license;
                }
            });

            // Check status for each manifest
            const manifestStatuses = [];
            for (const manifestNumber of manifestNumbers) {
                const license = manifestLicenseMap[manifestNumber] || null;
                
                // First check if we have a stored METRC ID for this manifest
                const manifestInfo = manifestMetrcIds.find(m => 
                    m.number === manifestNumber || 
                    m.number === manifestNumber.toUpperCase()
                );
                
                // If we have a stored METRC ID, we know the manifest was created
                // But if it doesn't exist in METRC, it might be placeholder data
                let status;
                if (manifestInfo && manifestInfo.id) {
                    // We have a METRC ID stored - try checking status
                    // If it fails, it might be placeholder data
                    status = await this.checkManifestStatus(manifestNumber, license);
                } else {
                    // No METRC ID stored - likely placeholder data
                    status = {
                        status: 'not_found',
                        message: 'Manifest number exists in database but no METRC ID is stored. This may be placeholder data from manifest creation that was not actually submitted to METRC.',
                        data: null
                    };
                }
                
                manifestStatuses.push({
                    manifestNumber: manifestNumber,
                    license: license,
                    ...status
                });
            }

            return {
                success: true,
                manifests: manifestStatuses
            };

        } catch (error) {
            console.error(`❌ Error getting invoice manifest statuses:`, error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    /**
     * Get manifest PDF from METRC API
     * Returns PDF buffer or stream
     */
    async getManifestPDF(manifestNumber, license = null, invoiceId = null) {
        try {
            const targetLicense = license || this.licenseNumber;
            
            let manifestMetrcId = null;
            let manifestLicense = targetLicense;
            
            // First, try to get METRC ID from invoice's manifest_metrc_ids if invoiceId is provided
            if (invoiceId) {
                try {
                    const invoice = await query(`
                        SELECT manifest_metrc_ids
                        FROM "ORDERS-invoices"
                        WHERE id = $1
                    `, [invoiceId]);
                    
                    if (invoice.rows.length > 0 && invoice.rows[0].manifest_metrc_ids) {
                        const manifestIds = Array.isArray(invoice.rows[0].manifest_metrc_ids)
                            ? invoice.rows[0].manifest_metrc_ids
                            : JSON.parse(invoice.rows[0].manifest_metrc_ids || '[]');
                        
                        // Find the manifest with matching number
                        const manifestInfo = manifestIds.find(m => 
                            m.number === manifestNumber || 
                            m.number === manifestNumber.toUpperCase()
                        );
                        
                        if (manifestInfo && manifestInfo.id) {
                            manifestMetrcId = manifestInfo.id;
                            manifestLicense = manifestInfo.license || targetLicense;
                            console.log(`✓ Found METRC ID ${manifestMetrcId} for manifest ${manifestNumber} from invoice ${invoiceId}`);
                        } else {
                            console.log(`⚠ Manifest ${manifestNumber} found in invoice ${invoiceId} but no METRC ID stored`);
                        }
                    }
                } catch (dbError) {
                    console.warn(`Could not get METRC ID from invoice: ${dbError.message}`);
                }
            }
            
            // If not found in invoice, try to find the invoice by manifest number
            if (!manifestMetrcId) {
                try {
                    const invoiceQuery = await query(`
                        SELECT id, manifest_metrc_ids, metrc_manifest_numbers
                        FROM "ORDERS-invoices"
                        WHERE metrc_manifest_numbers::text LIKE $1
                           OR metrc_manifest_numbers::jsonb @> $2::jsonb
                        LIMIT 1
                    `, [`%${manifestNumber}%`, JSON.stringify(manifestNumber)]);
                    
                    if (invoiceQuery.rows.length > 0 && invoiceQuery.rows[0].manifest_metrc_ids) {
                        const invoiceData = invoiceQuery.rows[0];
                        const manifestIds = Array.isArray(invoiceData.manifest_metrc_ids)
                            ? invoiceData.manifest_metrc_ids
                            : JSON.parse(invoiceData.manifest_metrc_ids || '[]');
                        
                        const manifestInfo = manifestIds.find(m => 
                            m.number === manifestNumber || 
                            m.number === manifestNumber.toUpperCase()
                        );
                        
                        if (manifestInfo && manifestInfo.id) {
                            manifestMetrcId = manifestInfo.id;
                            manifestLicense = manifestInfo.license || targetLicense;
                            console.log(`✓ Found METRC ID ${manifestMetrcId} for manifest ${manifestNumber} by searching invoices`);
                        } else {
                            console.log(`⚠ Manifest ${manifestNumber} found in invoice database but no METRC ID stored`);
                        }
                    }
                } catch (dbError) {
                    console.warn(`Could not search invoices by manifest number: ${dbError.message}`);
                }
            }
            
            // If still not found, try checking METRC active and inactive transfers
            if (!manifestMetrcId) {
                console.log(`METRC ID not found in database, searching METRC API for manifest ${manifestNumber}...`);
                
                // Check active transfers
                const activeStatus = await this.checkActiveTransfers(manifestNumber, targetLicense);
                if (activeStatus && activeStatus.metrcId) {
                    manifestMetrcId = activeStatus.metrcId;
                    console.log(`✓ Found METRC ID ${manifestMetrcId} in active transfers`);
                }
                
                // If not found in active, check inactive
                if (!manifestMetrcId) {
                    const inactiveStatus = await this.checkInactiveTransfers(manifestNumber, targetLicense);
                    if (inactiveStatus && inactiveStatus.metrcId) {
                        manifestMetrcId = inactiveStatus.metrcId;
                        console.log(`✓ Found METRC ID ${manifestMetrcId} in inactive transfers`);
                    }
                }
            }
            
            if (!manifestMetrcId) {
                return {
                    success: false,
                    error: 'Manifest not found - unable to retrieve PDF. The manifest may not exist in METRC or the METRC ID is not stored in the database.'
                };
            }
            
            // Fetch PDF from T3 API
            // Primary method: Use manifest number directly (works with /transfers/manifest endpoint)
            console.log(`📄 Fetching PDF for manifest ${manifestNumber} with license ${manifestLicense}...`);
            
            let response;
            let pdfReceived = false;
            
            // Method 1: Try /transfers/manifest endpoint with manifestNumber (preferred - works directly with manifest number)
            try {
                console.log(`📄 Attempting to fetch PDF using manifest number endpoint...`);
                response = await metrcAuth.makeAuthenticatedRequest({
                    method: 'GET',
                    url: `${this.apiBaseUrl}/transfers/manifest`,
                    params: {
                        licenseNumber: manifestLicense,
                        manifestNumber: manifestNumber
                    },
                    responseType: 'arraybuffer', // Get binary data
                    timeout: 30000
                });
                
                if (response.data && response.headers['content-type']?.includes('application/pdf')) {
                    pdfReceived = true;
                    console.log(`✅ PDF retrieved successfully using manifest number endpoint`);
                }
            } catch (error) {
                console.warn(`⚠️ Manifest number endpoint failed: ${error.message}`);
                if (error.response) {
                    console.warn(`   Status: ${error.response.status}`);
                }
            }
            
            // Method 2: If manifest number endpoint failed and we have METRC ID, try ID-based endpoint
            if (!pdfReceived && manifestMetrcId) {
                try {
                    console.log(`📄 Attempting to fetch PDF using METRC ID endpoint...`);
                    response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: `${this.apiBaseUrl}/transfers/${manifestMetrcId}/pdf`,
                        params: {
                            licenseNumber: manifestLicense
                        },
                        responseType: 'arraybuffer', // Get binary data
                        timeout: 30000
                    });
                    
                    if (response.data && response.headers['content-type']?.includes('application/pdf')) {
                        pdfReceived = true;
                        console.log(`✅ PDF retrieved successfully using METRC ID endpoint`);
                    }
                } catch (error) {
                    console.warn(`⚠️ METRC ID endpoint failed: ${error.message}`);
                    if (error.response) {
                        console.warn(`   Status: ${error.response.status}`);
                    }
                }
            }
            
            // Method 3: Try alternative outgoing endpoint if both above failed
            if (!pdfReceived && manifestMetrcId) {
                try {
                    console.log(`📄 Attempting to fetch PDF using outgoing endpoint...`);
                    response = await metrcAuth.makeAuthenticatedRequest({
                        method: 'GET',
                        url: `${this.apiBaseUrl}/transfers/outgoing/${manifestMetrcId}/pdf`,
                        params: {
                            licenseNumber: manifestLicense
                        },
                        responseType: 'arraybuffer',
                        timeout: 30000
                    });
                    
                    if (response.data && response.headers['content-type']?.includes('application/pdf')) {
                        pdfReceived = true;
                        console.log(`✅ PDF retrieved successfully using outgoing endpoint`);
                    }
                } catch (error) {
                    console.warn(`⚠️ Outgoing endpoint failed: ${error.message}`);
                    if (error.response) {
                        console.warn(`   Status: ${error.response.status}`);
                    }
                }
            }
            
            if (pdfReceived && response && response.data) {
                return {
                    success: true,
                    pdfBuffer: Buffer.from(response.data),
                    contentType: response.headers['content-type'] || 'application/pdf'
                };
            } else {
                return {
                    success: false,
                    error: 'No PDF data received from METRC. All endpoints failed.'
                };
            }
            
        } catch (error) {
            console.error(`❌ Error fetching manifest PDF for ${manifestNumber}:`, error.message);
            
            return {
                success: false,
                error: error.response?.data?.message || error.message || 'Failed to fetch manifest PDF'
            };
        }
    }

    /**
     * Helper method to get manifest METRC ID
     */
    async getManifestMetrcId(manifestNumber, license = null) {
        const targetLicense = license || this.licenseNumber;
        
        const activeStatus = await this.checkActiveTransfers(manifestNumber, targetLicense);
        if (activeStatus && activeStatus.metrcId) {
            return activeStatus.metrcId;
        }
        
        const inactiveStatus = await this.checkInactiveTransfers(manifestNumber, targetLicense);
        if (inactiveStatus && inactiveStatus.metrcId) {
            return inactiveStatus.metrcId;
        }
        
        return null;
    }
}

module.exports = new ManifestStatusService();

