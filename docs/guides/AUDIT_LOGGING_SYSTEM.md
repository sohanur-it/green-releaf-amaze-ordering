# Audit Logging System - Complete Implementation Guide

## Overview

The audit logging system provides **immutable, comprehensive tracking** of all significant user and system actions. It captures field-level changes with before/after comparisons, enabling accountability, troubleshooting, security monitoring, and regulatory compliance.

## Architecture

### Components

1. **Database Table**: `ORDERS-audit_log` - Stores all audit entries
2. **Audit Logger Service**: `Server/Services/auditLogger.js` - Core logging functionality
3. **Audit Middleware**: `Server/Middleware/auditMiddleware.js` - Automatic request interception
4. **Audit Controller**: `Server/Controllers/auditLogController.js` - Query and view audit logs
5. **Audit Routes**: `Server/Routes/audit-log-routes.js` - API endpoints

---

## Database Schema

```sql
Table: ORDERS-audit_log
├── id (bigint, PRIMARY KEY)
├── user_id (integer, FK to users)
├── action (varchar(100), NOT NULL)
├── resource_type (varchar(50))
├── resource_id (varchar(255))
├── details (jsonb)
├── status (varchar(20), DEFAULT 'success')
├── source_ip (inet)
└── timestamp (timestamptz, DEFAULT NOW())

Indexes:
├── idx_audit_log_user_id (user_id)
├── idx_audit_log_action (action)
├── idx_audit_log_resource (resource_type, resource_id)
├── idx_audit_log_status (status)
└── idx_audit_log_timestamp (timestamp)
```

---

## How It Works: Order Update Example

### Step-by-Step Flow

When a sales representative updates an order through `PUT /api/v1/orders/12345`:

#### 1. **Request Interception** (Before Controller)
The `orderAuditMiddleware` intercepts the request:

```javascript
// Server/Middleware/auditMiddleware.js
const orderAuditMiddleware = createAuditMiddleware({
    logMethods: ['PUT', 'PATCH'],
    extractAction: (req) => 'order_update',
    extractResourceData: async (req) => {
        const orderId = req.params.orderId;
        
        // Fetch CURRENT state from database
        const result = await pool.query(
            'SELECT * FROM "ORDERS-orders" WHERE order_id = $1',
            [orderId]
        );
        
        return result.rows[0]; // This is the "beforeData"
    }
});
```

**What happens:**
- Extracts user ID from session token
- Fetches complete current order state from database
- Stores it as `beforeData`
- Passes control to the controller

#### 2. **Business Logic Execution** (Controller)
The controller processes the update:

```javascript
// Server/Controllers/orderController.js
async updateOrder(req, res) {
    const { orderId } = req.params;
    const updates = req.body; // { quantity: 15, notes: "Client requested more." }
    
    // Update the order in database
    const result = await pool.query(
        'UPDATE "ORDERS-orders" SET quantity = $1, notes = $2 WHERE order_id = $3 RETURNING *',
        [updates.quantity, updates.notes, orderId]
    );
    
    // Return updated order
    res.json({
        success: true,
        data: result.rows[0] // This becomes "afterData"
    });
}
```

**What happens:**
- Updates the order in database
- Returns the updated order in response
- The middleware captures this response

#### 3. **Response Capture & Comparison** (After Controller)
The middleware re-engages after the response:

```javascript
// Middleware captures the response
res.on('finish', async () => {
    const afterData = JSON.parse(responseBody); // Parse response
    
    // Calculate field-by-field changes
    const changes = calculateChanges(beforeData, afterData);
    
    // Log to audit trail
    await auditLogger.logApiRequest(req, res, 'order_update', beforeData, afterData, 'success');
});
```

#### 4. **Audit Log Entry Created**

The final audit log entry:

```json
{
  "id": 15234,
  "user_id": 42,
  "action": "order_update",
  "resource_type": "Order",
  "resource_id": "12345",
  "details": {
    "method": "PUT",
    "path": "/api/v1/orders/12345",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
    "beforeData": {
      "order_id": 12345,
      "customer_id": 567,
      "quantity": 10,
      "notes": "",
      "status": "pending",
      "total_amount": 100.00,
      "created_at": "2025-10-20T10:00:00Z",
      "updated_at": "2025-10-20T10:00:00Z"
    },
    "afterData": {
      "order_id": 12345,
      "customer_id": 567,
      "quantity": 15,
      "notes": "Client requested more.",
      "status": "pending",
      "total_amount": 150.00,
      "created_at": "2025-10-20T10:00:00Z",
      "updated_at": "2025-10-21T14:30:00Z"
    },
    "changes": [
      {
        "field": "quantity",
        "oldValue": 10,
        "newValue": 15
      },
      {
        "field": "notes",
        "oldValue": "",
        "newValue": "Client requested more."
      },
      {
        "field": "total_amount",
        "oldValue": 100.00,
        "newValue": 150.00
      },
      {
        "field": "updated_at",
        "oldValue": "2025-10-20T10:00:00Z",
        "newValue": "2025-10-21T14:30:00Z"
      }
    ]
  },
  "status": "success",
  "source_ip": "192.168.1.100",
  "timestamp": "2025-10-21T14:30:00.325Z"
}
```

---

## Usage Examples

### 1. Apply to Order Routes

```javascript
// Server/Routes/order-routes.js
const { orderAuditMiddleware } = require('../Middleware/auditMiddleware');

// Order update with full field-level tracking
router.put('/orders/:orderId', orderAuditMiddleware, orderController.updateOrder);
router.patch('/orders/:orderId', orderAuditMiddleware, orderController.updateOrder);
```

### 2. Apply to Batch Status Changes

```javascript
// Server/Routes/batch-routes.js
const { batchAuditMiddleware } = require('../Middleware/auditMiddleware');

// Track batch promotions and status changes
router.put('/batches/:batchId/promote', batchAuditMiddleware, batchController.promoteBatch);
router.put('/batches/:batchId/hold', batchAuditMiddleware, batchController.holdBatch);
router.patch('/batches/:batchId', batchAuditMiddleware, batchController.updateBatch);
```

### 3. Manual Logging (For Custom Logic)

```javascript
const auditLogger = require('../Services/auditLogger');

// In your controller
async customBusinessLogic(req, res) {
    try {
        // Your business logic here
        const result = await performComplexOperation();
        
        // Manually log the action
        await auditLogger.logUserAction(
            req.session.userId,
            'custom_operation_completed',
            'CustomResource',
            result.id,
            {
                operation: 'complex_calculation',
                input: inputData,
                output: result,
                duration: performanceDuration
            },
            'success',
            req.ip
        );
        
        res.json({ success: true, data: result });
    } catch (error) {
        // Log failure
        await auditLogger.logUserAction(
            req.session.userId,
            'custom_operation_failed',
            'CustomResource',
            null,
            { error: error.message },
            'failure',
            req.ip
        );
        
        res.status(500).json({ success: false, error: error.message });
    }
}
```

### 4. System Actions (Automated Processes)

```javascript
const auditLogger = require('../Services/auditLogger');

// In your batch sync service
async syncBatches() {
    await auditLogger.logSystemAction(
        'batch_sync_started',
        'BatchSync',
        null,
        { batchCount: 364 },
        'success'
    );
    
    // Perform sync...
    
    await auditLogger.logSystemAction(
        'batch_sync_completed',
        'BatchSync',
        null,
        {
            batchCount: 364,
            newBatches: 10,
            updatedBatches: 5,
            duration: 316050
        },
        'success'
    );
}
```

---

## Querying Audit Logs

### API Endpoints

#### Get Audit Logs with Filters
```http
GET /api/v1/admin/audit-logs?page=1&limit=50&userId=42&action=order_update&status=success
```

#### Get Audit Statistics
```http
GET /api/v1/admin/audit-logs/stats
```

#### Get Single Audit Log
```http
GET /api/v1/admin/audit-logs/:id
```

#### Get Filter Options
```http
GET /api/v1/admin/audit-logs/filters
```

### Direct Database Queries

```sql
-- Get all order updates by a specific user
SELECT * FROM "ORDERS-audit_log"
WHERE user_id = 42
  AND action = 'order_update'
  AND timestamp >= NOW() - INTERVAL '7 days'
ORDER BY timestamp DESC;

-- Get all failed actions
SELECT * FROM "ORDERS-audit_log"
WHERE status = 'failure'
ORDER BY timestamp DESC;

-- Get changes to a specific order
SELECT * FROM "ORDERS-audit_log"
WHERE resource_type = 'Order'
  AND resource_id = '12345'
ORDER BY timestamp ASC;

-- Extract field changes from JSONB
SELECT 
    id,
    user_id,
    action,
    timestamp,
    jsonb_array_elements(details->'changes') as change
FROM "ORDERS-audit_log"
WHERE resource_id = '12345'
  AND details->'changes' IS NOT NULL;
```

---

## Available Middleware Types

### 1. `auditMiddleware` (Standard)
- Logs POST, PUT, DELETE, PATCH requests
- Excludes health checks and auth endpoints
- Automatic action detection from URL path

```javascript
router.post('/resource', auditMiddleware, controller.create);
```

### 2. `orderAuditMiddleware` (Order-Specific)
- Captures full order state before changes
- Logs field-by-field comparisons
- Ideal for PUT/PATCH operations

```javascript
router.put('/orders/:orderId', orderAuditMiddleware, controller.updateOrder);
```

### 3. `batchAuditMiddleware` (Batch-Specific)
- Tracks batch status changes (On Hold → Sellable, etc.)
- Captures inventory changes
- Logs promotion triggers

```javascript
router.put('/batches/:batchId/promote', batchAuditMiddleware, controller.promoteBatch);
```

### 4. `userAuditMiddleware` (User Management)
- Tracks user approvals, role assignments
- Captures permission changes
- Logs account status changes

```javascript
router.put('/users/:id/approve', userAuditMiddleware, controller.approveUser);
```

### 5. `syncAuditMiddleware` (Sync Operations)
- Logs METRC sync operations
- Tracks data synchronization events
- Captures sync results

```javascript
router.post('/sync/:serviceName', syncAuditMiddleware, controller.triggerSync);
```

### 6. Custom Middleware
Create your own for specific resources:

```javascript
const customAuditMiddleware = createAuditMiddleware({
    logMethods: ['PUT', 'DELETE'],
    extractAction: (req) => {
        if (req.path.includes('/approve')) return 'resource_approve';
        return 'resource_update';
    },
    extractResourceData: async (req) => {
        // Fetch current state from your table
        const id = req.params.id;
        const result = await pool.query('SELECT * FROM your_table WHERE id = $1', [id]);
        return result.rows[0];
    }
});
```

---

## Best Practices

### 1. Always Log State-Changing Operations
```javascript
// ✅ Good: Log updates, deletes, approvals
router.put('/resource/:id', auditMiddleware, controller.update);
router.delete('/resource/:id', auditMiddleware, controller.delete);

// ❌ Bad: Don't log read operations
router.get('/resource/:id', controller.get); // No audit middleware
```

### 2. Use Specific Middleware for Important Resources
```javascript
// ✅ Good: Use specialized middleware
router.put('/orders/:orderId', orderAuditMiddleware, controller.updateOrder);

// ❌ Bad: Generic middleware for critical operations
router.put('/orders/:orderId', auditMiddleware, controller.updateOrder);
```

### 3. Include Contextual Information
```javascript
// ✅ Good: Rich details
await auditLogger.logUserAction(userId, 'batch_promoted', 'Batch', batchId, {
    oldStatus: 'On Deck',
    newStatus: 'Sellable',
    reason: 'Sellable inventory depleted',
    triggeredBy: 'auto_promotion',
    affectedQuantity: 150
});

// ❌ Bad: Minimal details
await auditLogger.logUserAction(userId, 'batch_updated', 'Batch', batchId);
```

### 4. Handle Errors Gracefully
```javascript
try {
    // Business logic
    await updateResource();
    await auditLogger.logUserAction(userId, 'update_success', 'Resource', id, details, 'success');
} catch (error) {
    // Log failure too!
    await auditLogger.logUserAction(userId, 'update_failed', 'Resource', id, 
        { error: error.message, stack: error.stack }, 'failure');
    throw error;
}
```

---

## Testing the Audit System

### Test Script

```javascript
// test-audit-system.js
const axios = require('axios');

async function testAuditSystem() {
    // Login to get session
    const loginResponse = await axios.post('http://localhost:3000/api/auth/login', {
        username: 'testuser',
        password: 'password123'
    });
    
    const cookies = loginResponse.headers['set-cookie'];
    
    // Update an order (should trigger audit log)
    const updateResponse = await axios.put(
        'http://localhost:3000/api/v1/orders/12345',
        {
            quantity: 15,
            notes: 'Client requested more items'
        },
        {
            headers: { Cookie: cookies }
        }
    );
    
    console.log('Order updated:', updateResponse.data);
    
    // View audit logs
    const auditResponse = await axios.get(
        'http://localhost:3000/api/v1/admin/audit-logs?resourceId=12345',
        {
            headers: { Cookie: cookies }
        }
    );
    
    console.log('Audit logs:', JSON.stringify(auditResponse.data, null, 2));
}

testAuditSystem().catch(console.error);
```

### Expected Output

```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": 15234,
        "userId": 42,
        "username": "testuser",
        "action": "order_update",
        "resourceType": "Order",
        "resourceId": "12345",
        "details": {
          "changes": [
            {
              "field": "quantity",
              "oldValue": 10,
              "newValue": 15
            },
            {
              "field": "notes",
              "oldValue": "",
              "newValue": "Client requested more items"
            }
          ]
        },
        "status": "success",
        "sourceIp": "127.0.0.1",
        "timestamp": "2025-10-21T14:30:00.325Z"
      }
    ]
  }
}
```

---

## Security Considerations

1. **Immutable Logs**: Audit logs should NEVER be updated or deleted through the application
2. **Access Control**: Only administrators should view audit logs
3. **Data Retention**: Implement log archival/rotation policies
4. **PII Protection**: Be careful what sensitive data you log
5. **Network Security**: Source IP tracking helps identify suspicious activity

---

## Performance Optimization

1. **Indexes**: All critical fields have indexes (user_id, timestamp, resource_type)
2. **Async Logging**: Audit logging happens in background (doesn't block responses)
3. **Connection Pooling**: Uses connection pools for efficiency
4. **Selective Logging**: Only logs state-changing operations
5. **JSONB Indexing**: PostgreSQL's JSONB type allows efficient querying of details

---

## Troubleshooting

### Issue: Audit logs not being created

**Check:**
1. Is the middleware applied to the route?
2. Is the user authenticated? (`req.session.userId` must exist)
3. Check console for audit logger errors
4. Verify database connection

### Issue: Changes array is empty

**Check:**
1. Is `extractResourceData` returning the correct before state?
2. Is the controller returning the complete updated object in response?
3. Are field names matching between before/after data?

### Issue: Performance degradation

**Solutions:**
1. Add more indexes to audit_log table
2. Implement log archival (move old logs to separate table)
3. Consider async queue for very high-traffic endpoints
4. Use database partitioning for very large audit tables

---

## Summary

The audit logging system provides:

✅ **Automatic field-level change tracking**  
✅ **Before/after state comparison**  
✅ **User attribution with IP tracking**  
✅ **Flexible querying and reporting**  
✅ **Easy integration via middleware**  
✅ **High performance with minimal overhead**  

It's perfect for compliance, debugging, security monitoring, and understanding exactly who changed what, when, and how.

