// Server/Middleware/auth.js

const UserModel = require('../Models/userModel');

/**
 * Middleware to check if user is authenticated
 */
const requireAuth = async (req, res, next) => {
    try {
        console.log(`[AUTH MIDDLEWARE] Checking auth for: ${req.path}`);
        console.log(`[AUTH MIDDLEWARE] Session exists: ${!!req.session}`);
        console.log(`[AUTH MIDDLEWARE] Session ID: ${req.sessionID}`);
        console.log(`[AUTH MIDDLEWARE] Session userId: ${req.session?.userId}`);
        console.log(`[AUTH MIDDLEWARE] Session data:`, req.session ? Object.keys(req.session) : 'no session');
        
        if (!req.session || !req.session.userId) {
            console.log(`[AUTH MIDDLEWARE] No session or userId, redirecting to login`);
            // If it's an API request, return JSON error
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ 
                    error: 'Unauthorized',
                    message: 'Please log in to access this resource'
                });
            }
            // Otherwise redirect to login
            return res.redirect('/auth/login');
        }
        
        console.log(`[AUTH MIDDLEWARE] Session found, verifying user: ${req.session.userId}`);

        // Verify user still exists and is active
        console.log(`[AUTH MIDDLEWARE] Looking up user ID: ${req.session.userId}`);
        const user = await UserModel.findById(req.session.userId);
        
        if (!user) {
            console.log(`[AUTH MIDDLEWARE] User not found, destroying session`);
            req.session.destroy();
            return res.redirect('/auth/login');
        }

        console.log(`[AUTH MIDDLEWARE] User found: ${user.username}, status: ${user.status}`);
        if (user.status !== 'active') {
            console.log(`[AUTH MIDDLEWARE] User not active, destroying session`);
            req.session.destroy();
            return res.redirect('/auth/login?error=Your account is not active');
        }
        
        // Refresh roles and permissions from database to ensure they're current
        // This prevents stale session data from persisting after role changes
        // Always get fresh data from database, not from session cache
        const userWithPermissions = await UserModel.getUserWithPermissions(req.session.userId);
        req.session.roles = userWithPermissions.roles.map(r => r.name);
        req.session.permissions = userWithPermissions.permissions;
        req.session.isSuperuser = user.is_superuser;
        
        // Save updated session data
        req.session.save((err) => {
            if (err) {
                console.error('[AUTH MIDDLEWARE] Error saving updated session:', err);
            }
        });
        
        console.log(`[AUTH MIDDLEWARE] Authentication successful, proceeding`);
        console.log(`[AUTH MIDDLEWARE] Current roles: ${req.session.roles.join(', ')}`);

        // Attach user info to request
        req.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            isSuperuser: user.is_superuser
        };

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Authentication error' });
    }
};

/**
 * Middleware to check if user is a superuser
 */
const requireSuperuser = async (req, res, next) => {
    try {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const isSuperuser = await UserModel.isSuperuser(req.session.userId);
        
        if (!isSuperuser) {
            return res.status(403).json({ 
                error: 'Forbidden',
                message: 'Superuser access required'
            });
        }

        next();
    } catch (error) {
        console.error('Superuser check error:', error);
        res.status(500).json({ error: 'Authorization error' });
    }
};

/**
 * Middleware to check if user has specific permission
 */
const requirePermission = (action, resource) => {
    return async (req, res, next) => {
        try {
            if (!req.session || !req.session.userId) {
                return res.status(401).json({ 
                    error: 'Unauthorized',
                    message: 'Please log in to access this resource'
                });
            }

            // Check if user is superuser (superusers have all permissions)
            const isSuperuser = await UserModel.isSuperuser(req.session.userId);
            
            if (isSuperuser) {
                return next();
            }

            // Check if user has the required permission
            const hasPermission = await UserModel.hasPermission(req.session.userId, action, resource);
            
            if (!hasPermission) {
                return res.status(403).json({ 
                    error: 'Forbidden',
                    message: `You do not have permission to ${action} ${resource}`
                });
            }

            next();
        } catch (error) {
            console.error('Permission check error:', error);
            res.status(500).json({ error: 'Authorization error' });
        }
    };
};

/**
 * Middleware to check if user has any of the specified roles
 */
const requireRole = (...roles) => {
    return async (req, res, next) => {
        try {
            if (!req.session || !req.session.userId) {
                return res.status(401).json({ 
                    error: 'Unauthorized',
                    message: 'Please log in to access this resource'
                });
            }

            // Check if user is superuser
            const isSuperuser = await UserModel.isSuperuser(req.session.userId);
            
            if (isSuperuser) {
                return next();
            }

            // Get user roles
            const userRoles = await UserModel.getUserRoles(req.session.userId);
            const userRoleNames = userRoles.map(r => (r.name || r.role_name || '').trim()).filter(Boolean);

            // Normalize role names for comparison (handle spaces, underscores, case)
            const normalizeRole = (role) => role.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
            
            // Check if user has any of the required roles (case-insensitive, space/underscore agnostic)
            const hasRole = roles.some(role => 
                userRoleNames.some(userRole => 
                    normalizeRole(userRole) === normalizeRole(role)
                )
            );
            
            if (!hasRole) {
                console.log(`[AUTH] Role check failed for user ${req.session.userId}`);
                console.log(`[AUTH] User roles: ${JSON.stringify(userRoleNames)}`);
                console.log(`[AUTH] Required roles: ${JSON.stringify(roles)}`);
                return res.status(403).json({ 
                    error: 'Forbidden',
                    message: `Required role: ${roles.join(' or ')}`
                });
            }

            next();
        } catch (error) {
            console.error('Role check error:', error);
            res.status(500).json({ error: 'Authorization error' });
        }
    };
};

/**
 * Middleware to check if user has all of the specified roles
 */
const requireAllRoles = (...roles) => {
    return async (req, res, next) => {
        try {
            if (!req.session || !req.session.userId) {
                return res.status(401).json({ 
                    error: 'Unauthorized',
                    message: 'Please log in to access this resource'
                });
            }

            // Check if user is superuser
            const isSuperuser = await UserModel.isSuperuser(req.session.userId);
            
            if (isSuperuser) {
                return next();
            }

            // Get user roles
            const userRoles = await UserModel.getUserRoles(req.session.userId);
            const userRoleNames = userRoles.map(r => r.name);

            // Check if user has all of the required roles
            const hasAllRoles = roles.every(role => userRoleNames.includes(role));
            
            if (!hasAllRoles) {
                return res.status(403).json({ 
                    error: 'Forbidden',
                    message: `Required roles: ${roles.join(' and ')}`
                });
            }

            next();
        } catch (error) {
            console.error('Role check error:', error);
            res.status(500).json({ error: 'Authorization error' });
        }
    };
};

module.exports = {
    requireAuth,
    requireSuperuser,
    requirePermission,
    requireRole,
    requireAllRoles
};

