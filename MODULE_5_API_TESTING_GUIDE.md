# Module 5: Fulfillment & Manifesting - Complete API Testing Guide

## 📋 Table of Contents
1. [Authentication Setup](#1-authentication-setup)
2. [Fulfillment Queue APIs](#2-fulfillment-queue-apis)
3. [Package Scanning APIs](#3-package-scanning-apis)
4. [Issue Reporting APIs](#4-issue-reporting-apis)
5. [Transportation & Manifest APIs](#5-transportation--manifest-apis)
6. [Cancelled Shipment APIs](#6-cancelled-shipment-apis)
7. [Admin Session Management APIs](#7-admin-session-management-apis)
8. [Admin Issue Management APIs](#8-admin-issue-management-apis)
9. [Status Tracking APIs](#9-status-tracking-apis)
10. [UI Testing Guide](#10-ui-testing-guide)

---

## 1. Authentication Setup

### 1.1 Get JWT Token for API Testing

**Endpoint:** `POST /api/v1/auth/token`

```bash
# Get JWT token
curl -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your_password"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Token generated successfully",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "username": "admin",
      "email": "admin@example.com",
      "isAdmin": true
    },
    "expiresIn": "24h"
  }
}
```

**Save token for subsequent requests:**
```bash
export JWT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 1.2 Session-Based Authentication (For Browser Testing)

1. Navigate to: `http://localhost:3000/auth/login`
2. Login with your credentials
3. Session cookie will be automatically set
4. All subsequent requests will use the session cookie

---

## 2. Fulfillment Queue APIs

### 2.1 Get Fulfillment Queue

**Endpoint:** `GET /api/v1/fulfillment/queue`

**With JWT Token:**
```bash
curl -X GET "http://localhost:3000/api/v1/fulfillment/queue?page=1&limit=25&status=Approved" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**With Filters:**
```bash
# Filter by status, location, customer, value range
curl -X GET "http://localhost:3000/api/v1/fulfillment/queue?status=Approved&status=Fulfillment_Accepted&location=Denver&customer=ABC&minTotal=100&maxTotal=5000&sortBy=age&sortOrder=asc&page=1&limit=25" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "queue": [
    {
      "id": 12345,
      "invoice_number": "INV-2025-00123",
      "buyer_name": "ABC Dispensary",
      "location_name": "Main Store",
      "city": "Denver",
      "state": "CO",
      "total": 1250.00,
      "line_item_count": 3,
      "total_packages_needed": 15,
      "approved_at": "2025-01-16T08:00:00Z",
      "status": "Approved",
      "assigned_worker": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 150,
    "totalPages": 6
  }
}
```

### 2.2 Claim Order

**Endpoint:** `POST /api/v1/fulfillment/queue/claim`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/queue/claim \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "invoice_number": "INV-2025-00123",
  "message": "Order claimed successfully"
}
```

**Error Response (if already claimed):**
```json
{
  "error": "Order already claimed by John Doe"
}
```

### 2.3 Release Order

**Endpoint:** `POST /api/v1/fulfillment/queue/release`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/queue/release \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Order released back to queue"
}
```

### 2.4 Admin Reassign Order

**Endpoint:** `POST /api/v1/fulfillment/admin/reassign`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/admin/reassign \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "from_user_id": 5,
    "to_user_id": 7
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Order reassigned successfully"
}
```

---

## 3. Package Scanning APIs

### 3.1 Start Scanning Session

**Endpoint:** `POST /api/v1/fulfillment/scanning/start`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/scanning/start \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "websocket_connection_id": "ws-connection-abc123"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "session_id": 567,
  "started_at": "2025-01-16T14:30:00Z"
}
```

**Error Response (if not assigned):**
```json
{
  "error": "You are not assigned to this order"
}
```

### 3.2 Scan Package

**Endpoint:** `POST /api/v1/fulfillment/scanning/scan`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/scanning/scan \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": 567,
    "package_label": "1A40E0100000067000001234",
    "invoice_id": 12345
  }'
```

**Success Response:**
```json
{
  "success": true,
  "line_item_id": 123,
  "package_label": "1A40E0100000067000001234",
  "scanned_count": 5,
  "required_count": 10,
  "line_item_complete": false
}
```

**Rejection Alert Response:**
```json
{
  "success": false,
  "requiresConfirmation": true,
  "alert": {
    "type": "REJECTION_WARNING",
    "severity": "HIGH",
    "message": "⚠️ REJECTION ALERT: This package was rejected 3 days ago",
    "details": {
      "manifestNumber": "M000123",
      "rejectionDate": "2025-01-13T10:00:00Z",
      "rejectedBy": "Jane Smith",
      "facility": "ABC Dispensary"
    }
  },
  "line_item_id": 123,
  "package_label": "1A40E0100000067000001234"
}
```

**Error Response (package conflict):**
```json
{
  "error": "Package currently being used by John Doe for Order INV-2025-00122",
  "code": "PACKAGE_CONFLICT"
}
```

### 3.3 Get Scanning Progress

**Endpoint:** `GET /api/v1/fulfillment/scanning/progress/:invoiceId`

```bash
curl -X GET http://localhost:3000/api/v1/fulfillment/scanning/progress/12345 \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "invoice_id": 12345,
  "line_items": [
    {
      "line_item_id": 123,
      "product_name": "Blue Dream",
      "batch_name": "BATCH-001",
      "quantity_ordered": 10,
      "scanned_count": 5,
      "remaining_count": 5,
      "status": "in_progress",
      "scanned_packages": [
        "1A40E0100000067000001234",
        "1A40E0100000067000001235",
        "1A40E0100000067000001236",
        "1A40E0100000067000001237",
        "1A40E0100000067000001238"
      ]
    }
  ],
  "overall_progress": {
    "total_packages_needed": 20,
    "total_packages_scanned": 12,
    "percentage": 60,
    "all_complete": false
  }
}
```

### 3.4 Verify Rejected Package

**Endpoint:** `POST /api/v1/fulfillment/scanning/verify-rejected`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/scanning/verify-rejected \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "package_label": "1A40E0100000067000001234",
    "notes": "Package verified as good, ready for sale"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Package verified and cleared for fulfillment"
}
```

### 3.5 Cancel Scanning Session

**Endpoint:** `POST /api/v1/fulfillment/scanning/cancel/:sessionId`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/scanning/cancel/567 \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Need to check inventory first"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Scanning cancelled. Order returned to queue."
}
```

---

## 4. Issue Reporting APIs

### 4.1 Report Fulfillment Issue

**Endpoint:** `POST /api/v1/fulfillment/issues/report`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/issues/report \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "issues": [
      {
        "type": "batch_unavailable",
        "line_item_id": 123,
        "batch_name": "BATCH-001",
        "description": "Cannot locate batch in warehouse - searched all locations"
      },
      {
        "type": "package_damaged",
        "line_item_id": 124,
        "batch_name": "BATCH-002",
        "description": "Package label torn, contents exposed"
      }
    ]
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Issues reported for invoice INV-2025-00123. Order returned to sales for resolution."
}
```

### 4.2 Sales Request Global Issue

**Endpoint:** `POST /api/v1/fulfillment/issues/request-global`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/issues/request-global \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "reason": "Need to add more items to order - customer requested additional products"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Return request sent to fulfillment worker for invoice INV-2025-00123"
}
```

### 4.3 Fulfillment Acknowledge Global Issue

**Endpoint:** `POST /api/v1/fulfillment/issues/acknowledge-global/:invoiceId`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/issues/acknowledge-global/12345 \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Global issue acknowledged. Order returned to sales."
}
```

### 4.4 Update Issue Details

**Endpoint:** `POST /api/v1/fulfillment/issues/update`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/issues/update \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "issue_type": "package_missing_from_metrc",
    "description": "Updated: Package was found but is archived in METRC"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Issue details updated successfully"
}
```

### 4.5 Add Note to Issue

**Endpoint:** `POST /api/v1/fulfillment/issues/add-note`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/issues/add-note \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "note": "Spoke with warehouse manager - batch will be available tomorrow morning"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Note added successfully"
}
```

### 4.6 Cancel Issue Report

**Endpoint:** `POST /api/v1/fulfillment/issues/cancel`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/issues/cancel \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "reason": "Issue resolved - batch was found in different location"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Issue cancelled. Order returned to Fulfillment_Accepted status."
}
```

---

## 5. Transportation & Manifest APIs

### 5.1 Get Available Transporters

**Endpoint:** `GET /api/v1/fulfillment/transporters`

```bash
curl -X GET http://localhost:3000/api/v1/fulfillment/transporters \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "transporters": [
    {
      "id": 12345,
      "name": "ABC Transport Co",
      "licenseNumber": "TRANS000123"
    },
    {
      "id": 12346,
      "name": "XYZ Logistics",
      "licenseNumber": "TRANS000456"
    }
  ]
}
```

### 5.2 Enter Transportation Details

**Endpoint:** `POST /api/v1/fulfillment/transportation`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/transportation \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "driverName": "John Doe",
    "driverLicense": "D1234567",
    "driverOccupationalLicense": "OCC12345",
    "vehicleMake": "Ford",
    "vehicleModel": "Transit",
    "vehiclePlate": "ABC123",
    "estimatedDeparture": "2025-01-16T08:00:00Z",
    "estimatedArrival": "2025-01-16T14:00:00Z",
    "transporterName": "ABC Transport Co",
    "phoneNumber": "555-0123"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Transportation details saved. Ready to create manifest.",
  "recipientId": 67890,
  "transporterId": 12345
}
```

**Error Response (if scanning incomplete):**
```json
{
  "error": "Cannot proceed - package scanning not complete. Scanned: 15/20 (5 package(s) still need to be scanned)."
}
```

### 5.3 Get Manifest Preview

**Endpoint:** `GET /api/v1/fulfillment/manifest/preview/:invoiceId`

```bash
curl -X GET http://localhost:3000/api/v1/fulfillment/manifest/preview/12345 \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "invoice_number": "INV-2025-00123",
  "requires_multiple_manifests": true,
  "manifests_required": 2,
  "manifests": [
    {
      "license": "CUL000063",
      "package_count": 10,
      "total_weight_grams": 35.0,
      "total_value": 350.00
    },
    {
      "license": "MAN000072",
      "package_count": 5,
      "total_weight_grams": 150.0,
      "total_value": 250.00
    }
  ],
  "destination": {
    "license": "DISP000123",
    "route": "Delivery to DISP000123"
  },
  "transportation": {
    "driver": "John Doe",
    "vehicle": "Ford Transit",
    "plate": "ABC123",
    "departure": "2025-01-16T08:00:00Z",
    "arrival": "2025-01-16T14:00:00Z"
  },
  "warning": "This order contains packages from multiple licenses and will require multiple METRC manifests."
}
```

### 5.4 Create Manifest

**Endpoint:** `POST /api/v1/fulfillment/manifest/create`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/manifest/create \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345
  }'
```

**Expected Response (Single License):**
```json
{
  "success": true,
  "manifests": [
    {
      "license": "CUL000063",
      "manifest_number": "M000123",
      "metrc_id": 12345,
      "package_count": 10
    }
  ],
  "invoice_number": "INV-2025-00123",
  "total_manifests": 1
}
```

**Expected Response (Multi-License):**
```json
{
  "success": true,
  "manifests": [
    {
      "license": "CUL000063",
      "manifest_number": "M000123",
      "metrc_id": 12345,
      "package_count": 10
    },
    {
      "license": "MAN000072",
      "manifest_number": "M000124",
      "metrc_id": 12346,
      "package_count": 5
    }
  ],
  "invoice_number": "INV-2025-00123",
  "total_manifests": 2
}
```

**Error Response (Partial Failure):**
```json
{
  "error": "Partial manifest creation - manual intervention required",
  "created": [
    {
      "license": "CUL000063",
      "manifest_number": "M000123"
    }
  ],
  "failed": [
    {
      "license": "MAN000072",
      "error": "METRC API timeout"
    }
  ]
}
```

### 5.5 Void Manifest

**Endpoint:** `POST /api/v1/fulfillment/manifest/void`

**Void All Manifests:**
```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/manifest/void \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "reason": "Customer requested cancellation - order needs to be modified before shipping",
    "target_manifest_or_license": null
  }'
```

**Void Specific Manifest:**
```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/manifest/void \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "reason": "Incorrect information on manifest M000123",
    "target_manifest_or_license": "M000123"
  }'
```

**Expected Response (All Voided):**
```json
{
  "success": true,
  "voided_count": 2,
  "voided_manifests": ["M000123", "M000124"],
  "remaining_manifests": [],
  "failed_manifests": [],
  "all_voided": true,
  "message": "All 2 manifest(s) voided. Order returned to Fulfillment Issue state."
}
```

**Expected Response (Partial Void):**
```json
{
  "success": true,
  "voided_count": 1,
  "voided_manifests": ["M000123"],
  "remaining_manifests": ["M000124"],
  "failed_manifests": [],
  "all_voided": false,
  "message": "Partial void: 1 manifest(s) voided, 1 remaining."
}
```

**Error Response (Dry Run Failed):**
```json
{
  "error": "Cannot void manifest - already delivered"
}
```

### 5.6 Update Manifest

**Endpoint:** `PATCH /api/v1/fulfillment/manifest/update`

```bash
curl -X PATCH http://localhost:3000/api/v1/fulfillment/manifest/update \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "driverName": "Jane Smith",
    "vehicleMake": "Chevrolet",
    "vehicleModel": "Express",
    "estimatedDeparture": "2025-01-16T09:00:00Z",
    "estimatedArrival": "2025-01-16T15:00:00Z"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Manifest updated successfully"
}
```

---

## 6. Cancelled Shipment APIs

### 6.1 Process Cancellation

**Endpoint:** `POST /api/v1/fulfillment/cancelled-shipments/cancel`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/cancelled-shipments/cancel \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "cancellation_reason": "Customer requested cancellation after shipment - order no longer needed",
    "incident_type": "customer_cancel"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Order cancelled. Awaiting package return confirmation.",
  "packages_to_verify": 15,
  "invoice_number": "INV-2025-00123"
}
```

### 6.2 Confirm Packages Returned

**Endpoint:** `POST /api/v1/fulfillment/cancelled-shipments/confirm-return`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/cancelled-shipments/confirm-return \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "verified_count": 12,
  "not_found_count": 3,
  "all_verified": false,
  "message": "12 package(s) verified and returned to inventory. 3 package(s) not yet found in METRC."
}
```

### 6.3 Report Driver Incident

**Endpoint:** `POST /api/v1/fulfillment/cancelled-shipments/report-incident`

```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/cancelled-shipments/report-incident \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "incident_details": {
      "description": "Vehicle accident on highway - driver safe, packages may be damaged",
      "notes": "Accident occurred at mile marker 45 on I-70. Police report filed.",
      "estimated_damage": "Unknown - awaiting inspection"
    }
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Incident reported. Admin team will verify package status.",
  "requires_admin_verification": true
}
```

### 6.4 Finalize Destroyed Packages (Admin)

**Endpoint:** `POST /api/v1/admin/cancelled-shipments/:invoiceId/finalize-destroyed`

```bash
curl -X POST http://localhost:3000/api/v1/admin/cancelled-shipments/12345/finalize-destroyed \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "destroyed_packages": [
      {
        "package_label": "1A40E0100000067000001234",
        "destruction_reason": "Vehicle accident - total loss, packages destroyed in fire"
      },
      {
        "package_label": "1A40E0100000067000001235",
        "destruction_reason": "Vehicle accident - total loss, packages destroyed in fire"
      }
    ]
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "packages_finalized": 2,
  "total_quantity_destroyed": 2,
  "all_packages_accounted_for": true,
  "invoice_finalized": true,
  "inventory_was_already_finalized": false
}
```

### 6.5 Get Unaccounted Packages (Admin)

**Endpoint:** `GET /api/v1/admin/cancelled-shipments/:invoiceId/unaccounted-packages`

```bash
curl -X GET http://localhost:3000/api/v1/admin/cancelled-shipments/12345/unaccounted-packages \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "invoice_id": 12345,
  "invoice_number": "INV-2025-00123",
  "status": "Cancelled_After_Ship",
  "total": 15,
  "returned": 12,
  "destroyed": 1,
  "unaccounted": 2,
  "packages": [
    {
      "package_label": "1A40E0100000067000001234",
      "batch_id": 789,
      "was_on_manifest": true,
      "returned_to_inventory": false,
      "verified_in_metrc": false,
      "admin_notes": null,
      "allocation_released": false
    },
    {
      "package_label": "1A40E0100000067000001235",
      "batch_id": 789,
      "was_on_manifest": true,
      "returned_to_inventory": false,
      "verified_in_metrc": false,
      "admin_notes": "Still investigating",
      "allocation_released": false
    }
  ]
}
```

---

## 7. Admin Session Management APIs

### 7.1 Get All Active Sessions

**Endpoint:** `GET /api/v1/admin/fulfillment/sessions`

```bash
# Get all active sessions
curl -X GET http://localhost:3000/api/v1/admin/fulfillment/sessions \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"

# Filter by worker
curl -X GET "http://localhost:3000/api/v1/admin/fulfillment/sessions?worker_id=5" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"

# Filter by duration (sessions longer than 30 minutes)
curl -X GET "http://localhost:3000/api/v1/admin/fulfillment/sessions?duration_min=30" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "sessions": [
    {
      "id": 567,
      "fk_invoice_id": 12345,
      "fk_user_id": 5,
      "session_status": "active",
      "currently_locked_packages": [
        "1A40E0100000067000001234",
        "1A40E0100000067000001235"
      ],
      "last_activity": "2025-01-16T14:45:00Z",
      "started_at": "2025-01-16T14:30:00Z",
      "invoice_number": "INV-2025-00123",
      "invoice_status": "Fulfillment_Accepted",
      "worker_name": "John Doe",
      "duration_minutes": 15.5,
      "inactivity_minutes": 0.5,
      "progress": {
        "total_packages_needed": 20,
        "total_packages_scanned": 12,
        "percentage": 60
      }
    }
  ],
  "total": 1
}
```

### 7.2 Force Complete Session

**Endpoint:** `POST /api/v1/admin/fulfillment/sessions/:sessionId/force-complete`

```bash
curl -X POST http://localhost:3000/api/v1/admin/fulfillment/sessions/567/force-complete \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Worker unavailable - session abandoned for over 2 hours"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Session force-completed. 12 package(s) released.",
  "invoice_number": "INV-2025-00123"
}
```

### 7.3 Remove Scanned Package

**Endpoint:** `POST /api/v1/admin/fulfillment/sessions/remove-package`

```bash
curl -X POST http://localhost:3000/api/v1/admin/fulfillment/sessions/remove-package \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "line_item_id": 123,
    "package_label": "1A40E0100000067000001234"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Package removed successfully",
  "remaining_count": 4
}
```

### 7.4 Edit Scanned Package Label

**Endpoint:** `POST /api/v1/admin/fulfillment/sessions/edit-package`

```bash
curl -X POST http://localhost:3000/api/v1/admin/fulfillment/sessions/edit-package \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "line_item_id": 123,
    "old_package_label": "1A40E0100000067000001234",
    "new_package_label": "1A40E0100000067000001239"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Package label updated successfully",
  "old_label": "1A40E0100000067000001234",
  "new_label": "1A40E0100000067000001239"
}
```

### 7.5 Manually Adjust Session Data

**Endpoint:** `POST /api/v1/admin/fulfillment/sessions/:sessionId/adjust`

```bash
curl -X POST http://localhost:3000/api/v1/admin/fulfillment/sessions/567/adjust \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "adjustments": {
      "currently_locked_packages": [
        "1A40E0100000067000001234",
        "1A40E0100000067000001235",
        "1A40E0100000067000001236"
      ]
    },
    "reason": "Manual correction - removed duplicate package entry"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Session data adjusted successfully"
}
```

---

## 8. Admin Issue Management APIs

### 8.1 Get All Issues

**Endpoint:** `GET /api/v1/admin/fulfillment/issues`

```bash
# Get all issues
curl -X GET http://localhost:3000/api/v1/admin/fulfillment/issues \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"

# Filter by date range
curl -X GET "http://localhost:3000/api/v1/admin/fulfillment/issues?date_from=2025-01-01&date_to=2025-01-31" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"

# Filter by sales rep
curl -X GET "http://localhost:3000/api/v1/admin/fulfillment/issues?sales_rep_id=3" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"

# Filter by issue type
curl -X GET "http://localhost:3000/api/v1/admin/fulfillment/issues?issue_type=batch_unavailable" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "issues": [
    {
      "id": 12345,
      "invoice_number": "INV-2025-00123",
      "status": "Fulfillment_Issue",
      "fulfillment_issue_reported_at": "2025-01-16T10:00:00Z",
      "fulfillment_issue_note": "[batch_unavailable] Line Item 123 Batch: BATCH-001 - Cannot locate batch in warehouse",
      "assigned_sales_rep_id": 3,
      "buyer_name": "ABC Dispensary",
      "sales_rep_name": "Jane Smith"
    }
  ],
  "total": 1
}
```

### 8.2 Bulk Assign Issues

**Endpoint:** `POST /api/v1/admin/fulfillment/issues/bulk-assign`

```bash
curl -X POST http://localhost:3000/api/v1/admin/fulfillment/issues/bulk-assign \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_ids": [12345, 12346, 12347],
    "sales_rep_id": 3
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "updated_count": 3,
  "invoices": [
    {
      "id": 12345,
      "invoice_number": "INV-2025-00123"
    },
    {
      "id": 12346,
      "invoice_number": "INV-2025-00124"
    },
    {
      "id": 12347,
      "invoice_number": "INV-2025-00125"
    }
  ]
}
```

---

## 9. Status Tracking APIs

### 9.1 Sync Manifest Statuses (Manual Trigger)

**Endpoint:** `POST /api/v1/admin/fulfillment/sync-statuses`

```bash
curl -X POST http://localhost:3000/api/v1/admin/fulfillment/sync-statuses \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "synced": 25,
  "errors": 0
}
```

**Note:** This endpoint is also called automatically by a scheduled job every 15 minutes.

---

## 10. UI Testing Guide

### 10.1 Access Fulfillment Queue UI

**URL:** `http://localhost:3000/admin/fulfillment/queue`

**Access Requirements:**
- User must be logged in
- User must have role: `fulfillment_worker`, `fulfillment_admin`, `sales_admin`, or `admin`
- Navigate via sidebar menu: **Fulfillment** → **Fulfillment Queue**

**UI Elements to Test:**

1. **Queue List**
   - Location: Main content area
   - Shows: Invoice number, customer name, location, total value, package count, status
   - Actions: "Claim Order" button (if status = Approved)

2. **Filters**
   - Status filter: Dropdown with options (Approved, Fulfillment_Accepted, Fulfillment_Issue)
   - Location filter: Text input for city/state
   - Customer filter: Text input for buyer name
   - Value range: Min/Max inputs
   - Sort options: Age, Value, Destination, Customer
   - Apply filters button

3. **Pagination**
   - Page navigation buttons
   - Page size selector (25, 50, 100)
   - Total count display

4. **Claim Order Button**
   - Click to claim an order
   - Button disappears after claiming
   - Order card updates to show "In Progress" status

5. **Start Scanning Button**
   - Appears after claiming order
   - Clicking navigates to: `/admin/fulfillment/scanning/:invoiceId`

### 10.2 Access Package Scanning UI

**URL:** `http://localhost:3000/admin/fulfillment/scanning/:invoiceId`

**Example:** `http://localhost:3000/admin/fulfillment/scanning/12345`

**UI Elements to Test:**

1. **Scanner Input Field**
   - Location: Top of page, large input field
   - Auto-focus on page load
   - Accepts barcode scanner input
   - Shows real-time validation feedback

2. **Line Item Progress Cards**
   - Shows: Product name, batch name, scanned count / required count
   - Progress bar visualization
   - List of scanned package labels (scrollable)
   - Status indicator (not_started, in_progress, complete)

3. **Overall Progress Display**
   - Large counter: "15 / 20 packages scanned"
   - Overall progress bar
   - Percentage display
   - "Complete Scanning" button (enabled only when all complete)

4. **Package List**
   - Shows all scanned packages per line item
   - Remove button (X) next to each package (if not yet manifested)
   - Edit button (pencil icon) to edit package label

5. **Cancel Session Button**
   - Location: Top right
   - Shows confirmation modal
   - Returns order to queue on confirm

6. **Real-Time Updates**
   - Websocket connection shows package locks from other workers
   - Visual indicators for locked packages
   - Auto-refresh progress every 5 seconds

### 10.3 Access Transportation Details UI

**URL:** `http://localhost:3000/admin/fulfillment/transportation/:invoiceId`

**UI Elements to Test:**

1. **Transportation Form**
   - Driver Name (required)
   - Driver License Number (required)
   - Driver Occupational License (optional)
   - Vehicle Make (required)
   - Vehicle Model (required)
   - Vehicle License Plate (required)
   - Estimated Departure Time (datetime picker, required)
   - Estimated Arrival Time (datetime picker, required)
   - Transporter Name (required, dropdown from METRC)
   - Phone Number (optional)

2. **Validation**
   - Arrival time must be after departure time
   - Departure time cannot be in past (with warning)
   - All required fields must be filled

3. **Actions**
   - "Save Transportation Details" button
   - "Clear Transport Details" button (before manifest created)
   - "Edit Transport Details" button (if details exist but not manifested)

### 10.4 Access Manifest Creation UI

**URL:** `http://localhost:3000/admin/fulfillment/manifest/:invoiceId`

**UI Elements to Test:**

1. **Manifest Preview**
   - Shows breakdown by license (if multi-license)
   - Package count per license
   - Total weight and value
   - Destination information
   - Transportation details summary

2. **Create Manifest Button**
   - Shows loading state during creation
   - Displays success message with manifest numbers
   - Shows error if creation fails

3. **Manifest Status Display**
   - Shows created manifest numbers
   - Status: Manifested, Shipped, Delivered
   - "Void Manifest" button (if status = Manifested or Shipped)

### 10.5 Access Admin Session Management UI

**URL:** `http://localhost:3000/admin/fulfillment/sessions` (if implemented)

**Or via API response in custom admin dashboard**

**UI Elements to Test (if implemented):**

1. **Active Sessions Table**
   - Columns: Invoice number, Worker name, Duration, Packages scanned/Total, Last activity
   - Filter by worker dropdown
   - Filter by duration dropdown
   - Sort options

2. **Session Actions**
   - "Force Complete" button (with reason modal)
   - "View Details" link
   - "Remove Package" action
   - "Edit Package" action
   - "Manually Adjust" button (opens JSON editor)

### 10.6 Access Issue Management UI

**URL:** `http://localhost:3000/admin/invoices/:invoiceId` (Invoice detail page)

**UI Elements to Test:**

1. **Report Issue Button**
   - Location: On invoice detail page or scanning page
   - Opens modal with:
     - Issue type dropdown
     - Description textarea
     - Photo upload (optional)
     - Line item selector

2. **Issue Display**
   - Shows issue note on invoice
   - "Edit Issue" button
   - "Add Note" button
   - "Cancel Issue" button

3. **Admin Issue Dashboard** (if implemented)
   - Table of all issues
   - Bulk selection checkboxes
   - "Bulk Assign" button
   - Filter and sort options

---

## 11. Complete Testing Workflow

### 11.1 End-to-End Happy Path Test

```bash
# Step 1: Get JWT token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}' | jq -r '.data.token')

# Step 2: Get fulfillment queue
curl -X GET "http://localhost:3000/api/v1/fulfillment/queue?status=Approved" \
  -H "Authorization: Bearer $TOKEN"

# Step 3: Claim an order (use invoice_id from step 2)
curl -X POST http://localhost:3000/api/v1/fulfillment/queue/claim \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"invoice_id": 12345}'

# Step 4: Start scanning session
SESSION=$(curl -s -X POST http://localhost:3000/api/v1/fulfillment/scanning/start \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"invoice_id": 12345}' | jq -r '.session_id')

# Step 5: Scan packages (repeat for each package)
curl -X POST http://localhost:3000/api/v1/fulfillment/scanning/scan \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": '$SESSION',
    "package_label": "1A40E0100000067000001234",
    "invoice_id": 12345
  }'

# Step 6: Check progress
curl -X GET http://localhost:3000/api/v1/fulfillment/scanning/progress/12345 \
  -H "Authorization: Bearer $TOKEN"

# Step 7: Enter transportation details
curl -X POST http://localhost:3000/api/v1/fulfillment/transportation \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": 12345,
    "driverName": "John Doe",
    "driverLicense": "D1234567",
    "vehicleMake": "Ford",
    "vehicleModel": "Transit",
    "vehiclePlate": "ABC123",
    "estimatedDeparture": "2025-01-17T08:00:00Z",
    "estimatedArrival": "2025-01-17T14:00:00Z",
    "transporterName": "ABC Transport Co"
  }'

# Step 8: Get manifest preview
curl -X GET http://localhost:3000/api/v1/fulfillment/manifest/preview/12345 \
  -H "Authorization: Bearer $TOKEN"

# Step 9: Create manifest
curl -X POST http://localhost:3000/api/v1/fulfillment/manifest/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"invoice_id": 12345}'
```

### 11.2 Error Scenario Testing

**Test Concurrent Claim:**
```bash
# Terminal 1
curl -X POST http://localhost:3000/api/v1/fulfillment/queue/claim \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"invoice_id": 12345}'

# Terminal 2 (immediately after, should fail)
curl -X POST http://localhost:3000/api/v1/fulfillment/queue/claim \
  -H "Authorization: Bearer $TOKEN2" \
  -d '{"invoice_id": 12345}'
# Expected: Error "Order already claimed by [Worker Name]"
```

**Test Package Conflict:**
```bash
# Worker 1 scans package
curl -X POST http://localhost:3000/api/v1/fulfillment/scanning/scan \
  -H "Authorization: Bearer $TOKEN1" \
  -d '{"session_id": 567, "package_label": "1A40E0100000067000001234", "invoice_id": 12345}'

# Worker 2 tries to scan same package (should fail)
curl -X POST http://localhost:3000/api/v1/fulfillment/scanning/scan \
  -H "Authorization: Bearer $TOKEN2" \
  -d '{"session_id": 568, "package_label": "1A40E0100000067000001234", "invoice_id": 12346}'
# Expected: Error "Package currently being used by [Worker Name]"
```

**Test Invalid Package:**
```bash
curl -X POST http://localhost:3000/api/v1/fulfillment/scanning/scan \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "session_id": 567,
    "package_label": "INVALID_PACKAGE_LABEL",
    "invoice_id": 12345
  }'
# Expected: Error "Package not found in active inventory"
```

### 11.3 UI Testing Checklist

**Fulfillment Queue Page:**
- [ ] Queue loads with orders
- [ ] Filters work (status, location, customer)
- [ ] Sort options work
- [ ] Pagination works
- [ ] "Claim Order" button works
- [ ] Real-time updates when order claimed (websocket)
- [ ] Order status updates correctly

**Scanning Page:**
- [ ] Scanner input accepts barcode input
- [ ] Progress updates in real-time
- [ ] Line item progress bars update
- [ ] Package list shows scanned packages
- [ ] Remove package button works (X icon)
- [ ] Edit package button works (if implemented)
- [ ] Cancel session button works with confirmation
- [ ] "Complete Scanning" button enables when all packages scanned
- [ ] Websocket shows package locks from other workers

**Transportation Page:**
- [ ] Form validation works
- [ ] Transporter dropdown populates
- [ ] Date pickers work correctly
- [ ] Save button works
- [ ] Clear button works (before manifest)
- [ ] Edit button works (if details exist)

**Manifest Page:**
- [ ] Preview shows correct information
- [ ] Multi-license warning displays (if applicable)
- [ ] Create manifest button works
- [ ] Success message shows manifest numbers
- [ ] Error handling displays correctly

---

## 12. Real Data Examples

### 12.1 Sample Invoice IDs (Query Database)

```sql
-- Get sample approved invoices
SELECT id, invoice_number, status, total 
FROM "ORDERS-invoices" 
WHERE status = 'Approved' 
ORDER BY approved_at DESC 
LIMIT 5;

-- Get sample packages from activepackages
SELECT label, batch_name, item_name 
FROM activepackages 
WHERE isarchived = false 
  AND isfinished = false 
  AND synclicense IN ('CUL000063', 'MAN000072')
LIMIT 10;
```

### 12.2 Sample Package Labels

**Format:** `1A40E0100000067000001234` (24 characters, alphanumeric)

**Real Examples (from your database):**
- Query: `SELECT label FROM activepackages WHERE isarchived = false LIMIT 10;`
- Use actual labels from your `activepackages` table

### 12.3 Sample User IDs

```sql
-- Get fulfillment workers
SELECT id, username, first_name, last_name 
FROM users 
WHERE roles @> ARRAY['fulfillment_worker']::text[] 
  OR roles @> ARRAY['fulfillment_admin']::text[]
LIMIT 5;

-- Get sales reps
SELECT id, username, first_name, last_name 
FROM users 
WHERE roles @> ARRAY['sales_rep']::text[] 
  OR roles @> ARRAY['sales_admin']::text[]
LIMIT 5;
```

---

## 13. Testing Tips

### 13.1 Using jq for Better Output

```bash
# Install jq: brew install jq (Mac) or apt-get install jq (Linux)

# Pretty print JSON response
curl -X GET http://localhost:3000/api/v1/fulfillment/queue \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# Extract specific field
curl -X POST http://localhost:3000/api/v1/fulfillment/queue/claim \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"invoice_id": 12345}' | jq -r '.invoice_number'
```

### 13.2 Save Responses for Testing

```bash
# Save response to file
curl -X GET http://localhost:3000/api/v1/fulfillment/queue \
  -H "Authorization: Bearer $TOKEN" > queue_response.json

# Use saved data
INVOICE_ID=$(cat queue_response.json | jq -r '.queue[0].id')
```

### 13.3 Test with Multiple Users

```bash
# Get token for user 1 (fulfillment worker)
TOKEN1=$(curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -d '{"username":"worker1","password":"pass"}' | jq -r '.data.token')

# Get token for user 2 (fulfillment worker)
TOKEN2=$(curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -d '{"username":"worker2","password":"pass"}' | jq -r '.data.token')

# Test concurrent operations
```

### 13.4 Monitor Websocket Events

Open browser console on fulfillment queue page and watch for:
- `order:claimed` events
- `order:released` events
- `package:locked` events
- `package:released` events

---

## 14. Common Issues & Solutions

### 14.1 Authentication Errors

**Error:** `401 Unauthorized`
- **Solution:** Check JWT token is valid and not expired
- **Solution:** Ensure session cookie is set (for browser testing)
- **Solution:** Verify user has required role/permissions

### 14.2 Package Not Found

**Error:** `Package not found in active inventory`
- **Solution:** Verify package exists in `activepackages` table
- **Solution:** Check `isarchived = false` and `isfinished = false`
- **Solution:** Verify license matches (CUL000063 or MAN000072)

### 14.3 Session Already Exists

**Error:** `Active scanning session already exists`
- **Solution:** Check `ORDERS-scanning-sessions` table for active session
- **Solution:** Use admin force-complete if needed
- **Solution:** Wait for auto-abandon (30 minutes)

### 14.4 Manifest Creation Fails

**Error:** `Packages missing from METRC active inventory`
- **Solution:** Verify packages still exist in METRC
- **Solution:** Check METRC sync is running
- **Solution:** Verify package labels are correct

---

## 15. Database Queries for Testing

### 15.1 Get Test Data

```sql
-- Get approved invoice ready for fulfillment
SELECT 
    i.id,
    i.invoice_number,
    i.status,
    i.total,
    COUNT(li.id) as line_item_count,
    SUM(li.quantity_ordered) as total_packages
FROM "ORDERS-invoices" i
JOIN "ORDERS-invoice-line-items" li ON i.id = li.fk_invoice_id
WHERE i.status = 'Approved'
GROUP BY i.id, i.invoice_number, i.status, i.total
ORDER BY i.approved_at DESC
LIMIT 1;

-- Get packages for a specific batch
SELECT label, batch_name, item_name
FROM activepackages
WHERE batch_name = 'BATCH-001'
  AND isarchived = false
  AND isfinished = false
LIMIT 10;

-- Get active scanning sessions
SELECT 
    ss.id,
    ss.fk_invoice_id,
    i.invoice_number,
    u.username,
    ss.started_at,
    ss.last_activity
FROM "ORDERS-scanning-sessions" ss
JOIN "ORDERS-invoices" i ON ss.fk_invoice_id = i.id
JOIN users u ON ss.fk_user_id = u.id
WHERE ss.session_status = 'active';
```

---

## 16. Performance Testing

### 16.1 Load Test Queue Endpoint

```bash
# Test with 100 concurrent requests
for i in {1..100}; do
  curl -X GET "http://localhost:3000/api/v1/fulfillment/queue?page=1" \
    -H "Authorization: Bearer $TOKEN" &
done
wait
```

### 16.2 Test Scanning Performance

```bash
# Measure scan response time
time curl -X POST http://localhost:3000/api/v1/fulfillment/scanning/scan \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"session_id": 567, "package_label": "1A40E0100000067000001234", "invoice_id": 12345}'
```

---

**Last Updated:** 2025-01-16  
**Module:** Module 5 - Fulfillment & Manifesting  
**Version:** 1.0

