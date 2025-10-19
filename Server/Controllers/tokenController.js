/**
 * JWT Token Controller
 * Handles JWT token generation for API authentication
 */

const JWTAuthService = require('../Services/jwtAuth');

class TokenController {
    /**
     * Generate JWT token for API authentication
     * POST /api/v1/auth/token
     */
    static async generateToken(req, res) {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    error: 'Username and password are required'
                });
            }

            const result = await JWTAuthService.generateTestToken(username, password);

            res.json({
                success: true,
                message: 'Token generated successfully',
                data: result
            });

        } catch (error) {
            console.error('Token generation error:', error.message);
            res.status(401).json({
                success: false,
                error: 'Token generation failed',
                message: error.message
            });
        }
    }

    /**
     * Validate existing token
     * GET /api/v1/auth/validate
     */
    static async validateToken(req, res) {
        try {
            const authHeader = req.headers.authorization;
            const token = JWTAuthService.extractTokenFromHeader(authHeader);
            const user = await JWTAuthService.validateTokenAndGetUser(token);

            res.json({
                success: true,
                message: 'Token is valid',
                data: {
                    user,
                    token: token.substring(0, 20) + '...' // Show partial token for security
                }
            });

        } catch (error) {
            res.status(401).json({
                success: false,
                error: 'Token validation failed',
                message: error.message
            });
        }
    }

    /**
     * Get current user info from token
     * GET /api/v1/auth/me
     */
    static async getCurrentUser(req, res) {
        try {
            // User info is already attached by the auth middleware
            res.json({
                success: true,
                message: 'User info retrieved successfully',
                data: {
                    user: req.user
                }
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: 'Failed to get user info',
                message: error.message
            });
        }
    }
}

module.exports = TokenController;
