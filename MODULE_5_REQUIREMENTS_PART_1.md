# Module 5: Order Fulfillment & Manifesting - Requirements Document

**Part 1: Core Architecture & Database Schema**

**Status:** 📋 Requirements Specification  
**Version:** 1.0  
**Last Updated:** 2025-01-XX

---

## Table of Contents

1. [Core Objective & Principles](#10-core-objective--principles)
2. [Database Schema Design](#20-database-schema-design)
3. [Data Models & Relationships](#30-data-models--relationships)
4. [Indexes & Performance Optimization](#40-indexes--performance-optimization)
5. [Constraints & Data Integrity](#50-constraints--data-integrity)

---

## 1.0 Core Objective & Principles

### 1.1 Module Purpose

Module 5 is the **physical execution layer** of the sales process. It transforms approved invoices into compliant, tracked shipments by orchestrating warehouse operations, package scanning, and METRC manifest creation.

### 1.2 Fundamental Principle

**100% Accuracy or Nothing Ships**

If even a single package cannot be located, validated, or scanned correctly, the entire order stops until sales resolves the issue. This zero tolerance approach prevents regulatory violations and ensures customers receive exactly what the invoice specifies.

### 1.3 Operational Phases

The module handles three distinct operational phases:

1. **Phase 1: Scanning & Validation**
   - Fulfillment workers physically locate packages and scan barcodes
   - Real-time validation against batch assignments and METRC inventory status
   - Cross-worker coordination prevents package conflicts

2. **Phase 2: Manifest Creation**
   - Transportation details are entered
   - Pricing calculations are performed
   - Compliant METRC transfer manifest is generated via the T3 API

3. **Phase 3: Status Tracking**
   - System monitors manifest lifecycle (In Transit → Delivered → Rejected)
   - Automated sync jobs trigger inventory updates and notifications
   - Rejection detection and package verification workflows

### 1.4 Critical Success Factors

- **WebSocket-based cross-worker coordination** prevents package conflicts
- **Dry run validation** before submitting to METRC prevents compliance violations
- **Comprehensive audit trail** logs every scan, every error, and every state transition
- **Multi-license support** handles orders containing products from both cultivation (CUL000063) and manufacturing (MAN000072) licenses

---

## 2.0 Database Schema Design

### 2.1 Invoice Table Extensions

The existing `ORDERS-invoices` table from Module 4 already contains the necessary fulfillment tracking fields. Module 5 extends this with additional fields for advanced features.

#### 2.1.1 Existing Fields (From Module 4)

These fields are already defined and used by Module 5:

```sql
-- Fulfillment Assignment
fulfillment_accepted_at TIMESTAMPTZ,
fulfillment_accepted_by INTEGER REFERENCES users(id),

-- Issue Tracking
fulfillment_issue_reported_at TIMESTAMPTZ,
fulfillment_issue_note TEXT,

-- Manifest Creation
metrc_manifest_number VARCHAR(100), -- M000123 from METRC
manifest_created_at TIMESTAMPTZ,

-- Transportation
shipped_at TIMESTAMPTZ,
estimated_delivery TIMESTAMPTZ,
delivered_at TIMESTAMPTZ,
```

#### 2.1.2 New Fields for Module 5

```sql
-- Multi-License Manifest Support
ALTER TABLE "ORDERS-invoices" 
  DROP COLUMN IF EXISTS metrc_manifest_number,
  DROP COLUMN IF EXISTS manifest_metrc_id;

ALTER TABLE "ORDERS-invoices"
  ADD COLUMN metrc_manifest_numbers JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN manifest_metrc_ids JSONB DEFAULT '[]'::jsonb;

-- Manifest Voiding
ALTER TABLE "ORDERS-invoices"
  ADD COLUMN voided_manifest_number VARCHAR(100),
  ADD COLUMN voided_manifest_reason TEXT,
  ADD COLUMN voided_at TIMESTAMPTZ,
  ADD COLUMN voided_by INTEGER REFERENCES users(id);

-- Transportation Details (JSONB for flexibility)
ALTER TABLE "ORDERS-invoices"
  ADD COLUMN transportation_details JSONB;

-- Cancelled Shipment Tracking
ALTER TABLE "ORDERS-invoices"
  ADD COLUMN packages_returned_count INTEGER DEFAULT 0,
  ADD COLUMN packages_missing_count INTEGER DEFAULT 0,
  ADD COLUMN global_issue_requested_by INTEGER REFERENCES users(id),
  ADD COLUMN global_issue_requested_at TIMESTAMPTZ,
  ADD COLUMN inventory_finalized BOOLEAN DEFAULT FALSE;

-- Status Enum Extension
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Partially_Manifested';
```

#### 2.1.3 Transportation Details JSONB Structure

```json
{
  "driverName": "John Doe",
  "driverLicense": "D1234567",
  "driverOccupationalLicense": "OCC12345",
  "vehicleMake": "Ford",
  "vehicleModel": "Transit",
  "vehiclePlate": "ABC123",
  "estimatedDeparture": "2025-10-16T08:00:00Z",
  "estimatedArrival": "2025-10-16T14:00:00Z",
  "transporterId": 12345,
  "recipientId": 67890,
  "transporterName": "ABC Transport Co",
  "phoneNumber": "555-1234",
  "capturedAt": "2025-10-15T10:30:00Z",
  "capturedBy": 42
}
```

#### 2.1.4 Manifest Metadata JSONB Structure

```json
[
  {
    "license": "CUL000063",
    "id": 12345,
    "number": "M000123"
  },
  {
    "license": "MAN000072",
    "id": 12346,
    "number": "M000124"
  }
]
```

### 2.2 Scanning Session Tracking Table

**Purpose:** Tracks active package scanning sessions for websocket coordination and prevents multiple workers from scanning the same packages simultaneously.

```sql
CREATE TABLE "ORDERS-scanning-sessions" (
  id SERIAL PRIMARY KEY,
  fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id) ON DELETE CASCADE,
  fk_user_id INTEGER NOT NULL REFERENCES users(id),
  
  -- Session State
  session_status VARCHAR(20) NOT NULL DEFAULT 'active',
  -- Valid values: 'active', 'completed', 'cancelled', 'abandoned'
  
  -- Real-time Coordination
  currently_locked_packages JSONB DEFAULT '[]'::jsonb,
  -- Array of package labels being scanned
  -- Example: ["1A40E0100000067000001234", "1A40E0100000067000001235"]
  
  -- Session Lifecycle
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Metadata
  websocket_connection_id VARCHAR(255),
  
  -- Constraints
  CONSTRAINT uq_active_session UNIQUE (fk_invoice_id, session_status)
    WHERE session_status = 'active'
);

COMMENT ON TABLE "ORDERS-scanning-sessions" IS 
'Tracks active package scanning sessions for websocket coordination. Prevents multiple workers from scanning the same packages simultaneously. Sessions auto-abandon after 30 minutes of inactivity.';
```

**Key Features:**
- Only one active session per invoice (enforced by unique constraint)
- Tracks locked packages in real-time
- Auto-abandon after 30 minutes of inactivity
- Supports websocket connection tracking

### 2.3 Cancelled Shipment Package Tracking Table

**Purpose:** Tracks packages from cancelled shipments to ensure inventory recovery. System verifies each package returns to activepackages before releasing allocations.

```sql
CREATE TABLE "ORDERS-cancelled-shipment-packages" (
  id SERIAL PRIMARY KEY,
  fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id),
  
  -- Package Info
  package_label VARCHAR(255) NOT NULL,
  package_metrc_id INTEGER,
  batch_id INTEGER REFERENCES "ORDERS-batches"(id),
  
  -- Expected vs Actual Return
  was_on_manifest BOOLEAN NOT NULL DEFAULT TRUE,
  returned_to_inventory BOOLEAN DEFAULT FALSE,
  verified_in_metrc BOOLEAN DEFAULT FALSE,
  
  -- Issue Tracking
  cancellation_reason TEXT,
  incident_type VARCHAR(50),
  -- Valid values: 'customer_cancel', 'driver_accident', 'other'
  
  -- Verification
  verified_by INTEGER REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  admin_notes TEXT,
  
  -- Allocation Release Tracking
  allocation_released BOOLEAN DEFAULT FALSE,
  allocation_released_at TIMESTAMPTZ,
  allocation_released_by INTEGER REFERENCES users(id),
  
  -- Metadata
  synclicense VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Soft Delete Support
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id),
  
  -- Constraints
  CONSTRAINT uq_cancelled_pkg UNIQUE (fk_invoice_id, package_label)
);

COMMENT ON TABLE "ORDERS-cancelled-shipment-packages" IS 
'Tracks packages from cancelled shipments to ensure inventory recovery. System verifies each package returns to activepackages before releasing allocations. Prevents inventory loss from accidents, cancellations, or other incidents.';

COMMENT ON COLUMN "ORDERS-cancelled-shipment-packages".allocation_released IS 
'Tracks whether this specific package has had its allocation released from the batch. Prevents double-release when some packages are destroyed and others return.';
```

### 2.4 Manifest Package Junction Table

**Purpose:** Junction table recording which packages were on each manifest. Critical for rejection detection and cancelled shipment verification.

```sql
CREATE TABLE "ORDERS-manifest-packages" (
  id SERIAL PRIMARY KEY,
  fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id),
  
  -- Manifest Details
  manifest_number VARCHAR(100) NOT NULL,
  
  -- Package Details
  package_label VARCHAR(255) NOT NULL,
  package_metrc_id INTEGER NOT NULL,
  batch_id INTEGER NOT NULL REFERENCES "ORDERS-batches"(id),
  line_item_id INTEGER NOT NULL REFERENCES "ORDERS-invoice-line-items"(id),
  
  -- Manifest Details
  quantity NUMERIC NOT NULL,
  wholesale_price NUMERIC(10, 2) NOT NULL,
  gross_weight NUMERIC(10, 2) NOT NULL, -- In grams
  
  -- Status Tracking
  package_status VARCHAR(50) DEFAULT 'manifested',
  -- Valid values: 'manifested', 'delivered', 'rejected', 'returned', 'voided', 'in_transit'
  
  -- Void Tracking (if manifest voided)
  voided_at TIMESTAMPTZ,
  voided_by INTEGER REFERENCES users(id),
  
  -- Metadata
  synclicense VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uq_manifest_package UNIQUE (manifest_number, package_label, synclicense)
);

COMMENT ON TABLE "ORDERS-manifest-packages" IS 
'Junction table recording which packages were on each manifest. Critical for rejection detection and cancelled shipment verification. Populated immediately after successful manifest creation.';
```

**Record Lifecycle Options:**

The system supports two strategies for handling voided manifests:

- **Option A (Recommended):** `manifest_void_strategy = 'retain_records'`
  - Records remain in table with `package_status = 'voided'`
  - Full audit trail preserved

- **Option B:** `manifest_void_strategy = 'delete_records'`
  - Records deleted from active table
  - Snapshot saved to `manifest-packages-audit` table before deletion

### 2.5 Rejected Package Tracking Table

**Note:** This schema is fully documented in the "Manifest Rejection Detection & Package Verification Guide". Referenced here for completeness.

```sql
CREATE TABLE "ORDERS-rejected-packages" (
  id SERIAL PRIMARY KEY,
  packagelabel TEXT NOT NULL,
  package_metrc_id INTEGER,
  manifestnumber TEXT NOT NULL,
  rejection_date TIMESTAMPTZ NOT NULL,
  returned_to_inventory_date TIMESTAMPTZ,
  rejection_reason TEXT,
  rejected_by_facility TEXT,
  rejected_by_person TEXT,
  verified_by_fulfillment BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  verified_by TEXT,
  notes TEXT,
  synclicense TEXT NOT NULL,
  
  CONSTRAINT uq_rejected_pkg UNIQUE (synclicense, packagelabel, manifestnumber)
);
```

---

## 3.0 Data Models & Relationships

### 3.1 Entity Relationship Overview

```
ORDERS-invoices (1) ──< (N) ORDERS-scanning-sessions
ORDERS-invoices (1) ──< (N) ORDERS-manifest-packages
ORDERS-invoices (1) ──< (N) ORDERS-cancelled-shipment-packages
ORDERS-invoices (1) ──< (N) ORDERS-invoice-line-items
ORDERS-invoice-line-items (1) ──< (N) ORDERS-manifest-packages
ORDERS-batches (1) ──< (N) ORDERS-manifest-packages
ORDERS-batches (1) ──< (N) ORDERS-cancelled-shipment-packages
users (1) ──< (N) ORDERS-scanning-sessions
users (1) ──< (N) ORDERS-invoices (fulfillment_accepted_by)
```

### 3.2 Key Relationships

#### 3.2.1 Invoice → Scanning Session
- **Cardinality:** One-to-Many (one invoice can have multiple sessions over time)
- **Active Constraint:** Only one active session per invoice at any time
- **Cascade:** Sessions deleted when invoice deleted

#### 3.2.2 Invoice → Manifest Packages
- **Cardinality:** One-to-Many
- **Purpose:** Track which packages were on each manifest
- **Critical for:** Rejection detection, cancelled shipment verification

#### 3.2.3 Invoice → Cancelled Shipment Packages
- **Cardinality:** One-to-Many
- **Purpose:** Track packages that need to return to inventory
- **Verification:** Each package must be verified in METRC before allocation release

#### 3.2.4 Line Item → Manifest Packages
- **Cardinality:** One-to-Many
- **Purpose:** Link packages to specific line items for fulfillment tracking
- **Used for:** Calculating fulfillment progress per line item

### 3.3 State Machine Definitions

#### 3.3.1 Invoice Status Transitions

```
Approved
  ↓ (fulfillment worker claims)
Fulfillment_Accepted
  ↓ (scanning complete, manifest created)
Manifested
  ↓ (sync detects in transit)
Shipped
  ↓ (sync detects delivery)
Delivered
  ↓ (if rejection detected)
Partially_Rejected / Fully_Rejected

Fulfillment_Accepted
  ↓ (issue reported)
Fulfillment_Issue
  ↓ (sales resolves)
Approved

Manifested
  ↓ (manifest voided)
Fulfillment_Issue

Manifested
  ↓ (partial manifest failure)
Partially_Manifested
```

#### 3.3.2 Scanning Session Status Transitions

```
(created)
  ↓
active
  ↓ (scanning complete)
completed

active
  ↓ (user cancels)
cancelled

active
  ↓ (30 min inactivity)
abandoned
```

#### 3.3.3 Package Status (in manifest-packages)

```
manifested
  ↓ (sync detects in transit)
in_transit
  ↓ (sync detects delivery)
delivered

manifested
  ↓ (manifest voided)
voided

delivered
  ↓ (rejection detected)
rejected
```

---

## 4.0 Indexes & Performance Optimization

### 4.1 Critical Indexes for Fulfillment Queue

```sql
-- Fulfillment queue queries
CREATE INDEX idx_invoices_fulfillment_queue 
ON "ORDERS-invoices"(status, approved_at) 
WHERE status IN ('Approved', 'Fulfillment_Accepted', 'Fulfillment_Issue');

-- Worker assignment lookups
CREATE INDEX idx_invoices_fulfillment_worker 
ON "ORDERS-invoices"(fulfillment_accepted_by) 
WHERE status IN ('Fulfillment_Accepted', 'Fulfillment_Issue');

-- Voided manifest lookups
CREATE INDEX idx_invoices_voided_manifests 
ON "ORDERS-invoices"(voided_manifest_number) 
WHERE voided_manifest_number IS NOT NULL;

-- Multi-license manifest lookups
CREATE INDEX idx_invoices_manifest_numbers 
ON "ORDERS-invoices" USING GIN(metrc_manifest_numbers);
```

### 4.2 Scanning Session Indexes

```sql
-- Invoice lookups
CREATE INDEX idx_scanning_sessions_invoice 
ON "ORDERS-scanning-sessions"(fk_invoice_id);

-- User lookups
CREATE INDEX idx_scanning_sessions_user 
ON "ORDERS-scanning-sessions"(fk_user_id);

-- Active session queries
CREATE INDEX idx_scanning_sessions_active 
ON "ORDERS-scanning-sessions"(session_status) 
WHERE session_status = 'active';

-- Cleanup job queries
CREATE INDEX idx_scanning_sessions_cleanup 
ON "ORDERS-scanning-sessions"(last_activity) 
WHERE session_status = 'active';
```

### 4.3 Package Lookup Indexes

```sql
-- Active packages lookup (critical for scanning validation)
CREATE INDEX idx_activepackages_label_lookup 
ON activepackages(label, synclicense) 
WHERE isarchived = FALSE AND isfinished = FALSE;

-- Manifest package lookups
CREATE INDEX idx_manifest_packages_invoice 
ON "ORDERS-manifest-packages"(fk_invoice_id);

CREATE INDEX idx_manifest_packages_manifest 
ON "ORDERS-manifest-packages"(manifest_number, synclicense);

CREATE INDEX idx_manifest_packages_label 
ON "ORDERS-manifest-packages"(package_label, synclicense);

-- Cancelled shipment lookups
CREATE INDEX idx_cancelled_packages_invoice 
ON "ORDERS-cancelled-shipment-packages"(fk_invoice_id);

CREATE INDEX idx_cancelled_packages_unverified 
ON "ORDERS-cancelled-shipment-packages"(returned_to_inventory, verified_in_metrc) 
WHERE verified_in_metrc = FALSE;

CREATE INDEX idx_cancelled_packages_allocation_status 
ON "ORDERS-cancelled-shipment-packages"(fk_invoice_id, allocation_released) 
WHERE allocation_released = FALSE;
```

### 4.4 Query Performance Targets

- **Fulfillment queue load:** < 500ms for 100 invoices
- **Package validation:** < 200ms per package scan
- **Manifest creation:** < 2 seconds for 10 packages
- **Active session queries:** < 100ms

---

## 5.0 Constraints & Data Integrity

### 5.1 Referential Integrity

#### 5.1.1 Foreign Key Constraints

```sql
-- All foreign keys must reference valid records
-- ON DELETE behavior:
--   CASCADE: scanning-sessions (when invoice deleted)
--   RESTRICT: manifest-packages, cancelled-shipment-packages (prevent orphaned records)
--   SET NULL: user references (if user deleted, set to NULL with audit log)
```

#### 5.1.2 Unique Constraints

```sql
-- Only one active scanning session per invoice
CONSTRAINT uq_active_session UNIQUE (fk_invoice_id, session_status)
  WHERE session_status = 'active';

-- No duplicate cancelled package records
CONSTRAINT uq_cancelled_pkg UNIQUE (fk_invoice_id, package_label);

-- No duplicate manifest package records
CONSTRAINT uq_manifest_package UNIQUE (manifest_number, package_label, synclicense);
```

### 5.2 Data Validation Constraints

#### 5.2.1 Invoice-Level Constraints

```sql
-- Cannot have voided_at without voided_manifest_reason
ALTER TABLE "ORDERS-invoices"
  ADD CONSTRAINT chk_void_reason 
  CHECK (voided_at IS NULL OR voided_manifest_reason IS NOT NULL);

-- Cannot have manifest_metrc_ids without metrc_manifest_numbers
ALTER TABLE "ORDERS-invoices"
  ADD CONSTRAINT chk_manifest_consistency
  CHECK (
    (jsonb_array_length(metrc_manifest_numbers) = 0 AND jsonb_array_length(manifest_metrc_ids) = 0)
    OR
    (jsonb_array_length(metrc_manifest_numbers) > 0 AND jsonb_array_length(manifest_metrc_ids) > 0)
  );

-- Counts cannot be negative
ALTER TABLE "ORDERS-invoices"
  ADD CONSTRAINT chk_package_counts
  CHECK (packages_returned_count >= 0 AND packages_missing_count >= 0);
```

#### 5.2.2 Session-Level Constraints

```sql
-- Session status must be valid enum value
ALTER TABLE "ORDERS-scanning-sessions"
  ADD CONSTRAINT chk_session_status
  CHECK (session_status IN ('active', 'completed', 'cancelled', 'abandoned'));

-- Cannot have completed_at without completed status
ALTER TABLE "ORDERS-scanning-sessions"
  ADD CONSTRAINT chk_completed_state
  CHECK (
    (session_status = 'completed' AND completed_at IS NOT NULL)
    OR
    (session_status != 'completed' AND completed_at IS NULL)
  );

-- Cannot have cancelled_at without cancelled/abandoned status
ALTER TABLE "ORDERS-scanning-sessions"
  ADD CONSTRAINT chk_cancelled_state
  CHECK (
    (session_status IN ('cancelled', 'abandoned') AND cancelled_at IS NOT NULL)
    OR
    (session_status NOT IN ('cancelled', 'abandoned') AND cancelled_at IS NULL)
  );
```

#### 5.2.3 Package-Level Constraints

```sql
-- Package status must be valid
ALTER TABLE "ORDERS-manifest-packages"
  ADD CONSTRAINT chk_package_status
  CHECK (package_status IN ('manifested', 'delivered', 'rejected', 'returned', 'voided', 'in_transit'));

-- Quantities must be positive
ALTER TABLE "ORDERS-manifest-packages"
  ADD CONSTRAINT chk_positive_quantities
  CHECK (quantity > 0 AND wholesale_price >= 0 AND gross_weight > 0);

-- Incident type must be valid
ALTER TABLE "ORDERS-cancelled-shipment-packages"
  ADD CONSTRAINT chk_incident_type
  CHECK (incident_type IS NULL OR incident_type IN ('customer_cancel', 'driver_accident', 'other'));
```

### 5.3 Cross-Table Validation Rules

#### 5.3.1 Invoice → Line Items Consistency

```sql
-- Every invoice must have at least one line item
-- Enforced at application level (cannot create invoice without line items)

-- Line item totals must sum to invoice subtotal
-- Validated via application-level checks (not database constraint for performance)
```

#### 5.3.2 Batch Allocation Consistency

```sql
-- allocated_quantity ≤ quantity (cannot allocate more than exists)
-- Validated via application-level pessimistic locking

-- Sum of line item allocations = batch allocated_quantity
-- Validated via reconciliation job (runs daily)
```

#### 5.3.3 Manifest Package Consistency

```sql
-- All packages in manifest-packages must exist in activepackages at time of manifest creation
-- Validated via pre-manifest validation check

-- Package labels in manifest-packages must match assigned_package_labels in line items
-- Validated via application-level checks
```

### 5.4 Audit Trail Requirements

#### 5.4.1 Required History Logging

Every state change must be logged to `ORDERS-invoice-history`:

- Status transitions
- Package scans
- Manifest creation
- Manifest voiding
- Issue reporting
- Transportation details entry
- Allocation releases

#### 5.4.2 History Record Structure

```sql
-- Every history entry must include:
--   fk_invoice_id
--   modification_type (enum: 'status_changed', 'package_scanned', 'manifest_created', etc.)
--   field_name (which field changed)
--   old_value (if applicable)
--   new_value (if applicable)
--   reason (text description)
--   changed_by_user_id
--   changed_by_system (boolean)
--   triggered_by_fulfillment_issue (boolean)
--   change_details (JSONB for complex changes)
--   timestamp (automatic)
```

---

## 6.0 Archive Tables & Data Retention

### 6.1 Archive Table Structures

#### 6.1.1 Scanning Sessions Archive

```sql
CREATE TABLE "ORDERS-scanning-sessions-archive" (
  -- Same structure as active table
  -- Additional columns:
  archived_at TIMESTAMPTZ NOT NULL,
  archived_by INTEGER REFERENCES users(id),
  archive_reason TEXT
);
```

#### 6.1.2 Manifest Packages Archive

```sql
CREATE TABLE "ORDERS-manifest-packages-archive" (
  -- Same structure as active table
  -- Additional columns:
  archived_at TIMESTAMPTZ NOT NULL,
  archived_by INTEGER REFERENCES users(id),
  archive_reason TEXT
);
```

#### 6.1.3 Cancelled Shipment Packages Archive

```sql
CREATE TABLE "ORDERS-cancelled-shipment-packages-archive" (
  -- Same structure as active table
  -- Additional columns:
  archived_at TIMESTAMPTZ NOT NULL,
  archived_by INTEGER REFERENCES users(id),
  archive_reason TEXT
);
```

### 6.2 Data Retention Policies

| Table | Active Retention | Archive Retention | Purge Eligibility |
|-------|-----------------|-------------------|-------------------|
| scanning-sessions | Until completed/cancelled | 30 days | 1 year |
| manifest-packages | Indefinite (active manifests) | 1 year (delivered) | Never (voided) |
| cancelled-shipment-packages | Until resolved | 90 days | 2 years |
| invoice-history | Indefinite | N/A | Never |

### 6.3 Archive Process Requirements

1. **Scheduled Jobs:**
   - Scanning sessions: Daily at 2 AM
   - Manifest packages: Monthly (1st of month at 2 AM)
   - Cancelled shipments: Weekly (Sunday at 3 AM)

2. **Archive Steps:**
   - Identify eligible records
   - INSERT INTO archive table
   - Verify copy successful (row count match)
   - DELETE FROM active table
   - Log operation to admin audit

3. **Error Handling:**
   - If any step fails, rollback entire batch
   - Send notification to admin
   - Retry on next scheduled run

---

## 7.0 Configuration & Settings

### 7.1 System Configuration Table

```sql
CREATE TABLE system_config (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id)
);
```

### 7.2 Module 5 Configuration Keys

| Key | Default Value | Description |
|-----|--------------|-------------|
| `manifest_void_strategy` | `retain_records` | How to handle manifest package records on void |
| `scanning_session_timeout_minutes` | `30` | Minutes of inactivity before auto-abandon |
| `manifest_creation_timeout_seconds` | `30` | METRC API timeout in seconds |
| `package_validation_cache_ttl` | `300` | Cache TTL for package existence checks (seconds) |
| `bulk_operation_max_records` | `100` | Maximum records per bulk operation |

---

**End of Part 1**

*Continue to [Part 2: Functional Requirements & Workflows](./MODULE_5_REQUIREMENTS_PART_2.md)*



