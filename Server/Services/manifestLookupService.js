// Server/Services/manifestLookupService.js
// Extracted manifest lookup logic for better separation of concerns

const metrcAuth = require('./metrcAuth');

class ManifestLookupService {
    constructor() {
        this.apiBaseUrl = metrcAuth.apiBaseUrl || process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
    }

    /**
     * Extract manifest number from various possible field names
     */
    extractManifestNumber(obj) {
        if (!obj) return null;
        return obj.manifestNumber || 
               obj.manifest_number || 
               obj.ManifestNumber ||
               obj.number ||
               obj.Number ||
               obj.transferNumber ||
               obj.transfer_number ||
               obj.TransferNumber ||
               (obj.destinations && Array.isArray(obj.destinations) && obj.destinations[0]?.manifestNumber) ||
               (obj.destinations && Array.isArray(obj.destinations) && obj.destinations[0]?.number) ||
               null;
    }

    /**
     * Extract METRC ID from various possible field names
     */
    extractMetrcId(obj) {
        if (!obj) return null;
        return obj.id || 
               obj.Id || 
               obj.ID ||
               obj.metrcId ||
               obj.metrc_id ||
               obj.MetrcId ||
               (obj.destinations && Array.isArray(obj.destinations) && obj.destinations[0]?.id) ||
               null;
    }

    /**
     * Find manifest in active transfers by invoice number
     */
    async findManifestByInvoiceNumber(invoiceNumber, license, maxRetries = 3) {
        const retryDelays = [2000, 3000, 5000];
        const creationTime = new Date();
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
                } else {
                    await new Promise(resolve => setTimeout(resolve, retryDelays[0]));
                }
                
                const result = await this.queryActiveTransfers(license, invoiceNumber, creationTime);
                if (result) {
                    return result;
                }
            } catch (error) {
                if (attempt === maxRetries - 1) {
                    throw error;
                }
            }
        }
        
        return null;
    }

    /**
     * Query active transfers from METRC
     */
    async queryActiveTransfers(license, invoiceNumber, creationTime) {
        const endpoints = [
            {
                name: 'outgoing/active',
                url: `${this.apiBaseUrl}/transfers/outgoing/active`,
                params: { licenseNumber: license, pageSize: 50, page: 1 }
            },
            {
                name: 'v2/external/outgoing',
                url: `${this.apiBaseUrl}/transfers/v2/external/outgoing`,
                params: { licenseNumber: license, pageSize: 50 }
            }
        ];

        for (const endpoint of endpoints) {
            try {
                const response = await metrcAuth.makeAuthenticatedRequest({
                    method: 'GET',
                    url: endpoint.url,
                    params: endpoint.params,
                    timeout: 15000
                });

                const transfers = this.normalizeTransfersResponse(response.data);
                
                // Method 1: Find by invoice number
                const match = transfers.find(t => this.getInvoiceNumber(t) === invoiceNumber);
                if (match) {
                    return {
                        manifestNumber: this.extractManifestNumber(match),
                        manifestMetrcId: this.extractMetrcId(match)
                    };
                }

                // Method 2: Find by creation time
                const recent = this.findRecentTransfer(transfers, creationTime);
                if (recent) {
                    return {
                        manifestNumber: this.extractManifestNumber(recent),
                        manifestMetrcId: this.extractMetrcId(recent)
                    };
                }
            } catch (error) {
                // Continue to next endpoint
                continue;
            }
        }

        return null;
    }

    /**
     * Normalize different response structures to array of transfers
     */
    normalizeTransfersResponse(data) {
        if (Array.isArray(data)) return data;
        if (data?.data && Array.isArray(data.data)) return data.data;
        if (data?.transfers && Array.isArray(data.transfers)) return data.transfers;
        return [];
    }

    /**
     * Get invoice number from transfer object
     */
    getInvoiceNumber(transfer) {
        return transfer.invoiceNumber || 
               (transfer.destinations && Array.isArray(transfer.destinations) && transfer.destinations[0]?.invoiceNumber) ||
               (transfer.destination && transfer.destination.invoiceNumber) ||
               (transfer.destinations && !Array.isArray(transfer.destinations) && transfer.destinations.invoiceNumber) ||
               null;
    }

    /**
     * Find most recent transfer within time window
     */
    findRecentTransfer(transfers, creationTime, windowMs = 2 * 60 * 1000) {
        const recent = transfers.filter(t => {
            const transferDate = t.createdDateTime || t.createdDate || t.dateCreated || t.lastModified;
            if (!transferDate) return false;
            const transferTime = new Date(transferDate);
            const timeDiff = creationTime - transferTime;
            return timeDiff >= 0 && timeDiff < windowMs;
        });

        if (recent.length === 0) return null;

        recent.sort((a, b) => {
            const timeA = new Date(a.createdDateTime || a.createdDate || a.dateCreated || 0);
            const timeB = new Date(b.createdDateTime || b.createdDate || b.dateCreated || 0);
            return timeB - timeA;
        });

        return recent[0];
    }
}

module.exports = new ManifestLookupService();

