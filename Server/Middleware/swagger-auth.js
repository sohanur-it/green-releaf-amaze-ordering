// JWT-based authentication middleware for Swagger API testing
// This validates JWT tokens and extracts real user information

const JWTAuthService = require('../Services/jwtAuth');

const authMiddleware = (req, res, next) => {
  try {
    // Check for JWT token in Authorization header
    const authHeader = req.headers.authorization;
    
    if (authHeader) {
      try {
        // Extract and validate JWT token
        const token = JWTAuthService.extractTokenFromHeader(authHeader);
        const decoded = JWTAuthService.verifyToken(token);
        
        // Add user info to request object
        req.user = {
          id: decoded.userId,
          username: decoded.username,
          email: decoded.email,
          isAdmin: decoded.isAdmin,
          isSuperuser: decoded.isSuperuser
        };
        
        // Set session for compatibility with existing code
        req.session = req.session || {};
        req.session.userId = decoded.userId;
        req.session.username = decoded.username;
        req.session.email = decoded.email;
        req.session.isAdmin = decoded.isAdmin;
        req.session.isSuperuser = decoded.isSuperuser;
        
        console.log(`🔐 Authenticated user via JWT: ${decoded.username} (ID: ${decoded.userId})`);
        next();
        return;
        
      } catch (jwtError) {
        console.log(`🔐 JWT validation failed: ${jwtError.message}`);
        // Fall through to create mock session for testing
      }
    }
    
    // If there's already a valid session with a real user, use it
    if (req.session && req.session.userId && typeof req.session.userId === 'number') {
      // Real user is logged in, use their session - DO NOT CREATE MOCK SESSION
      req.user = {
        id: req.session.userId,
        username: req.session.username || 'admin',
        email: req.session.email || 'admin@example.com',
        isSuperuser: req.session.isAdmin || false
      };
      console.log(`🔐 Using real user session: ${req.session.userId}`);
      next();
      return;
    }

    // Only create mock session if NO user is logged in at all
    // This allows Swagger API testing without requiring login
    if (!req.session || !req.session.userId) {
      // Create a mock authenticated session for API testing
      req.session.userId = 'SYSTEM'; // Use SYSTEM for automated operations
      req.session.username = 'system';
      req.session.isAdmin = true;
      req.session.isAuthenticated = true;
      console.log('🔐 Created mock session for API testing (no user logged in)');
    }
    
    // Add user info to request object
    req.user = {
      id: req.session.userId,
      username: req.session.username,
      email: 'system@example.com',
      isSuperuser: true
    };
    
    // Always proceed - this middleware never blocks requests
    next();
    
  } catch (error) {
    console.error('🔐 Auth middleware error:', error.message);
    // Fall back to mock session for testing
    req.session = req.session || {};
    req.session.userId = 'SYSTEM';
    req.session.username = 'system';
    req.session.isAdmin = true;
    
    req.user = {
      id: 'SYSTEM',
      username: 'system',
      email: 'system@example.com',
      isSuperuser: true
    };
    
    next();
  }
};

module.exports = authMiddleware;
