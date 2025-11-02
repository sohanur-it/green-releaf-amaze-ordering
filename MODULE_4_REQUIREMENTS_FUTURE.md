# Module 4: Order Creation & Management (The Invoice Engine)

**Status:** ⏳ FUTURE IMPLEMENTATION - Requirements Document

**Note:** This is a comprehensive requirements specification for future implementation. Module 4 is NOT currently implemented.

---

## 1.0 Core Objective

This module is the operational heart of the entire platform. It transforms buyer demand into tracked, allocated, and compliant transactions that flow seamlessly from initial creation through payment.

**Fundamental Principle:** An Invoice IS the order from inception to completion. There is no separate "order" object that becomes an "invoice" later.

**Two User Experiences:**
- **Internal Sales Interface:** Optimized for speed with surgical control over batch selection, pricing, and allocation
- **External Client Portal:** E-commerce experience with real-time inventory, shopping cart functionality, and 24hr session management

**Critical Features:**
- Real-time allocation system prevents overselling through optimistic locking and WebSocket-based inventory broadcasting
- Flexible discount engine handles both standing rules and one-time adjustments
- Modification tracking system logs every change for compliance and troubleshooting

---

## 2.0 Database Schema Design

The database schema for Module 4 represents the complete financial and operational record of every transaction in the system. The design philosophy here is normalization for integrity, denormalization for performance. We're storing calculated values like subtotal and total directly on the invoice record because recalculating them every time someone views an invoice would be expensive and unnecessary.

### 2.1 Invoices Table (The Hub)

```sql
CREATE TYPE invoice_status AS ENUM (
  'Draft',                    -- External: in cart, not submitted
  'Pending_Approval',         -- External: submitted, awaiting sales rep
  'Approved',                 -- Ready for fulfillment
  'Fulfillment_Accepted',     -- Fulfillment team claimed it
  'Fulfillment_Issue',        -- Problem reported by fulfillment
  'Manifested',               -- METRC manifest created
  'Shipped',                  -- In transit
  'Delivered',                -- Received by customer
  'Partially_Rejected',       -- Some items rejected by customer
  'Fully_Rejected',           -- Entire shipment rejected
  'Cancelled',                -- Cancelled before ship
  'Cancelled_After_Ship',     -- Cancelled post-ship (needs inventory recovery)
  'Issue_After_Shipped',      -- Problem reported post-delivery
  'Paid'                      -- Final state
);

CREATE TYPE invoice_source AS ENUM ('Internal', 'External');

CREATE TABLE "ORDERS-invoices" (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(50) UNIQUE NOT NULL, -- e.g., "INV-2025-00123"
  
  -- Customer Information
  fk_buyer_id INTEGER NOT NULL REFERENCES "orders-buyers"(entry_id),
  fk_location_id INTEGER NOT NULL,     -- Which dispensary location
  location_license_number VARCHAR(50) NOT NULL, -- For METRC manifest
  
  -- Source & Ownership
  source INVOICE_SOURCE NOT NULL,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  assigned_sales_rep_id INTEGER REFERENCES users(id), -- Who manages this invoice
  
  -- Status & Lifecycle
  status INVOICE_STATUS NOT NULL DEFAULT 'Draft',
  status_updated_at TIMESTAMPTZ,
  
  -- Financial Totals
  subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  credit_applied NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  total NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  
  -- Shopping Cart Management (External orders only)
  cart_created_at TIMESTAMPTZ,
  cart_expires_at TIMESTAMPTZ,
  cart_extended BOOLEAN DEFAULT false, -- Can only extend once
  
  -- Purchase Limits (External validation)
  purchase_limit_validated BOOLEAN DEFAULT false,
  outstanding_invoice_count_at_creation INTEGER,
  
  -- Approval Tracking
  approved_at TIMESTAMPTZ,
  approved_by_user_id INTEGER REFERENCES users(id),
  
  -- Fulfillment Tracking
  fulfillment_accepted_at TIMESTAMPTZ,
  fulfillment_accepted_by INTEGER REFERENCES users(id),
  fulfillment_issue_reported_at TIMESTAMPTZ,
  fulfillment_issue_note TEXT,
  
  -- Manifest & Shipping
  metrc_manifest_number VARCHAR(100),
  manifest_created_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  estimated_delivery TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  
  -- Payment
  paid_at TIMESTAMPTZ,
  payment_method VARCHAR(50),
  quickbooks_invoice_id VARCHAR(100), -- For Module 6 integration
  
  -- Metadata
  internal_notes TEXT,
  customer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Critical indexes
CREATE INDEX idx_invoices_buyer ON "ORDERS-invoices" (fk_buyer_id);
CREATE INDEX idx_invoices_location ON "ORDERS-invoices" (fk_location_id);
CREATE INDEX idx_invoices_status ON "ORDERS-invoices" (status);
CREATE INDEX idx_invoices_sales_rep ON "ORDERS-invoices" (assigned_sales_rep_id);
CREATE INDEX idx_invoices_created_at ON "ORDERS-invoices" (created_at DESC);
CREATE INDEX idx_invoices_cart_expiry ON "ORDERS-invoices" (cart_expires_at) 
  WHERE status = 'Draft' AND source = 'External';

-- Update timestamp trigger
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON "ORDERS-invoices" 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 2.2 Invoice Line Items Table

The line items table is where the 'rubber meets the road' for inventory allocation. Each line item represents a specific quantity of a specific batch that's been allocated to this invoice.

**NEW: Partial Package Handling** - The `specific_package_labels` field allows sales reps to specify exact package labels when adding partial packages to an order. This is critical because partial packages have non-standard quantities and cannot be substituted.

```sql
CREATE TABLE "ORDERS-invoice-line-items" (
  id SERIAL PRIMARY KEY,
  fk_invoice_id INTEGER NOT NULL REFERENCES "orders-invoices"(id) ON DELETE CASCADE,
  
  -- Product & Batch Reference
  fk_master_product_id INTEGER NOT NULL REFERENCES "orders-products"(entry_id),
  fk_batch_id INTEGER NOT NULL REFERENCES "orders-batches"(id),
  
  -- Quantities
  quantity_ordered INTEGER NOT NULL,  -- What they want
  quantity_allocated INTEGER NOT NULL DEFAULT 0,  -- Reserved from batch
  quantity_fulfilled INTEGER DEFAULT 0,  -- What actually shipped (set during manifest)
  
  -- Pricing (locked at line item creation)
  unit_price NUMERIC(10, 2) NOT NULL,
  line_discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  line_total NUMERIC(10, 2) NOT NULL,
  
  -- Discount Tracking
  standing_discount_applied BOOLEAN DEFAULT false,
  standing_discount_id INTEGER REFERENCES "orders-standing-discounts"(id),
  manual_discount_applied BOOLEAN DEFAULT false,
  manual_discount_reason TEXT,
  
  -- Credit Proportioning (calculated when credit applied to invoice)
  credit_portion NUMERIC(10, 2) DEFAULT 0.00,
  
  -- Fulfillment Package Assignment (populated during scanning)
  assigned_package_labels JSONB,  -- Array of METRC package tags actually used during fulfillment
  
  -- NEW: Partial Package Specific Selection
  specific_package_labels JSONB DEFAULT NULL,
  -- For partial packages ONLY: JSONB array of specific package labels sales rep selected
  -- Example: ["1A40E0100000067000001234", "1A40E0100000067000001235"]
  -- NULL = any full packages from batch acceptable (standard behavior)
  -- NOT NULL = fulfillment MUST scan these exact labels (partial package requirement)
  
  -- Modification Tracking
  was_modified BOOLEAN DEFAULT false,
  original_quantity INTEGER,  -- Store original if modified post-approval
  modification_reason TEXT,
  modified_at TIMESTAMPTZ,
  modified_by INTEGER REFERENCES users(id),
  
  -- Metadata
  line_item_order INTEGER NOT NULL,  -- Display order
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_line_items_invoice ON "ORDERS-invoice-line-items"(fk_invoice_id);
CREATE INDEX idx_line_items_batch ON "ORDERS-invoice-line-items"(fk_batch_id);
CREATE INDEX idx_line_items_product ON "ORDERS-invoice-line-items"(fk_master_product_id);

-- Index for querying line items with specific package requirements
CREATE INDEX idx_line_items_specific_packages ON "ORDERS-invoice-line-items"(fk_invoice_id) 
  WHERE specific_package_labels IS NOT NULL;

COMMENT ON COLUMN "ORDERS-invoice-line-items".specific_package_labels IS 
  'For partial packages: JSONB array of specific package labels sales rep selected. 
   Example: ["1A40E0100000067000001234", "1A40E0100000067000001235"] 
   NULL for full package line items (any full package from batch is acceptable). 
   When NOT NULL, fulfillment scanning MUST validate against these exact labels. 
   This prevents substitution of partial packages which have non-standard quantities.';
```

### 2.3 Standing Discounts Table

```sql
CREATE TYPE discount_type AS ENUM ('Percentage', 'Fixed_Amount', 'BOGO');

CREATE TABLE "orders-standing-discounts" (
  id SERIAL PRIMARY KEY,
  
  -- Scope
  fk_location_id INTEGER NOT NULL,      -- Which dispensary gets this discount
  fk_master_product_id INTEGER NOT NULL REFERENCES "orders-products"(entry_id),
  
  -- Discount Configuration
  discount_type DISCOUNT_TYPE NOT NULL,
  discount_value NUMERIC(10, 2) NOT NULL,  -- 15.00 for 15%, or dollar amount
  
  -- BOGO Specific
  bogo_buy_quantity INTEGER,      -- Buy X
  bogo_get_quantity INTEGER,      -- Get Y
  bogo_discount_percent NUMERIC(5, 2),  -- % off the Y items (often 100% = free)
  
  -- Validity Period
  valid_from DATE,
  valid_until DATE,
  is_active BOOLEAN DEFAULT true,
  
  -- Metadata
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX idx_standing_discounts_location_product 
  ON "orders-standing-discounts"(fk_location_id, fk_master_product_id);
CREATE INDEX idx_standing_discounts_active 
  ON "orders-standing-discounts"(is_active) WHERE is_active = true;
```

### 2.4 Account Credits Table

```sql
CREATE TABLE "ORDERS-account-credits" (
  id SERIAL PRIMARY KEY,
  fk_location_id INTEGER NOT NULL,  -- Credits are location-specific
  
  -- Credit Details
  credit_amount NUMERIC(10, 2) NOT NULL,
  remaining_balance NUMERIC(10, 2) NOT NULL,
  
  -- Issuance
  issued_by INTEGER NOT NULL REFERENCES users(id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL,
  related_invoice_id INTEGER REFERENCES "orders-invoices"(id),  -- If issued due to problem
  
  -- Expiration
  expires_at TIMESTAMPTZ,
  is_expired BOOLEAN DEFAULT false,
  
  -- Status
  is_fully_used BOOLEAN DEFAULT false,
  fully_used_at TIMESTAMPTZ
);

CREATE INDEX idx_credits_location ON "ORDERS-account-credits"(fk_location_id);
CREATE INDEX idx_credits_active ON "ORDERS-account-credits"(remaining_balance, is_expired, is_fully_used) 
  WHERE remaining_balance > 0 AND is_expired = false AND is_fully_used = false;
```

### 2.5 Credit Applications Table (Audit Trail)

```sql
CREATE TABLE "orders-credit-applications" (
  id SERIAL PRIMARY KEY,
  fk_credit_id INTEGER NOT NULL REFERENCES "orders-account-credits"(id),
  fk_invoice_id INTEGER NOT NULL REFERENCES "orders-invoices"(id),
  amount_applied NUMERIC(10, 2) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credit_apps_invoice ON "orders-credit-applications"(fk_invoice_id);
CREATE INDEX idx_credit_apps_credit ON "orders-credit-applications"(fk_credit_id);
```

### 2.6 Purchase Limits Table

```sql
CREATE TABLE "orders-purchase-limits" (
  id SERIAL PRIMARY KEY,
  fk_location_id INTEGER NOT NULL UNIQUE,  -- One set of limits per location
  
  -- Limits (NULL means use system defaults)
  max_order_total NUMERIC(10, 2) DEFAULT 20000.00,
  max_unshipped_orders INTEGER DEFAULT 3,
  max_unpaid_invoices INTEGER DEFAULT 6,
  
  -- Override Tracking
  last_modified_by INTEGER REFERENCES users(id),
  last_modified_at TIMESTAMPTZ
);

CREATE INDEX idx_purchase_limits_location ON "orders-purchase-limits"(fk_location_id);
```

### 2.7 Invoice Modification History Table

```sql
CREATE TYPE modification_type AS ENUM (
  'line_item_added',
  'line_item_removed',
  'line_item_quantity_changed',
  'discount_applied',
  'discount_removed',
  'credit_applied',
  'status_changed',
  'fulfillment_issue_reported',
  'fulfillment_issue_resolved',
  'cancelled',
  'cloned_from'
);

CREATE TABLE "orders-invoice-history" (
  id BIGSERIAL PRIMARY KEY,
  fk_invoice_id INTEGER NOT NULL REFERENCES "orders-invoices"(id) ON DELETE CASCADE,
  
  -- What Changed
  modification_type MODIFICATION_TYPE NOT NULL,
  field_name VARCHAR(100),  -- e.g., 'status', 'line_item_id_123'
  old_value TEXT,
  new_value TEXT,
  change_details JSONB,  -- Flexible storage for complex changes
  
  -- Context
  reason TEXT,
  triggered_by_fulfillment_issue BOOLEAN DEFAULT false,
  
  -- Who & When
  changed_by_user_id INTEGER REFERENCES users(id),
  changed_by_system BOOLEAN DEFAULT false,
  TIMESTAMP TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_history_invoice ON "orders-invoice-history"(fk_invoice_id);
CREATE INDEX idx_invoice_history_timestamp ON "orders-invoice-history"(TIMESTAMP DESC);
CREATE INDEX idx_invoice_history_type ON "orders-invoice-history"(modification_type);
```

---

## 3.0 Invoice State Machine

### 3.1 Understanding the State Flow

The invoice state machine is the backbone of the entire order lifecycle. Think of it as a controlled pipeline where an invoice can only move forward through specific checkpoints, with each transition triggering business logic, notifications, and audit logging.

**EXTERNAL ORDERS:**
```
Draft → Pending_Approval → Approved → Fulfillment_Accepted → 
Manifested → Shipped → Delivered → Paid
```

**INTERNAL ORDERS:**
```
Draft → Approved → Fulfillment_Accepted → Manifested → 
Shipped → Delivered → Paid
```

**ISSUE PATHS:**
- Fulfillment_Issue (can go back to Approved after sales modifies)
- Cancelled (from Draft, Pending_Approval, Approved, Fulfillment_Accepted)
- Cancelled_After_Ship (from Shipped, Delivered)
- Issue_After_Shipped (from Shipped, Delivered)
- Partially_Rejected (from Delivered)
- Fully_Rejected (from Delivered)

### 3.2 State Transition Rules & Logic

```javascript
class InvoiceStateMachine {
  static VALID_TRANSITIONS = {
    'Draft': ['Pending_Approval', 'Approved', 'Cancelled'],
    'Pending_Approval': ['Approved', 'Cancelled'],
    'Approved': ['Fulfillment_Accepted', 'Cancelled'],
    'Fulfillment_Accepted': ['Fulfillment_Issue', 'Manifested', 'Cancelled'],
    'Fulfillment_Issue': ['Approved'], // sales fixes, re-submits
    'Manifested': ['Shipped'],
    'Shipped': ['Delivered', 'Cancelled_After_Ship'],
    'Delivered': ['Partially_Rejected', 'Fully_Rejected', 'Issue_After_Shipped', 'Paid'],
    'Partially_Rejected': ['Paid'],
    'Fully_Rejected': [], // terminal state
    'Issue_After_Shipped': ['Paid'],
    'Cancelled': [], // terminal
    'Cancelled_After_Ship': [], // terminal (needs inventory recovery check)
    'Paid': [] // terminal
  };

  async transitionTo(invoiceId, newStatus, userId, reason = null) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Lock the invoice row
      const invoice = await client.query(`
        SELECT status, source FROM "ORDERS-invoices"
        WHERE id = $1
        FOR UPDATE
      `, [invoiceId]);
      
      const currentStatus = invoice.rows[0].status;
      
      // Validate the transition
      if (!this.VALID_TRANSITIONS[currentStatus].includes(newStatus)) {
        throw new Error(`Invalid transition: ${currentStatus} → ${newStatus}`);
      }
      
      // Execute transition specific logic
      await this.executeTransitionLogic(
        invoiceId, currentStatus, newStatus, userId, client
      );
      
      // Update status
      await client.query(`
        UPDATE "ORDERS-invoices"
        SET status = $1, status_updated_at = NOW()
        WHERE id = $2
      `, [newStatus, invoiceId]);
      
      // Log history
      await client.query(`
        INSERT INTO "ORDERS-invoice-history" (
          fk_invoice_id, modification_type, field_name,
          old_value, new_value, reason, changed_by_user_id
        ) VALUES ($1, 'status_changed', 'status', $2, $3, $4, $5)
      `, [invoiceId, currentStatus, newStatus, reason, userId]);
      
      await client.query('COMMIT');
      
      // Trigger side effects (websocket broadcasts, notifications, etc.)
      await this.postTransitionEffects(invoiceId, currentStatus, newStatus);
      
      return { success: true, newStatus };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async executeTransitionLogic(invoiceId, from, to, userId, client) {
    // Draft -> Pending_Approval (External order submitted)
    if (from === 'Draft' && to === 'Pending_Approval') {
      await this.validatePurchaseLimits(invoiceId, client);
      await this.notifySalesRep(invoiceId);
    }
    
    // Pending_Approval -> Approved (Sales rep approves)
    if (from === 'Pending_Approval' && to === 'Approved') {
      await client.query(`
        UPDATE "ORDERS-invoices"
        SET approved_at = NOW(), approved_by_user_id = $1
        WHERE id = $2
      `, [userId, invoiceId]);
      await this.notifyFulfillment(invoiceId);
    }
    
    // Draft -> Approved (Internal order, skip approval)
    if (from === 'Draft' && to === 'Approved') {
      await client.query(`
        UPDATE "ORDERS-invoices"
        SET approved_at = NOW(), approved_by_user_id = $1
        WHERE id = $2
      `, [userId, invoiceId]);
    }
    
    // Approved -> Fulfillment_Accepted
    if (to === 'Fulfillment_Accepted') {
      await client.query(`
        UPDATE "ORDERS-invoices"
        SET fulfillment_accepted_at = NOW(), fulfillment_accepted_by = $1
        WHERE id = $2
      `, [userId, invoiceId]);
    }
    
    // -> Cancelled (before shipping)
    if (to === 'Cancelled') {
      await this.releaseAllAllocations(invoiceId, client);
      const invoice = await client.query(
        'SELECT source FROM "ORDERS-invoices" WHERE id = $1', [invoiceId]
      );
      if (invoice.rows[0].source === 'External') {
        await this.notifyCustomerCancellation(invoiceId);
      }
    }
    
    // -> Cancelled_After_Ship
    if (to === 'Cancelled_After_Ship') {
      await this.flagForInventoryRecovery(invoiceId, client);
    }
    
    // Fulfillment_Issue → Approved (Sales fixed the issue)
    if (from === 'Fulfillment_Issue' && to === 'Approved') {
      await client.query(`
        UPDATE "ORDERS-invoices"
        SET fulfillment_issue_reported_at = NULL, fulfillment_issue_note = NULL
        WHERE id = $1
      `, [invoiceId]);
      await this.notifyFulfillment(invoiceId);
    }
    
    // -> Manifested
    if (to === 'Manifested') {
      // Manifest number should already be set by Module 5
      // Allocations remain in place until shipped
    }
    
    // -> Shipped
    if (to === 'Shipped') {
      await client.query(`
        UPDATE "ORDERS-invoices"
        SET shipped_at = NOW()
        WHERE id = $1
      `, [invoiceId]);
      await this.notifyCustomerShipment(invoiceId);
    }
    
    // -> Delivered
    if (to === 'Delivered') {
      await client.query(`
        UPDATE "ORDERS-invoices"
        SET delivered_at = NOW()
        WHERE id = $1
      `, [invoiceId]);
      await this.finalizeInventoryDeductions(invoiceId, client);
    }
    
    // -> Paid
    if (to === 'Paid') {
      await client.query(`
        UPDATE "ORDERS-invoices"
        SET paid_at = NOW()
        WHERE id = $1
      `, [invoiceId]);
      await this.updateDealFlowStage(invoiceId, client);
    }
  }
}
```

---

## 4.0 Batch Allocation System

### 4.1 Understanding Allocation

The allocation system prevents overselling. When a customer adds an item to their cart or a sales rep creates an invoice, we immediately reserve it by incrementing the `allocated_quantity` on the batch. This creates a hard lock: `available_to_sell = quantity - allocated_quantity`.

The system uses pessimistic locking (`FOR UPDATE`) to handle concurrent access. If two sales reps try to allocate the last 10 units of a batch at the exact same moment, the database lock ensures one succeeds and one gets an "insufficient inventory" error.

Allocations exist in a temporary state until delivery. The batch's `quantity` field doesn't decrease until the order is marked 'Delivered'. Until then, the inventory is just "spoken for" but still technically exists. This design handles cancellations cleanly.

### 4.2 Core Allocation Pseudocode Logic

```javascript
class BatchAllocationService {
  /**
   * Allocate quantity from a batch to an invoice line item
   * Uses pessimistic locking to prevent overselling
   */
  async allocateFromBatch(batchId, quantity, invoiceId, lineItemId) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // CRITICAL: Lock the batch row
      const batch = await client.query(`
        SELECT id, batch_name, quantity, allocated_quantity, fk_master_product_id
        FROM "ORDERS-batches"
        WHERE id = $1
        FOR UPDATE
      `, [batchId]);
      
      if (batch.rows.length === 0) {
        throw new Error(`Batch ${batchId} not found`);
      }
      
      const b = batch.rows[0];
      const available = b.quantity - b.allocated_quantity;
      
      if (available < quantity) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'insufficient_inventory',
          available: available,
          requested: quantity
        };
      }
      
      // Increment allocated_quantity
      await client.query(`
        UPDATE "ORDERS-batches"
        SET allocated_quantity = allocated_quantity + $1
        WHERE id = $2
      `, [quantity, batchId]);
      
      // Update line item
      await client.query(`
        UPDATE "ORDERS-invoice-line-items"
        SET quantity_allocated = $1
        WHERE id = $2
      `, [quantity, lineItemId]);
      
      // Log batch history
      await client.query(`
        INSERT INTO "ORDERS-batch-history" (
          batch_id, change_type, field_name,
          old_value, new_value, reason,
          related_invoice_id, changed_by_system
        ) VALUES ($1, 'allocation_increased', 'allocated_quantity',
                  $2, $3, 'Allocated to invoice', $4, true)
      `, [batchId, b.allocated_quantity, b.allocated_quantity + quantity, invoiceId]);
      
      await client.query('COMMIT');
      
      // Check if auto promotion needed (Module 3 integration)
      await this.checkAutoPromotion(b.fk_master_product_id);
      
      // Broadcast inventory change via websocket
      await this.broadcastInventoryUpdate(batchId, available - quantity);
      
      return {
        success: true,
        batch_name: b.batch_name,
        allocated: quantity,
        remaining_available: available - quantity
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Release allocation (cart removal, order cancellation, etc.)
   */
  async releaseAllocation(batchId, quantity, invoiceId, reason) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const batch = await client.query(`
        SELECT allocated_quantity FROM "ORDERS-batches"
        WHERE id = $1
        FOR UPDATE
      `, [batchId]);
      
      const currentAllocated = batch.rows[0].allocated_quantity;
      
      // Decrement allocation
      await client.query(`
        UPDATE "ORDERS-batches"
        SET allocated_quantity = allocated_quantity - $1
        WHERE id = $2
      `, [quantity, batchId]);
      
      // Log history
      await client.query(`
        INSERT INTO "ORDERS-batch-history" (
          batch_id, change_type, field_name,
          old_value, new_value, reason,
          related_invoice_id, changed_by_system
        ) VALUES ($1, 'allocation_decreased', 'allocated_quantity',
                  $2, $3, $4, $5, true)
      `, [batchId, currentAllocated, currentAllocated - quantity, reason, invoiceId]);
      
      await client.query('COMMIT');
      
      // Broadcast availability increase
      const newAvailable = await this.getAvailableQuantity(batchId);
      await this.broadcastInventoryUpdate(batchId, newAvailable);
      
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Release ALL allocations for an invoice (cancellation)
   */
  async releaseAllAllocations(invoiceId, client) {
    const lineItems = await client.query(`
      SELECT id, fk_batch_id, quantity_allocated
      FROM "ORDERS-invoice-line-items"
      WHERE fk_invoice_id = $1 AND quantity_allocated > 0
    `, [invoiceId]);
    
    for (const item of lineItems.rows) {
      await this.releaseAllocation(
        item.fk_batch_id, item.quantity_allocated, invoiceId, 'Invoice cancelled'
      );
      
      // Zero out line item allocation
      await client.query(`
        UPDATE "ORDERS-invoice-line-items"
        SET quantity_allocated = 0
        WHERE id = $1
      `, [item.id]);
    }
  }

  /**
   * Finalize inventory deduction after delivery
   * This is when we actually remove from batch.quantity
   */
  async finalizeInventoryDeductions(invoiceId, client) {
    const lineItems = await client.query(`
      SELECT fk_batch_id, quantity_fulfilled
      FROM "ORDERS-invoice-line-items"
      WHERE fk_invoice_id = $1
    `, [invoiceId]);
    
    for (const item of lineItems.rows) {
      // Decrease actual quantity AND allocated_quantity
      await client.query(`
        UPDATE "ORDERS-batches"
        SET quantity = quantity - $1, allocated_quantity = allocated_quantity - $1
        WHERE id = $2
      `, [item.quantity_fulfilled, item.fk_batch_id]);
      
      // Log the final deduction
      await client.query(`
        INSERT INTO "ORDERS-batch-history" (
          batch_id, change_type, reason,
          related_invoice_id, changed_by_system
        ) VALUES ($1, 'quantity_deducted', 'Invoice delivered and finalized', $2, true)
      `, [item.fk_batch_id, invoiceId]);
    }
  }
}
```

### 4.3 Change Detection Logic (METRC Sync Integration)

**CRITICAL:** When packages allocated to invoices disappear from METRC, we must immediately flag the affected orders.

```javascript
function detectChanges(freshBatches, existingBatches) {
  const changes = {
    new: [],
    updated: [],
    removed: [],
    packageChanges: []
  };
  
  // Create lookup maps
  const existingMap = new Map(
    existingBatches.map(b => [b.batch_name, b])
  );
  const freshMap = new Map(
    freshBatches.map(b => [b.batch_name, b])
  );
  
  // Detect new batches
  for (const [batchName, freshBatch] of freshMap) {
    if (!existingMap.has(batchName)) {
      changes.new.push(freshBatch);
    }
  }
  
  // Detect updates and package-level changes
  for (const [batchName, existingBatch] of existingMap) {
    const freshBatch = freshMap.get(batchName);
    
    if (!freshBatch) {
      // Batch no longer exists in METRC
      changes.removed.push(existingBatch);
      continue;
    }
    
    // Compare critical fields
    const updates = {};
    
    if (freshBatch.quantity !== existingBatch.quantity) {
      updates.quantity = { old: existingBatch.quantity, new: freshBatch.quantity };
    }
    
    if (freshBatch.package_count !== existingBatch.package_count) {
      updates.package_count = {
        old: existingBatch.package_count,
        new: freshBatch.package_count
      };
      
      // DEEP DIVE: WHICH packages changed?
      const packageDiff = this.comparePackageLabels(
        existingBatch.available_labels,
        freshBatch.available_labels
      );
      
      if (packageDiff.removed.length > 0) {
        changes.packageChanges.push({
          batch_name: batchName,
          batch_id: existingBatch.id,
          removed_packages: packageDiff.removed,
          added_packages: packageDiff.added
        });
      }
    }
    
    if (Object.keys(updates).length > 0) {
      changes.updated.push({
        batch_name: batchName,
        batch_id: existingBatch.id,
        updates: updates,
        full_fresh_data: freshBatch
      });
    }
  }
  
  return changes;
}

/**
 * When a package disappears, investigate WHY and flag affected orders
 */
async function investigateRemovedPackage(packageLabel, batchId) {
  const investigation = {
    package_label: packageLabel,
    batch_id: batchId,
    reason: null,
    related_invoices: [],
    metrc_status: null,
    requires_immediate_action: false
  };
  
  // Check 1: Was this package allocated to ANY active orders?
  const allocations = await db.query(`
    SELECT i.id as invoice_id, i.invoice_number, i.status, i.assigned_sales_rep_id,
           li.id as line_item_id, li.assigned_package_labels,
           u.firstname, u.lastname, u.email
    FROM "ORDERS-invoice-line-items" li
    JOIN "ORDERS-invoices" i ON li.fk_invoice_id = i.id
    LEFT JOIN users u ON i.assigned_sales_rep_id = u.id
    WHERE li.fk_batch_id = $1
      AND li.assigned_package_labels @> $2::jsonb
      AND i.status NOT IN ('Cancelled', 'Paid', 'Fully_Rejected')
    ORDER BY i.created_at DESC
  `, [batchId, JSON.stringify([packageLabel])]);
  
  if (allocations.rows.length > 0) {
    investigation.reason = 'allocated_to_active_invoices';
    investigation.related_invoices = allocations.rows;
    investigation.requires_immediate_action = true;
    
    // CRITICAL: Flag all affected invoices immediately
    for (const allocation of allocations.rows) {
      await flagInvoiceForMETRCConflict(
        allocation.invoice_id, packageLabel, batchId, allocation
      );
    }
    
    return investigation;
  }
  
  // Check 2: Did it get transferred out?
  const transferred = await db.query(`
    SELECT metrcid, destination_license, transferred_date
    FROM transferredpackages
    WHERE label = $1
    ORDER BY transferred_date DESC
    LIMIT 1
  `, [packageLabel]);
  
  if (transferred.rows.length > 0) {
    investigation.reason = 'transferred_out';
    investigation.metrc_status = 'transferred';
    investigation.details = transferred.rows[0];
    return investigation;
  }
  
  // Check 3: Was it made inactive?
  const inactive = await db.query(`
    SELECT metrcid, finisheddate, finishedreason
    FROM inactivepackages
    WHERE label = $1
    ORDER BY finisheddate DESC
    LIMIT 1
  `, [packageLabel]);
  
  if (inactive.rows.length > 0) {
    investigation.reason = 'made_inactive';
    investigation.metrc_status = 'finished';
    investigation.details = inactive.rows[0];
    return investigation;
  }
  
  // Unknown reason - CRITICAL ALERT
  investigation.reason = 'unknown_removal';
  investigation.requires_immediate_action = true;
  
  await alertAdminTeam({
    type: 'UNKNOWN_PACKAGE_DISAPPEARANCE',
    package_label: packageLabel,
    batch_id: batchId,
    message: 'Package disappeared from METRC with no clear reason'
  });
  
  return investigation;
}

/**
 * Flag invoice for METRC conflict and transition to safe state
 */
async function flagInvoiceForMETRCConflict(invoiceId, packageLabel, batchId, allocation) {
  const client = await db.pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get current invoice status
    const invoice = await client.query(`
      SELECT status FROM "ORDERS-invoices" WHERE id = $1 FOR UPDATE
    `, [invoiceId]);
    
    const currentStatus = invoice.rows[0].status;
    
    // Only transition if not already in a terminal or issue state
    if (!['Fulfillment_Issue', 'Cancelled', 'Paid', 'Fully_Rejected'].includes(currentStatus)) {
      // Transition to Fulfillment_Issue
      await client.query(`
        UPDATE "ORDERS-invoices"
        SET status = 'Fulfillment_Issue',
            fulfillment_issue_reported_at = NOW(),
            fulfillment_issue_note = $1,
            status_updated_at = NOW()
        WHERE id = $2
      `, [
        `🚨 METRC SYNC ALERT: Package ${packageLabel} allocated to this order is no longer in active inventory. ` +
        `This package may have been transferred, destroyed, or removed from METRC. ` +
        `Sales must verify order and reallocate inventory.`,
        invoiceId
      ]);
      
      // Clear the problematic package from assigned_package_labels
      await client.query(`
        UPDATE "ORDERS-invoice-line-items"
        SET assigned_package_labels = assigned_package_labels - $1
        WHERE id = $2
      `, [packageLabel, allocation.line_item_id]);
      
      // Log the conflict
      await client.query(`
        INSERT INTO "ORDERS-invoice-history" (
          fk_invoice_id, modification_type, field_name,
          old_value, reason, changed_by_system, triggered_by_fulfillment_issue
        ) VALUES ($1, 'metrc_allocation_conflict', 'package_disappeared', $2, $3, true, true)
      `, [invoiceId, packageLabel, `Package disappeared from METRC during sync. Batch ID: ${batchId}`]);
    }
    
    await client.query('COMMIT');
    
    // Send URGENT notifications
    await sendUrgentNotifications({
      invoice_id: invoiceId,
      invoice_number: allocation.invoice_number,
      sales_rep_id: allocation.assigned_sales_rep_id,
      sales_rep_email: allocation.email,
      sales_rep_name: `${allocation.firstname} ${allocation.lastname}`,
      package_label: packageLabel,
      issue: 'METRC_ALLOCATION_CONFLICT'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[CRITICAL] Failed to flag invoice for METRC conflict:', error);
    await alertAdminTeam({
      type: 'INVOICE_FLAGGING_FAILED',
      invoice_id: invoiceId,
      package_label: packageLabel,
      error: error.message
    });
  } finally {
    client.release();
  }
}
```

### 2.2.1 Partial Package Workflow Integration

**Sales Rep UI Flow for Adding Partial Packages:**

When a sales rep adds a line item from a batch that contains partial packages, the system determines whether the rep is selecting from full packages or partial packages:

**Flow for Full Packages (Standard):**
```javascript
// Sales rep selects batch and quantity
addLineItem(batchId, quantity) {
  // specific_package_labels = NULL (default)
  // Fulfillment can use any full packages from batch
}
```

**Flow for Partial Packages (Specific Selection Required):**
```javascript
// Step 1: Rep selects a batch that has partial packages
selectBatch(batchId) {
  const batch = await getBatchDetails(batchId);
  
  if (batch.partial_package_count > 0) {
    // Show UI with partial package selection
    const partialPackages = batch.partial_package_details.partial_packages;
    // [
    //   { label: "1A40E0100..001", quantity: 2.8 },
    //   { label: "1A40E0100..002", quantity: 3.1 },
    //   { label: "1A40E0100..003", quantity: 2.5 }
    // ]
    
    return showPartialPackageSelector(partialPackages);
  }
}

// Step 2: Rep selects specific partial package(s)
addPartialPackageLineItem(batchId, selectedPackageLabels) {
  // selectedPackageLabels = ["1A40E0100..001", "1A40E0100..002"]
  
  // Calculate total quantity from selected packages
  const totalQuantity = selectedPackageLabels.reduce((sum, label) => {
    const pkg = findPackageByLabel(label);
    return sum + pkg.quantity;
  }, 0);
  
  // Create line item with specific labels
  await createLineItem({
    fk_batch_id: batchId,
    quantity_ordered: totalQuantity,
    specific_package_labels: selectedPackageLabels,  // NOT NULL
    // ... other fields
  });
}
```

**Fulfillment Scanning Validation with Specific Labels:**

During fulfillment (Module 5), the scanning validation logic checks `specific_package_labels`:

```javascript
async function validateScannedPackage(scannedLabel, lineItemId) {
  const lineItem = await db.query(`
    SELECT fk_batch_id, quantity_ordered, specific_package_labels, assigned_package_labels
    FROM "ORDERS-invoice-line-items"
    WHERE id = $1
  `, [lineItemId]);
  
  const item = lineItem.rows[0];
  
  // CRITICAL: If specific_package_labels is NOT NULL, ONLY those labels are valid
  if (item.specific_package_labels !== null) {
    const allowedLabels = item.specific_package_labels;
    
    if (!allowedLabels.includes(scannedLabel)) {
      return {
        valid: false,
        error: 'SPECIFIC_PACKAGE_REQUIRED',
        message: `This line item requires specific partial packages. Package ${scannedLabel} is not in the required list.`,
        allowedLabels: allowedLabels
      };
    }
    
    // Check if already scanned
    const alreadyScanned = item.assigned_package_labels?.includes(scannedLabel);
    if (alreadyScanned) {
      return {
        valid: false,
        error: 'DUPLICATE_SCAN',
        message: `Package ${scannedLabel} has already been scanned for this line item.`
      };
    }
    
    return { valid: true };
  }
  
  // NULL specific_package_labels = any full package from batch is OK
  // Standard validation logic continues...
  const batch = await getBatchDetails(item.fk_batch_id);
  const fullPackageLabels = batch.full_package_details.full_packages.map(p => p.label);
  
  if (!fullPackageLabels.includes(scannedLabel)) {
    return {
      valid: false,
      error: 'PACKAGE_NOT_IN_BATCH',
      message: `Package ${scannedLabel} does not belong to the required batch for this line item.`
    };
  }
  
  return { valid: true };
}
```

**Key Business Rules for Partial Packages:**

1. **External Orders Cannot Use Partial Packages:** The client portal only shows batches with `full_package_count > 0`. Partial packages are never visible to external buyers.

2. **Specific Selection is Mandatory for Partials:** When a sales rep adds a partial package to an order, they MUST select the specific package label(s). The system will not allow "any partial from this batch."

3. **No Substitution During Fulfillment:** If fulfillment cannot locate a required partial package, they must report an issue. They cannot substitute it with a different partial package, even from the same batch.

4. **Allocation Still Uses Batch Level:** Even though specific packages are required, the allocation logic operates at the batch level (increments `allocated_quantity`). The `specific_package_labels` field is a fulfillment constraint, not an allocation constraint.

5. **Partial Package Quantities Are Non-Standard:** A partial package with 200g cannot be treated as equivalent to a full 210g package. The sales rep must be aware of the exact quantity when building the order.

---

## 5.0 Invoice Creation Services

### 5.1 Understanding Internal vs External Creation

The invoice creation process branches at the very beginning based on who's creating it. Internal creation (by sales reps) is optimized for speed and flexibility. External creation (via client portal) is fundamentally a shopping cart system with a 24hr TTL.

### 5.2 Internal Invoice Creation (Sales Rep)

```javascript
class InternalInvoiceService {
  async createInvoice(salesRepId, invoiceData) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Validate sales rep can create for this buyer
      const canCreate = await this.validateSalesRepAccess(
        salesRepId, invoiceData.fk_buyer_id, client
      );
      
      if (!canCreate) {
        throw new Error('Sales rep not authorized for this buyer');
      }
      
      // Generate invoice number
      const invoiceNumber = await this.generateInvoiceNumber(client);
      
      // Create invoice record
      const invoice = await client.query(`
        INSERT INTO "ORDERS-invoices" (
          invoice_number, fk_buyer_id, fk_location_id,
          location_license_number, source, created_by_user_id,
          assigned_sales_rep_id, status
        ) VALUES ($1, $2, $3, $4, 'Internal', $5, $5, 'Draft')
        RETURNING id
      `, [
        invoiceNumber, invoiceData.fk_buyer_id, invoiceData.fk_location_id,
        invoiceData.location_license_number, salesRepId
      ]);
      
      const invoiceId = invoice.rows[0].id;
      
      // Add line items with allocation
      for (const item of invoiceData.line_items) {
        await this.addLineItem(invoiceId, item, salesRepId, client);
      }
      
      // Calculate totals
      await this.recalculateTotals(invoiceId, client);
      
      await client.query('COMMIT');
      
      return { success: true, invoice_id: invoiceId, invoice_number: invoiceNumber };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async addLineItem(invoiceId, itemData, userId, client) {
    // Get batch info and pricing
    const batch = await client.query(`
      SELECT b.id, b.batch_name, b.fk_master_product_id, b.quantity,
             b.allocated_quantity, b.partial_package_details,
             COALESCE(b.override_price, p.default_price) as unit_price
      FROM "ORDERS-batches" b
      LEFT JOIN "ORDERS-products" p ON b.fk_master_product_id = p.entry_id
      WHERE b.id = $1
      FOR UPDATE
    `, [itemData.fk_batch_id]);
    
    if (batch.rows.length === 0) {
      throw new Error('Batch not found');
    }
    
    const b = batch.rows[0];
    const available = b.quantity - b.allocated_quantity;
    
    if (available < itemData.quantity) {
      throw new Error(
        `Insufficient inventory. Available: ${available}, Requested: ${itemData.quantity}`
      );
    }
    
    // ========================================
    // Validate specific partial packages if provided
    // ========================================
    let specificLabels = null;
    
    if (itemData.partial_packages_selected && itemData.partial_packages_selected.length > 0) {
      specificLabels = itemData.partial_packages_selected;
      
      // Validate EACH specific label still exists in METRC activepackages
      for (const label of specificLabels) {
        const exists = await client.query(`
          SELECT metrcid, quantity, batch_name
          FROM activepackages
          WHERE label = $1
            AND synclicense IN ('CUL000063', 'MAN000072')
            AND isarchived = false
            AND isfinished = false
        `, [label]);
        
        if (exists.rows.length === 0) {
          throw new Error(
            `Partial package ${label} is no longer available. ` +
            `It may have been sold or transferred since you started building this order. ` +
            `Please refresh the partial package list and try again.`
          );
        }
        
        // Verify it belongs to the correct batch
        if (exists.rows[0].batch_name !== b.batch_name) {
          throw new Error(
            `Partial package ${label} does not belong to batch ${b.batch_name}`
          );
        }
      }
      
      // Validate these labels exist in batch's partial_package_details
      const partialPackages = b.partial_package_details?.partial_packages || [];
      const validLabels = partialPackages.map(p => p.label);
      
      for (const label of specificLabels) {
        if (!validLabels.includes(label)) {
          throw new Error(
            `Invalid partial package label: ${label} is not in batch ${b.batch_name}`
          );
        }
      }
    }
    
    // Get invoice location for standing discount check
    const invoice = await client.query(
      'SELECT fk_location_id FROM "ORDERS-invoices" WHERE id = $1', [invoiceId]
    );
    const locationId = invoice.rows[0].fk_location_id;
    
    const standingDiscount = await this.getApplicableStandingDiscount(
      locationId, b.fk_master_product_id, client
    );
    
    let lineTotal = b.unit_price * itemData.quantity;
    let discountAmount = 0;
    let standingDiscountId = null;
    
    if (standingDiscount) {
      discountAmount = this.calculateDiscount(
        standingDiscount, b.unit_price, itemData.quantity
      );
      lineTotal -= discountAmount;
      standingDiscountId = standingDiscount.id;
    }
    
    // Create line item
    const lineItem = await client.query(`
      INSERT INTO "ORDERS-invoice-line-items" (
        fk_invoice_id, fk_master_product_id, fk_batch_id,
        quantity_ordered, quantity_allocated, unit_price,
        line_discount_amount, line_total, standing_discount_applied,
        standing_discount_id, specific_package_labels, line_item_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                (SELECT COALESCE(MAX(line_item_order), 0) + 1
                 FROM "ORDERS-invoice-line-items" WHERE fk_invoice_id = $1))
      RETURNING id
    `, [
      invoiceId, b.fk_master_product_id, itemData.fk_batch_id,
      itemData.quantity, itemData.quantity, // Allocate immediately
      b.unit_price, discountAmount, lineTotal,
      standingDiscount !== null, standingDiscountId,
      specificLabels ? JSON.stringify(specificLabels) : null
    ]);
    
    // Allocate from batch
    await client.query(`
      UPDATE "ORDERS-batches"
      SET allocated_quantity = allocated_quantity + $1
      WHERE id = $2
    `, [itemData.quantity, itemData.fk_batch_id]);
    
    // Log batch history
    await client.query(`
      INSERT INTO "ORDERS-batch-history" (
        batch_id, change_type, field_name,
        old_value, new_value, reason,
        related_invoice_id, changed_by_system
      ) VALUES ($1, 'allocation_increased', 'allocated_quantity',
                $2, $3, 'Allocated to invoice', $4, true)
    `, [
      itemData.fk_batch_id, b.allocated_quantity,
      b.allocated_quantity + itemData.quantity, invoiceId
    ]);
    
    // Broadcast inventory update
    await this.broadcastInventoryUpdate(itemData.fk_batch_id, available - itemData.quantity);
    
    return lineItem.rows[0].id;
  }

  async submitForFulfillment(invoiceId, userId) {
    // Internal orders go straight to Approved
    return await InvoiceStateMachine.transitionTo(
      invoiceId, 'Approved', userId, 'Internal order submitted'
    );
  }
}
```

### 5.3 External Shopping Cart Service

The shopping cart system balances user convenience with inventory accuracy. The 24hr expiry is the compromise. Realtime allocation ensures if you successfully add something to your cart, it's guaranteed to be available when you check out (assuming you do so within 24 hours).

```javascript
class ShoppingCartService {
  /**
   * Initialize cart for external buyer
   * CRITICAL: All time calculations use server time
   */
  async createCart(buyerId, locationId) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const invoiceNumber = await this.generateInvoiceNumber(client);
      
      // CRITICAL: Let database calculate expiry using server time
      const cart = await client.query(`
        INSERT INTO "ORDERS-invoices" (
          invoice_number, fk_buyer_id, fk_location_id,
          location_license_number, source, created_by_user_id,
          assigned_sales_rep_id, status, cart_created_at, cart_expires_at
        )
        SELECT $1, $2, $3, l.license_number, 'External',
               (SELECT id FROM users WHERE username = 'system'),
               l.assigned_sales_rep_id, 'Draft', NOW(), NOW() + INTERVAL '24 hours'
        FROM "ORDERS-buyer_locations" l
        WHERE l.id = $3
        RETURNING id, cart_expires_at
      `, [invoiceNumber, buyerId, locationId]);
      
      await client.query('COMMIT');
      
      return {
        cart_id: cart.rows[0].id,
        expires_at: cart.rows[0].cart_expires_at
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Extend cart expiry (one-time only)
   */
  async extendCart(cartId) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const cart = await client.query(`
        SELECT cart_extended, cart_expires_at
        FROM "ORDERS-invoices"
        WHERE id = $1 AND status = 'Draft'
        FOR UPDATE
      `, [cartId]);
      
      if (cart.rows.length === 0) {
        throw new Error('Cart not found');
      }
      
      if (cart.rows[0].cart_extended) {
        throw new Error('Cart can only be extended once');
      }
      
      // Extend by 24 hours using server time
      await client.query(`
        UPDATE "ORDERS-invoices"
        SET cart_expires_at = cart_expires_at + INTERVAL '24 hours',
            cart_extended = TRUE
        WHERE id = $1
        RETURNING cart_expires_at
      `, [cartId]);
      
      await client.query('COMMIT');
      
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Clear expired cart (scheduled job runs every 10 minutes)
   */
  async clearExpiredCart(cartId, client = null) {
    const shouldCommit = !client;
    if (!client) {
      client = await db.pool.connect();
      await client.query('BEGIN');
    }
    
    try {
      // Check if cart still exists and is expired
      const cart = await client.query(`
        SELECT id, status, cart_expires_at
        FROM "ORDERS-invoices"
        WHERE id = $1
        FOR UPDATE SKIP LOCKED
      `, [cartId]);
      
      if (cart.rows.length === 0) {
        if (shouldCommit) await client.query('COMMIT');
        return { skipped: true, reason: 'already_cleaned_or_locked' };
      }
      
      const cartData = cart.rows[0];
      
      // Double-check it's actually expired (safety check)
      if (new Date(cartData.cart_expires_at) > new Date()) {
        if (shouldCommit) await client.query('COMMIT');
        return { skipped: true, reason: 'not_expired' };
      }
      
      // Release all allocations
      await BatchAllocationService.releaseAllAllocations(cartId, client);
      
      // Delete line items
      await client.query(`
        DELETE FROM "ORDERS-invoice-line-items"
        WHERE fk_invoice_id = $1
      `, [cartId]);
      
      // Delete invoice
      await client.query(`
        DELETE FROM "ORDERS-invoices"
        WHERE id = $1
      `, [cartId]);
      
      if (shouldCommit) await client.query('COMMIT');
      
      return { success: true };
    } catch (error) {
      if (shouldCommit) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (shouldCommit) client.release();
    }
  }
}

// Cron job for cart cleanup (every 10 minutes)
const cron = require('node-cron');
cron.schedule('*/10 * * * *', async () => {
  try {
    const expiredCarts = await db.query(`
      SELECT id, invoice_number, fk_buyer_id, cart_expires_at
      FROM "ORDERS-invoices"
      WHERE status = 'Draft'
        AND source = 'External'
        AND cart_expires_at < NOW()
        AND cart_expires_at IS NOT NULL
      ORDER BY cart_expires_at ASC
      LIMIT 100
    `);
    
    for (const cart of expiredCarts.rows) {
      try {
        await ShoppingCartService.clearExpiredCart(cart.id);
      } catch (error) {
        console.error(`[Cart Cleanup] Failed to clear cart ${cart.id}:`, error);
      }
    }
  } catch (error) {
    console.error('[Cart Cleanup] Job crashed:', error);
  }
});
```

---

## 6.0 Discount System

### Standing Discounts
- Pre-configured rules
- Location + product specific
- Auto-apply during line item creation
- Types: Percentage, Fixed_Amount, BOGO

### Manual Discounts
- One-time adjustments
- Requires Sales Admin permission
- Logged with reason
- Can stack with standing discounts

---

## 7.0 Account Credit System

### Key Features:
- Location-specific
- Proportional application across all line items
- Automatic application during checkout
- Oldest-first ordering (prevents expiration)
- Balance tracking in `remaining_balance`

---

## 8.0 Purchase Limit Validation

### 8.1 Understanding Purchase Limits

Purchase limits provide three layers of protection: per order total (can't place a single massive order), unshipped count (can't have too many pending orders), and unpaid count (can't owe too much money).

**Defaults:**
- Max order total: $20,000
- Max unshipped orders: 3
- Max unpaid invoices: 6

### 8.2 Purchase Limit Validation Logic with Concurrency Protection

**CRITICAL:** Use PostgreSQL advisory locks to serialize purchase limit checks per location to prevent race conditions.

```javascript
class PurchaseLimitService {
  async validatePurchaseLimits(invoiceId, client) {
    const invoice = await client.query(`
      SELECT fk_location_id, total
      FROM "ORDERS-invoices"
      WHERE id = $1
    `, [invoiceId]);
    
    const locationId = invoice.rows[0].fk_location_id;
    const orderTotal = invoice.rows[0].total;
    
    // CRITICAL: Acquire advisory lock for this location
    // This ensures only ONE purchase limit check happens at a time per location
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [locationId]);
    
    // Get limits (or defaults)
    const limits = await client.query(`
      SELECT
        COALESCE(max_order_total, 20000.00) as max_order_total,
        COALESCE(max_unshipped_orders, 3) as max_unshipped_orders,
        COALESCE(max_unpaid_invoices, 6) as max_unpaid_invoices
      FROM "ORDERS-purchase-limits"
      WHERE fk_location_id = $1
    `, [locationId]);
    
    const lim = limits.rows.length > 0 ? limits.rows[0] : {
      max_order_total: 20000.00,
      max_unshipped_orders: 3,
      max_unpaid_invoices: 6
    };
    
    const violations = [];
    
    // Check 1: Order total
    if (orderTotal > lim.max_order_total) {
      violations.push({
        type: 'order_total_exceeded',
        message: `Order total ($${orderTotal}) exceeds limit ($${lim.max_order_total})`,
        limit: lim.max_order_total,
        current: orderTotal
      });
    }
    
    // Check 2: Unshipped orders (with row-level locking)
    const unshipped = await client.query(`
      SELECT COUNT(*) as count
      FROM "ORDERS-invoices"
      WHERE fk_location_id = $1
        AND status NOT IN ('Shipped', 'Delivered', 'Paid', 'Cancelled',
                           'Cancelled_After_Ship', 'Fully_Rejected')
      FOR UPDATE
    `, [locationId]);
    
    const currentUnshipped = parseInt(unshipped.rows[0].count);
    
    if (currentUnshipped >= lim.max_unshipped_orders) {
      violations.push({
        type: 'unshipped_limit_exceeded',
        message: `Location has ${currentUnshipped} unshipped orders (limit: ${lim.max_unshipped_orders})`,
        limit: lim.max_unshipped_orders,
        current: currentUnshipped
      });
    }
    
    // Check 3: Unpaid invoices (with row-level locking)
    const unpaid = await client.query(`
      SELECT COUNT(*) as count
      FROM "ORDERS-invoices"
      WHERE fk_location_id = $1
        AND status IN ('Delivered', 'Partially_Rejected', 'Issue_After_Shipped')
        AND status != 'Paid'
      FOR UPDATE
    `, [locationId]);
    
    const currentUnpaid = parseInt(unpaid.rows[0].count);
    
    if (currentUnpaid >= lim.max_unpaid_invoices) {
      violations.push({
        type: 'unpaid_limit_exceeded',
        message: `Location has ${currentUnpaid} unpaid invoices (limit: ${lim.max_unpaid_invoices})`,
        limit: lim.max_unpaid_invoices,
        current: currentUnpaid
      });
    }
    
    // Store validation result
    await client.query(`
      UPDATE "ORDERS-invoices"
      SET purchase_limit_validated = $1,
          outstanding_invoice_count_at_creation = $2
      WHERE id = $3
    `, [violations.length === 0, currentUnshipped + currentUnpaid, invoiceId]);
    
    // Advisory lock is automatically released at transaction end
    
    if (violations.length > 0) {
      throw new PurchaseLimitError(violations);
    }
    
    return { valid: true };
  }
}
```

---

## 9.0 Invoice Modification & Fulfillment Issues

### Fulfillment Issue Flow:
1. Fulfillment reports problem
2. Invoice → 'Fulfillment_Issue' state
3. Sales modifies invoice
4. Back to 'Approved' for retry

### Modification Tracking:
- `was_modified` flag
- `original_quantity` preservation
- `modification_reason` audit trail
- All changes logged in history

---

## 10.0 Clone Invoice Feature

### What Gets Cloned:
- All line items
- Batch references
- Immediate allocation
- NO manual discounts

### What Happens:
- Independent invoice created
- Allocations attempted
- Failures reported to user
- Source logged in history

---

## 11.0 WebSocket Real-Time Updates

### Architecture:
- Subscription-based model
- Batch-level subscriptions
- Broadcast inventory changes instantly
- Prevents overselling through UI

### Key Methods:
- `handleSubscription(ws, batchId)`
- `broadcastInventoryUpdate(batchId, quantity)`
- `sendCurrentBatchState(ws, batchId)`

---

## 12.0 Deal Flow Stage Automation

### Triggers:
- When invoice reaches 'Paid'
- Daily batch job (2 AM)

### Stages:
- **Active:** Invoice in last 30 days
- **Warm:** Invoice in 30-60 day range
- **Cold:** No activity in 60+ days

---

## 13.0 API Endpoints

### INTERNAL SALES REP ENDPOINTS

**Create invoice**
```
POST /api/v1/invoices/internal
Body: {
  fk_buyer_id: 123,
  fk_location_id: 456,
  line_items: [
    { fk_batch_id: 789, quantity: 10 },
    { fk_batch_id: 790, quantity: 5 }
  ]
}
```

**Add line item to existing draft**
```
POST /api/v1/invoices/:id/line-items
Body: {
  fk_batch_id: 791,
  quantity: 15,
  partial_packages_selected: ["1A40E0100..001", "1A40E0100..002"]  // Optional, for partial packages
}
```

**Update line item quantity**
```
PATCH /api/v1/invoices/:id/line-items/:lineItemId
Body: { quantity: 20 }
```

**Remove line item**
```
DELETE /api/v1/invoices/:id/line-items/:lineItemId
```

**Apply manual discount**
```
POST /api/v1/invoices/:id/line-items/:lineItemId/discount
Body: {
  discount_amount: 50.00,
  reason: "Aged inventory"
}
```

**Submit for fulfillment**
```
POST /api/v1/invoices/:id/submit
```

**Clone invoice**
```
POST /api/v1/invoices/:id/clone
Body: { new_location_id: 999 }
```

### EXTERNAL CLIENT PORTAL ENDPOINTS

**Get or create cart**
```
GET /api/v1/cart?buyer_id=123&location_id=456
```

**Add to cart**
```
POST /api/v1/cart/:cartId/items
Body: {
  batch_id: 789,
  quantity: 10
}
```

**Update cart item**
```
PATCH /api/v1/cart/:cartId/items/:lineItemId
Body: { quantity: 5 }
```

**Remove from cart**
```
DELETE /api/v1/cart/:cartId/items/:lineItemId
```

**Extend cart expiry**
```
POST /api/v1/cart/:cartId/extend
```

**Submit cart for approval**
```
POST /api/v1/cart/:cartId/submit
```

### SALES ADMIN ENDPOINTS

**Approve pending order**
```
POST /api/v1/invoices/:id/approve
```

**Reject pending order**
```
POST /api/v1/invoices/:id/reject
Body: { reason: "Inventory unavailable" }
```

**Manage standing discounts**
```
POST /api/v1/discounts/standing
Body: {
  fk_location_id: 456,
  fk_master_product_id: 789,
  discount_type: "Percentage",
  discount_value: 15.00
}

DELETE /api/v1/discounts/standing/:id
```

**Issue account credit**
```
POST /api/v1/credits
Body: {
  fk_location_id: 456,
  amount: 500.00,
  reason: "Damaged product",
  related_invoice_id: 12345
}
```

**Update purchase limits**
```
PUT /api/v1/purchase-limits/:locationId
Body: {
  max_order_total: 30000.00,
  max_unshipped_orders: 5,
  max_unpaid_invoices: 10
}
```

### FULFILLMENT ENDPOINTS

**Accept order for fulfillment**
```
POST /api/v1/invoices/:id/fulfillment/accept
```

**Report fulfillment issue**
```
POST /api/v1/invoices/:id/fulfillment/issue
Body: {
  issues: [{
    type: "batch_unavailable",
    batch_id: 789,
    batch_name: "...",
    description: "Cannot locate package in warehouse"
  }]
}
```

### GENERAL QUERY ENDPOINTS

**Get invoice details**
```
GET /api/v1/invoices/:id
```

**Get invoice history**
```
GET /api/v1/invoices/:id/history
```

**List invoices (with filters)**
```
GET /api/v1/invoices?status=Pending_Approval&assigned_to=userId
```

**Get buyer's invoices**
```
GET /api/v1/buyers/:buyerId/invoices?location_id=456
```

**Check available credits**
```
GET /api/v1/credits/available/:locationId
```

**Get real-time available partial packages for a batch**
```
GET /api/v1/batches/:batchId/partial-packages/available
Permissions: sales_rep, sales_admin

Response: {
  batch_id: 789,
  batch_name: "1A40E..._V1 Amaze Orange 3.5g",
  partial_packages: [
    {
      label: "1A40E0100000067000001234",
      quantity: 2.8,
      available: true,
      allocated_to: null
    },
    {
      label: "1A40E0100000067000001235",
      quantity: 3.1,
      available: false,
      allocated_to: "INV-2025-00123"
    }
  ]
}
```

---

## 14.0 Integration Points

### Module 2 (METRC)
- Requires `location_license_number` for manifest creation
- METRC sync lag considerations
- Physical availability respects METRC state

### Module 3 (Inventory)
- Line items reference `fk_batch_id`
- Allocation increments `allocated_quantity`
- Auto-promotion triggered after allocation
- Finalization decrements both quantities

### Module 5 (Fulfillment)
- Fulfillment accepts → status change
- Package scanning validates against batch details
- Fulfillment issues trigger modification workflow

### Module 6 (Financials)
- `quickbooks_invoice_id` for sync
- Credits applied before QuickBooks
- Payment tracking triggers deal flow

### CRM Module
- `fk_buyer_id` links to buyers
- `assigned_sales_rep_id` determines permissions
- Deal flow automation updates stages

---

## 15.0 Known Edge Cases & Considerations

### Edge Cases:
- Batch deleted during cart session
- Simultaneous cart submission
- Cart expiry mid-checkout
- Credit balance exactly covers invoice
- Manifest created but METRC rejects
- Sales rep assigns more than available
- WebSocket connection lost mid-cart
- Concurrent modification during clone
- Purchase limit changes during cart session
- Discount valid period expires during cart

### Future Enhancements:
- Partial payment tracking
- Subscription/recurring orders
- Bundle deals
- Loyalty points system
- Pre-order allocations
- Invoice PDF generation
- Email invoice delivery
- SMS notifications
- Invoice templates
- Batch invoice creation
- Smart reordering
- Promotional campaigns
- Tiered pricing
- Consignment tracking
- Returns processing

---

## 16.0 Security Considerations

### Key Points:
- SQL injection prevention via parameterized queries
- Permission enforcement at every endpoint
- Rate limiting for external portal
- Sensitive data logging restrictions
- Cryptographically secure portal URLs

---

## 17.0 Success Criteria

### Comprehensive Testing Checklist:
- Allocation & Locking (concurrent access, race conditions)
- State Machine (valid/invalid transitions)
- Shopping Cart (expiry, real-time updates)
- Discounts (standing + manual stacking)
- Account Credits (proportional application)
- Purchase Limits (all three layers)
- Fulfillment Issues (report and resolve)
- Invoice Modifications (tracking, audit)
- Clone Feature (independence, allocation)
- Deal Flow (auto-update triggers)
- Notifications (all trigger points)
- WebSockets (subscriptions, broadcasts)
- Totals Calculation (accuracy across scenarios)

---

## Notes

This document is the **definitive reference** for Module 4 implementation. When questions arise about "how should this work?", refer to this document. When edge cases are discovered, document them and update this specification.

**Critical Implementation Warnings:**
- Never bypass the allocation system
- Always use transactions
- Test concurrency explicitly
- Don't cache availability
- Validate state transitions

---

**Document Version:** 2.0  
**Last Updated:** 2025-01-XX  
**Status:** Comprehensive Requirements Specification  
**Implementation Status:** ⏳ NOT STARTED

---

## Additional Features Documented

This updated version includes comprehensive implementation details for:

- ✅ Complete database schema with CREATE TABLE statements
- ✅ Detailed state machine with full transition logic
- ✅ Complete allocation system with pessimistic locking
- ✅ METRC conflict detection and alerting system
- ✅ Partial package handling workflow (NEW)
- ✅ Shopping cart with 24hr expiry and cleanup jobs
- ✅ Purchase limit validation with concurrency protection
- ✅ Complete API endpoint specifications
- ✅ Discount system (standing + manual)
- ✅ Account credit system with proportional application
- ✅ Fulfillment issue reporting and resolution
- ✅ Clone invoice feature
- ✅ WebSocket real-time inventory updates
- ✅ Deal flow stage automation
- ✅ Complete pseudocode for all major services

All features documented with implementation-ready pseudocode and business logic specifications.
