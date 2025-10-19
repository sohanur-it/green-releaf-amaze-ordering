/**
 * JWT Token Routes
 * Handles JWT token generation and validation endpoints
 */

const express = require('express');
const router = express.Router();
const TokenController = require('../Controllers/tokenController');
const JWTAuthService = require('../Services/jwtAuth');

/**
 * @swagger
 * /api/v1/auth/token:
 *   post:
 *     summary: Generate JWT token for API authentication
 *     description: Generate a JWT token using username and password for API authentication
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TokenRequest'
 *           example:
 *             username: "admin"
 *             password: "admin123"
 *     responses:
 *       200:
 *         description: Token generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenResponse'
 *       400:
 *         description: Bad request - missing username or password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/token', TokenController.generateToken);

/**
 * @swagger
 * /api/v1/auth/validate:
 *   get:
 *     summary: Validate existing JWT token
 *     description: Validate an existing JWT token and return user information
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Token is valid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationResponse'
 *       401:
 *         description: Token validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/validate', TokenController.validateToken);

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     summary: Get current user information
 *     description: Get current user information from the authenticated JWT token
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationResponse'
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/me', JWTAuthService.authenticateToken(), TokenController.getCurrentUser);

module.exports = router;
