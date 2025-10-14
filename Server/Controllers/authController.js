// Server/Controllers/authController.js

const UserModel = require('../Models/userModel');

class AuthController {
    /**
     * Show login page
     */
    static showLogin(req, res) {
        if (req.session.userId) {
            return res.redirect('/admin');
        }
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
            const { username, password, rememberMe } = req.body;

            // Validate input
            if (!username || !password) {
                return res.redirect('/auth/login?error=Username and password are required');
            }

            // Find user by username
            const user = await UserModel.findByUsername(username);
            
            if (!user) {
                return res.redirect('/auth/login?error=Invalid username or password');
            }

            // Check if user is active
            if (user.status !== 'active') {
                return res.redirect('/auth/login?error=Your account is not active. Please contact an administrator.');
            }

            // Verify password
            const isPasswordValid = await UserModel.verifyPassword(password, user.password_hash);
            
            if (!isPasswordValid) {
                return res.redirect('/auth/login?error=Invalid username or password');
            }

            // Update last login
            await UserModel.updateLastLogin(user.id);

            // Create session
            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.isSuperuser = user.is_superuser;
            
            // Set session duration based on remember me
            if (rememberMe) {
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
            }

            // Get user roles and permissions
            const userWithPermissions = await UserModel.getUserWithPermissions(user.id);
            req.session.roles = userWithPermissions.roles.map(r => r.name);
            req.session.permissions = userWithPermissions.permissions;

            // Redirect to admin dashboard
            res.redirect('/admin');
        } catch (error) {
            console.error('Login error:', error);
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

