// Server/Controllers/authController.js

const UserModel = require('../Models/userModel');

class AuthController {
    /**
     * Show login page
     */
    static showLogin(req, res) {
        if (req.session && req.session.userId) {
            console.log(`[AUTH] User already logged in (ID: ${req.session.userId}), redirecting to admin`);
            return res.redirect('/admin');
        }

        console.log('[AUTH] Showing login page');
        res.render('auth/login', {
            title: 'Login',
            layout: 'layouts/auth',
            error: req.query.error
        });
    }

    /**
     * Handle login
     */
    static async login(req, res) {
        try {
            console.log('[AUTH] Login attempt started');
            const { username, password, rememberMe } = req.body;

            // Validate input
            if (!username || !password) {
                console.log('[AUTH] Login failed: Missing username or password');
                return res.redirect('/auth/login?error=Username/Email and password are required');
            }

            console.log(`[AUTH] Attempting to find user: ${username}`);
            // Try to find user by username first, then by email if not found
            let user = await UserModel.findByUsername(username);
            
            // If not found by username, try email
            if (!user) {
                console.log(`[AUTH] User not found by username, trying email: ${username}`);
                user = await UserModel.findByEmail(username);
            }
            
            if (!user) {
                console.log(`[AUTH] Login failed: User not found: ${username}`);
                return res.redirect('/auth/login?error=Invalid username/email or password');
            }

            console.log(`[AUTH] User found: ${user.username} (ID: ${user.id}), status: ${user.status}`);
            
            // Check if user is active
            if (user.status !== 'active') {
                console.log(`[AUTH] Login failed: User account is not active: ${user.status}`);
                return res.redirect('/auth/login?error=Your account is not active. Please contact an administrator.');
            }

            // Verify password
            console.log('[AUTH] Verifying password...');
            const isPasswordValid = await UserModel.verifyPassword(password, user.password_hash);
            
            if (!isPasswordValid) {
                console.log(`[AUTH] Login failed: Invalid password for user: ${user.username}`);
                return res.redirect('/auth/login?error=Invalid username/email or password');
            }

            console.log('[AUTH] Password verified, updating last login...');
            // Update last login
            await UserModel.updateLastLogin(user.id);

            console.log('[AUTH] Creating session...');
            // Create session
            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.email = user.email;
            req.session.isSuperuser = user.is_superuser;
            
            // Set session duration based on remember me
            if (rememberMe) {
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
            }

            console.log('[AUTH] Getting user roles and permissions...');
            // Get user roles and permissions
            const userWithPermissions = await UserModel.getUserWithPermissions(user.id);
            req.session.roles = userWithPermissions.roles.map(r => r.name);
            req.session.permissions = userWithPermissions.permissions;

            console.log(`[AUTH] Login successful for user: ${user.username} (ID: ${user.id})`);
            console.log(`[AUTH] Session ID: ${req.sessionID}`);
            console.log(`[AUTH] Session data before save:`, {
                userId: req.session.userId,
                username: req.session.username,
                email: req.session.email,
                isSuperuser: req.session.isSuperuser,
                roles: req.session.roles,
                permissions: req.session.permissions
            });
            
            // Save session explicitly to ensure it's persisted
            // Use a promise wrapper to ensure proper async handling
            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) {
                        console.error('[AUTH] Error saving session:', err);
                        console.error('[AUTH] Error stack:', err.stack);
                        return reject(err);
                    }
                    resolve();
                });
            });
            
            // Verify session was saved by checking the store
            console.log(`[AUTH] Session save completed. Session ID: ${req.sessionID}`);
            console.log(`[AUTH] Session data after save:`, {
                userId: req.session.userId,
                username: req.session.username,
                email: req.session.email,
                roles: req.session.roles,
                isSuperuser: req.session.isSuperuser
            });
            
            // Verify session was actually saved to database
            const { query } = require('../config/database');
            try {
                const sessionCheck = await query(
                    'SELECT sess FROM user_sessions WHERE sid = $1',
                    [req.sessionID]
                );
                if (sessionCheck.rows.length > 0) {
                    const sessData = typeof sessionCheck.rows[0].sess === 'string' 
                        ? JSON.parse(sessionCheck.rows[0].sess) 
                        : sessionCheck.rows[0].sess;
                    console.log('[AUTH] Session verified in database:', {
                        userId: sessData.userId,
                        username: sessData.username,
                        hasRoles: !!sessData.roles
                    });
                } else {
                    console.warn('[AUTH] WARNING: Session not found in database after save!');
                }
            } catch (dbErr) {
                console.error('[AUTH] Error checking session in database:', dbErr);
            }
            
            console.log('[AUTH] Session saved successfully, redirecting to admin...');
            console.log(`[AUTH] Cookie will be set with session ID: ${req.sessionID}`);
            
            // Set cookie explicitly before redirect
            res.cookie('connect.sid', req.sessionID, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 24 * 60 * 60 * 1000,
                sameSite: 'lax',
                path: '/'
            });
            
            res.redirect('/admin');
        } catch (error) {
            console.error('[AUTH] Login error:', error);
            console.error('[AUTH] Error stack:', error.stack);
            res.redirect('/auth/login?error=An error occurred. Please try again.');
        }
    }

    /**
     * Handle logout
     */
    static async logout(req, res) {
        req.session.destroy((err) => {
            if (err) {
                console.error('Logout error:', err);
            }
            res.redirect('/auth/login');
        });
    }

    /**
     * Show registration page
     */
    static showRegister(req, res) {
        if (req.session.userId) {
            return res.redirect('/admin');
        }
        res.render('auth/register', {
            title: 'Register',
            layout: 'layouts/auth',
            error: req.query.error,
            success: req.query.success
        });
    }

    /**
     * Handle registration
     */
    static async register(req, res) {
        try {
            const { username, firstname, lastname, email, password, confirmPassword } = req.body;

            // Validate input
            if (!username || !firstname || !lastname || !email || !password) {
                return res.redirect('/auth/register?error=All fields are required');
            }

            if (password !== confirmPassword) {
                return res.redirect('/auth/register?error=Passwords do not match');
            }

            if (password.length < 8) {
                return res.redirect('/auth/register?error=Password must be at least 8 characters long');
            }

            // Check if username already exists
            const existingUsername = await UserModel.findByUsername(username);
            if (existingUsername) {
                return res.redirect('/auth/register?error=Username already exists');
            }

            // Check if email already exists
            const existingEmail = await UserModel.findByEmail(email);
            if (existingEmail) {
                return res.redirect('/auth/register?error=Email already exists');
            }

            // Create user with pending status
            await UserModel.create({
                username,
                firstname,
                lastname,
                email,
                password,
                status: 'pending'
            });

            res.redirect('/auth/register?success=Registration successful! Please wait for administrator approval.');
        } catch (error) {
            console.error('Registration error:', error);
            res.redirect('/auth/register?error=An error occurred. Please try again.');
        }
    }

    /**
     * Show pending approval page
     */
    static showPending(req, res) {
        res.render('auth/pending', {
            title: 'Account Pending Approval',
            layout: 'layouts/auth'
        });
    }

    /**
     * Check if user is authenticated
     */
    static async checkAuth(req, res, next) {
        if (!req.session.userId) {
            return res.redirect('/auth/login');
        }
        next();
    }

    /**
     * Check if user is admin
     */
    static async checkAdmin(req, res, next) {
        if (!req.session.userId) {
            return res.redirect('/auth/login');
        }

        const isSuperuser = await UserModel.isSuperuser(req.session.userId);
        const userRoles = await UserModel.getUserRoles(req.session.userId);
        const isAdmin = isSuperuser || userRoles.some(role => role.name === 'Administrator');

        if (!isAdmin) {
            return res.status(403).render('error', {
                title: 'Access Denied',
                layout: 'layouts/main',
                error: {
                    status: 403,
                    message: 'You do not have permission to access this page.'
                }
            });
        }

        next();
    }

    /**
     * Get current user info
     */
    static async getCurrentUser(req, res) {
        try {
            if (!req.session.userId) {
                return res.status(401).json({ error: 'Not authenticated' });
            }

            const user = await UserModel.getUserWithPermissions(req.session.userId);
            res.json(user);
        } catch (error) {
            console.error('Get current user error:', error);
            res.status(500).json({ error: 'Failed to get user information' });
        }
    }
}

module.exports = AuthController;

