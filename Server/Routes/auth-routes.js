// Server/Routes/auth-routes.js

const express = require('express');
const router = express.Router();
const AuthController = require('../Controllers/authController');

// Public routes (no authentication required)
router.get('/login', AuthController.showLogin);
router.post('/login', AuthController.login);
router.get('/register', AuthController.showRegister);
router.post('/register', AuthController.register);
router.get('/logout', AuthController.logout);
router.get('/pending', AuthController.showPending);

// Protected route (requires authentication)
router.get('/me', AuthController.getCurrentUser);

module.exports = router;

