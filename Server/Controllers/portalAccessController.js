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
            
            const result = await query(`
                INSERT INTO "ORDERS-portal-access" (
                    fk_buyer_id,
                    fk_location_id,
                    is_active,
                    expires_at,
                    notes,
                    created_by
                ) VALUES ($1, $2, true, $3, $4, $5)
                RETURNING access_uuid, id
            `, [
                buyer_id,
                location_id,
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
     * Regenerate UUID for portal access (for security if link is leaked)
     */
    static async regenerateUuid(req, res) {
        try {
            const { id } = req.params;
            
            const result = await query(`
                UPDATE "ORDERS-portal-access"
                SET access_uuid = gen_random_uuid()
                WHERE id = $1
                RETURNING access_uuid
            `, [id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Portal access not found' });
            }
            
            const host = req.get('host');
            const protocol = req.protocol;
            const url = `${protocol}://${host}/external/store/${result.rows[0].access_uuid}`;
            
            res.json({
                success: true,
                message: 'UUID regenerated successfully',
                access_uuid: result.rows[0].access_uuid,
                url: url
            });
        } catch (error) {
            console.error('Error regenerating UUID:', error);
            res.status(500).json({ error: 'Failed to regenerate UUID' });
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

