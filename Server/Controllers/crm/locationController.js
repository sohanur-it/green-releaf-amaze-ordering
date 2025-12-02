// Server/Controllers/crm/locationController.js

const Location = require('../../Models/crm/locationModel');

// controller for the locations api. just json, no ejs.

//handles creating a new location
const createLocation = async (req, res) => {
    try {
        const { buyerId } = req.params;
        const newLocation = await Location.create(buyerId, req.body);
        res.status(201).json(newLocation);
    } catch (err) {
        res.status(500).json({ message: "Failed to create location", error: err.message });
    }
};

//handles updating a location
const updateLocation = async (req, res) => {
    try {
        const { locationId } = req.params;
        const userId = req.session?.userId;
        
        // Check if user is fulfillment user - restrict to delivery_zone only
        if (userId) {
            const UserModel = require('../../Models/userModel');
            const userRoles = await UserModel.getUserRoles(userId);
            const userRoleNames = userRoles.map(r => (r.name || r.role_name || '').trim()).filter(Boolean);
            const normalizeRole = (role) => role.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
            const isFulfillmentUser = userRoleNames.some(r => {
                const normalized = normalizeRole(r);
                return normalized === 'fulfillment team' || 
                       normalized === 'fulfillment worker' || 
                       normalized === 'fulfillment admin';
            });
            
            if (isFulfillmentUser) {
                // Fulfillment users can only update delivery_zone
                // Get current location data first
                const { query } = require('../../config/database');
                const currentLocation = await query(
                    'SELECT * FROM "ORDERS-buyer_locations" WHERE entry_id = $1',
                    [locationId]
                );
                
                if (currentLocation.rows.length === 0) {
                    return res.status(404).json({ message: "Location not found" });
                }
                
                // Only allow delivery_zone to be updated
                const updatedData = {
                    ...currentLocation.rows[0],
                    delivery_zone: req.body.delivery_zone || currentLocation.rows[0].delivery_zone,
                    updated_at: new Date()
                };
                
                const updatedLocation = await Location.update(locationId, updatedData);
                return res.status(200).json(updatedLocation);
            }
        }
        
        // Non-fulfillment users can update all fields
        const updatedLocation = await Location.update(locationId, req.body);
        res.status(200).json(updatedLocation);
    } catch (err) {
        res.status(500).json({ message: "Failed to update location", error: err.message });
    }
};

// handles deleting a location
const deleteLocation = async (req, res) => {
    try {
        const { locationId } = req.params;
        await Location.deleteById(locationId);
        res.status(204).send(); // Success, no content to send back
    } catch (err) {
        res.status(500).json({ message: "Failed to delete location", error: err.message });
    }
};

// Check if a DIS number (state_license) belongs to another buyer's location
const checkDisNumber = async (req, res) => {
    try {
        const { disNumber } = req.query;
        const { query } = require('../../config/database');
        
        if (!disNumber || !disNumber.trim()) {
            return res.json({ 
                success: true, 
                exists: false,
                message: 'DIS number is required'
            });
        }
        
        const result = await query(`
            SELECT 
                l.entry_id as location_id,
                l.name as location_name,
                l.state_license,
                b.entry_id as buyer_id,
                b.name as buyer_name
            FROM "ORDERS-buyer_locations" l
            INNER JOIN "ORDERS-buyers" b ON l.orders_buyer_id = b.entry_id
            WHERE LOWER(TRIM(l.state_license)) = LOWER(TRIM($1))
            LIMIT 1
        `, [disNumber.trim()]);
        
        if (result.rows.length > 0) {
            const location = result.rows[0];
            return res.json({
                success: true,
                exists: true,
                location: {
                    location_id: location.location_id,
                    location_name: location.location_name,
                    buyer_id: location.buyer_id,
                    buyer_name: location.buyer_name,
                    state_license: location.state_license
                }
            });
        }
        
        res.json({
            success: true,
            exists: false
        });
    } catch (err) {
        console.error('Error checking DIS number:', err);
        res.status(500).json({ 
            success: false,
            message: "Failed to check DIS number", 
            error: err.message 
        });
    }
};

// Move a location from one buyer to another
const moveLocation = async (req, res) => {
    const { pool } = require('../../config/database');
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { locationId } = req.params;
        const { targetBuyerId, disNumber } = req.body;
        
        if (!targetBuyerId || !locationId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                success: false,
                message: "Target buyer ID and location ID are required" 
            });
        }
        
        // Get current location info
        const locationResult = await client.query(`
            SELECT 
                l.*,
                b.entry_id as current_buyer_id,
                b.name as current_buyer_name
            FROM "ORDERS-buyer_locations" l
            INNER JOIN "ORDERS-buyers" b ON l.orders_buyer_id = b.entry_id
            WHERE l.entry_id = $1
        `, [locationId]);
        
        if (locationResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                success: false,
                message: "Location not found" 
            });
        }
        
        const location = locationResult.rows[0];
        
        // Verify target buyer exists
        const buyerResult = await client.query(`
            SELECT entry_id, name FROM "ORDERS-buyers" WHERE entry_id = $1
        `, [targetBuyerId]);
        
        if (buyerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                success: false,
                message: "Target buyer not found" 
            });
        }
        
        const targetBuyer = buyerResult.rows[0];
        
        // If DIS number provided, verify it matches
        if (disNumber && location.state_license && 
            disNumber.trim().toLowerCase() !== location.state_license.trim().toLowerCase()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                success: false,
                message: "DIS number does not match this location" 
            });
        }
        
        // Move location: Update orders_buyer_id
        await client.query(`
            UPDATE "ORDERS-buyer_locations"
            SET orders_buyer_id = $1, updated_at = NOW()
            WHERE entry_id = $2
        `, [targetBuyerId, locationId]);
        
        // Move all invoices associated with this location
        await client.query(`
            UPDATE "ORDERS-invoices"
            SET fk_buyer_id = $1, updated_at = NOW()
            WHERE fk_location_id = $2
        `, [targetBuyerId, locationId]);
        
        // Move portal access records
        await client.query(`
            UPDATE "ORDERS-portal-access"
            SET fk_buyer_id = $1
            WHERE fk_location_id = $2
        `, [targetBuyerId, locationId]);
        
        // Account credits are already linked by fk_location_id, so they stay with the location
        // No update needed for account credits
        
        // Standing discounts are linked by location_id, so they stay with the location
        // No update needed
        
        // Note: Sales rep assignments at location level (assigned_sales_rep_id column) stay with the location
        // Buyer-level sales rep assignments stay with the buyer, not the location
        // Discount buyer assignments are buyer-level, so they stay with the original buyer
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: `Location "${location.name}" has been moved from "${location.current_buyer_name}" to "${targetBuyer.name}"`,
            location: {
                location_id: locationId,
                location_name: location.name,
                new_buyer_id: targetBuyerId,
                new_buyer_name: targetBuyer.name
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error moving location:', err);
        res.status(500).json({ 
            success: false,
            message: "Failed to move location", 
            error: err.message 
        });
    } finally {
        client.release();
    }
};

// Delivery Window Management
const deliveryWindowService = require('../../Services/deliveryWindowService');

// Get all delivery windows for a location
const getLocationWindows = async (req, res) => {
    try {
        const { locationId } = req.params;
        const windows = await deliveryWindowService.getLocationWindows(locationId);
        res.json({ success: true, windows });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to get delivery windows", error: err.message });
    }
};

// Create a new delivery window
const createDeliveryWindow = async (req, res) => {
    try {
        const { locationId } = req.params;
        const window = await deliveryWindowService.createWindow(locationId, req.body);
        res.status(201).json({ success: true, window });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to create delivery window", error: err.message });
    }
};

// Update a delivery window
const updateDeliveryWindow = async (req, res) => {
    try {
        const { windowId } = req.params;
        const window = await deliveryWindowService.updateWindow(windowId, req.body);
        res.json({ success: true, window });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to update delivery window", error: err.message });
    }
};

// Delete a delivery window
const deleteDeliveryWindow = async (req, res) => {
    try {
        const { windowId } = req.params;
        await deliveryWindowService.deleteWindow(windowId);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to delete delivery window", error: err.message });
    }
};

// Validate delivery time for a location
const validateDeliveryTime = async (req, res) => {
    try {
        const { locationId } = req.params;
        const { deliveryDateTime } = req.body;
        
        if (!deliveryDateTime) {
            return res.status(400).json({ success: false, message: "deliveryDateTime is required" });
        }
        
        const validation = await deliveryWindowService.validateDeliveryTime(locationId, deliveryDateTime);
        res.json({ success: true, ...validation });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to validate delivery time", error: err.message });
    }
};

// Get all delivery zones (for filtering)
const getAllDeliveryZones = async (req, res) => {
    try {
        const zones = await deliveryWindowService.getAllDeliveryZones();
        res.json({ success: true, zones });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to get delivery zones", error: err.message });
    }
};

module.exports = {
    createLocation,
    updateLocation,
    deleteLocation,
    checkDisNumber,
    moveLocation,
    getLocationWindows,
    createDeliveryWindow,
    updateDeliveryWindow,
    deleteDeliveryWindow,
    validateDeliveryTime,
    getAllDeliveryZones
};