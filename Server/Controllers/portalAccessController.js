// Server/Controllers/portalAccessController.js

const { query } = require('../config/database');

class PortalAccessController {
    /**
     * List all portal access links
     */
    static async list(req, res) {
        try {
            const portalAccesses = await query(`
                SELECT 
                    pa.id,
                    pa.access_uuid,
                    pa.fk_buyer_id,
                    pa.fk_location_id,
                    pa.is_active,
                    pa.expires_at,
                    pa.first_accessed_at,
                    pa.last_accessed_at,
                    pa.access_count,
                    pa.created_at,
                    pa.notes,
                    b.name as buyer_name
                FROM "ORDERS-portal-access" pa
                INNER JOIN "ORDERS-buyers" b ON pa.fk_buyer_id = b.entry_id
                ORDER BY pa.created_at DESC
            `);
            
            res.render('admin/portal-access', {
                title: 'Portal Access Management',
                layout: 'layouts/main',
                portalAccesses: portalAccesses.rows
            });
        } catch (error) {
            console.error('Error loading portal access:', error);
            res.status(500).json({ error: 'Failed to load portal access links' });
        }
    }
    
    /**
     * Create new portal access link
     */
    static async create(req, res) {
        try {
            const { buyer_id, location_id, expires_at, notes } = req.body;
            
            if (!buyer_id) {
                return res.status(400).json({ error: 'Buyer ID is required' });
            }
            
            if (!location_id) {
                return res.status(400).json({ error: 'Location ID is required' });
            }
            
            // Get the location's access_code from CRM
            const locationResult = await query(`
                SELECT access_code
                FROM "ORDERS-buyer_locations"
                WHERE entry_id = $1
            `, [location_id]);
            
            if (locationResult.rows.length === 0) {
                return res.status(404).json({ error: 'Location not found' });
            }
            
            const locationAccessCode = locationResult.rows[0].access_code;
            
            // Validation: Prevent portal access creation without a valid UUID access_code
            if (!locationAccessCode) {
                return res.status(400).json({ 
                    error: 'Cannot create portal access: Location does not have an access_code. Please ensure the location has a valid UUID access_code before creating portal access.' 
                });
            }
            
            // Validate that access_code is a valid UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(locationAccessCode)) {
                return res.status(400).json({ 
                    error: 'Cannot create portal access: Location access_code is not a valid UUID format. Please ensure the location has a valid UUID access_code.' 
                });
            }
            
            // Check if portal access already exists for this location
            const existingAccess = await query(`
                SELECT id, access_uuid, is_active
                FROM "ORDERS-portal-access"
                WHERE fk_location_id = $1
                ORDER BY created_at DESC
                LIMIT 1
            `, [location_id]);
            
            if (existingAccess.rows.length > 0) {
                const existing = existingAccess.rows[0];
                // Update the existing access to use the location's access_code if it doesn't match
                if (existing.access_uuid !== locationAccessCode) {
                    await query(`
                        UPDATE "ORDERS-portal-access"
                        SET access_uuid = $1,
                            is_active = true,
                            expires_at = $2,
                            notes = $3
                        WHERE id = $4
                    `, [locationAccessCode, expires_at || null, notes || null, existing.id]);
                } else if (expires_at !== undefined || notes !== undefined) {
                    // Update expires_at or notes if provided
                    await query(`
                        UPDATE "ORDERS-portal-access"
                        SET expires_at = COALESCE($1, expires_at),
                            notes = COALESCE($2, notes)
                        WHERE id = $3
                    `, [expires_at || null, notes || null, existing.id]);
                }
                
                return res.json({
                    success: true,
                    access_uuid: locationAccessCode,
                    id: existing.id,
                    message: 'Portal access already exists for this location'
                });
            }
            
            // Create new portal access using the location's access_code as UUID
            const result = await query(`
                INSERT INTO "ORDERS-portal-access" (
                    fk_buyer_id,
                    fk_location_id,
                    access_uuid,
                    is_active,
                    expires_at,
                    notes,
                    created_by
                ) VALUES ($1, $2, $3, true, $4, $5, $6)
                RETURNING access_uuid, id
            `, [
                buyer_id,
                location_id,
                locationAccessCode,
                expires_at || null,
                notes || null,
                req.user.id
            ]);
            
            res.json({
                success: true,
                access_uuid: result.rows[0].access_uuid,
                id: result.rows[0].id
            });
        } catch (error) {
            console.error('Error creating portal access:', error);
            res.status(500).json({ error: 'Failed to create portal access link' });
        }
    }
    
    /**
     * Toggle portal access active status
     */
    static async toggleActive(req, res) {
        try {
            const { id } = req.params;
            
            const result = await query(`
                UPDATE "ORDERS-portal-access"
                SET is_active = NOT is_active
                WHERE id = $1
                RETURNING is_active
            `, [id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Portal access not found' });
            }
            
            res.json({
                success: true,
                is_active: result.rows[0].is_active
            });
        } catch (error) {
            console.error('Error toggling portal access:', error);
            res.status(500).json({ error: 'Failed to update portal access' });
        }
    }
    
    /**
     * Delete portal access
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;
            
            await query(`
                DELETE FROM "ORDERS-portal-access"
                WHERE id = $1
            `, [id]);
            
            res.json({ success: true });
        } catch (error) {
            console.error('Error deleting portal access:', error);
            res.status(500).json({ error: 'Failed to delete portal access' });
        }
    }
    
    /**
     * Sync UUID for portal access with location's access_code
     * Since UUID should always match the location's access_code, this syncs it back
     */
    static async regenerateUuid(req, res) {
        try {
            const { id } = req.params;
            
            // Get the portal access to find the location
            const portalAccess = await query(`
                SELECT fk_location_id
                FROM "ORDERS-portal-access"
                WHERE id = $1
            `, [id]);
            
            if (portalAccess.rows.length === 0) {
                return res.status(404).json({ error: 'Portal access not found' });
            }
            
            const locationId = portalAccess.rows[0].fk_location_id;
            
            // Get the location's access_code
            const locationResult = await query(`
                SELECT access_code
                FROM "ORDERS-buyer_locations"
                WHERE entry_id = $1
            `, [locationId]);
            
            if (locationResult.rows.length === 0) {
                return res.status(404).json({ error: 'Location not found' });
            }
            
            const locationAccessCode = locationResult.rows[0].access_code;
            
            if (!locationAccessCode) {
                return res.status(400).json({ error: 'Location does not have an access_code' });
            }
            
            // Sync the portal access UUID with the location's access_code
            const result = await query(`
                UPDATE "ORDERS-portal-access"
                SET access_uuid = $1
                WHERE id = $2
                RETURNING access_uuid
            `, [locationAccessCode, id]);
            
            const host = req.get('host');
            const protocol = req.protocol;
            const url = `${protocol}://${host}/external/store/${result.rows[0].access_uuid}`;
            
            res.json({
                success: true,
                message: 'UUID synced with location access_code successfully',
                access_uuid: result.rows[0].access_uuid,
                url: url
            });
        } catch (error) {
            console.error('Error syncing UUID:', error);
            res.status(500).json({ error: 'Failed to sync UUID' });
        }
    }
    
    /**
     * Get portal URL
     */
    static async getUrl(req, res) {
        try {
            const { id } = req.params;
            const host = req.get('host');
            const protocol = req.protocol;
            
            const result = await query(`
                SELECT access_uuid
                FROM "ORDERS-portal-access"
                WHERE id = $1
            `, [id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Portal access not found' });
            }
            
            const url = `${protocol}://${host}/external/store/${result.rows[0].access_uuid}`;
            
            res.json({
                success: true,
                url: url,
                uuid: result.rows[0].access_uuid
            });
        } catch (error) {
            console.error('Error getting portal URL:', error);
            res.status(500).json({ error: 'Failed to get portal URL' });
        }
    }
    
    /**
     * Get locations for a buyer
     */
    static async getLocationsForBuyer(req, res) {
        try {
            const { buyerId } = req.params;
            
            const locations = await query(`
                SELECT 
                    entry_id as id,
                    name,
                    line_one,
                    line_two,
                    city,
                    state,
                    zip,
                    state_license
                FROM "ORDERS-buyer_locations"
                WHERE orders_buyer_id = $1
                ORDER BY name
            `, [buyerId]);
            
            res.json({
                success: true,
                locations: locations.rows
            });
        } catch (error) {
            console.error('Error fetching locations:', error);
            res.status(500).json({ error: 'Failed to fetch locations' });
        }
    }
}

module.exports = PortalAccessController;

