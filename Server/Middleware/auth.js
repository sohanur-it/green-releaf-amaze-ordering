// Server/Middleware/auth.js

const UserModel = require('../Models/userModel');

/**
 * Middleware to check if user is authenticated
 */
const requireAuth = async (req, res, next) => {
    try {
        if (!req.session || !req.session.userId) {
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

        // Verify user still exists and is active
        const user = await UserModel.findById(req.session.userId);
        
        if (!user) {
            req.session.destroy();
            return res.redirect('/auth/login');
        }

        if (user.status !== 'active') {
            req.session.destroy();
            return res.redirect('/auth/login?error=Your account is not active');
        }

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

            // Check if user has any of the required roles (case-insensitive)
            const hasRole = roles.some(role => 
                userRoleNames.some(userRole => 
                    userRole.toLowerCase() === role.toLowerCase()
                )
            );
            
            if (!hasRole) {
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

