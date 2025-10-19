/**
 * JWT Token Swagger Documentation
 * Adds JWT authentication endpoints to Swagger UI
 */

const swaggerJSDoc = require('swagger-jsdoc');

// Swagger options for JWT token endpoints
const tokenSwaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'JWT Authentication API',
      version: '1.0.0',
      description: 'JWT token generation and validation endpoints for API authentication'
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token for API authentication'
        }
      },
      schemas: {
        TokenRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: {
              type: 'string',
              description: 'Username for authentication',
              example: 'admin'
            },
            password: {
              type: 'string',
              description: 'Password for authentication',
              example: 'admin123'
            }
          }
        },
        TokenResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              example: 'Token generated successfully'
            },
            data: {
              type: 'object',
              properties: {
                success: {
                  type: 'boolean',
                  example: true
                },
                token: {
                  type: 'string',
                  description: 'JWT token for API authentication',
                  example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
                },
                user: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'integer',
                      example: 21
                    },
                    username: {
                      type: 'string',
                      example: 'admin'
                    },
                    email: {
                      type: 'string',
                      example: 'admin@greenreleaf.com'
                    },
                    isAdmin: {
                      type: 'boolean',
                      example: false
                    },
                    isSuperuser: {
                      type: 'boolean',
                      example: true
                    }
                  }
                },
                expiresIn: {
                  type: 'string',
                  example: '24h'
                }
              }
            }
          }
        },
        ValidationResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              example: 'Token is valid'
            },
            data: {
              type: 'object',
              properties: {
                user: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'integer',
                      example: 21
                    },
                    username: {
                      type: 'string',
                      example: 'admin'
                    },
                    email: {
                      type: 'string',
                      example: 'admin@greenreleaf.com'
                    },
                    isAdmin: {
                      type: 'boolean',
                      example: false
                    },
                    isSuperuser: {
                      type: 'boolean',
                      example: true
                    }
                  }
                },
                token: {
                  type: 'string',
                  description: 'Partial token for security',
                  example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
                }
              }
            }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'string',
              example: 'Authentication failed'
            },
            message: {
              type: 'string',
              example: 'Invalid username or password'
            }
          }
        }
      }
    }
  },
  apis: ['./Server/Routes/token-routes.js'] // Path to the API files
};

const tokenSwaggerSpec = swaggerJSDoc(tokenSwaggerOptions);

module.exports = { tokenSwaggerSpec };
