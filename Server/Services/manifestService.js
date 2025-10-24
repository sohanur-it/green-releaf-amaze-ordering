/**
 * Manifest Service
 * 
 * Handles creation of METRC manifests from orders and packages
 * Implements the CreateManifestFromOrderAndPackages service logic
 */

const axios = require('axios');
const { pool } = require('../config/database');
const metrcAuth = require('./metrcAuth');
const auditLogger = require('./auditLogger');

class ManifestService {
    constructor() {
        this.apiBaseUrl = process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
        this.shipperLicense = process.env.T3_LICENSE_NUMBER;
        
        if (!this.shipperLicense) {
            throw new Error('T3_LICENSE_NUMBER environment variable is required');
        }
        
        this.pool = pool; // Use shared connection pool
    }

    /**
     * Create manifest from order and packages
     * 
     * @param {Object} manifestData - Manifest creation data
     * @param {number} manifestData.orderId - Internal order ID
     * @param {string} manifestData.transporterLicenseNumber - Transporter license
     * @param {string} manifestData.driverName - Driver name
     * @param {string} manifestData.vehicleModel - Vehicle model
     * @param {string} manifestData.estimatedDeparture - Estimated departure time
     * @param {string} manifestData.estimatedArrival - Estimated arrival time
     * @param {Array} manifestData.packages - Array of packages to ship
     * @param {number} userId - User creating the manifest
     * @returns {Promise<Object>} - Manifest creation result
     */
    async createManifestFromOrderAndPackages(manifestData, userId) {
        const client = await this.pool.connect();
        
        try {
            console.log(`🚀 Creating manifest for order ${manifestData.orderId}...`);
            
            // Step 1: Validate order and packages
            const validationResult = await this.validateOrderAndPackages(client, manifestData);
            if (!validationResult.valid) {
                await auditLogger.logUserAction(
                    userId,
                    'manifest_create_failed',
                    'Order',
                    manifestData.orderId,
                    { reason: validationResult.reason },
                    'failure'
                );
                return { success: false, error: validationResult.reason };
            }

            // Step 2: Build METRC API payload
            const metrcPayload = await this.buildMetrcPayload(client, manifestData);
            
            // Step 3: Create manifest in METRC
            const metrcResult = await this.createMetrcTransfer(metrcPayload);
            if (!metrcResult.success) {
                await auditLogger.logUserAction(
                    userId,
                    'manifest_create_failed',
                    'Order',
                    manifestData.orderId,
                    { error: metrcResult.error },
                    'failure'
                );
                return { success: false, error: metrcResult.error };
            }

            // Step 4: Update local system
            const updateResult = await this.updateLocalSystem(client, manifestData, metrcResult.data, userId);
            if (!updateResult.success) {
                await auditLogger.logUserAction(
                    userId,
                    'manifest_create_failed',
                    'Order',
                    manifestData.orderId,
                    { error: updateResult.error },
                    'failure'
                );
                return { success: false, error: updateResult.error };
            }

            // Step 5: Log successful manifest creation
            await auditLogger.logUserAction(
                userId,
                'manifest_create_success',
                'Order',
                manifestData.orderId,
                {
                    manifestNumber: metrcResult.data.manifestNumber,
                    packageCount: manifestData.packages.length,
                    transporterLicense: manifestData.transporterLicenseNumber
                },
                'success'
            );

            console.log(`✅ Manifest created successfully: ${metrcResult.data.manifestNumber}`);
            
            return {
                success: true,
                manifestNumber: metrcResult.data.manifestNumber,
                manifestData: metrcResult.data
            };

        } catch (error) {
            console.error('❌ Manifest creation failed:', error.message);
            
            await auditLogger.logUserAction(
                userId,
                'manifest_create_failed',
                'Order',
                manifestData.orderId,
                { error: error.message },
                'failure'
            );
            
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    }

    /**
     * Validate order and packages before manifest creation
     */
    async validateOrderAndPackages(client, manifestData) {
        try {
            // Check if order exists and is approved
            const orderQuery = `
                SELECT id, status, customer_name, total_amount 
                FROM orders 
                WHERE id = $1
            `;
            const orderResult = await client.query(orderQuery, [manifestData.orderId]);
            
            if (orderResult.rows.length === 0) {
                return { valid: false, reason: 'Order not found' };
            }
            
            const order = orderResult.rows[0];
            if (order.status !== 'Approved for Fulfillment') {
                return { valid: false, reason: `Order status is ${order.status}, must be 'Approved for Fulfillment'` };
            }

            // Validate packages
            for (const pkg of manifestData.packages) {
                // Check if package exists in active packages
                const packageQuery = `
                    SELECT metrcid, label, quantity, item_name 
                    FROM activepackages 
                    WHERE label = $1 AND sync_license = $2
                `;
                const packageResult = await client.query(packageQuery, [pkg.PackageLabel, this.shipperLicense]);
                
                if (packageResult.rows.length === 0) {
                    return { valid: false, reason: `Package ${pkg.PackageLabel} not found in active packages` };
                }
                
                const activePackage = packageResult.rows[0];
                if (activePackage.quantity < pkg.Quantity) {
                    return { valid: false, reason: `Insufficient quantity for package ${pkg.PackageLabel}` };
                }
            }

            return { valid: true, order };
            
        } catch (error) {
            return { valid: false, reason: `Validation error: ${error.message}` };
        }
    }

    /**
     * Build METRC API payload
     */
    async buildMetrcPayload(client, manifestData) {
        const packages = [];
        
        for (const pkg of manifestData.packages) {
            // Get package details from database
            const packageQuery = `
                SELECT metrcid, label, quantity, item_name, item_unitofmeasurename
                FROM activepackages 
                WHERE label = $1 AND sync_license = $2
            `;
            const packageResult = await client.query(packageQuery, [pkg.PackageLabel, this.shipperLicense]);
            const activePackage = packageResult.rows[0];
            
            packages.push({
                PackageLabel: pkg.PackageLabel,
                Quantity: pkg.Quantity,
                UnitOfMeasureName: pkg.UnitOfMeasureName || activePackage.item_unitofmeasurename,
                WholesalePrice: pkg.WholesalePrice || 0
            });
        }

        return {
            ShipperLicenseNumber: this.shipperLicense,
            TransporterLicenseNumber: manifestData.transporterLicenseNumber,
            DriverName: manifestData.driverName,
            VehicleModel: manifestData.vehicleModel,
            EstimatedDepartureDateTime: manifestData.estimatedDeparture,
            EstimatedArrivalDateTime: manifestData.estimatedArrival,
            Packages: packages
        };
    }

    /**
     * Create transfer in METRC
     */
    async createMetrcTransfer(payload) {
        try {
            console.log('📤 Sending manifest to METRC...');
            
            const response = await metrcAuth.makeAuthenticatedRequest({
                method: 'POST',
                url: `${this.apiBaseUrl}/transfers/create`,
                data: payload
            });
            
            console.log('✅ METRC transfer created successfully');
            
            return {
                success: true,
                data: response.data
            };
            
        } catch (error) {
            console.error('❌ METRC transfer creation failed:', error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    /**
     * Update local system after successful METRC creation
     */
    async updateLocalSystem(client, manifestData, metrcData, userId) {
        try {
            await client.query('BEGIN');
            
            // Update order status to 'Manifested'
            const updateOrderQuery = `
                UPDATE orders 
                SET status = 'Manifested', 
                    manifest_number = $1,
                    manifested_at = NOW(),
                    manifested_by = $2
                WHERE id = $3
            `;
            await client.query(updateOrderQuery, [metrcData.manifestNumber, userId, manifestData.orderId]);
            
            // Insert manifest data into activeoutgoingtransfers table
            const insertManifestQuery = `
                INSERT INTO activeoutgoingtransfers (
                    metrcid, manifestnumber, shipperfacilitylicensenumber, 
                    driveroccupationallicensenumber, drivername, vehiclemodel,
                    estimateddeparturedatetime, estimatedarrivaldatetime,
                    packagecount, synclicense
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `;
            
            await client.query(insertManifestQuery, [
                metrcData.id,
                metrcData.manifestNumber,
                this.shipperLicense,
                manifestData.transporterLicenseNumber, // This maps to driveroccupationallicensenumber
                manifestData.driverName,
                manifestData.vehicleModel,
                manifestData.estimatedDeparture,
                manifestData.estimatedArrival,
                manifestData.packages.length,
                this.shipperLicense
            ]);
            
            await client.query('COMMIT');
            
            return { success: true };
            
        } catch (error) {
            await client.query('ROLLBACK');
            return { success: false, error: error.message };
        }
    }

    /**
     * Get manifest status from METRC
     */
    async getManifestStatus(manifestNumber) {
        try {
            const response = await metrcAuth.makeAuthenticatedRequest({
                method: 'GET',
                url: `${this.apiBaseUrl}/transfers/outgoing/active`,
                params: {
                    licenseNumber: this.shipperLicense,
                    manifestNumber: manifestNumber
                }
            });
            
            const transfers = response.data.data || [];
            return transfers.find(t => t.manifestNumber === manifestNumber) || null;
            
        } catch (error) {
            console.error('❌ Failed to get manifest status:', error.message);
            return null;
        }
    }

    /**
     * Close database connection (no-op since using shared pool)
     */
    async close() {
        // No-op: Using shared pool, don't close it here
    }
}

module.exports = new ManifestService();
