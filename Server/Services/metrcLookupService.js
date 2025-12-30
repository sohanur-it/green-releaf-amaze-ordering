// Server/Services/metrcLookupService.js
// Module 22.2: METRC Lookup Service with Caching
// Example implementation for fetching and caching METRC lookup values

const metrcAuth = require('./metrcAuth');
const metrcCacheService = require('./metrcCacheService');
const axios = require('axios');

class MetrcLookupService {
    /**
     * Get unit IDs from METRC API (cached for 24 hours)
     */
    async getUnitIds() {
        return await metrcCacheService.getCachedMETRCLookup('unit_ids', async () => {
            try {
                const accessToken = await metrcAuth.getAccessToken();
                const apiBaseUrl = metrcAuth.apiBaseUrl || process.env.T3_API_BASE_URL || 'https://api.t3.com';
                const licenseNumber = process.env.T3_LICENSE_NUMBER || 'CUL000063';
                
                const response = await axios.get(`${apiBaseUrl}/units/v1/active`, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                });
                
                // Map to simple ID -> Name structure for easier lookup
                const unitIds = {};
                if (Array.isArray(response.data)) {
                    response.data.forEach(unit => {
                        unitIds[unit.id] = unit.name;
                    });
                }
                
                return unitIds;
            } catch (error) {
                console.error('[METRC Lookup] Error fetching unit IDs:', error.message);
                // Return default/fallback values
                return { 1: 'Each' }; // Default fallback
            }
        });
    }

    /**
     * Get transfer types from METRC API (cached for 24 hours)
     */
    async getTransferTypes() {
        return await metrcCacheService.getCachedMETRCLookup('transfer_types', async () => {
            try {
                const accessToken = await metrcAuth.getAccessToken();
                const apiBaseUrl = metrcAuth.apiBaseUrl || process.env.T3_API_BASE_URL || 'https://api.t3.com';
                const licenseNumber = process.env.T3_LICENSE_NUMBER || 'CUL000063';
                
                const response = await axios.get(`${apiBaseUrl}/transfers/v1/types`, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                });
                
                // Map to simple ID -> Name structure
                const transferTypes = {};
                if (Array.isArray(response.data)) {
                    response.data.forEach(type => {
                        transferTypes[type.id] = type.name;
                    });
                }
                
                return transferTypes;
            } catch (error) {
                console.error('[METRC Lookup] Error fetching transfer types:', error.message);
                // Return default/fallback values
                return { 1: 'Transfer' }; // Default fallback
            }
        });
    }

    /**
     * Get default unit ID (e.g., for "Each")
     * Uses cached lookup
     */
    async getDefaultUnitId() {
        const unitIds = await this.getUnitIds();
        // Try to find "Each" or return first available
        for (const [id, name] of Object.entries(unitIds)) {
            if (name.toLowerCase() === 'each') {
                return parseInt(id);
            }
        }
        // Fallback to first ID or 1
        return parseInt(Object.keys(unitIds)[0]) || 1;
    }

    /**
     * Get default transfer type ID
     * Uses cached lookup
     */
    async getDefaultTransferTypeId() {
        const transferTypes = await this.getTransferTypes();
        // Try to find "Transfer" or return first available
        for (const [id, name] of Object.entries(transferTypes)) {
            if (name.toLowerCase().includes('transfer')) {
                return parseInt(id);
            }
        }
        // Fallback to first ID or 1
        return parseInt(Object.keys(transferTypes)[0]) || 1;
    }

    /**
     * Invalidate METRC lookup caches
     * Call this when METRC data changes
     */
    async invalidateLookups() {
        await metrcCacheService.invalidateCache('unit_ids');
        await metrcCacheService.invalidateCache('transfer_types');
    }
}

module.exports = new MetrcLookupService();



