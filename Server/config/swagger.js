const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// Swagger configuration options
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Green Releaf Amaze Ordering - API Documentation',
      version: '1.0.0',
      description: 'Complete API documentation for METRC sync services, JWT authentication, and admin operations',
      contact: {
        name: 'Green Releaf Amaze Ordering',
        email: 'admin@greenreleaf.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: 'https://your-production-domain.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token for API authentication. Get token from /api/v1/auth/token endpoint.'
        }
      },
      schemas: {
        // JWT Authentication Schemas
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
        // Existing Sync Schemas
        SyncStatus: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['running', 'stopped', 'error'],
              description: 'Current scheduler status'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Last status update timestamp'
            },
            runningJobs: {
              type: 'integer',
              description: 'Number of currently running sync jobs'
            },
            recentJobs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  status: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  duration: { type: 'integer' }
                }
              },
              description: 'List of recently executed jobs'
            },
            schedules: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  schedule: { type: 'string' },
                  script: { type: 'string' }
                }
              },
              description: 'Configured sync schedules'
            }
          }
        },
        SyncResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: 'Whether the sync operation was successful'
            },
            message: {
              type: 'string',
              description: 'Human-readable status message'
            },
            serviceName: {
              type: 'string',
              description: 'Name of the sync service that was executed'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'When the sync was executed'
            },
            recordsProcessed: {
              type: 'integer',
              description: 'Number of records processed during sync'
            },
            executionTime: {
              type: 'integer',
              description: 'Execution time in milliseconds'
            },
            details: {
              type: 'object',
              description: 'Additional sync details and statistics'
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
              description: 'Error message'
            },
            timestamp: {
              type: 'string',
              format: 'date-time'
            },
            details: {
              type: 'object',
              description: 'Additional error details'
            }
          }
        },
        // Order Management Schemas
        Order: {
          type: 'object',
          properties: {
            order_id: {
              type: 'integer',
              description: 'Unique order identifier',
              example: 12345
            },
            customer_id: {
              type: 'integer',
              description: 'Customer ID',
              example: 567
            },
            total_amount: {
              type: 'number',
              format: 'float',
              description: 'Total order amount',
              example: 150.00
            },
            status: {
              type: 'string',
              enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
              description: 'Order status',
              example: 'confirmed'
            },
            notes: {
              type: 'string',
              description: 'Order notes',
              example: 'Client requested more items'
            },
            shipping_address: {
              type: 'object',
              description: 'Shipping address details'
            },
            billing_address: {
              type: 'object',
              description: 'Billing address details'
            },
            payment_method: {
              type: 'string',
              description: 'Payment method',
              example: 'credit_card'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Order creation timestamp'
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
              description: 'Last update timestamp'
            }
          }
        },
        OrderCreateRequest: {
          type: 'object',
          required: ['customer_id', 'items'],
          properties: {
            customer_id: {
              type: 'integer',
              description: 'Customer ID',
              example: 567
            },
            items: {
              type: 'array',
              description: 'Order items',
              items: {
                type: 'object',
                properties: {
                  product_id: { type: 'integer', example: 1 },
                  quantity: { type: 'integer', example: 2 },
                  price: { type: 'number', example: 25.00 }
                }
              }
            },
            notes: {
              type: 'string',
              example: 'Delivery instructions here'
            },
            shipping_address: {
              type: 'object',
              properties: {
                street: { type: 'string', example: '123 Main St' },
                city: { type: 'string', example: 'Springfield' },
                state: { type: 'string', example: 'MO' },
                zip: { type: 'string', example: '65801' }
              }
            },
            billing_address: {
              type: 'object',
              description: 'Billing address (same format as shipping_address)'
            },
            payment_method: {
              type: 'string',
              enum: ['cash', 'credit_card', 'debit_card', 'check'],
              example: 'credit_card'
            }
          }
        },
        OrderUpdateRequest: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
              example: 'confirmed'
            },
            total_amount: {
              type: 'number',
              format: 'float',
              example: 150.00
            },
            notes: {
              type: 'string',
              example: 'Client requested more items'
            },
            shipping_address: {
              type: 'object',
              description: 'Updated shipping address'
            },
            billing_address: {
              type: 'object',
              description: 'Updated billing address'
            },
            payment_method: {
              type: 'string',
              example: 'cash'
            }
          }
        },
        OrderListResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/Order'
              }
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer', example: 1 },
                limit: { type: 'integer', example: 50 }
              }
            }
          }
        },
        OrderResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              $ref: '#/components/schemas/Order'
            },
            message: {
              type: 'string',
              example: 'Order updated successfully'
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Authentication',
        description: 'JWT token generation and validation endpoints'
      },
      {
        name: 'Orders',
        description: 'Order management with field-level audit tracking'
      },
      {
        name: 'Sync Services',
        description: 'METRC data synchronization services'
      },
      {
        name: 'Admin',
        description: 'Administrative operations and monitoring'
      }
    ]
  },
  apis: [
    './Server/Routes/*.js',
    './Server/Controllers/*.js',
    './Server/Middleware/*.js'
  ]
};

// Generate Swagger specification
const swaggerSpec = swaggerJSDoc(swaggerOptions);

// Swagger UI options
const swaggerUiOptions = {
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info .title { color: #2c5530; }
    .swagger-ui .scheme-container { background: #f8f9fa; padding: 20px; border-radius: 8px; }
    .swagger-ui .auth-container { background: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0; }
    .swagger-ui .auth-container h4 { color: #2c5530; margin: 0 0 10px 0; }
    .swagger-ui .auth-container p { margin: 5px 0; color: #4a5568; }
  `,
  customSiteTitle: 'Green Releaf Amaze - Admin Sync API',
  customfavIcon: '/favicon.svg',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    requestInterceptor: (req) => {
      // Add session cookie to requests
      if (req.url.includes('/api/v1/swagger/sync/')) {
        // Get the session cookie from browser's document.cookie
        const cookies = document.cookie.split(';');
        let sessionCookie = '';
        
        for (let cookie of cookies) {
          const trimmedCookie = cookie.trim();
          if (trimmedCookie.startsWith('connect.sid=')) {
            sessionCookie = trimmedCookie;
            break;
          }
        }
        
        if (sessionCookie) {
          req.headers['Cookie'] = sessionCookie;
        } else {
          console.warn('No session cookie found. Please login first.');
        }
      }
      return req;
    },
    onComplete: () => {
      // Add authentication notice
      const authNotice = document.createElement('div');
      authNotice.className = 'auth-container';
      authNotice.innerHTML = `
        <h4>🔐 Authentication Required</h4>
        <p><strong>⚠️ IMPORTANT:</strong> You must login through the web interface first!</p>
        <p><strong>Step 1:</strong> <a href="/auth/login" target="_blank" style="background: #667eea; color: white; padding: 8px 16px; border-radius: 4px; text-decoration: none;">🔑 Login Here</a></p>
        <p><strong>Step 2:</strong> Use your browser session to test the API endpoints below</p>
        <p><strong>Credentials:</strong> <code>admin</code> / <code>admin123</code></p>
        <p><strong>Note:</strong> No API keys needed - your browser session will be used automatically</p>
        <div id="session-status" style="background: #f0f0f0; padding: 10px; border-radius: 4px; margin-top: 10px; font-family: monospace; font-size: 12px;">
          <strong>Session Status:</strong> <span id="session-info">Checking...</span>
        </div>
      `;
      
      // Check session status
      const checkSession = () => {
        const cookies = document.cookie.split(';');
        let sessionCookie = '';
        
        for (let cookie of cookies) {
          const trimmedCookie = cookie.trim();
          if (trimmedCookie.startsWith('connect.sid=')) {
            sessionCookie = trimmedCookie;
            break;
          }
        }
        
        const sessionInfo = document.getElementById('session-info');
        if (sessionCookie) {
          sessionInfo.innerHTML = '✅ <span style="color: green;">Logged in</span> - Session cookie found';
          sessionInfo.parentElement.style.background = '#e8f5e8';
        } else {
          sessionInfo.innerHTML = '❌ <span style="color: red;">Not logged in</span> - No session cookie found';
          sessionInfo.parentElement.style.background = '#ffe8e8';
        }
      };
      
      // Check session status immediately and every 2 seconds
      checkSession();
      setInterval(checkSession, 2000);
      
      // Insert at the top of the info section
      const infoSection = document.querySelector('.swagger-ui .info');
      if (infoSection) {
        infoSection.insertBefore(authNotice, infoSection.firstChild);
      }
      
      // Hide the security section completely
      const securitySection = document.querySelector('.swagger-ui .auth-container');
      if (securitySection) {
        securitySection.style.display = 'none';
      }
    }
  }
};

module.exports = {
  swaggerSpec,
  swaggerUi,
  swaggerUiOptions
};