// Server/Services/gracefulDegradationService.js
// Module 15: Error Handling & Recovery - Graceful Degradation

class GracefulDegradationService {
    constructor() {
        this.metrcAvailable = true;
        this.lastMetrcCheck = Date.now();
        this.metrcCheckInterval = 60000; // Check every minute
    }

    /**
     * Check if METRC API is available
     */
    async checkMetrcAvailability() {
        try {
            const metrcAuth = require('./metrcAuth');
            await metrcAuth.getAccessToken();
            this.metrcAvailable = true;
            this.lastMetrcCheck = Date.now();
            return true;
        } catch (error) {
            this.metrcAvailable = false;
            this.lastMetrcCheck = Date.now();
            console.warn('[Graceful Degradation] METRC API unavailable:', error.message);
            return false;
        }
    }

    /**
     * Get METRC availability status
     */
    isMetrcAvailable() {
        // If we haven't checked recently, assume available
        if (Date.now() - this.lastMetrcCheck > this.metrcCheckInterval) {
            // Async check, but return cached value for now
            this.checkMetrcAvailability().catch(() => {});
        }
        return this.metrcAvailable;
    }

    /**
     * Handle METRC API failure gracefully
     */
    async handleMetrcFailure(operation, fallbackAction) {
        const isAvailable = await this.checkMetrcAvailability();
        
        if (!isAvailable) {
            console.warn(`[Graceful Degradation] METRC unavailable for ${operation}, using fallback`);
            
            if (fallbackAction) {
                return await fallbackAction();
            }
            
            // Default fallback: return maintenance message
            return {
                success: false,
                error: 'METRC API is currently unavailable',
                message: 'The METRC API is temporarily unavailable. Please try again later or contact support.',
                degraded_mode: true
            };
        }
        
        return null; // METRC is available, proceed normally
    }

    /**
     * Get maintenance message for METRC unavailability
     */
    getMaintenanceMessage() {
        return {
            message: 'METRC API is currently unavailable. Some features may be limited.',
            degraded_mode: true,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = new GracefulDegradationService();



