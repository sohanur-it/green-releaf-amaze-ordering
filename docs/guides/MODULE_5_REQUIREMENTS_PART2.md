# Module 5: Order Fulfillment & Manifesting - Detailed Requirements (Part 2)

*[This is a continuation of MODULE_5_REQUIREMENTS.md]*

## 8. Manifest Voiding & Updates

### 8.1 Voiding Manifest (Pre-Shipment)

#### 8.1.1 Void Initiation

**Requirements:**
- "Void Manifest" button available when status = 'Manifested' or 'Shipped'
- Button protected by permissions (only admins or fulfillment managers)
- Clicking opens void modal

**Void Form:**
- Reason dropdown with predefined options:
  - "Incorrect Information"
  - "Customer Requested Cancellation"
  - "Fulfillment Error"
  - "Other"
- Detailed reason textarea (required, min 20 characters)
- Confirmation checkbox: "I understand this will void the manifest in METRC"
- Target manifest selection (if multi-license):
  - Dropdown: "Void all manifests" or select specific license/manifest number

#### 8.1.2 Void Dry Run

**Requirements:**
- Call METRC void endpoint with `dryRun=true`
- Use `manifest_metrc_id` from invoice
- Validation checks if manifest can be voided

**Reasons Void Might Fail:**
- Manifest already delivered
- Manifest already voided
- Transfer in transit (may not be voidable depending on METRC rules)

**Error Display:**
- If dry run fails, show error message
- Explain why void cannot proceed
- Do not allow actual void

#### 8.1.3 Actual Void Submission

**Multi-License Support:**
- Can void one specific manifest OR all manifests
- If voiding specific: Find manifest by number or license
- If voiding all: Process each manifest sequentially

**For Each Manifest to Void:**
1. **PHASE 1: DRY RUN**
   - Call METRC void endpoint with `submit=false`
   - Validate response is 200 OK
2. **PHASE 2: ACTUAL VOID**
   - Call METRC void endpoint with `submit=true`
   - Handle errors gracefully
   - Track succeeded vs failed voids

**Database Updates:**
- Remove voided manifest numbers from `metrc_manifest_numbers` array
- Remove voided manifest IDs from `manifest_metrc_ids` array
- Set `voided_manifest_number` (comma-separated list if multiple)
- Set `voided_manifest_reason`
- Set `voided_at` and `voided_by`

**Status Transition:**
- If ALL manifests voided: 'Manifested' → 'Fulfillment_Issue'
- If PARTIAL void: 'Manifested' → 'Partially_Voided'
- Clear `assigned_package_labels` if all voided (allow re-scanning)
- Set `fulfillment_issue_reported_at` and note if all voided

**Package Status Updates:**
- Update `ORDERS-manifest-packages` records:
  - Set `package_status = 'voided'`
  - Set `voided_at` and `voided_by`
  - OR delete records (based on configuration setting)

**Allocation Release:**
- If ALL manifests voided:
  - Release all line item allocations
  - Decrement `allocated_quantity` for each batch
  - Log to batch history
  - Websocket broadcasts for batch updates

**History Logging:**
- Log void to invoice history with:
  - Old manifest numbers
  - New manifest numbers (remaining)
  - Void reason
  - Which manifests voided (license + number)
  - Failed voids (if any)

**Alert if Partial Void:**
- Send alert to admin team
- Details: Which manifests voided, which remain active
- Requires manual intervention

#### 8.1.4 Post-Void Workflow

**Sales Modification Window:**
- Invoice status = 'Fulfillment_Issue' (if all voided)
- Sales rep can modify invoice
- Allowed modifications:
  - Add/remove line items
  - Change quantities
  - Change batch selection
- Modification allocation behavior:
  - Adding line item: Allocates from batches
  - Increasing quantity: Allocates additional units
  - Decreasing quantity: Releases units (if any allocated)
  - Removing line item: Releases allocations

**Re-Allocation During Scanning:**
- BEFORE any package can be scanned, ALL line items must be re-allocated
- System queries line items with `quantity_allocated = 0`
- For each line item: Call `allocateFromBatch()`
- If allocation fails: Show error, halt scanning
- If all succeed: Enable scanning UI

**Re-Allocation Failure Handling:**
- If insufficient inventory:
  - Show specific error: "Cannot allocate [QTY] from [BATCH], only [AVAILABLE] available"
  - Scanning UI disabled
  - Notify sales rep: "Invoice cannot be re-scanned - inventory shortage"
  - Invoice remains in 'Fulfillment_Issue' status
  - Sales must modify invoice before fulfillment can proceed

**Re-Scanning Requirements:**
- Must scan ALL packages from scratch
- Previous scan data completely cleared
- Can use SAME packages OR DIFFERENT packages from same batch
- Full validation applied to every scan
- All packages must be scanned before manifest can be created

**Re-Manifesting Process:**
- All line items re-allocated successfully
- All packages scanned and validated
- Transportation details entered
- Dry run first, then actual submission
- METRC generates NEW manifest number
- Database updated with new manifest info
- Old voided manifest info preserved for audit

### 8.2 Updating Manifest (Post Creation)

#### 8.2.1 Allowed Updates

**Driver Information:**
- Can update driver name
- Can update driver license number
- UI shows current driver info and allows editing

**Vehicle Information:**
- Can update vehicle make, model, license plate
- UI shows current vehicle info and allows editing

**Estimated Times:**
- Can update estimated departure time
- Can update estimated arrival time
- Validation: arrival still after departure

#### 8.2.2 Disallowed Updates

**Package List:**
- Cannot add packages to existing manifest
- Cannot remove packages from existing manifest
- UI makes this clear (packages section read-only)

**Destination:**
- Cannot change recipient facility
- Destination license number read-only
- If change needed, must void and re-manifest

**Prices:**
- Cannot change package prices after manifesting
- Price per package read-only

#### 8.2.3 Update Process

**API Call:**
- `PUT /transfers/v2/external/incoming/{manifest_metrc_id}`
- Payload includes only updated fields
- METRC validates changes

**Database Update:**
- Update invoice's `transportation_details` JSONB
- Merge updates with current details
- Log update to invoice history:
  - `modification_type = 'manifest_updated'`
  - `field_changed = 'transportation_details'`
  - `old_value` and `new_value` in JSON

**Notification:**
- Success message: "Manifest updated successfully"
- If manifest already in transit, show warning: "Update may not be reflected in METRC until delivery"

**Dry Run:**
- Must perform dry run before actual update
- Same two-phase approach as creation

---

## 9. Post-Manifest Status Tracking

### 9.1 Automated Status Detection via Sync

The manifest lifecycle (In Transit → Delivered → Rejected) is tracked through Module 2's sync services. Module 5 responds to status changes detected by these syncs.

#### 9.1.1 METRC Transfer Sync Job

**Scheduled Job:**
- Cron job runs every 15 minutes (configurable)
- Queries all invoices with status IN ('Manifested', 'Shipped')
- For each invoice, fetches current transfer status from METRC

**API Call:**
- `GET /transfers/v2/external/incoming/{manifest_metrc_id}`
- Returns transfer details including:
  - Status (e.g., "InTransit", "Delivered", "Rejected")
  - Actual delivery time
  - Package details (delivered, rejected)

**Multi-License Handling:**
- Check status for each manifest in `manifest_metrc_ids` array
- All manifests must be delivered before invoice status changes

### 9.2 Delivered Status Detection

#### 9.2.1 METRC Status Check

**Requirements:**
- If METRC transfer status = "Delivered"
- If transfer's `ActualDeliveryDate` is set
- Check all manifests are delivered (if multi-license)

#### 9.2.2 Database Update

**Invoice Status:**
- Transition: 'Shipped' → 'Delivered'
- Set `delivered_at = [METRC ActualDeliveryDate]`
- Set `status_updated_at = NOW()`

**Package Status:**
- For each package in `ORDERS-manifest-packages`:
  - Set `package_status = 'delivered'`

**Inventory Finalization:**
- Call `finalizeInventoryDeductions()` function
- For each package delivered:
  - Find associated batch
  - Decrement batch's `quantity` by units delivered
  - Decrement batch's `allocated_quantity` by units delivered
  - Log to `ORDERS-batch-history`:
    - `change_type = 'package_delivered'`
    - `package_label = [label]`
    - Details include invoice number, delivery date

**Critical: Finalization Flag**
- Set `inventory_finalized = TRUE` on invoice
- Prevents double-deduction on crash
- Check flag FIRST before any deductions
- If already finalized, skip (idempotent)

**Full vs Partial Package Handling:**
- If line item uses specific partial packages:
  - Only decrement `allocated_quantity` (NOT `quantity`)
  - Batch `quantity` only tracks full packages
- If line item uses full packages:
  - Decrement BOTH `quantity` and `allocated_quantity`

**Auto-Promotion Trigger:**
- After inventory finalized, check if batch is now depleted
- If `quantity - allocated_quantity = 0`, trigger auto-promotion
- Promote next "On Deck" batch to "Sellable"
- Broadcast to sales reps and external portal

### 9.3 In Transit Status

#### 9.3.1 METRC Status Check

**Requirements:**
- If METRC transfer status = "InTransit"

#### 9.3.2 Database Update

**Invoice Status:**
- Transition: 'Manifested' → 'Shipped'
- Set `shipped_at = [METRC DepartureDateTime]`
- Set `estimated_delivery = [METRC EstimatedArrivalDateTime]`

**Customer Notification:**
- Send shipment notification to customer (if external order)
- Email includes:
  - Invoice number
  - Estimated delivery
  - Tracking details (if available)

### 9.4 Rejection Detection

#### 9.4.1 METRC Package Comparison

**Requirements:**
- Compare packages sent vs packages received
- If `PackagesSent > PackagesReceived`, some packages rejected

#### 9.4.2 Partial Rejection

**Invoice Status:**
- Transition: 'Delivered' → 'Partially_Rejected'

**Package Tracking:**
- For each rejected package:
  - Insert record into `ORDERS-rejected_packages` table
  - Fields: invoice_id, package_label, package_metrc_id, batch_id, rejection_reason (from METRC if available)
  - Set `detected_at = NOW()`
- Update `ORDERS-manifest-packages`:
  - Set `package_status = 'rejected'` for rejected packages

#### 9.4.3 Full Rejection

**Invoice Status:**
- If all packages rejected, status = 'Fully_Rejected'
- All packages inserted into rejected packages table

#### 9.4.4 Inventory Recovery

**Requirements:**
- Rejected packages should return to inventory
- Verify packages back in METRC `activepackages`
- Increment batch `quantity` for returned packages
- Decrement batch `allocated_quantity`
- Log to batch history: `change_type = 'package_returned'`

**Admin Notification:**
- Alert admin of rejection
- Email/Slack: "Invoice [NUMBER] has rejected packages - review needed"
- Admin must verify inventory return manually

### 9.5 Sync Job Error Handling

#### 9.5.1 API Failures

**Requirements:**
- If METRC API unavailable, log error and retry next cycle
- Do NOT mark invoices as failed
- Alert admin if failures persist (3+ cycles)

#### 9.5.2 Data Inconsistencies

**Requirements:**
- If METRC shows status not in our system, log for investigation
- Manual reconciliation may be needed
- Admin dashboard shows "sync issues" count

---

## 10. Cancelled Shipments & Returns

### 10.1 Cancellation Triggers

#### 10.1.1 Customer Cancellation

**Requirements:**
- Customer requests cancellation after shipment
- Sales rep initiates "Cancel After Ship" action
- Confirmation required: "This will trigger inventory recovery process"

#### 10.1.2 Driver Incident

**Requirements:**
- Driver reports accident, theft, or other incident
- Admin initiates "Driver Incident" action
- Incident type and details recorded

#### 10.1.3 Other Incidents

**Requirements:**
- Any scenario requiring shipment cancellation post-manifest

### 10.2 Cancellation Database Updates

#### 10.2.1 Invoice Status

**Requirements:**
- Status transitions: 'Shipped' → 'Cancelled_After_Ship'
- Cannot transition from 'Delivered' (must be before delivery confirmation)

#### 10.2.2 Package Tracking Creation

**Requirements:**
- For EVERY package on the manifest, insert into `ORDERS-cancelled-shipment-packages`:
  - `fk_invoice_id`
  - `package_label`
  - `package_metrc_id`
  - `batch_id`
  - `was_on_manifest = TRUE`
  - `returned_to_inventory = FALSE` (initially)
  - `verified_in_metrc = FALSE` (initially)
  - `cancellation_reason = [reason text]`
  - `incident_type = [customer_cancel | driver_accident | other]`

**Expected Package Count:**
- Count of packages in `cancelled-shipment-packages` = count in `manifest-packages`
- Invoice's `packages_returned_count` initially = 0
- Invoice's `packages_missing_count` initially = 0

### 10.3 Package Return Verification

#### 10.3.1 METRC Verification

**Requirements:**
- Admin or automated job checks METRC `activepackages` table
- For each package in `cancelled-shipment-packages`:
  - Query: `SELECT * FROM activepackages WHERE label = ? AND isarchived = FALSE AND isfinished = FALSE`
  - If found: package is verified as returned

#### 10.3.2 Verification Update

**Requirements:**
- When package found in `activepackages`:
  - Set `verified_in_metrc = TRUE`
  - Set `returned_to_inventory = TRUE`
  - Set `verified_at = NOW()`
  - Set `verified_by = [admin_user_id]`
  - Increment invoice's `packages_returned_count`

#### 10.3.3 Inventory Restoration

**Requirements:**
- When package verified:
  - Find associated batch
  - Increment batch's `quantity` (package is back in sellable inventory)
  - Log to batch history: `change_type = 'package_returned_cancelled_shipment'`

### 10.4 Missing Package Handling

#### 10.4.1 Missing Detection

**Requirements:**
- After reasonable time (e.g., 7 days), if package still not verified
- Admin marks package as missing

#### 10.4.2 Missing Update

**Requirements:**
- Set `returned_to_inventory = FALSE`
- Set `verified_in_metrc = FALSE`
- Add admin notes explaining why missing
- Increment invoice's `packages_missing_count`

#### 10.4.3 Allocation Release with Missing Packages

**Requirements:**
- System allows releasing allocations only when ALL packages accounted for:
  - `returned_to_inventory = TRUE`, OR
  - Admin confirms package permanently lost
- If any package status unknown, allocation release blocked

### 10.5 Allocation Release Process

#### 10.5.1 Conditions

**Requirements:**
- All packages either `verified_in_metrc = TRUE` OR admin-approved as destroyed
- No packages with `allocation_released = FALSE` remaining

#### 10.5.2 Release Action

**Requirements:**
- For each package:
  - Decrement batch's `allocated_quantity`
  - Set package's `allocation_released = TRUE`
  - Set `allocation_released_at = NOW()`
  - Set `allocation_released_by = [admin_user_id]`

#### 10.5.3 Inventory Loss Accounting

**Requirements:**
- If packages confirmed destroyed/lost:
  - Decrement batch's `quantity` (permanent loss)
  - Log to batch history: `change_type = 'package_destroyed'`
  - Notify accounting team via email/Slack

#### 10.5.4 Invoice Finalization

**Requirements:**
- After all packages accounted for and allocations released:
  - Invoice status transitions: 'Cancelled_After_Ship' → 'Cancelled'
  - Invoice is now in terminal state

### 10.6 Destroyed Package Finalization

#### 10.6.1 Admin API: Finalize Destroyed Packages

**Requirements:**
- Admin marks packages as permanently destroyed
- Releases allocations and adjusts batch quantities
- **CRITICAL: Checks if inventory already finalized to prevent double-deduction**

**Function: `finalizeDestroyedPackages(invoiceId, destroyedPackages, adminUserId)`**

**Pre-Checks:**
- Verify admin permission: `admin:finalize_destroyed_packages`
- Get invoice details and check `inventory_finalized` flag
- Verify invoice status is 'Cancelled_After_Ship'

**Processing:**
- For each destroyed package:
  - Verify package was on this invoice's manifest
  - Mark as confirmed destroyed
  - Accumulate quantity changes per batch

**Batch Quantity Updates:**
- **If inventory already finalized:**
  - No quantity adjustments needed (already decremented at delivery)
  - Only log destruction for audit purposes
  - No `allocated_quantity` changes (already at 0)
- **If inventory NOT finalized:**
  - Decrement both `quantity` and `allocated_quantity`
  - Log destruction with quantity change

**Finalization:**
- Update invoice `packages_missing_count`
- Check if all packages accounted for
- Update invoice status if all accounted for
- Log finalization to invoice history
- Alert accounting team of inventory loss

#### 10.6.2 API Endpoint

**POST `/api/v1/admin/cancelled-shipments/:invoiceId/finalize-destroyed`**

**Permissions:** `admin:finalize_destroyed_packages`

**Request Body:**
```json
{
  "destroyed_packages": [
    {
      "package_label": "1A40E0100000067000001234",
      "destruction_reason": "Vehicle accident - total loss"
    }
  ]
}
```

**Response:**
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

### 10.7 Admin Verification UI

#### 10.7.1 Unverified Packages View

**Requirements:**
- Admin dashboard shows list of all packages awaiting verification
- Filters: By invoice, by incident type, by age
- Columns: Invoice number, Package label, Days since cancellation, Status

#### 10.7.2 Bulk Verification

**Requirements:**
- Admin can select multiple packages and mark as verified
- Confirmation modal shows packages being verified
- Background job processes verifications and updates inventory

#### 10.7.3 Missing Package Workflow

**Requirements:**
- Admin can mark package as "Permanently Missing"
- Requires mandatory reason and approval
- Triggers inventory loss accounting

---

## 11. Websocket Real-Time Coordination

### 11.1 Websocket Integration

Module 5 uses the unified websocket service from Module 3. All package locking, batch updates, and notification broadcasts are handled by the single websocket server on port 8080.

**Import:**
```javascript
const WebsocketService = require('./unified-websocket-service');
```

**Usage Throughout Module 5:**
- `WebsocketService.broadcastPackageLocked(packageLabel, invoiceId, userId)`
- `WebsocketService.broadcastPackageReleased(packageLabel)`
- `WebsocketService.sendPersistentNotification(userId, notification)`
- `WebsocketService.broadcastBatchInventoryUpdate(batchId, newAvailable)`

### 11.2 Package Lock Broadcasting

#### 11.2.1 Lock Event

**When Emitted:**
- When worker scans package successfully

**Event:** `package:locked`

**Payload:**
```json
{
  "packageLabel": "1A40E0100000067000001234",
  "userId": 123,
  "userName": "John Doe",
  "invoiceId": 456,
  "invoiceNumber": "INV-2025-00123"
}
```

**Subscribers:**
- All fulfillment workers connected to websocket
- Workers filtering packages receive event

**UI Update:**
- Package label shows as "Locked" in other workers' views
- Visual indicator: lock icon, grayed out
- Tooltip: "Locked by John Doe"
- Prevents scan attempts for locked packages

### 11.3 Package Release Broadcasting

#### 11.3.1 Release Event

**When Emitted:**
- When scanning session cancelled or completed
- When package removed from session

**Event:** `package:released`

**Payload:**
```json
{
  "packageLabels": ["1A40E0100000067000001234", "1A40E0100000067000001235"],
  "invoiceId": 456
}
```

**UI Update:**
- Packages become available again in other workers' views
- Lock indicators removed
- Workers can now scan these packages for different orders

### 11.4 Batch Inventory Updates

#### 11.4.1 Update Event

**When Emitted:**
- When batch quantity changes (allocation, delivery, return)
- When allocations released (void, cancellation)

**Event:** `batch:updated`

**Payload:**
```json
{
  "batchId": 789,
  "availableQuantity": 45,
  "allocatedQuantity": 15,
  "lastUpdated": "2025-10-16T14:30:00Z"
}
```

**Subscribers:**
- Sales reps viewing batch availability
- Fulfillment workers viewing batch details
- External portal clients (if subscribed to batch)

**UI Update:**
- Availability numbers update in real-time
- If batch now out of stock, UI shows "Out of Stock"
- Auto-promotion notifications appear if triggered

### 11.5 Persistent Notifications

#### 11.5.1 Notification Delivery

**When Emitted:**
- When global issue requested by sales
- When order reassigned
- When critical errors occur

**Event:** `notification:persistent`

**Payload:**
```json
{
  "userId": 123,
  "type": "global_issue",
  "invoiceId": 456,
  "invoiceNumber": "INV-2025-00123",
  "message": "Sales requested review for Invoice INV-2025-00123 - Need to add items",
  "timestamp": "2025-10-16T14:30:00Z"
}
```

**Persistence:**
- Notification stored in database
- Survives page reload
- Displays until acknowledged

#### 11.5.2 Acknowledgment

**Requirements:**
- User clicks "Acknowledge"
- Emit: `notification:acknowledged`
- Database record updated with `acknowledged_at` timestamp
- Notification dismissed from UI

### 11.6 Connection Handling

#### 11.6.1 Connection Establishment

**Requirements:**
- User connects to websocket on login
- Connection ID generated and stored (in session or database)
- User subscribes to relevant channels (e.g., "fulfillment", "batch:789")

#### 11.6.2 Reconnection

**Requirements:**
- If connection drops, auto-reconnect after 5 seconds
- Fetch missed events from server (event log or database)
- Re-subscribe to channels

#### 11.6.3 Disconnection Cleanup

**Requirements:**
- When user disconnects, release any locks they held
- Broadcast release events
- Remove user from subscriber lists

### 11.7 Load Testing

#### 11.7.1 Concurrent Users

**Requirements:**
- Test with 10+ simultaneous fulfillment workers
- All workers receive broadcasts without delay (<500ms)
- No message loss

#### 11.7.2 High Frequency Updates

**Requirements:**
- Simulate rapid allocations (10 per second)
- Websocket handles load without dropping connections
- UI updates remain smooth

---

## 12. API Endpoints

### 12.1 Fulfillment Queue Endpoints

#### 12.1.1 Get Fulfillment Queue

**GET `/api/v1/fulfillment/queue`**

**Query Params:**
- `status` - Filter by status (Approved, Fulfillment_Accepted, Fulfillment_Issue)
- `location` - Filter by destination city/state
- `customer` - Search by customer name
- `minTotal` - Filter by minimum order value
- `maxTotal` - Filter by maximum order value
- `sortBy` - Sort field (age, value, destination, customer)
- `sortOrder` - Sort direction (asc, desc)
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 25)

**Permissions:** `fulfillment`

**Response:**
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
      "approved_at": "2025-10-16T08:00:00Z",
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

#### 12.1.2 Claim Order

**POST `/api/v1/fulfillment/queue/claim`**

**Request Body:**
```json
{
  "invoice_id": 12345
}
```

**Permissions:** `fulfillment`

**Response:**
```json
{
  "success": true,
  "invoice_number": "INV-2025-00123",
  "message": "Order claimed successfully"
}
```

#### 12.1.3 Release Order

**POST `/api/v1/fulfillment/queue/release`**

**Request Body:**
```json
{
  "invoice_id": 12345
}
```

**Permissions:** `fulfillment`

**Response:**
```json
{
  "success": true,
  "message": "Order released back to queue"
}
```

#### 12.1.4 Admin Reassign Order

**POST `/api/v1/fulfillment/admin/reassign`**

**Request Body:**
```json
{
  "invoice_id": 12345,
  "from_user_id": 789,
  "to_user_id": 790
}
```

**Permissions:** `fulfillment:reassign`

**Response:**
```json
{
  "success": true,
  "message": "Order reassigned successfully"
}
```

### 12.2 Scanning Endpoints

#### 12.2.1 Start Scanning Session

**POST `/api/v1/fulfillment/scanning/start`**

**Request Body:**
```json
{
  "invoice_id": 12345,
  "websocket_connection_id": "ws-connection-123"
}
```

**Permissions:** `fulfillment`

**Response:**
```json
{
  "success": true,
  "session_id": 567,
  "started_at": "2025-10-16T14:30:00Z"
}
```

#### 12.2.2 Scan Package

**POST `/api/v1/fulfillment/scanning/scan`**

**Request Body:**
```json
{
  "session_id": 567,
  "package_label": "1A40E0100000067000001234",
  "invoice_id": 12345
}
```

**Permissions:** `fulfillment`

**Response (Success):**
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

**Response (Rejection Alert):**
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
      "rejectionDate": "2025-10-13T10:00:00Z",
      "rejectedBy": "Jane Smith",
      "facility": "ABC Dispensary"
    }
  },
  "line_item_id": 123,
  "package_label": "1A40E0100000067000001234"
}
```

#### 12.2.3 Get Scanning Progress

**GET `/api/v1/fulfillment/scanning/progress/:invoiceId`**

**Permissions:** `fulfillment`

**Response:**
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
      "scanned_packages": ["1A40E...1234", "1A40E...1235"]
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

#### 12.2.4 Verify Rejected Package

**POST `/api/v1/fulfillment/scanning/verify-rejected`**

**Request Body:**
```json
{
  "package_label": "1A40E0100000067000001234",
  "notes": "Package verified as good, ready for sale"
}
```

**Permissions:** `fulfillment`

**Response:**
```json
{
  "success": true,
  "message": "Package verified and cleared for fulfillment"
}
```

#### 12.2.5 Cancel Scanning Session

**POST `/api/v1/fulfillment/scanning/cancel/:sessionId`**

**Request Body:**
```json
{
  "reason": "Need to check inventory first"
}
```

**Permissions:** `fulfillment`

**Response:**
```json
{
  "success": true,
  "message": "Scanning cancelled. Order returned to queue."
}
```

### 12.3 Issue Reporting Endpoints

#### 12.3.1 Report Fulfillment Issue

**POST `/api/v1/fulfillment/issues/report`**

**Request Body:**
```json
{
  "invoice_id": 12345,
  "issues": [
    {
      "type": "batch_unavailable",
      "line_item_id": 123,
      "batch_name": "BATCH-001",
      "description": "Cannot locate batch in warehouse"
    }
  ]
}
```

**Permissions:** `fulfillment`

**Response:**
```json
{
  "success": true,
  "message": "Issues reported. Order returned to sales for resolution."
}
```

#### 12.3.2 Sales Requests Global Issue

**POST `/api/v1/fulfillment/issues/request-global`**

**Request Body:**
```json
{
  "invoice_id": 12345,
  "reason": "Need to add more items to order"
}
```

**Permissions:** `sales_admin`

**Response:**
```json
{
  "success": true,
  "message": "Return request sent to fulfillment worker"
}
```

#### 12.3.3 Fulfillment Acknowledges Global Issue

**POST `/api/v1/fulfillment/issues/acknowledge-global/:invoiceId`**

**Permissions:** `fulfillment`

**Response:**
```json
{
  "success": true,
  "message": "Global issue acknowledged. Order returned to sales."
}
```

### 12.4 Transportation & Manifest Endpoints

#### 12.4.1 Get Available Transporters

**GET `/api/v1/fulfillment/transporters`**

**Permissions:** `fulfillment`

**Response:**
```json
{
  "transporters": [
    {
      "id": 12345,
      "name": "ABC Transport Co",
      "licenseNumber": "TRANS000123"
    }
  ]
}
```

#### 12.4.2 Enter Transportation Details

**POST `/api/v1/fulfillment/transportation`**

**Request Body:**
```json
{
  "invoice_id": 12345,
  "driverName": "John Doe",
  "driverLicense": "D1234567",
  "driverOccupationalLicense": "OCC12345",
  "vehicleMake": "Ford",
  "vehicleModel": "Transit",
  "vehiclePlate": "ABC123",
  "estimatedDeparture": "2025-10-16T08:00:00Z",
  "estimatedArrival": "2025-10-16T14:00:00Z",
  "transporterName": "ABC Transport Co",
  "phoneNumber": "555-0123"
}
```

**Permissions:** `fulfillment`

**Response:**
```json
{
  "success": true,
  "message": "Transportation details saved. Ready to create manifest.",
  "recipientId": 67890,
  "transporterId": 12345
}
```

#### 12.4.3 Get Manifest Preview

**GET `/api/v1/fulfillment/manifest/preview/:invoiceId`**

**Permissions:** `fulfillment`

**Response:**
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
    }
  ],
  "destination": {
    "license": "DISP000123"
  },
  "transportation": {
    "driver": "John Doe",
    "vehicle": "Ford Transit"
  }
}
```

#### 12.4.4 Create Manifest

**POST `/api/v1/fulfillment/manifest/create`**

**Request Body:**
```json
{
  "invoice_id": 12345
}
```

**Permissions:** `fulfillment`

**Response:**
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

#### 12.4.5 Void Manifest

**POST `/api/v1/fulfillment/manifest/void`**

**Request Body:**
```json
{
  "invoice_id": 12345,
  "reason": "Customer requested cancellation",
  "target_manifest_or_license": null
}
```

**Permissions:** `fulfillment` (void own manifest) or `fulfillment_admin` (void any)

**Response:**
```json
{
  "success": true,
  "voided_count": 1,
  "voided_manifests": ["M000123"],
  "remaining_manifests": [],
  "all_voided": true,
  "message": "All 1 manifest(s) voided. Order returned to Fulfillment Issue state."
}
```

#### 12.4.6 Update Manifest

**PATCH `/api/v1/fulfillment/manifest/update/:invoiceId`**

**Request Body:**
```json
{
  "updates": {
    "driverName": "Jane Smith",
    "vehicleMake": "Chevrolet",
    "estimatedDeparture": "2025-10-16T09:00:00Z",
    "estimatedArrival": "2025-10-16T15:00:00Z"
  }
}
```

**Permissions:** `fulfillment` (update own manifest) or `fulfillment_admin` (update any)

**Response:**
```json
{
  "success": true,
  "message": "Manifest M000123 updated successfully"
}
```

### 12.5 Cancelled Shipment Endpoints

#### 12.5.1 Process Cancellation

**POST `/api/v1/fulfillment/cancelled-shipments/cancel`**

**Request Body:**
```json
{
  "invoice_id": 12345,
  "cancellation_reason": "Customer requested cancellation after shipment"
}
```

**Permissions:** `sales_admin`

**Response:**
```json
{
  "success": true,
  "message": "Order cancelled. Awaiting package return confirmation.",
  "packages_to_verify": 15
}
```

#### 12.5.2 Confirm Packages Returned

**POST `/api/v1/fulfillment/cancelled-shipments/confirm-return`**

**Request Body:**
```json
{
  "invoice_id": 12345
}
```

**Permissions:** `fulfillment`

**Response:**
```json
{
  "success": true,
  "all_returned": true,
  "packages_verified": 15,
  "allocations_released": 15,
  "message": "All packages confirmed returned. 15 allocations released."
}
```

#### 12.5.3 Report Driver Incident

**POST `/api/v1/fulfillment/cancelled-shipments/report-incident`**

**Request Body:**
```json
{
  "invoice_id": 12345,
  "incident_details": {
    "description": "Vehicle accident on highway",
    "notes": "Driver safe, packages may be damaged",
    "estimated_damage": "Unknown"
  }
}
```

**Permissions:** `fulfillment`

**Response:**
```json
{
  "success": true,
  "message": "Incident reported. Admin team will verify package status.",
  "requires_admin_verification": true
}
```

#### 12.5.4 Finalize Destroyed Packages

**POST `/api/v1/admin/cancelled-shipments/:invoiceId/finalize-destroyed`**

**Request Body:**
```json
{
  "destroyed_packages": [
    {
      "package_label": "1A40E0100000067000001234",
      "destruction_reason": "Vehicle accident - total loss"
    }
  ]
}
```

**Permissions:** `admin:finalize_destroyed_packages`

**Response:**
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

#### 12.5.5 Get Unaccounted Packages

**GET `/api/v1/admin/cancelled-shipments/:invoiceId/unaccounted-packages`**

**Permissions:** `admin`, `fulfillment`

**Response:**
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
      "admin_notes": null
    }
  ]
}
```

---

## 13. Integration Points with Other Modules

### 13.1 Module 2 (METRC Integration)

#### 13.1.1 Data Dependencies

**Requirements:**
- Manifest creation requires `activepackages` data to be current
- Package validation during scanning queries `activepackages` in real-time
- Status tracking depends on `inactiveoutgoingtransfers` and `deliveries` sync

#### 13.1.2 Workflow Integration

**Requirements:**
- Module 2's sync jobs populate the data Module 5 validates against
- Manifest creation calls T3 API endpoints (Module 2 handles authentication)
- Status changes detected by Module 2 trigger Module 5's status update logic

#### 13.1.3 Critical Considerations

**Sync Lag:**
- Sync lag can cause scanning validation failures (package transferred but still shows active)
- Must handle race condition: scanning happens mid-sync
- **Solution:** Validate packages exist in METRC immediately before manifest creation (final check)

### 13.2 Module 3 (Inventory Management)

#### 13.2.1 Data Dependencies

**Requirements:**
- Scanning validates against `ORDERS-batches` and batch's package details
- `specific_package_labels` field constrains which packages can be scanned
- Batch allocation system tracks `allocated_quantity` set by Module 4

#### 13.2.2 Workflow Integration

**Requirements:**
- Delivery confirmation triggers `finalizeInventoryDeductions()` which decrements batch quantities
- Cancelled shipments with returned packages release allocations
- Package conflicts detected via batch's `assigned_package_labels` during scanning

#### 13.2.3 Critical Considerations

**Inventory Finalization:**
- Must happen exactly once per invoice
- Check `inventory_finalized` flag FIRST to prevent double-deduction
- Allocations must not be released until packages physically return (verified in METRC)
- Rejected packages need special handling (allocation released but quantity not decremented)

### 13.3 Module 4 (Invoice Engine)

#### 13.3.1 Data Dependencies

**Requirements:**
- Fulfillment queue queries invoices with status = 'Approved'
- Scanning reads and updates `assigned_package_labels` on line items
- Transportation details stored in `transportation_details` JSONB column

#### 13.3.2 Workflow Integration

**Requirements:**
- Module 4 creates invoices and allocates inventory
- Module 5 validates, scans, and manifests those invoices
- Issues reported by Module 5 transition invoices back to 'Fulfillment_Issue' for Module 4 (sales) to fix

#### 13.3.3 Critical Considerations

**State Machine:**
- Must be strictly enforced (no skipping states)
- Fulfillment cannot modify line items directly (must report issues)
- Scanning progress persists in `assigned_package_labels` for audit trail

### 13.4 Module 6 (Financials) - Future

#### 13.4.1 Data Dependencies

**Requirements:**
- Manifest number stored on invoice for QuickBooks sync
- Payment tracking happens after delivery confirmation
- Credits/adjustments may be issued for rejected packages

#### 13.4.2 Workflow Integration

**Requirements:**
- Delivery confirmation enables Paid status transition
- Rejection detection may trigger credit issuance (Module 4/6 collaboration)
- Invoice totals frozen after manifest creation

---

## 14. Testing & Validation

### 14.1 Testing Scenarios

#### 14.1.1 Happy Path

**End-to-End Test:**
1. Approved invoice appears in queue
2. Worker claims order
3. Worker scans all packages successfully
4. Transportation details entered
5. Manifest created in METRC
6. Status syncs to Shipped
7. Status syncs to Delivered
8. Inventory deducted correctly
9. Auto-promotion triggered if applicable

**Verification:**
- All status transitions correct
- All database updates correct
- All METRC API calls successful
- All websocket broadcasts sent

#### 14.1.2 Concurrent Access

**Scenario 1: Two Workers Claim Same Order**
- Two workers attempt to claim same order within 100ms
- Result: One succeeds, one fails with clear error
- No partial updates

**Scenario 2: Two Workers Scan Same Package**
- Worker A scanning batch, Worker B starts scanning same batch different order
- Result: First scan locks package, second scan rejected
- Websocket broadcasts lock to second worker

**Scenario 3: Worker A Scanning While Worker B Reassigns**
- Worker A scanning while Worker B (admin) tries to reassign their order
- Result: Reassignment blocked, error shown

#### 14.1.3 Validation Failures

**Wrong Package Scanned:**
- Scan package from different batch
- Validation rejects, shows specific error
- Scanning continues without crash

**Package Not in METRC:**
- Scan invalid package label
- Error: "Package not found in inventory"
- Scanning continues

**Wrong Partial Package:**
- Line item requires specific partial package
- Worker scans different partial
- Error: "Wrong partial package. Expected: [LABEL]"

#### 14.1.4 METRC Integration Failures

**Dry Run Fails:**
- Manifest data invalid
- METRC returns validation errors
- Errors displayed to user, cannot proceed

**Actual Submission Fails After Dry Run:**
- Network error during actual submission
- No database updates occur (transaction rollback)
- User can retry

**METRC API Unavailable:**
- All METRC calls timeout
- User shown maintenance message
- Scanning still works locally

#### 14.1.5 Cancellation & Voiding

**Void After Manifest Created:**
- Admin voids manifest
- Status returns to 'Fulfillment_Issue'
- Packages available for re-scan
- Sales can modify invoice

**Cancel After Ship:**
- Invoice status = 'Shipped'
- Admin triggers cancellation
- Package tracking records created
- System verifies packages return
- Inventory restored correctly

**Missing Package After Cancellation:**
- Some packages don't return
- Admin marks as missing
- Allocation cannot be released until resolved
- Accounting notified of loss

#### 14.1.6 Rejection Scenarios

**Partial Rejection:**
- METRC shows 8 of 10 packages delivered
- Sync job detects rejection
- Status = 'Partially_Rejected'
- Rejected packages tracked
- Inventory returned for rejected packages

**Full Rejection:**
- All packages rejected
- Status = 'Fully_Rejected'
- All packages tracked as rejected
- Inventory fully restored

#### 14.1.7 Edge Cases

**Session Abandonment:**
- Worker starts scanning, closes browser
- After 30 minutes, session auto-abandoned
- Packages released, order available again

**Scanning with Issue Already Reported:**
- Order has fulfillment issue
- Worker tries to scan
- Blocked with message: "Order has reported issue, cannot scan"

**Modify After Manifest:**
- Invoice manifested
- Sales tries to modify line item
- Hard stop: "Cannot modify after manifest created"

**Void Manifest Already Delivered:**
- Manifest status = 'Delivered'
- Admin tries to void
- METRC rejects void (dry run fails)
- Error shown to admin

### 14.2 Data Integrity Checks

#### 14.2.1 Cross-Table Validation

**Invoice → Line Items:**
- Every invoice has at least 1 line item
- Line item totals sum to invoice subtotal
- No orphaned line items

**Line Items → Batches:**
- Every line item references valid batch
- Batch allocation matches line item `quantity_allocated`
- No line items with invalid batch_id

**Manifest Packages → Batches:**
- Every package in manifest_packages references valid batch
- Package labels match batch's available_labels

**Cancelled Packages → Invoice:**
- All cancelled packages reference valid invoices
- Invoice count matches package count

#### 14.2.2 Quantity Consistency Checks

**Batch Allocation Rules:**
- `allocated_quantity ≤ quantity` (cannot allocate more than exists)
- Query: `SELECT * FROM batches WHERE allocated_quantity > quantity`
- No results = good

**Allocation Tracking:**
- Sum of all line item allocations for a batch = batch's `allocated_quantity`
- Discrepancies logged and flagged for investigation

**Fulfilled Quantity Validation:**
- `quantity_fulfilled ≤ quantity_allocated` (cannot fulfill more than allocated)
- Query: `SELECT * FROM line_items WHERE quantity_fulfilled > quantity_allocated`
- No results = good

#### 14.2.3 Status Transition Validation

**Valid Transitions Only:**
- Invoice status changes follow state machine rules
- Cannot skip states (e.g., Approved → Delivered without Manifested)
- Transitions logged in history with timestamp

**Terminal State Protection:**
- Statuses Paid, Cancelled, Fully_Rejected cannot transition further
- API rejects attempts with error: "Invoice in terminal state"

#### 14.2.4 METRC Sync Validation

**Package Status Sync:**
- Packages in manifest_packages match METRC transfer packages
- Regular sync job compares counts
- If mismatch: alert admin, log discrepancy

**Manifest Number Uniqueness:**
- Each manifest_number in database corresponds to unique METRC transfer
- No duplicate manifest numbers across invoices

### 14.3 Performance Testing

#### 14.3.1 Database Query Performance

**Index Usage:**
- All queries for fulfillment queue use indexes
- Active scanning session queries use indexes
- EXPLAIN ANALYZE shows index scans, not sequential scans

**Query Response Times:**
- Fulfillment queue loads in <500ms (100 invoices)
- Scanning validation (per package) <200ms
- Manifest creation completes in <2 seconds (10 packages)

**Pagination:**
- Large fulfillment queues paginated (not loading 1000+ records at once)
- Offset/limit optimized with keyset pagination if needed

#### 14.3.2 METRC API Rate Limiting

**Caching Strategy:**
- Recipient IDs cached for 24 hours
- Transporter IDs cached for 24 hours
- Unit IDs cached for 24 hours
- Cache invalidation on demand if data changes

**Batch API Calls:**
- Status sync job batches multiple invoice checks if possible
- Avoid N+1 API calls (fetch all transfers, then process)

**Retry Logic:**
- Exponential backoff for failed API calls (1s, 2s, 4s, 8s)
- Max 3 retries before reporting failure to user
- Rate limit errors (429) wait and retry after delay

#### 14.3.3 Websocket Performance

**Connection Scaling:**
- System handles 50+ concurrent websocket connections
- Broadcast latency <100ms for package lock events

**Message Filtering:**
- Workers only receive events relevant to them (channel subscriptions)
- Not broadcasting every event to every user

**Memory Management:**
- Disconnected users removed from subscriber maps
- Stale sessions cleaned up (30 min timeout)

#### 14.3.4 Load Testing Scenarios

**Concurrent Scanning:**
- 5 workers scanning different orders simultaneously
- No package conflicts or lock failures
- Database handles FOR UPDATE locking without deadlocks

**Concurrent Allocations:**
- 10 sales reps allocating from same batch simultaneously
- Pessimistic locking prevents overselling
- Last allocation fails gracefully with clear error

**High Volume Manifesting:**
- Create 100 manifests in 1 hour
- METRC API calls succeed
- Database updates complete without errors

---

## 15. Security & Permissions

### 15.1 Role-Based Access Control

#### 15.1.1 Fulfillment Worker

**Permissions:**
- Can view fulfillment queue
- Can claim orders
- Can scan packages
- Can report issues
- Cannot void manifests (unless own manifest)
- Cannot modify invoices after issue reported

#### 15.1.2 Fulfillment Admin

**Permissions:**
- All fulfillment worker permissions
- Can reassign orders before scanning
- Can void any manifest
- Can mark packages as destroyed
- Can release allocations on cancelled shipments
- Can force-complete scanning sessions
- Can manually adjust session data

#### 15.1.3 Sales Rep

**Permissions:**
- Cannot access fulfillment queue
- Can view invoices assigned to them
- Can modify invoices when status = 'Fulfillment_Issue'
- Can request global issue
- Cannot void manifests

#### 15.1.4 Sales Admin

**Permissions:**
- All sales rep permissions
- Can view all invoices
- Can reassign sales reps
- Can void manifests
- Can cancel shipments

#### 15.1.5 Admin (Super User)

**Permissions:**
- All permissions
- Can override any validation
- Can manually adjust inventory
- Can finalize destroyed packages
- Can access admin override tools

### 15.2 API Endpoint Protection

#### 15.2.1 Authentication Required

**Requirements:**
- All Module 5 endpoints require valid JWT token
- Expired tokens rejected with 401 error

#### 15.2.2 Authorization Checks

**Requirements:**
- Each endpoint validates user role before executing action
- Insufficient permissions = 403 error with message

**Examples:**
- `/api/fulfillment/orders/:id/claim` → requires `fulfillment_worker` role
- `/api/fulfillment/manifests/:id/void` → requires `fulfillment_admin` or `sales_admin` role
- `/api/admin/cancelled-packages/:id/finalize` → requires `fulfillment_admin` role

#### 15.2.3 Data Access Restrictions

**Requirements:**
- Workers can only access orders they've claimed
- Sales reps can only modify their assigned invoices
- Cross-user access attempts logged and rejected

### 15.3 Input Validation & Sanitization

#### 15.3.1 Package Label Validation

**Requirements:**
- Format: Alphanumeric, 24 characters (METRC standard)
- SQL injection prevention (parameterized queries)
- XSS prevention (escape special characters)

#### 15.3.2 Transportation Details

**Requirements:**
- Driver name: Max 100 characters, letters/spaces only
- License plate: Max 10 characters, alphanumeric
- Dates: Valid ISO 8601 format, not in past

#### 15.3.3 Issue Notes

**Requirements:**
- Max length validation (e.g., 2000 characters)
- HTML stripping (no script tags)
- SQL injection prevention

### 15.4 Audit Logging

#### 15.4.1 Security Events Logged

**Requirements:**
- Failed login attempts
- Unauthorized access attempts (403 errors)
- Permission changes
- Manifest voids (who, when, why)
- Package destruction (who, when, which packages)

#### 15.4.2 Log Retention

**Requirements:**
- Security logs retained for 1 year minimum
- Tamper-proof (append-only log table or external service)

---

## 16. Performance & Optimization

### 16.1 Database Query Optimization

#### 16.1.1 Critical Indexes

```sql
-- Fulfillment queue performance
CREATE INDEX CONCURRENTLY idx_invoices_fulfillment_queue 
  ON "ORDERS-invoices"(status, approved_at) 
  WHERE status IN ('Approved', 'Fulfillment_Accepted', 'Fulfillment_Issue');

-- Package lookup performance
CREATE INDEX CONCURRENTLY idx_activepackages_label_lookup 
  ON activepackages(label, synclicense) 
  WHERE isarchived = FALSE AND isfinished = FALSE;

-- Session cleanup performance
CREATE INDEX CONCURRENTLY idx_scanning_sessions_cleanup 
  ON "ORDERS-scanning-sessions"(last_activity) 
  WHERE session_status = 'active';
```

#### 16.1.2 Query Performance Targets

**Requirements:**
- Fulfillment queue: <500ms for 100 invoices
- Package validation: <200ms per scan
- Manifest creation: <2 seconds for 10 packages
- Progress query: <200ms

### 16.2 Caching Strategy

#### 16.2.1 METRC Lookup Caching

**Cache TTL: 24 hours**
- Unit IDs
- Transfer type IDs
- Gross unit of weight IDs
- Recipient IDs
- Transporter IDs

**Cache Invalidation:**
- On demand if data changes
- Manual refresh option in admin UI

### 16.3 Background Job Optimization

#### 16.3.1 Session Cleanup Job

**Requirements:**
- Runs every 10 minutes
- Finds sessions where `last_activity < NOW() - INTERVAL '30 minutes'`
- Batch process abandoned sessions
- Log cleanup operations

#### 16.3.2 Status Sync Job

**Requirements:**
- Runs every 15 minutes
- Batch query multiple invoices
- Process in chunks to avoid timeout
- Retry failed syncs on next cycle

---

## 17. Monitoring & Alerts

### 17.1 Critical Metrics

#### 17.1.1 Queue Metrics

**Orders in Queue:**
- Metric: Count of 'Approved' status invoices
- Alert if >50 for more than 1 hour

**Active Scanning Sessions:**
- Metric: Count of active sessions
- Alert if same session active >2 hours (possible stuck state)

#### 17.1.2 Manifest Metrics

**Manifest Creation Success Rate:**
- Metric: Successful manifests / Total attempts
- Alert if success rate <95% over 24 hours

**Manifest Creation Duration:**
- Metric: Time from start scanning to manifest created
- Alert if p95 >5 minutes

#### 17.1.3 Error Metrics

**Abandoned Sessions:**
- Metric: Count per day
- Alert if >10 per day (indicates UX issues)

**METRC API Failures:**
- Metric: Failed API calls / Total calls
- Alert if failure rate >5%

**Package Scan Errors:**
- Metric: Count of rejected scans
- Alert if >50 per hour (indicates systemic issue)

### 17.2 Alert Channels

#### 17.2.1 Admin Dashboard

**Requirements:**
- Real-time metric display
- Historical graphs (last 24 hours, last 7 days)
- Drill-down to specific issues

#### 17.2.2 Email Alerts

**Critical Alerts:**
- Partial manifest creation
- METRC API persistent failures
- High error rates

#### 17.2.3 Slack Alerts

**Real-Time Notifications:**
- Manifest creation failures
- High queue backlog
- Session abandonment spikes

### 17.3 Health Checks

#### 17.3.1 Database Connection

**Endpoint:** `/api/health/db`
- Returns 200 if connection pool healthy
- Returns 503 if connection issues

#### 17.3.2 METRC API Connectivity

**Endpoint:** `/api/health/metrc`
- Makes test API call
- Returns 200 if METRC reachable
- Returns 503 if METRC unavailable

#### 17.3.3 Websocket Server

**Endpoint:** `/api/health/websocket`
- Returns count of active connections
- Returns 200 if server healthy

---

## 18. Summary & Key Principles

### 18.1 Core Principles

**Zero Tolerance Accuracy:**
- If any validation fails, the entire process stops
- Better to catch errors during scanning than after shipment

**Real-Time Coordination:**
- Websockets prevent package conflicts across multiple workers
- No constant database polling required

**Audit Trail Completeness:**
- Every scan, every error, every state change is logged permanently
- Critical for compliance and debugging

**METRC Compliance First:**
- Always dry run before actual submission
- Never submit invalid data to METRC

**Graceful Degradation:**
- Errors handled at each layer with clear user feedback
- Recovery paths available for all failure scenarios

**Future Proof Architecture:**
- Rejection tracking, cancelled shipment handling, package verification systems
- Handle edge cases most systems ignore until they become problems

### 18.2 Implementation Priority

**Phase 1: Core Functionality**
1. Database schema creation
2. Fulfillment queue and order claiming
3. Basic package scanning with validation
4. Transportation details entry
5. Single-license manifest creation

**Phase 2: Advanced Features**
1. Multi-license manifest support
2. Issue reporting and resolution
3. Manifest voiding and updates
4. Status tracking and sync

**Phase 3: Edge Cases**
1. Cancelled shipments and returns
2. Rejection detection and handling
3. Destroyed package finalization
4. Admin override tools

**Phase 4: Optimization**
1. Performance tuning
2. Caching implementation
3. Load testing and optimization
4. Monitoring and alerts

### 18.3 Success Criteria

**Module 5 is complete when:**
- ✅ All database tables created and indexed
- ✅ All API endpoints implemented and tested
- ✅ All validation layers working correctly
- ✅ Multi-license manifest support functional
- ✅ Websocket coordination preventing conflicts
- ✅ All edge cases handled gracefully
- ✅ Performance targets met
- ✅ Security and permissions enforced
- ✅ Monitoring and alerts configured
- ✅ Comprehensive test coverage (>95%)
- ✅ Documentation complete
- ✅ Stakeholder sign-off received

---

*[Module 5 Requirements Document Complete]*

