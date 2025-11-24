# Module 5: Order Fulfillment & Manifesting - Detailed Requirements

## Table of Contents
1. [Core Objective & Overview](#1-core-objective--overview)
2. [Database Schema Design](#2-database-schema-design)
3. [Fulfillment Queue & Order Management](#3-fulfillment-queue--order-management)
4. [Package Scanning System](#4-package-scanning-system)
5. [Fulfillment Issue Reporting](#5-fulfillment-issue-reporting)
6. [Transportation Details Entry](#6-transportation-details-entry)
7. [METRC Manifest Creation](#7-metrc-manifest-creation)
8. [Manifest Voiding & Updates](#8-manifest-voiding--updates)
9. [Post-Manifest Status Tracking](#9-post-manifest-status-tracking)
10. [Cancelled Shipments & Returns](#10-cancelled-shipments--returns)
11. [Websocket Real-Time Coordination](#11-websocket-real-time-coordination)
12. [API Endpoints](#12-api-endpoints)
13. [Integration Points](#13-integration-points)
14. [Testing & Validation](#14-testing--validation)
15. [Performance & Optimization](#15-performance--optimization)
16. [Security & Permissions](#16-security--permissions)
17. [Monitoring & Alerts](#17-monitoring--alerts)

---

## 1. Core Objective & Overview

### 1.1 Purpose
Module 5 is the physical execution layer that transforms approved invoices into compliant, tracked shipments. It orchestrates warehouse operations, package scanning, and METRC manifest creation.

### 1.2 Core Principle
**100% accuracy or nothing ships.** If even a single package cannot be located, validated, or scanned correctly, the entire order stops until sales resolves the issue.

### 1.3 Operational Phases
1. **Phase 1: Scanning & Validation** - Fulfillment workers locate packages and scan barcodes with real-time validation
2. **Phase 2: Manifest Creation** - Transportation details entered, pricing calculated, compliant METRC transfer manifest generated
3. **Phase 3: Status Tracking** - System monitors manifest lifecycle (In Transit → Delivered → Rejected) via automated sync jobs

### 1.4 Critical Features
- Websocket-based cross-worker coordination (prevents package conflicts)
- Dry run validation before submitting to METRC
- Comprehensive audit trail (logs every scan, error, state transition)
- Multi-license manifest support (CUL000063 and MAN000072)

---

## 2. Database Schema Design

### 2.1 Invoice Table Extensions

#### 2.1.1 Existing Fields (from Module 4)
These fields already exist and are used by Module 5:
- `fulfillment_accepted_at` (timestamptz) - When worker claimed the order
- `fulfillment_accepted_by` (integer, FK to users) - Which worker claimed it
- `fulfillment_issue_reported_at` (timestamptz)
- `fulfillment_issue_note` (text)
- `metrc_manifest_number` (varchar(100)) - M000123 from METRC
- `manifest_created_at` (timestamptz)
- `shipped_at` (timestamptz)
- `estimated_delivery` (timestamptz)
- `delivered_at` (timestamptz)

#### 2.1.2 New Fields Required
```sql
ALTER TABLE "ORDERS-invoices" 
  ADD COLUMN voided_manifest_number varchar(100),
  ADD COLUMN voided_manifest_reason text,
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_by integer REFERENCES users(id),
  ADD COLUMN manifest_metrc_id integer,
  ADD COLUMN transportation_details jsonb,
  ADD COLUMN packages_returned_count integer DEFAULT 0,
  ADD COLUMN packages_missing_count integer DEFAULT 0,
  ADD COLUMN global_issue_requested_by integer REFERENCES users(id),
  ADD COLUMN global_issue_requested_at timestamptz,
  ADD COLUMN inventory_finalized boolean DEFAULT false;
```

#### 2.1.3 Multi-License Manifest Support
For orders containing packages from multiple licenses, use JSONB arrays:
```sql
-- Replace single manifest fields with arrays
ALTER TABLE "ORDERS-invoices"
  DROP COLUMN metrc_manifest_number,
  DROP COLUMN manifest_metrc_id;

ALTER TABLE "ORDERS-invoices"
  ADD COLUMN metrc_manifest_numbers JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN manifest_metrc_ids JSONB DEFAULT '[]'::jsonb;

-- Example stored data:
-- metrc_manifest_numbers: ["M000123", "M000124"]
-- manifest_metrc_ids: [{"license": "CUL000063", "id": 12345, "number": "M000123"}, 
--                       {"license": "MAN000072", "id": 12346, "number": "M000124}]
```

#### 2.1.4 Status Enum Extension
```sql
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Partially_Manifested';
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Partially_Voided';
```

#### 2.1.5 Indexes
```sql
CREATE INDEX idx_invoices_fulfillment_worker 
  ON "ORDERS-invoices"(fulfillment_accepted_by)
  WHERE status IN ('Fulfillment_Accepted', 'Fulfillment_Issue');

CREATE INDEX idx_invoices_voided_manifests 
  ON "ORDERS-invoices"(voided_manifest_number)
  WHERE voided_manifest_number IS NOT NULL;

CREATE INDEX idx_invoices_manifest_numbers 
  ON "ORDERS-invoices" USING GIN(metrc_manifest_numbers);
```

### 2.2 Scanning Session Tracking Table

```sql
CREATE TABLE "ORDERS-scanning-sessions" (
  id SERIAL PRIMARY KEY,
  fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id) ON DELETE CASCADE,
  fk_user_id INTEGER NOT NULL REFERENCES users(id),
  
  -- Session State
  session_status VARCHAR(20) NOT NULL DEFAULT 'active', 
  -- Values: 'active', 'completed', 'cancelled', 'abandoned'
  
  -- Real-time Coordination
  currently_locked_packages JSONB, 
  -- Array of package labels: ["1A40E0100000067000001234", "1A40E0100000067000001235"]
  
  -- Activity Tracking
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Session Lifecycle
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  
  -- Metadata
  websocket_connection_id VARCHAR(255),
  
  CONSTRAINT uq_active_session UNIQUE (fk_invoice_id, session_status)
    WHERE session_status = 'active'
);

CREATE INDEX idx_scanning_sessions_invoice 
  ON "ORDERS-scanning-sessions"(fk_invoice_id);

CREATE INDEX idx_scanning_sessions_user 
  ON "ORDERS-scanning-sessions"(fk_user_id);

CREATE INDEX idx_scanning_sessions_active 
  ON "ORDERS-scanning-sessions"(session_status) 
  WHERE session_status = 'active';

CREATE INDEX idx_scanning_sessions_cleanup 
  ON "ORDERS-scanning-sessions"(last_activity) 
  WHERE session_status = 'active';
```

**Comments:**
- Only one active session per invoice (enforced by unique constraint)
- Sessions auto-abandon after 30 minutes of inactivity
- Completed/cancelled sessions archived after 30 days

### 2.3 Cancelled Shipment Package Tracking

```sql
CREATE TABLE "ORDERS-cancelled-shipment-packages" (
  id SERIAL PRIMARY KEY,
  fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id),
  
  -- Package Info
  package_label VARCHAR(255) NOT NULL,
  package_metrc_id INTEGER,
  batch_id INTEGER REFERENCES "ORDERS-batches"(id),
  
  -- Expected vs Actual Return
  was_on_manifest BOOLEAN NOT NULL DEFAULT true,
  returned_to_inventory BOOLEAN DEFAULT false,
  verified_in_metrc BOOLEAN DEFAULT false,
  
  -- Issue Tracking
  cancellation_reason TEXT,
  incident_type VARCHAR(50), 
  -- Values: 'customer_cancel', 'driver_accident', 'other'
  
  -- Verification
  verified_by INTEGER REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  admin_notes TEXT,
  
  -- Allocation Release Tracking
  allocation_released BOOLEAN DEFAULT false,
  allocation_released_at TIMESTAMPTZ,
  allocation_released_by INTEGER REFERENCES users(id),
  
  -- Metadata
  synclicense VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Soft Delete Support
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id),
  
  CONSTRAINT uq_cancelled_pkg UNIQUE (fk_invoice_id, package_label)
);

CREATE INDEX idx_cancelled_packages_invoice 
  ON "ORDERS-cancelled-shipment-packages"(fk_invoice_id);

CREATE INDEX idx_cancelled_packages_unverified 
  ON "ORDERS-cancelled-shipment-packages"(returned_to_inventory, verified_in_metrc) 
  WHERE verified_in_metrc = FALSE;

CREATE INDEX idx_cancelled_packages_allocation_status 
  ON "ORDERS-cancelled-shipment-packages"(fk_invoice_id, allocation_released) 
  WHERE allocation_released = false;
```

### 2.4 Manifest Package Junction Table

```sql
CREATE TABLE "ORDERS-manifest-packages" (
  id SERIAL PRIMARY KEY,
  fk_invoice_id INTEGER NOT NULL REFERENCES "ORDERS-invoices"(id),
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
  -- Values: 'manifested', 'delivered', 'rejected', 'returned', 'voided'
  
  -- Void Tracking (if manifest voided)
  voided_at TIMESTAMPTZ,
  voided_by INTEGER REFERENCES users(id),
  
  -- Metadata
  synclicense VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT uq_manifest_package UNIQUE (manifest_number, package_label, synclicense)
);

CREATE INDEX idx_manifest_packages_invoice 
  ON "ORDERS-manifest-packages"(fk_invoice_id);

CREATE INDEX idx_manifest_packages_manifest 
  ON "ORDERS-manifest-packages"(manifest_number, synclicense);

CREATE INDEX idx_manifest_packages_label 
  ON "ORDERS-manifest-packages"(package_label, synclicense);

CREATE INDEX idx_manifest_packages_voided 
  ON "ORDERS-manifest-packages"(package_status) 
  WHERE package_status = 'voided';
```

### 2.5 Rejected Package Tracking

This table is documented in the "Manifest Rejection Detection & Package Verification Guide" and referenced here for completeness:

```sql
CREATE TABLE "ORDERS-rejected_packages" (
  id serial PRIMARY KEY,
  packagelabel text NOT NULL,
  package_metrc_id integer,
  manifestnumber text NOT NULL,
  rejection_date timestamp WITH time zone NOT NULL,
  returned_to_inventory_date timestamp WITH time zone,
  rejection_reason text,
  rejected_by_facility text,
  rejected_by_person text,
  verified_by_fulfillment boolean DEFAULT false,
  verified_at timestamp WITH time zone,
  verified_by text,
  notes text,
  synclicense text NOT NULL,
  CONSTRAINT uq_rejected_pkg UNIQUE (synclicense, packagelabel, manifestnumber)
);
```

---

## 3. Fulfillment Queue & Order Management

### 3.1 Queue Architecture

The fulfillment queue is a shared pool of approved invoices that any fulfillment worker can claim. The queue operates on a "first come first served" basis with pessimistic locking to prevent concurrent claims.

#### 3.1.1 Queue Query Requirements

**Get Fulfillment Queue**
- Returns all orders ready for fulfillment
- Sorted by priority (if applicable), then by age (oldest first)
- Includes buyer details, location info, order summary, assigned worker (if any)
- Filters by license number if needed

**Key Fields to Return:**
- Invoice ID, invoice number, buyer name, location details
- Total value, line item count, total packages needed
- Assigned worker name (if claimed)
- Approval timestamp
- Status

#### 3.1.2 Claim Order Functionality

**Requirements:**
- Use pessimistic locking (`SELECT FOR UPDATE`)
- Verify invoice status is 'Approved'
- Check if already claimed by another worker
- Update invoice status to 'Fulfillment_Accepted'
- Set `fulfillment_accepted_by` and `fulfillment_accepted_at`
- Log to invoice history
- Return success with invoice number

**Error Cases:**
- Invoice not found → Error
- Status not 'Approved' → Error with current status
- Already claimed → Error with claiming worker name
- Concurrent claim attempt → Transaction rollback, second attempt fails

#### 3.1.3 Admin Reassignment

**Requirements:**
- Only available BEFORE scanning starts
- Requires `fulfillment:reassign` permission
- Check for active scanning session (block if exists)
- Verify current assignment matches `fromUserId`
- Update `fulfillment_accepted_by` to `toUserId`
- Log reassignment to invoice history
- Notify both workers via websocket

**Error Cases:**
- Scanning already started → Error: "Cannot reassign - scanning in progress"
- Current assignment doesn't match → Error
- Insufficient permissions → 403 error

### 3.2 Queue Filtering & Sorting

#### 3.2.1 Filter Options

**Status Filter:**
- Filter by: 'Approved', 'Fulfillment_Accepted', 'Fulfillment_Issue'
- Multiple statuses can be selected

**Location Filter:**
- Filter by destination city or state
- Case-insensitive partial match

**Customer Filter:**
- Search by buyer name
- Case-insensitive partial match

**Value Filter:**
- Filter by minimum total value
- Filter by maximum total value

**Date Range Filter:**
- Filter by approval date range

#### 3.2.2 Sort Options

**Sort By:**
- Age (approved_at) - oldest/newest first
- Value (total) - highest/lowest first
- Destination (city) - alphabetical
- Customer (buyer name) - alphabetical
- Item count - most/least items

**Sort Order:**
- Ascending or descending

#### 3.2.3 Pagination

- Default: 25 orders per page
- Configurable page size (25, 50, 100)
- Total count displayed
- Page navigation preserves filter state

### 3.3 Queue Real-Time Updates

#### 3.3.1 Websocket Integration

**Events to Broadcast:**
- `order:claimed` - When order is claimed by worker
- `order:released` - When order is released back to queue
- `order:approved` - When new order is approved (appears in queue)
- `order:status_changed` - When order status changes

**Payload Structure:**
```json
{
  "event": "order:claimed",
  "invoice_id": 12345,
  "invoice_number": "INV-2025-00123",
  "worker_id": 789,
  "worker_name": "John Doe",
  "timestamp": "2025-10-16T14:30:00Z"
}
```

#### 3.3.2 Connection Handling

- Queue subscribers notified when order is claimed/released
- Fallback to polling if websockets unavailable
- Reconnection doesn't duplicate queue entries
- Connection ID stored for targeted notifications

---

## 4. Package Scanning System

### 4.1 Scanning Architecture Overview

The scanning system is a multi-layered validation pipeline:

```
User Scans Package Label
    ↓
1. Session Validation (Is scanning session active?)
    ↓
2. Package Existence Check (Is package in activepackages?)
    ↓
3. Batch Membership Check (Does package belong to required batch?)
    ↓
4. Specific Label Check (If partial package, is it the required label?)
    ↓
5. Cross Worker Conflict Check (Is another worker using this package?)
    ↓
6. Duplicate Scan Check (Already scanned for this invoice?)
    ↓
7. Rejection Alert Check (Was package recently rejected?)
    ↓
SUCCESS: Add to assigned_package_labels, update progress
```

### 4.2 Scanning Session Management

#### 4.2.1 Start Scanning Session

**Requirements:**
- Verify invoice status is 'Fulfillment_Accepted'
- Verify user is assigned to invoice (`fulfillment_accepted_by`)
- Check no active session exists (unique constraint)
- Create session record with status 'active'
- Store websocket connection ID
- Initialize `currently_locked_packages` as empty array
- Return session ID and started_at timestamp

**Error Cases:**
- Invoice not found → Error
- Status not 'Fulfillment_Accepted' → Error
- User not assigned → Error: "You are not assigned to this order"
- Active session exists → Error: "Active scanning session already exists"

#### 4.2.2 Cancel Scanning Session

**Requirements:**
- Verify session belongs to user
- Clear all `assigned_package_labels` from line items
- Return invoice to 'Approved' status
- Clear `fulfillment_accepted_by` and `fulfillment_accepted_at`
- Mark session as 'cancelled'
- Set `cancelled_at` timestamp
- Log cancellation to invoice history
- Broadcast package release for all locked packages

**User Confirmation:**
- Modal: "Cancel scanning? All progress will be lost and order will return to queue."
- Requires explicit confirmation

#### 4.2.3 Auto-Abandon Sessions

**Scheduled Job:**
- Runs every 10 minutes (configurable)
- Finds sessions where `last_activity < NOW() - INTERVAL '30 minutes'`
- Sets session status to 'abandoned'
- Rolls back all progress (same as cancel)
- Logs abandonment reason

**Notification:**
- Admin dashboard shows count of abandoned sessions
- Alert if >10 per day

### 4.3 Real-Time Package Scanning Validation

#### 4.3.1 Validation Layers

**Layer 1: Session Active Check**
- Verify session exists and status is 'active'
- Update `last_activity` timestamp
- Error if session not active

**Layer 2: Package Existence Check**
- Query `activepackages` table for package label
- Verify: `isarchived = false`, `isfinished = false`
- Verify: `synclicense IN ('CUL000063', 'MAN000072')`
- Error: "Package not found in active inventory"

**Layer 3: Batch Membership Check**
- Match package's `batch_name` to line item's batch
- Verify package's `item_name` matches batch's `metrc_item_name`
- Verify package's `first_sourcepackage_label` matches batch
- Error: "Package does not belong to any line item on this order"

**Layer 4: Specific Label Check (Partial Packages)**
- If line item has `specific_package_labels`, verify scanned label is in list
- Error: "Wrong partial package. Expected: [LABEL]"

**Layer 5: Full vs Partial Package Check**
- If line item requires full packages only, verify package is not partial
- Check against `full_package_details` from batch
- Error: "Partial package not allowed - this line item requires full packages"

**Layer 6: Cross-Worker Conflict Check**
- Query other active sessions for this package label
- Check `currently_locked_packages` JSONB array
- Error: "Package currently being used by [Worker Name] for Order [NUMBER]"

**Layer 7: Duplicate Scan Check**
- Check if package already in `assigned_package_labels` for line item
- If duplicate: Return success with `duplicate: true` flag (silent ignore)
- No error, just informational message

**Layer 8: Rejection Alert Check**
- Query `rejected_packages` table for recent rejections
- If found and not verified: Return confirmation required
- Don't reject, just alert user for verification

#### 4.3.2 Successful Scan Actions

**On Success:**
- Add package label to line item's `assigned_package_labels` array
- Add package label to session's `currently_locked_packages` array
- Update session's `last_activity` timestamp
- Log successful scan to invoice history
- Broadcast `package:locked` event via websocket
- Check if line item is complete (scanned_count === quantity_ordered)
- Return success with progress update

**Response Structure:**
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

#### 4.3.3 Rejection Alert Handling

**When Rejection Detected:**
- Return `requiresConfirmation: true` instead of error
- Include alert details:
  - Manifest number
  - Rejection date
  - Rejected by (person/facility)
  - Days since rejection
  - Severity (HIGH if <7 days, MEDIUM if 7-30 days)

**User Actions:**
- Option 1: Verify package is good → Call verify endpoint → Continue scanning
- Option 2: Do not use package → Cancel scan, try different package

**Verify Rejected Package:**
- Update `rejected_packages` table: `verified_by_fulfillment = true`
- Set `verified_at` and `verified_by`
- Log verification to invoice history
- Package can now be scanned normally

### 4.4 Scanning Progress Tracking

#### 4.4.1 Progress Query

**Returns:**
- Per line item:
  - Line item ID, product name, batch name
  - Quantity ordered, scanned count, remaining count
  - Status: 'not_started', 'in_progress', 'complete'
  - List of scanned package labels
- Overall progress:
  - Total packages needed
  - Total packages scanned
  - Percentage complete
  - All complete flag

**Query Performance:**
- Must complete in <200ms
- Use indexes on `assigned_package_labels` (GIN index on JSONB)

#### 4.4.2 UI Display Requirements

**Line Item Progress:**
- Show product name and batch name
- Display scanned count / required count
- Progress bar visualization
- List of scanned package labels (scrollable)
- Status indicator (color-coded)

**Overall Progress:**
- Large counter: "15 / 20 packages scanned"
- Overall progress bar
- Percentage display
- "Complete Scanning" button (enabled only when all complete)

**Specific Package Labels:**
- If line item requires specific partial packages, display warning
- Show list of required labels
- Highlight when correct label scanned

### 4.5 Scanning Session Correction & Admin Tools

#### 4.5.1 Remove Mistakenly Scanned Package

**Requirements:**
- Worker clicks "X" next to scanned package
- Confirmation modal: "Remove this package from the order?"
- On confirm:
  - Remove from `assigned_package_labels` array
  - Remove from `currently_locked_packages` array
  - Broadcast `package:released` event
  - Decrement progress counter
  - Log removal to invoice history

**Restrictions:**
- Only available if invoice not yet manifested
- Cannot remove if manifest created

#### 4.5.2 Edit Scanned Package Label

**Requirements:**
- Worker clicks "Edit" on scanned package
- Modal with current label pre-filled
- Worker enters correct label
- Full validation pipeline runs on new label
- Old label removed, new label added
- Change logged to invoice history

#### 4.5.3 Admin Force-Complete Session

**Requirements:**
- Admin with `fulfillment_admin` role
- Dashboard shows "Active Scanning Sessions" table
- Admin selects session, clicks "Force Complete"
- Mandatory reason field required
- On confirm:
  - Session status set to 'completed'
  - All packages released
  - Websocket broadcasts sent
  - Action logged with reason

#### 4.5.4 Admin View All Active Sessions

**Dashboard Table Columns:**
- Invoice number
- Assigned worker name
- Session duration (time elapsed)
- Packages scanned / Total needed
- Last activity timestamp

**Filter Options:**
- Filter by worker
- Filter by duration (>30min, >1hr, >2hr)

**Sort Options:**
- Sort by last activity
- Sort by duration
- Sort by invoice number

#### 4.5.5 Admin Manually Adjust Session Data

**Requirements:**
- Admin with `fulfillment_admin` role
- JSON editor for `currently_locked_packages`
- Validation warns if invalid format
- Mandatory reason field
- Warning modal: "This bypasses normal validation. Use with caution."
- On save:
  - Session updated in database
  - Change logged with full details
  - Websocket broadcasts update

---

## 5. Fulfillment Issue Reporting

### 5.1 Issue Types

**Predefined Issue Types:**
- `batch_unavailable` - Can't find batch physically
- `package_damaged` - Found but damaged
- `package_quantity_mismatch` - Physical quantity doesn't match METRC
- `package_missing_from_metrc` - Not in active inventory anymore
- `global_issue` - Sales requested return to modify order
- `other` - Other issues

### 5.2 Fulfillment Issue Reporting (Line Item Level)

#### 5.2.1 Report Issue Functionality

**Requirements:**
- Each line item has "Report Issue" button
- Modal form with:
  - Issue type (dropdown)
  - Description (textarea, required)
  - Photo upload (optional)
  - Affected line item ID (auto-filled)
- Verify invoice is in 'Fulfillment_Accepted' or 'Approved' status
- Verify user is assigned to invoice
- Format issue note with type, line item, batch, description

**On Submission:**
- Transition invoice status: 'Fulfillment_Accepted' → 'Fulfillment_Issue'
- Set `fulfillment_issue_reported_at` timestamp
- Set `fulfillment_issue_note` with formatted report
- Clear any active scanning session (set to 'cancelled')
- Clear all `assigned_package_labels` (rollback scanning progress)
- Log each issue to invoice history
- Notify assigned sales rep

**Error Cases:**
- Invoice not found → Error
- Status not correct → Error
- User not assigned → Error
- Missing description → Validation error

#### 5.2.2 Issue Report Format

**Format Example:**
```
[batch_unavailable] Line Item 123 Batch: BATCH-001 - Cannot locate batch in warehouse
[package_damaged] Line Item 124 Batch: BATCH-002 - Package label torn, contents exposed
```

**Multiple Issues:**
- Each issue on separate line
- All issues combined in `fulfillment_issue_note` field

### 5.3 Global Issue Request (Sales → Fulfillment)

#### 5.3.1 Sales Request Trigger

**Requirements:**
- Sales rep can request global issue via invoice actions menu
- Button: "Request Fulfillment Review"
- Only available when invoice status is 'Fulfillment_Accepted' or 'Fulfillment_Issue'
- Requires assigned sales rep permission

**On Request:**
- Set `global_issue_requested_by` to sales user ID
- Set `global_issue_requested_at` timestamp
- Log request to invoice history with reason
- Send persistent notification to fulfillment worker

#### 5.3.2 Fulfillment Acknowledgment

**Requirements:**
- Persistent notification appears in fulfillment worker's UI
- Notification doesn't auto-dismiss
- Content: "Sales requested review for Invoice [NUMBER] - [REASON]"
- Worker clicks "Acknowledge" button
- System calls `reportIssue` with global_issue type
- Clears `global_issue_requested_by` and `global_issue_requested_at`
- Logs acknowledgment to invoice history

### 5.4 Sales Invoice Modification (After Issue)

#### 5.4.1 Access Control

**Requirements:**
- Sales rep can modify invoice when status = 'Fulfillment_Issue'
- Cannot modify when status = 'Manifested' or later (hard stop)
- API validates invoice status before allowing changes
- Only assigned sales rep can modify (or sales_admin for any invoice)

#### 5.4.2 Allowed Modifications

**Line Item Changes:**
- Change quantity on existing line item
- Remove line item completely
- Add new line item
- Change batch selection (switch to different batch for same product)

**Allocation Impact:**
- Reducing quantity: Releases allocations properly
- Increasing quantity: Allocates more (if available)
- Adding line item: Allocates from batches with status = 'Sellable'
- Allocation failures reported clearly

#### 5.4.3 Modification Tracking

**Requirements:**
- All modifications logged to `ORDERS-invoice-line-items-history`
- `was_modified = TRUE` set on modified line items
- Original values preserved
- `modification_reason` required field
- `fulfillment_issue_modification = TRUE` flag set

#### 5.4.4 Re-Entry to Fulfillment

**Requirements:**
- After modifications saved, sales can click "Resolve Issue"
- Invoice status transitions: 'Fulfillment_Issue' → 'Approved'
- Invoice re-enters fulfillment queue
- Original fulfillment worker assignment cleared
- Available to any worker

### 5.5 Post-Manifest Modification Protection

**Hard Stop:**
- Any attempt to modify invoice after `manifest_created_at` is set = REJECTED
- API returns 403 error: "Cannot modify invoice after manifest created"
- UI disables all modification buttons

**Void-Then-Modify Flow:**
- If changes needed after manifest, must void first
- Voiding transitions to 'Fulfillment_Issue'
- Then modifications allowed
- Then re-manifest required

### 5.6 Issue Report Management & Updates

#### 5.6.1 Update Issue Details

**Requirements:**
- Fulfillment worker can edit issue if invoice status = 'Fulfillment_Issue'
- "Edit Issue" button available
- Can update issue type (dropdown)
- Can update description (textarea)
- Can add additional photos
- Cannot change which line items affected
- Update logged to invoice history with old_value and new_value
- Sales rep receives notification: "Issue details updated"

#### 5.6.2 Add Notes to Existing Issue

**Requirements:**
- "Add Note" button on issue detail page
- Modal with textarea for note
- Note includes automatic timestamp and user name
- Format: `[2025-10-16 14:30 - John Doe]: "Additional context here"`
- Note appends to `fulfillment_issue_note` field
- Notes display chronologically in UI
- Each note addition logged to invoice history

#### 5.6.3 Cancel/Delete Issue Report

**Requirements:**
- "Cancel Issue Report" button available to fulfillment worker
- Confirmation modal: "This will return order to Fulfillment_Accepted. Continue?"
- On confirm:
  - Invoice status: 'Fulfillment_Issue' → 'Fulfillment_Accepted'
  - `fulfillment_issue_note` cleared (set to NULL)
  - `fulfillment_issue_reported_at` cleared (set to NULL)
  - Cancellation logged to invoice history with reason
  - Sales rep notification: "Issue cancelled by fulfillment"
- Worker can resume scanning immediately

#### 5.6.4 Bulk Issue Management (Admin)

**Dashboard Table:**
- Columns: Invoice number, Customer name, Issue type, Reported date, Assigned sales rep
- Filter options: Issue type, Date range, Sales rep, Product
- Bulk action checkboxes
- "Select All" checkbox at top

**Bulk Actions:**
- Assign to sales rep (dropdown selector)
- Mark as resolved (sets status to Approved)
- Export to CSV (downloads selected issues)

**Sort Options:**
- Sort by: Date, Customer, Issue type

**Pagination:**
- Supports >50 issues with pagination

#### 5.6.5 Issue Resolution Tracking

**Requirements:**
- When sales clicks "Resolve Issue":
  - System records `resolved_at` timestamp
  - System records `resolved_by` user ID
  - System captures `resolution_actions` (JSON):
    - Which line items modified
    - Which batches changed
    - Which products removed
- Resolution data stored in invoice record
- Available in reporting:
  - Average time to resolve by issue type
  - Resolution rate by sales rep
  - Most common issue types

---

## 6. Transportation Details Entry

### 6.1 Transportation Form Data Collection

#### 6.1.1 Form Fields

**Required Fields:**
- Driver Name (text, max 100 chars)
- Driver License Number (text, required)
- Driver Occupational License (optional, text)
- Vehicle Make (text, required)
- Vehicle Model (text, required)
- Vehicle License Plate (text, required, format validation)
- Estimated Departure Time (datetime picker, required)
- Estimated Arrival Time (datetime picker, required)
- Transporter Name (text, required - for METRC lookup)

**Optional Fields:**
- Phone Number for Questions (text)

#### 6.1.2 Validation Rules

**Time Validation:**
- Arrival time must be AFTER departure time
- Departure time cannot be in the past (or allow with warning)
- Both times required

**License Plate Validation:**
- State-specific format validation (if applicable)
- Alphanumeric, max 10 characters

**Driver License Validation:**
- Format validation (state-specific if applicable)

**All Fields Required:**
- Cannot submit with empty required fields
- Clear error messages for missing fields

### 6.2 METRC Recipient & Transporter Lookup

#### 6.2.1 Recipient Lookup

**Requirements:**
- Use invoice's `fk_location_id` to get `license_number`
- API call: `GET /transfers/create/destinations` with our license
- Find facility matching destination license number
- Extract `recipientId` from response
- Cache recipient IDs (24hr TTL) to reduce API calls

**Error Handling:**
- If recipient not found: Error "Destination facility not found in METRC"
- Cannot proceed to manifest creation without valid recipientId

#### 6.2.2 Transporter Lookup

**Requirements:**
- Look up transporter by name or license number
- API call: `GET /transfers/create/transporters` with our license
- Find transporter matching name or license
- Extract `transporterId` from response
- User selects from dropdown of available transporters

**Error Handling:**
- If transporter not found: Error "Transporter not registered in METRC"
- Cannot proceed to manifest creation without valid transporterId

#### 6.2.3 Get Available Transporters

**Requirements:**
- Endpoint returns list of available transporters for UI dropdown
- Format: `[{id, name, licenseNumber}, ...]`
- Cached for 24 hours
- Refresh on demand if needed

### 6.3 Transportation Details Storage

#### 6.3.1 JSONB Structure

**Stored in `transportation_details` field:**
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
  "phoneNumber": "555-0123",
  "destinationLicense": "DISP000123",
  "capturedAt": "2025-10-16T07:30:00Z",
  "capturedBy": 789
}
```

#### 6.3.2 Capture Transportation Details

**Requirements:**
- Verify invoice is ready (status = 'Fulfillment_Accepted')
- Verify user is assigned to invoice
- Verify scanning is complete (all packages scanned)
- Validate all transportation data
- Get recipientId from METRC API
- Get transporterId from METRC API
- Construct full transportation details object
- Store in `transportation_details` JSONB field
- Log to invoice history

**Error Cases:**
- Invoice not found → Error
- Status not correct → Error
- Scanning not complete → Error: "Cannot proceed - package scanning not complete"
- Missing required fields → Validation errors
- Invalid times → Validation error
- METRC lookup failures → Error with details

### 6.4 Transportation Details Management

#### 6.4.1 Clear Transportation Details

**Requirements:**
- "Clear Transport Details" button visible before manifest created
- Confirmation modal: "This will delete all entered transportation information. Continue?"
- On confirm:
  - `transportation_details` field set to NULL
  - Form fields clear/reset
  - No history entry (not yet manifested)
- Worker can re-enter from scratch
- Button disabled after manifest created

#### 6.4.2 Edit Transportation Details

**Requirements:**
- "Edit Transport Details" button available if details entered but not manifested
- Form opens pre-populated with existing data from JSONB
- All fields editable
- Changes save to `transportation_details` JSONB
- No history tracking (not manifested yet)
- Validation re-runs on save

#### 6.4.3 View Transportation Details History

**Requirements:**
- After manifest created, "View Transport Details" shows read-only display
- Display shows all fields from original JSONB
- If manifest was updated, display shows comparison:
  - "Original Details" section
  - "Updated Details" section
  - Highlight changed fields
  - Show update date and user who updated
- Print-friendly view available

#### 6.4.4 Auto-Clear on Status Change

**Requirements:**
- When invoice transitions to 'Fulfillment_Issue':
  - System checks if `manifest_created_at` is NULL
  - If NULL, `transportation_details` automatically cleared
  - Prevents using stale transport details if order re-scanned later
  - Action logged to invoice history
- If manifest already created, `transportation_details` preserved

---

## 7. METRC Manifest Creation

### 7.1 Manifest Creation Architecture

The manifest creation process is the most critical operation in Module 5. It bridges our internal system with METRC's compliance tracking and must be executed with absolute precision.

#### 7.1.1 Two-Phase Validation Approach

**Phase 1: Dry Run Validation**
- Submit with `submit=false` to validate payload structure and business rules
- Catch validation errors before creating real manifest
- METRC does not allow manifest deletion after creation, only voiding
- Invalid submissions can trigger compliance alerts

**Phase 2: Actual Submission**
- If validation passes, submit with `submit=true` to create the manifest in METRC
- This two-phase approach is non-negotiable

#### 7.1.2 Multi-License Manifest Support

**Critical Requirement:**
- Orders may contain packages from BOTH cultivation (CUL000063) and manufacturing (MAN000072) licenses
- METRC requires separate manifests per shipper license
- A single invoice may require multiple manifests

**Database Schema:**
- Use JSONB arrays for `metrc_manifest_numbers` and `manifest_metrc_ids`
- Each license gets its own transaction to prevent partial failure corruption

### 7.2 Manifest Creation Process

#### 7.2.1 Pre-Creation Validation

**Requirements:**
- Verify invoice status is 'Fulfillment_Accepted'
- Verify user is assigned to invoice
- Verify transportation details are entered
- Verify scanning is complete (all packages scanned)
- **CRITICAL: Final validation - all packages still exist in METRC**

**Final Package Validation:**
- Query METRC API directly (not local table) to avoid stale sync data
- Check all scanned packages exist in active inventory
- Query in batches of 50 packages
- Check both CUL and MAN licenses
- If any package missing:
  - Transition invoice to 'Fulfillment_Issue'
  - Clear affected `assigned_package_labels`
  - Log issue with missing package list
  - Throw error: "Packages missing from METRC active inventory"

**Timeout Handling:**
- If METRC validation timeout, fall back to local table check
- Log warning about timeout
- Continue with local validation

#### 7.2.2 Group Packages by License

**Requirements:**
- Query all line items with assigned packages
- Join with `activepackages` table to get `synclicense` for each package
- Group packages by license
- Count packages per license
- Build line items array per license

**Query Structure:**
```sql
SELECT 
  ap.synclicense,
  COUNT(*) as package_count,
  json_agg(json_build_object(
    'label', li.assigned_package_labels,
    'line_item_id', li.id,
    'batch_id', li.fk_batch_id,
    'quantity', li.quantity_ordered,
    'unit_price', li.unit_price,
    'line_total', li.line_total
  )) as line_items
FROM "ORDERS-invoice-line-items" li
JOIN "ORDERS-batches" b ON li.fk_batch_id = b.id
JOIN activepackages ap ON b.batch_name = ap.batch_name
WHERE li.fk_invoice_id = $1
  AND ap.label = ANY(
    SELECT jsonb_array_elements_text(li.assigned_package_labels)
  )
GROUP BY ap.synclicense
```

#### 7.2.3 Create Manifest(s) - One Per License

**Critical: Each License Gets Its Own Transaction**

**For Each License Group:**
1. Use separate database connection and transaction
2. Build manifest payload for this license
3. **PHASE 1: DRY RUN**
   - Call METRC API with `submit=false`
   - Validate response is 200 OK
   - If fails, throw error with METRC error message
4. **PHASE 2: ACTUAL SUBMISSION**
   - Call METRC API with `submit=true`
   - Handle timeout errors (critical - may have partial state)
   - Wait 2 seconds for METRC to process
   - Query for newly created manifest number
5. **Save to Database IMMEDIATELY**
   - Update `metrc_manifest_numbers` array
   - Update `manifest_metrc_ids` array
   - Record packages in `ORDERS-manifest-packages` table
   - Commit transaction
6. **Continue to Next License**

**Timeout During Submission:**
- If timeout occurs after other manifests succeeded:
  - Update invoice to 'Partially_Manifested' status
  - Set `fulfillment_issue_note` with details
  - Alert admin team (email, Slack, PagerDuty)
  - Throw error: "Manifest may or may not have been created - manual verification required"

**Partial Manifest Failure:**
- If ANY license fails after first succeeded:
  - Update invoice to 'Partially_Manifested' status
  - Log partial failure to invoice history
  - Alert admin team with succeeded/failed lists
  - Throw error: "Partial manifest creation - manual intervention required"

#### 7.2.4 Build Manifest Payload for License

**Payload Structure:**
```json
[{
  "destinations": [{
    "recipientId": 67890,
    "plannedRoute": "Delivery to DISP000123",
    "transferTypeId": 1,
    "invoiceNumber": "INV-2025-00123",
    "estimatedDepartureDateTime": "2025-10-16T08:00:00Z",
    "estimatedArrivalDateTime": "2025-10-16T14:00:00Z",
    "grossWeight": 1500.50,
    "grossUnitOfWeightId": 1,
    "transporters": [{
      "transporterId": 12345,
      "phoneNumberForQuestions": "555-0123",
      "transporterDetails": [{
        "driverName": "John Doe",
        "driverOccupationalLicenseNumber": "OCC12345",
        "driverLicenseNumber": "D1234567",
        "driverLayoverLeg": "",
        "vehicleMake": "Ford",
        "vehicleModel": "Transit",
        "vehicleLicensePlateNumber": "ABC123"
      }]
    }],
    "packages": [
      {
        "id": 123456,
        "wholesalePrice": 35.00,
        "grossWeight": 3.5,
        "grossUnitOfWeightId": 1
      }
    ]
  }]
}]
```

**Package Array Construction:**
- For each package label in line item:
  - Get package data from `activepackages` (filtered by license)
  - Calculate gross weight (see 7.3)
  - Calculate price per package: `line_total / package_count`
  - Add to packages array

**Gross Weight Calculation:**
- Weight-based items: `quantity × unit_weight_grams`
- Unit-based items: Use default weights (Edible = 50g, Vape = 30g, Concentrate = 10g)
- Sum all package weights for total gross weight

**Transfer Type ID:**
- Look up "Unaffiliated Transfer" transfer type ID
- Cache for 24 hours

**Gross Unit of Weight ID:**
- Look up "Grams" unit ID
- Cache for 24 hours

#### 7.2.5 Record Manifest Packages

**Requirements:**
- For each package in manifest:
  - Insert record into `ORDERS-manifest-packages` table
  - Include: invoice_id, manifest_number, package_label, package_metrc_id, batch_id, line_item_id, quantity, wholesale_price, gross_weight, synclicense
  - Set `package_status = 'manifested'`

**Critical:**
- Must record packages IMMEDIATELY after manifest created
- Before processing next license
- Ensures audit trail completeness

#### 7.2.6 Final Status Update

**After All Manifests Created Successfully:**
- Update invoice status: 'Fulfillment_Accepted' → 'Manifested'
- Set `manifest_created_at = NOW()`
- Set `quantity_fulfilled = quantity_ordered` on all line items
- Complete scanning session (set status to 'completed')
- Log manifest creation to invoice history
- Return success with manifest numbers

**Response Structure:**
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

### 7.3 Gross Weight Calculation

#### 7.3.1 Weight-Based Items

**Calculation:**
- Look up `item_unit_weight_grams` from METRC items table
- Gross weight = `quantity × unit_weight_grams`
- Example: 3.5 grams of flower → 3.5g gross weight

#### 7.3.2 Unit-Based Items

**Default Weights by Category:**
- Edible: 50g per unit
- Vape: 30g per unit
- Concentrate: 10g per unit
- Other: Use product-specific weight if available

**Calculation:**
- Gross weight = `unit_count × default_weight`

#### 7.3.3 Total Gross Weight

**Requirements:**
- Sum all package gross weights for entire manifest
- Store in manifest payload
- Verify total weight makes sense (not 0, not absurdly high)
- Round to 2 decimal places

### 7.4 Price Per Package Calculation

#### 7.4.1 Calculation Logic

**For Each Line Item:**
- `price_per_package = line_total / package_count`
- Example: Line total = $350, 10 packages → $35.00 per package
- Round to 2 decimal places

#### 7.4.2 Discount Allocation

**Requirements:**
- Line total already includes discounts (from Module 4)
- Price per package reflects discounted price
- METRC manifest shows discounted price (not original)

#### 7.4.3 Zero-Price Handling

**Requirements:**
- If line item is $0 (e.g., free sample), handle gracefully
- METRC may require minimum price (check API docs)
- If required, use $0.01 per package minimum

### 7.5 Manifest Preview (Before Submission)

#### 7.5.1 Preview Generation

**Requirements:**
- Generate preview showing exactly what will be submitted to METRC
- Show destination, transportation details, package list
- Display total count, total weight, total value
- Show breakdown by license (if multi-license order)

**Preview Structure:**
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
    "departure": "2025-10-16T08:00:00Z",
    "arrival": "2025-10-16T14:00:00Z"
  },
  "warning": "This order contains packages from multiple licenses and will require multiple METRC manifests."
}
```

### 7.6 Manifest Submission Failure Recovery

#### 7.6.1 Network Failure

**Requirements:**
- If API call times out or network error:
  - Show error: "Failed to connect to METRC. Please try again."
  - Do NOT update database (no partial state)
  - Allow retry

#### 7.6.2 METRC API Error

**Requirements:**
- If METRC returns 400 error after dry run succeeded (rare):
  - Display METRC error message
  - Log error to system logs
  - Allow admin to investigate and retry

#### 7.6.3 Transaction Rollback

**Requirements:**
- If database update fails after METRC submission:
  - Alert admin: "Manifest created in METRC but DB update failed"
  - Manual reconciliation required (critical edge case)
  - Provide recovery script to sync METRC manifest to database

### 7.7 METRC API Configuration

#### 7.7.1 Timeout Settings

**Configuration:**
- `METRC_API_TIMEOUT = 30000` (30 seconds)
- `METRC_API_MAX_RETRIES = 2`
- Validation calls: 15 second timeout

#### 7.7.2 Retry Logic

**Requirements:**
- Exponential backoff for failed API calls (1s, 2s, 4s, 8s)
- Max 3 retries before reporting failure to user
- Rate limit errors (429) wait and retry after delay

#### 7.7.3 Caching Strategy

**Cache METRC Lookup Values:**
- Unit IDs (24hr TTL)
- Transfer type IDs (24hr TTL)
- Gross unit of weight IDs (24hr TTL)
- Recipient IDs (24hr TTL)
- Transporter IDs (24hr TTL)

**Cache Invalidation:**
- On demand if data changes
- Manual refresh option in admin UI

---

*[Part 4 Complete - Continue with Part 5: Manifest Voiding & Status Tracking]*

