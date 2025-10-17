// Simple authentication middleware for Swagger API testing
// This bypasses database authentication for testing purposes

const authMiddleware = (req, res, next) => {
  // For testing purposes, create a mock session if none exists
  if (!req.session || !req.session.userId) {
    // Create a mock authenticated session for API testing
    req.session.userId = 'test-user-123';
    req.session.username = 'test-admin';
    req.session.isAdmin = true;
    req.session.isAuthenticated = true;
    console.log('🔐 Created mock session for API testing');
  }
  
  // Always proceed - this middleware never blocks requests
  next();
};

module.exports = authMiddleware;
