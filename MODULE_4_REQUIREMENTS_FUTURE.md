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

[Complete schema definitions documented in original requirements]

### Key Tables:
- `ORDERS-invoices` - Main invoice hub
- `ORDERS-invoice-line-items` - Line items with allocation tracking
- `ORDERS-standing-discounts` - Auto-applied discount rules
- `ORDERS-account-credits` - Location-specific credits
- `ORDERS-credit-applications` - Credit application audit trail
- `ORDERS-purchase-limits` - Per-location order limits
- `ORDERS-invoice-history` - Complete modification audit trail

---

## 3.0 Invoice State Machine

### State Flow

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

---

## 4.0 Batch Allocation System

### Key Concepts:
- **Allocation:** Increments `allocated_quantity` on batch
- **Available:** `quantity - allocated_quantity`
- **Finalization:** After delivery, decrements both `quantity` AND `allocated_quantity`
- **Uses pessimistic locking:** `FOR UPDATE` prevents race conditions

### Core Methods:
- `allocateFromBatch()` - Reserve inventory
- `releaseAllocation()` - Free up inventory
- `releaseAllAllocations()` - For cancellations
- `finalizeInventoryDeductions()` - After delivery

---

## 5.0 Invoice Creation Services

### 5.1 Internal Invoice Creation (Sales Rep)
- Fast, efficient workflow
- Direct batch selection
- Auto-apply standing discounts
- Goes straight to 'Approved' status
- Bypasses approval queue

### 5.2 External Shopping Cart
- 24-hour expiry
- Real-time allocation on add
- Cart extension (once only)
- Purchase limit validation
- Auto-release on expiry

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

### Three Layers:
1. **Per-order limit:** Max total per invoice
2. **Unshipped limit:** Max pending orders
3. **Unpaid limit:** Max outstanding invoices

### Defaults:
- Max order total: $20,000
- Max unshipped orders: 3
- Max unpaid invoices: 6

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

[Complete API endpoint documentation in original requirements]

### Endpoint Categories:
- Internal Sales Rep endpoints
- External Client Portal endpoints
- Sales Admin endpoints
- Fulfillment endpoints
- General query endpoints

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

**Document Version:** 1.0  
**Last Updated:** 2025-01-15  
**Status:** Requirements Specification  
**Implementation Status:** ⏳ NOT STARTED
