// Server/Services/transportationDetailsService.js
// Module 5: Transportation Details Entry

const { query, pool } = require('../config/database');
const axios = require('axios');

// METRC API Configuration
const T3_API_BASE_URL = process.env.T3_API_BASE_URL || 'https://api.t3.com';
const METRC_API_TIMEOUT = 30000; // 30 seconds

class TransportationDetailsService {
    /**
     * Collect and validate transportation details
     * Called AFTER scanning is complete, BEFORE manifest creation
     */
    async captureTransportationDetails(invoiceId, userId, transportationData) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verify invoice is ready for transportation details
            const invoice = await client.query(`
                SELECT 
                    status,
                    fulfillment_accepted_by,
                    fk_location_id,
                    invoice_number,
                    location_license_number
                FROM "ORDERS-invoices"
                WHERE id = $1
                FOR UPDATE
            `, [invoiceId]);

            if (invoice.rows.length === 0) {
                throw new Error('Invoice not found');
            }

            const inv = invoice.rows[0];

            if (inv.status !== 'Fulfillment_Accepted') {
                throw new Error(`Cannot enter transportation - invoice status is ${inv.status}`);
            }

            if (inv.fulfillment_accepted_by !== userId) {
                throw new Error('You are not assigned to this order');
            }

            // Verify scanning is complete
            const scanningSessionService = require('./scanningSessionService');
            const scanProgress = await scanningSessionService.getScanningProgress(invoiceId);
            
            if (!scanProgress.overall_progress.all_complete) {
                throw new Error('Cannot proceed - package scanning is not complete');
            }

            // Get destination license for METRC API calls
            // Use location_license_number from invoice (set during order creation)
            let destinationLicense = inv.location_license_number;
            
            if (!destinationLicense) {
                // Fallback: try to get from location's state_license
                const location = await client.query(`
                    SELECT state_license
                    FROM "ORDERS-buyer_locations"
                    WHERE entry_id = $1
                `, [inv.fk_location_id]);
                
                if (location.rows.length === 0 || !location.rows[0].state_license) {
                    throw new Error('Destination license not found. Please ensure the invoice has a location license number.');
                }
                
                destinationLicense = location.rows[0].state_license;
            }

            // Validate transportation data
            this.validateTransportationData(transportationData);

            // Get recipientId from METRC API (optional - can be null if API not available)
            let recipientId = null;
            try {
                recipientId = await this.getRecipientIdByLicense(destinationLicense);
            } catch (error) {
                console.warn('[Transportation] Recipient lookup failed (optional):', error.message);
                // Continue without recipientId - can be filled in later or during manifest creation
            }

            // Get transporterId from METRC API (optional - can be null if API not available)
            let transporterId = null;
            try {
                transporterId = await this.getTransporterIdByName(transportationData.transporterName);
            } catch (error) {
                console.warn('[Transportation] Transporter lookup failed (optional):', error.message);
                // Continue without transporterId - can be filled in later or during manifest creation
            }

            // Construct full transportation details object
            const fullDetails = {
                ...transportationData,
                recipientId, // May be null if METRC API not available
                transporterId, // May be null if METRC API not available
                destinationLicense,
                capturedAt: new Date().toISOString(),
                capturedBy: userId,
                // Flag to indicate if METRC IDs need to be looked up later
                metrcIdsPending: !recipientId || !transporterId
            };

            // Store on invoice
            await client.query(`
                UPDATE "ORDERS-invoices"
                SET 
                    transportation_details = $1,
                    updated_at = NOW()
                WHERE id = $2
            `, [JSON.stringify(fullDetails), invoiceId]);

            // Log transportation details capture
            await client.query(`
                INSERT INTO "ORDERS-invoice-history" (
                    fk_invoice_id,
                    modification_type,
                    change_details,
                    changed_by_user_id
                ) VALUES ($1, 'transportation_details_entered', $2, $3)
            `, [
                invoiceId,
                JSON.stringify({
                    driver: transportationData.driverName,
                    vehicle: `${transportationData.vehicleMake} ${transportationData.vehicleModel}`,
                    departure: transportationData.estimatedDeparture,
                    arrival: transportationData.estimatedArrival
                }),
                userId
            ]);

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Transportation details saved. Ready to create manifest.',
                recipientId,
                transporterId
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    validateTransportationData(data) {
        const required = [
            'driverName',
            'driverLicense',
            'vehicleMake',
            'vehicleModel',
            'vehiclePlate',
            'estimatedDeparture',
            'estimatedArrival',
            'transporterName'
        ];

        for (const field of required) {
            if (!data[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }

        // Validate departure is before arrival
        const departure = new Date(data.estimatedDeparture);
        const arrival = new Date(data.estimatedArrival);

        if (departure >= arrival) {
            throw new Error('Estimated arrival must be after estimated departure');
        }

        // Validate dates are not in the past (allow with warning)
        const now = new Date();
        if (departure < now) {
            console.warn('Warning: Estimated departure is in the past');
        }
    }

    /**
     * Look up METRC recipient facility ID by license number
     * Returns null if not implemented or API unavailable
     */
    async getRecipientIdByLicense(licenseNumber) {
        // TODO: Implement METRC API call
        // For now, return null (optional feature)
        // This should call: GET /transfers/create/destinations with our license
        // Then find facility matching destinationLicense
        
        // Cache recipient IDs (24hr TTL) to reduce API calls
        // Implementation depends on T3 API structure
        
        // For now, return null instead of throwing error
        // This allows transportation details to be saved without METRC API
        console.warn('[Transportation] METRC recipient lookup not yet implemented - returning null');
        return null;
    }

    /**
     * Look up METRC transporter facility ID by name
     * User selects from dropdown of available transporters
     * Returns null if not implemented or API unavailable
     */
    async getTransporterIdByName(transporterName) {
        // TODO: Implement METRC API call
        // This should call: GET /transfers/create/transporters with our license
        // Then find transporter matching name or license
        
        // For now, return null instead of throwing error
        // This allows transportation details to be saved without METRC API
        console.warn('[Transportation] METRC transporter lookup not yet implemented - returning null');
        return null;
    }

    /**
     * Get list of available transporters for UI dropdown
     */
    async getAvailableTransporters() {
        // TODO: Implement METRC API call
        // Return format: [{id, name, licenseNumber}, ...]
        // Cache for 24 hours
        
        return {
            transporters: []
        };
    }
}

module.exports = new TransportationDetailsService();

