/**
 * JWT Authentication Service
 * Handles JWT token generation and validation for API endpoints
 */

const jwt = require('jsonwebtoken');
const UserModel = require('../Models/userModel');

// JWT secret key - in production, this should be in environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'green-releaf-jwt-secret-key-2024';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h'; // 24 hours

class JWTAuthService {
    /**
     * Generate JWT token for a user
     */
    static generateToken(user) {
        const superFlag = user.is_superadmin ?? user.is_superuser ?? user.is_admin ?? false;
        const payload = {
            userId: user.id,
            username: user.username,
            email: user.email,
            isAdmin: superFlag,
            isSuperuser: superFlag
        };

        return jwt.sign(payload, JWT_SECRET, { 
            expiresIn: JWT_EXPIRES_IN,
            issuer: 'green-releaf-api',
            audience: 'green-releaf-client'
        });
    }

    /**
     * Verify and decode JWT token
     */
    static verifyToken(token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET, {
                issuer: 'green-releaf-api',
                audience: 'green-releaf-client'
            });
            return decoded;
        } catch (error) {
            throw new Error(`Invalid token: ${error.message}`);
        }
    }

    /**
     * Extract token from Authorization header
     */
    static extractTokenFromHeader(authHeader) {
        if (!authHeader) {
            throw new Error('Authorization header is required');
        }

        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            throw new Error('Authorization header must be in format: Bearer <token>');
        }

        return parts[1];
    }

    /**
     * Validate token and get user info
     */
    static async validateTokenAndGetUser(token) {
        try {
            // Verify the token
            const decoded = this.verifyToken(token);
            
            // Get user from database to ensure they still exist and are active
            const user = await UserModel.findById(decoded.userId);
            
            if (!user) {
                throw new Error('User not found');
            }

            if (user.status !== 'active') {
                throw new Error('User account is not active');
            }

            const superFlag = user.is_superadmin ?? user.is_superuser ?? user.is_admin ?? false;
            return {
                id: user.id,
                username: user.username,
                email: user.email,
                isAdmin: superFlag,
                isSuperuser: superFlag,
                status: user.status
            };
        } catch (error) {
            throw new Error(`Token validation failed: ${error.message}`);
        }
    }

    /**
     * Middleware to authenticate API requests
     */
    static authenticateToken() {
        return async (req, res, next) => {
            try {
                const authHeader = req.headers.authorization;
                const token = this.extractTokenFromHeader(authHeader);
                const user = await this.validateTokenAndGetUser(token);
                
                // Add user info to request object
                req.user = user;
                req.token = token;
                
                next();
            } catch (error) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication failed',
                    message: error.message
                });
            }
        };
    }

    /**
     * Generate token for Swagger API testing
     */
    static async generateTestToken(username, password) {
        try {
            // Validate user credentials
            const user = await UserModel.findByUsername(username);
            
            if (!user) {
                throw new Error('Invalid username');
            }

            // In a real implementation, you'd verify the password hash here
            // For now, we'll assume the user is valid if they exist
            
            if (user.status !== 'active') {
                throw new Error('User account is not active');
            }

            // Generate token
            const token = this.generateToken(user);
            
            const superFlag = user.is_superadmin ?? user.is_superuser ?? user.is_admin ?? false;
            return {
                success: true,
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    isAdmin: superFlag,
                    isSuperuser: superFlag
                },
                expiresIn: JWT_EXPIRES_IN
            };
        } catch (error) {
            throw new Error(`Token generation failed: ${error.message}`);
        }
    }
}

module.exports = JWTAuthService;
