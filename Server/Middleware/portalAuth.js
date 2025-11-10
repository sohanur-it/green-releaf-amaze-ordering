// Server/Middleware/portalAuth.js

const { query } = require('../config/database');

/**
 * Middleware to authenticate external buyer portal access via UUID
 * This validates the UUID from the URL and creates a session for the buyer
 */
const authenticatePortalAccess = async (req, res, next) => {
    try {
        const { uuid } = req.params;
        
        if (!uuid) {
            return res.status(401).render('external/error', {
                error: 'Invalid Portal Access',
                message: 'Access UUID is required'
            });
        }
        
        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(uuid)) {
            return res.status(401).render('external/error', {
                error: 'Invalid Portal Access',
                message: 'Invalid UUID format'
            });
        }
        
        // Check if UUID exists and is active
        const portalAccess = await query(`
            SELECT 
                pa.*,
                b.name AS buyer_name,
                l.name AS location_name
            FROM "ORDERS-portal-access" pa
            INNER JOIN "ORDERS-buyers" b ON pa.fk_buyer_id = b.entry_id
            LEFT JOIN "ORDERS-buyer_locations" l ON pa.fk_location_id = l.entry_id
            WHERE pa.access_uuid = $1
            AND pa.is_active = true
        `, [uuid]);
        
        if (portalAccess.rows.length === 0) {
            return res.status(401).render('external/error', {
                error: 'Invalid Portal Access',
                message: 'This access link is not valid or has been deactivated'
            });
        }
        
        const access = portalAccess.rows[0];
        
        // Check if expired
        if (access.expires_at && new Date(access.expires_at) < new Date()) {
            return res.status(401).render('external/error', {
                error: 'Portal Access Expired',
                message: 'This access link has expired. Please contact your sales representative.'
            });
        }
        
        // Update access tracking
        await query(`
            UPDATE "ORDERS-portal-access"
            SET last_accessed_at = NOW(),
                access_count = access_count + 1,
                first_accessed_at = COALESCE(first_accessed_at, NOW())
            WHERE id = $1
        `, [access.id]);
        
        // Create portal session (separate from internal user sessions)
        req.session.portalAccess = {
            accessId: access.id,
            buyerId: access.fk_buyer_id,
            locationId: access.fk_location_id,
            buyerName: access.buyer_name,
            locationName: access.location_name,
            uuid: access.access_uuid
        };
        
        // Attach to request for use in routes
        req.portalAccess = req.session.portalAccess;
        
        next();
    } catch (error) {
        console.error('Portal auth error:', error);
        res.status(500).render('external/error', {
            error: 'Authentication Error',
            message: 'An error occurred while authenticating your access. Please try again.'
        });
    }
};

/**
 * Middleware to ensure portal session exists
 * Use this for routes that require valid portal access
 */
const requirePortalAccess = async (req, res, next) => {
    try {
        if (!req.session || !req.session.portalAccess) {
            return res.status(401).render('external/error', {
                error: 'Session Expired',
                message: 'Your portal session has expired. Please access the portal again using your unique link.'
            });
        }
        
        // Validate session data
        req.portalAccess = req.session.portalAccess;
        
        next();
    } catch (error) {
        console.error('Portal session check error:', error);
        res.status(500).render('external/error', {
            error: 'Session Error',
            message: 'An error occurred while validating your session.'
        });
    }
};

module.exports = {
    authenticatePortalAccess,
    requirePortalAccess
};

