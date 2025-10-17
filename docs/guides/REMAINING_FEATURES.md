# 🚧 Remaining Features Implementation Checklist

## 📋 Executive Summary

This document outlines **ALL remaining features** that need to be implemented to complete Module 2: Core Infrastructure & METRC Integration, as per client requirements.

**Current Status**: ~15% Complete  
**Remaining Work**: ~85% of Module 2

---

## ✅ Currently Implemented (What We Have)

### 1. Basic Infrastructure
- ✅ Express.js server with EJS templating
- ✅ PostgreSQL database connection
- ✅ Basic CRM module (buyers, contacts, locations, notes, tags, sales reps)
- ✅ Static file serving
- ✅ Error handling middleware
- ✅ Request logging

### 2. METRC Sync (Partial)
- ✅ `sync-active-packages.js` - Active packages sync script
- ✅ JWT authentication with T3 API
- ✅ Token refresh logic
- ✅ Retry mechanisms with extended timeouts
- ✅ Transaction-based database operations
- ✅ Full mirror sync strategy

---

## ❌ NOT IMPLEMENTED - Remaining Work

---

## 🎯 MODULE 2: CORE INFRASTRUCTURE & METRC INTEGRATION

### 📦 PHASE 1: METRC Data Synchronization (60% Remaining)

#### 1.1 Additional Sync Services (5 New Scripts Needed)

**Priority: CRITICAL**

| Sync Service | Status | Endpoint | Strategy | Frequency | Effort |
|--------------|--------|----------|----------|-----------|--------|
| Active Packages | ✅ DONE | GET /v2/packages/active | Full Mirror | 10 min | - |
| **Transferred Packages** | ❌ TODO | GET /v2/packages/transferred | Incremental | 10 min | Medium |
| **In-Transit Packages** | ❌ TODO | GET /v2/packages/intransit | Full Mirror | 5 min | Medium |
| **Outgoing Transfers** | ❌ TODO | GET /v2/transfers/outgoing/active | Incremental | 5 min | High |
| **Items** | ❌ TODO | GET /v2/items | Incremental | 60 min | Medium |
| **Strains** | ❌ TODO | GET /v2/strains | Incremental | 60 min | Low |

**Implementation Tasks:**
- [ ] Create `sync-transferred-packages.js`
- [ ] Create `sync-intransit-packages.js`
- [ ] Create `sync-outgoing-transfers.js`
- [ ] Create `sync-items.js`
- [ ] Create `sync-strains.js`
- [ ] Implement incremental (delta) sync logic for applicable services
- [ ] Test each sync service independently
- [ ] Verify database schema for each table

**Files to Create:**
```
Sync/
├── sync-active-packages.js (✅ existing)
├── sync-transferred-packages.js (❌ new)
├── sync-intransit-packages.js (❌ new)
├── sync-outgoing-transfers.js (❌ new)
├── sync-items.js (❌ new)
└── sync-strains.js (❌ new)
```

---

#### 1.2 Master Scheduler System

**Priority: CRITICAL**

**Tasks:**
- [ ] Install and configure `node-cron` package
- [ ] Create `scheduler.js` - Master scheduler service
- [ ] Implement business hours detection (8 AM - 6 PM weekdays)
- [ ] Configure cron jobs for each sync service:
  - [ ] Active Packages: Every 10 minutes
  - [ ] Transferred Packages: Every 10 minutes
  - [ ] In-Transit Packages: Every 5 minutes
  - [ ] Outgoing Transfers: Every 5 minutes
  - [ ] Items: Every 60 minutes
  - [ ] Strains: Every 60 minutes
- [ ] Implement "last successful sync" timestamp tracking
- [ ] Add health monitoring for sync services
- [ ] Create sync status dashboard endpoint

**Files to Create:**
```
Server/
└── Services/
    └── scheduler.js (❌ new)
```

---

#### 1.3 On-Demand Sync API Endpoint

**Priority: HIGH**

**Endpoint:** `POST /api/v1/admin/sync/:serviceName`

**Tasks:**
- [ ] Create sync controller: `Server/Controllers/syncController.js`
- [ ] Add route to admin routes
- [ ] Implement service name validation
- [ ] Add authentication middleware (admin only)
- [ ] Implement manual trigger logic
- [ ] Return sync status and results
- [ ] Add rate limiting to prevent abuse

**Features:**
- Trigger any sync service on-demand
- Return real-time sync progress
- Support for immediate data refresh outside scheduled window

**Files to Create:**
```
Server/
├── Controllers/
│   └── syncController.js (❌ new)
└── Routes/
    └── sync-routes.js (❌ new)
```

---

#### 1.4 Shared Authentication Module

**Priority: HIGH**

**Tasks:**
- [ ] Create `Server/Services/metrcAuth.js` - Centralized auth service
- [ ] Extract JWT logic from sync scripts
- [ ] Implement token caching (file-based or Redis)
- [ ] Implement token sharing across sync processes
- [ ] Add token validity checking
- [ ] Implement automatic refresh before expiration
- [ ] Add fallback to credential re-authentication
- [ ] Add retry logic for auth failures

**Files to Create:**
```
Server/
└── Services/
    └── metrcAuth.js (❌ new)
```

---

### 🔐 PHASE 2: User Roles & Permissions (RBAC) - 100% TODO

**Priority: CRITICAL**

This is a **COMPLETE NEW SYSTEM** with no existing implementation.

---

#### 2.1 Database Schema for RBAC

**Tasks:**
- [ ] Create `roles` table
- [ ] Create `users` table with user_status enum
- [ ] Create `user_roles` junction table
- [ ] Create `permissions` table
- [ ] Create `role_permissions` junction table
- [ ] Create `user_sessions` table (for session management)
- [ ] Insert default roles:
  - [ ] Sales Representative
  - [ ] Sales Admin
  - [ ] Fulfillment Team
  - [ ] Inventory Manager
  - [ ] Accounting/Finance
  - [ ] Administrator
- [ ] Insert default permissions for each role
- [ ] Create indexes for performance

**SQL Script to Create:**
```
Queries/
└── create-rbac-schema.sql (❌ new)
```

---

#### 2.2 User Authentication System

**Priority: CRITICAL**

**Tasks:**
- [ ] Install `bcrypt` for password hashing
- [ ] Install `express-session` for session management
- [ ] Create `Server/Middleware/auth.js` - Authentication middleware
- [ ] Create `Server/Controllers/authController.js`
- [ ] Implement login endpoint: `POST /api/v1/auth/login`
- [ ] Implement logout endpoint: `POST /api/v1/auth/logout`
- [ ] Implement password hashing on registration
- [ ] Implement password verification on login
- [ ] Add session management
- [ ] Add "remember me" functionality
- [ ] Implement password reset flow (optional)

**Files to Create:**
```
Server/
├── Controllers/
│   └── authController.js (❌ new)
├── Middleware/
│   ├── auth.js (❌ new)
│   └── requireAuth.js (❌ new)
└── Models/
    └── userModel.js (❌ new)
```

---

#### 2.3 User Registration & Approval Workflow

**Priority: HIGH**

**Tasks:**
- [ ] Create public registration page: `Views/auth/register.ejs`
- [ ] Create registration endpoint: `POST /api/v1/auth/register`
- [ ] Implement pending status on registration
- [ ] Create admin approval interface: `Views/admin/users/pending.ejs`
- [ ] Create approval endpoint: `POST /api/v1/admin/users/:id/approve`
- [ ] Create rejection endpoint: `POST /api/v1/admin/users/:id/reject`
- [ ] Implement role assignment during approval
- [ ] Send email notifications (optional)
- [ ] Prevent login for pending users

**Files to Create:**
```
Views/
└── auth/
    ├── register.ejs (❌ new)
    ├── login.ejs (❌ new)
    └── pending.ejs (❌ new)

Server/
└── Controllers/
    └── userController.js (❌ new)
```

---

#### 2.4 Role-Based Access Control (RBAC)

**Priority: CRITICAL**

**Tasks:**
- [ ] Create `Server/Middleware/rbac.js` - Permission checking middleware
- [ ] Implement permission checking function
- [ ] Create middleware for each permission level
- [ ] Protect all routes with appropriate permissions
- [ ] Add role-based route guards
- [ ] Implement "can" helper function for views
- [ ] Add permission checking to API endpoints
- [ ] Create permission denied error handling

**Permission Matrix:**
```
Sales Representative:
  - order:create
  - order:read_own
  - order:update_draft
  - inventory:read
  - client:read_assigned

Sales Admin:
  - All Sales Rep +
  - invoice:approve_discount
  - invoice:issue_credit
  - client:assign

Fulfillment Team:
  - order:read_approved
  - fulfillment:accept_order
  - manifest:create
  - manifest:read

Inventory Manager:
  - product:link_metrc
  - batch:update_status

Accounting/Finance:
  - invoice:read_all
  - invoice:mark_paid
  - invoice:master_override

Administrator:
  - All Sales Admin +
  - user:read
  - user:approve
  - user:revoke
  - user:assign_roles
```

**Files to Create:**
```
Server/
└── Middleware/
    └── rbac.js (❌ new)
```

---

#### 2.5 Superuser Initialization Script

**Priority: HIGH**

**Tasks:**
- [ ] Create `Scripts/create-superuser.js`
- [ ] Implement one-time execution check
- [ ] Hash superuser password with bcrypt
- [ ] Create superuser with is_superuser=true
- [ ] Add protection against modification
- [ ] Document credential storage (secure vault)
- [ ] Add warning for production deployment

**Files to Create:**
```
Scripts/
└── create-superuser.js (❌ new)
```

---

#### 2.6 User Management Interface

**Priority: MEDIUM**

**Tasks:**
- [ ] Create user list page: `Views/admin/users/index.ejs`
- [ ] Create user detail page: `Views/admin/users/detail.ejs`
- [ ] Create user edit page: `Views/admin/users/edit.ejs`
- [ ] Implement user search and filtering
- [ ] Add role assignment interface
- [ ] Implement user revocation (soft delete)
- [ ] Add user activity log display
- [ ] Implement email/username uniqueness validation

**Files to Create:**
```
Views/
└── admin/
    └── users/
        ├── index.ejs (❌ new)
        ├── detail.ejs (❌ new)
        ├── edit.ejs (❌ new)
        └── pending.ejs (❌ new)
```

---

### 📝 PHASE 3: Audit Trail & Action History - 100% TODO

**Priority: CRITICAL**

This is a **COMPLETE NEW SYSTEM** with no existing implementation.

---

#### 3.1 Audit Log Database Schema

**Tasks:**
- [ ] Create `ORDERS-audit_log` table
- [ ] Add all required columns:
  - id (BIGSERIAL PRIMARY KEY)
  - user_id (INTEGER REFERENCES users)
  - action (VARCHAR(100))
  - resource_type (VARCHAR(50))
  - resource_id (VARCHAR(255))
  - details (JSONB)
  - status (VARCHAR(20))
  - source_ip (INET)
  - timestamp (TIMESTAMPTZ)
- [ ] Create indexes:
  - idx_audit_log_user_id
  - idx_audit_log_resource
  - idx_audit_log_timestamp
- [ ] Add constraints for data integrity

**SQL Script to Create:**
```
Queries/
└── create-audit-log-schema.sql (❌ new)
```

---

#### 3.2 AuditLogger Service

**Priority: CRITICAL**

**Tasks:**
- [ ] Create `Server/Services/auditLogger.js`
- [ ] Implement `logAction()` method
- [ ] Implement `logSystemAction()` method
- [ ] Add user context extraction
- [ ] Add IP address capture
- [ ] Implement before/after state capture
- [ ] Add error handling for logging failures
- [ ] Implement async logging (non-blocking)
- [ ] Add structured logging format

**Usage Examples:**
```javascript
// Manual business logic event
auditLogger.logAction({
  userId: 'SYSTEM',
  action: 'batch_status_update',
  resourceType: 'Batch',
  resourceId: batchId,
  details: {
    updated_batches: [101, 102, 103],
    new_status: 'Sellable'
  }
});

// API request event (via middleware)
auditLogger.logAction({
  userId: req.user.id,
  action: 'order_update',
  resourceType: 'Order',
  resourceId: orderId,
  details: {
    changes: [
      { field: 'quantity', old_value: 10, new_value: 15 }
    ]
  }
});
```

**Files to Create:**
```
Server/
└── Services/
    └── auditLogger.js (❌ new)
```

---

#### 3.3 API Middleware for Automatic Logging

**Priority: HIGH**

**Tasks:**
- [ ] Create `Server/Middleware/auditMiddleware.js`
- [ ] Intercept all state-changing requests (POST, PUT, DELETE)
- [ ] Extract user from session/token
- [ ] Capture request body and params
- [ ] Query database for "before" state
- [ ] Execute controller logic
- [ ] Query database for "after" state
- [ ] Calculate differences
- [ ] Log to audit trail
- [ ] Handle errors gracefully (don't break main flow)
- [ ] Add configuration for excluded routes

**Files to Create:**
```
Server/
└── Middleware/
    └── auditMiddleware.js (❌ new)
```

---

#### 3.4 Manual Logging for Business Logic

**Priority: MEDIUM**

**Tasks:**
- [ ] Identify all business logic events that need logging
- [ ] Add audit logging to batch promotion logic
- [ ] Add audit logging to order status changes
- [ ] Add audit logging to inventory updates
- [ ] Add audit logging to manifest creation
- [ ] Add audit logging to user role changes
- [ ] Document all logged events in code comments

**Examples:**
- Batch status updates (On Deck → Sellable)
- Order approval/rejection
- Invoice generation
- Manifest creation
- User role assignments
- Permission changes

---

#### 3.5 Audit Log Viewer Interface

**Priority: MEDIUM**

**Tasks:**
- [ ] Create audit log list page: `Views/admin/audit/index.ejs`
- [ ] Implement filtering by:
  - User
  - Action type
  - Resource type
  - Date range
  - Status (success/failure)
- [ ] Implement pagination
- [ ] Add export functionality (CSV/JSON)
- [ ] Create detailed view for individual log entries
- [ ] Add search functionality
- [ ] Implement real-time updates (optional)

**Files to Create:**
```
Views/
└── admin/
    └── audit/
        ├── index.ejs (❌ new)
        └── detail.ejs (❌ new)

Server/
└── Controllers/
    └── auditController.js (❌ new)
```

---

### 📦 PHASE 4: Manifest Creation Infrastructure - 100% TODO

**Priority: HIGH**

This is foundational work for Module 5 (Fulfillment UI).

---

#### 4.1 Manifest Creation Service

**Priority: HIGH**

**Tasks:**
- [ ] Create `Server/Services/manifestService.js`
- [ ] Implement `createManifestFromOrderAndPackages()` method
- [ ] Add order validation (status must be 'Approved for Fulfillment')
- [ ] Add package validation (cross-reference with order items)
- [ ] Construct METRC API payload
- [ ] Implement dry-run validation with T3 API
- [ ] Execute actual manifest creation
- [ ] Parse response to extract manifestNumber
- [ ] Update local order status to 'Manifested'
- [ ] Store manifest number in orders table
- [ ] Insert manifest into activeoutgoingtransfers table
- [ ] Call AuditLogger to log creation
- [ ] Handle errors and rollback on failure
- [ ] Add comprehensive error messages

**Files to Create:**
```
Server/
└── Services/
    └── manifestService.js (❌ new)
```

---

#### 4.2 Manifest API Endpoint

**Priority: HIGH**

**Endpoint:** `POST /api/v1/manifests`

**Tasks:**
- [ ] Create manifest controller: `Server/Controllers/manifestController.js`
- [ ] Add route to API routes
- [ ] Implement request body validation
- [ ] Add authentication middleware
- [ ] Add permission check (fulfillment team)
- [ ] Call manifestService.createManifestFromOrderAndPackages()
- [ ] Return manifest data to frontend
- [ ] Add error handling and appropriate status codes

**Request Body Structure:**
```json
{
  "orderId": 12345,
  "transporterLicenseNumber": "TRN-00001",
  "driverName": "John Doe",
  "vehicleModel": "Ford Transit",
  "estimatedDeparture": "2025-10-28T14:00:00Z",
  "estimatedArrival": "2025-10-28T18:00:00Z",
  "packages": [
    {
      "PackageLabel": "1A40E0100000067000001234",
      "Quantity": 10,
      "UnitOfMeasureName": "Grams",
      "WholesalePrice": 50.00
    }
  ]
}
```

**Files to Create:**
```
Server/
├── Controllers/
│   └── manifestController.js (❌ new)
└── Routes/
    └── manifest-routes.js (❌ new)
```

---

#### 4.3 Manifest Validation Logic

**Priority: MEDIUM**

**Tasks:**
- [ ] Validate order exists and is in correct status
- [ ] Validate all packages exist in activepackages table
- [ ] Validate package quantities match order requirements
- [ ] Validate package labels are correct format
- [ ] Validate transporter license format
- [ ] Validate dates (departure before arrival)
- [ ] Add comprehensive validation error messages
- [ ] Return validation errors before API call

---

#### 4.4 Database Schema Updates for Manifests

**Priority: MEDIUM**

**Tasks:**
- [ ] Add manifest-related columns to orders table:
  - `manifest_number` (VARCHAR)
  - `manifested_at` (TIMESTAMPTZ)
  - `manifested_by` (INTEGER REFERENCES users)
- [ ] Verify activeoutgoingtransfers table structure
- [ ] Add indexes for manifest lookups
- [ ] Add foreign key constraints

**SQL Script to Create:**
```
Queries/
└── add-manifest-columns.sql (❌ new)
```

---

### 🛠️ PHASE 5: Supporting Infrastructure

#### 5.1 Environment Configuration

**Tasks:**
- [ ] Document all required environment variables
- [ ] Add METRC credentials to .ENV
- [ ] Add session secret for auth
- [ ] Add database connection pooling settings
- [ ] Add Redis configuration (if using for sessions)
- [ ] Create .ENV.example template
- [ ] Document all configuration options

---

#### 5.2 Error Handling & Logging

**Tasks:**
- [ ] Enhance error handling middleware
- [ ] Add structured error logging
- [ ] Implement error notification system
- [ ] Add monitoring and alerting
- [ ] Create error tracking dashboard

---

#### 5.3 Testing Infrastructure

**Priority: MEDIUM**

**Tasks:**
- [ ] Set up Jest testing framework
- [ ] Write unit tests for sync services
- [ ] Write unit tests for RBAC system
- [ ] Write unit tests for audit logger
- [ ] Write integration tests for API endpoints
- [ ] Create test database setup
- [ ] Add CI/CD pipeline configuration

---

#### 5.4 Documentation

**Tasks:**
- [ ] Document all API endpoints
- [ ] Create deployment guide
- [ ] Document RBAC permission matrix
- [ ] Create troubleshooting guide
- [ ] Document sync service configuration
- [ ] Create user manual for admins

---

## 📊 Implementation Priority Matrix

### 🔴 CRITICAL (Must Have - Start Immediately)
1. ✅ **Active Packages Sync** - DONE
2. ❌ **Remaining 5 Sync Services** - 2-3 weeks
3. ❌ **RBAC System** - 2-3 weeks
4. ❌ **Audit Trail System** - 1-2 weeks
5. ❌ **Master Scheduler** - 1 week

### 🟠 HIGH (Important - Next Phase)
6. ❌ **Manifest Creation Service** - 1 week
7. ❌ **On-Demand Sync API** - 3-4 days
8. ❌ **Shared Auth Module** - 2-3 days
9. ❌ **User Registration/Approval** - 1 week

### 🟡 MEDIUM (Nice to Have - Later)
10. ❌ **Audit Log Viewer UI** - 1 week
11. ❌ **User Management Interface** - 1 week
12. ❌ **Testing Infrastructure** - 1-2 weeks

### 🟢 LOW (Polish - Final Phase)
13. ❌ **Documentation** - Ongoing
14. ❌ **Error Handling Enhancements** - Ongoing
15. ❌ **Performance Optimization** - Ongoing

---

## 📅 Estimated Timeline

### Phase 1: METRC Sync (3-4 weeks)
- Week 1: Remaining sync services
- Week 2: Master scheduler + on-demand API
- Week 3: Shared auth module + testing
- Week 4: Bug fixes and optimization

### Phase 2: RBAC (2-3 weeks)
- Week 1: Database schema + authentication
- Week 2: Registration/approval workflow
- Week 3: Permission system + testing

### Phase 3: Audit Trail (1-2 weeks)
- Week 1: Database + service + middleware
- Week 2: UI + testing

### Phase 4: Manifest Infrastructure (1 week)
- Week 1: Service + API + validation

### Phase 5: Polish (1-2 weeks)
- Testing, documentation, optimization

**Total Estimated Time: 8-12 weeks**

---

## 🎯 Success Criteria

### Module 2 Complete When:
- ✅ All 6 sync services running on schedule
- ✅ RBAC system fully functional
- ✅ All user actions logged to audit trail
- ✅ Manifest creation service operational
- ✅ All database schemas created
- ✅ All tests passing
- ✅ Documentation complete
- ✅ Zero critical bugs

---

## 📝 Notes

1. **License Number**: Hardcoded as `CUL000063` for initial development
2. **Business Hours**: Sync runs 8 AM - 6 PM weekdays only
3. **Token Caching**: Use file-based storage initially, upgrade to Redis later
4. **Superuser Credentials**: Must be stored in secure vault, not in code
5. **Audit Log**: Append-only, never deleted or modified
6. **Error Handling**: All errors must be logged but not break user flow
7. **Testing**: Write tests as you build, not after

---

## 🚀 Getting Started

### Immediate Next Steps:
1. Create database schema for RBAC
2. Implement remaining sync services (start with transferred packages)
3. Set up master scheduler
4. Build authentication system
5. Implement audit logging

### Recommended Order:
1. **Week 1-2**: Complete METRC sync services
2. **Week 3-4**: Implement RBAC system
3. **Week 5**: Build audit trail
4. **Week 6**: Manifest infrastructure
5. **Week 7-8**: Testing and polish

---

**Last Updated**: January 2025  
**Status**: Ready for Implementation  
**Owner**: Development Team

