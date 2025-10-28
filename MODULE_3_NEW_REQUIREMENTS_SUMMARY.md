# Module 3: New/Modified Requirements Analysis

## Summary
Comparing the new requirements document with `MODULE_3_IMPLEMENTATION_COMPLETE.md`, here are the **NEW/MODIFIED** requirements:

---

## ✅ NEW Requirements (NOT Yet Implemented)

### 1. **Real-Time Inventory Broadcasts (Section 10.0 & 11.0)** - **COMPLETELY NEW**

**Status:** ❌ NOT IMPLEMENTED

**What's New:**
- WebSocket server for real-time inventory updates
- Broadcast notifications when "On Deck" batches auto-promote to "Sellable"
- React hooks for client-side inventory notifications
- Package locking broadcasts for fulfillment workers
- Persistent notifications system

**Key Features to Implement:**

#### 10.1 Real-Time Inventory Broadcasts Overview
- When auto-promotion occurs, external buyers must see inventory updates without refreshing
- Requires WebSocket coordination between Module 3 (inventory) and Module 4 (external portal)

#### 10.2 Broadcast on Auto Promotion
- Modify `evaluateAndPromote()` to broadcast inventory availability
- Send message with: product details, batch count, quantities
- Target: All external client portal users

#### 10.3 Websocket Broadcast Implementation
- Create `broadcastNewInventoryAvailable()` function
- Send JSON message to all connected external clients
- Include: master_product_id, product_name, category, batches, quantities

#### 10.4 Frontend Integration (External Portal)
- React hook: `useInventoryNotifications()`
- Show notification banner when new inventory available
- Auto-dismiss after 10 seconds
- Trigger product refresh

#### 10.5 Broadcast for Manual Status Changes
- Also broadcast when admin manually changes batch status to "Sellable"

---

### 2. **Unified Websocket Architecture (Section 11.0)** - **COMPLETELY NEW**

**Status:** ❌ NOT IMPLEMENTED

**What's New:**
- Single WebSocket server on port 8080
- Unified service handling multiple message types
- Client subscription management
- Multiple broadcast types

**Key Features to Implement:**

#### 11.1 Unified Websocket Architecture
- Create `Server/Services/websocketService.js`
- WebSocket server listening on port 8080
- Connection maps for batch subscriptions and user connections
- Message routing based on message type

**Message Types to Support:**
1. **Inventory Updates (Module 3)**
   - Batch subscription/unsubscription
   - Current batch state
   - Inventory updates
   
2. **New Inventory Availability (Module 3)**
   - Product availability broadcasts
   - External portal notifications
   
3. **Package Locking (Module 5)**
   - Fulfillment worker updates
   - Package locked/released
   
4. **Persistent Notifications (Module 5)**
   - User-specific notifications
   - Acknowledgment handling

#### 11.2 Client Usage Examples
- React hook: `useBatchInventory(batchId)` for real-time quantity updates
- React hook: `useInventoryNotifications()` for notification banners
- React hook: `useFulfillmentWebsocket()` for fulfillment workers

**Implementation Details:**
```javascript
// Server-side
class UnifiedWebsocketService {
  handleBatchSubscription(ws, batchId)
  broadcastInventoryUpdate(batchId, availableQty)
  broadcastNewInventoryAvailable(inventoryData)
  broadcastPackageLocked(packageLabel, invoiceId, userId)
  sendPersistentNotification(userId, notification)
}

// Client-side (React)
function useBatchInventory(batchId) // Real-time quantity
function useInventoryNotifications() // Notification banner
function useFulfillmentWebsocket() // Worker updates
```

---

### 3. **Modified: Auto-Promotion Logic Enhancement**

**Current Implementation:** ✅ EXISTS but needs modification

**Required Change:**
- Add `broadcastNewInventoryAvailable()` call after promotion
- Extract product details for broadcast
- Send WebSocket message to all connected clients

**File to Modify:** `Server/Services/batchStatusService.js`
- Method: `promoteBatchesToSellable()` (line 95)
- Add broadcast call after line 156

---

### 4. **Modified: Manual Status Changes Broadcast**

**Current Implementation:** ✅ EXISTS but needs modification

**Required Change:**
- Detect when status changed TO "Sellable"
- Broadcast inventory availability
- Include product and batch details

**File to Modify:** `Server/Routes/module3-routes.js`
- Endpoint: `PATCH /api/v1/batches/:id/status` (line 295)
- Add broadcast logic after status update

---

## 📊 Implementation Priority

### **Priority 1: Critical (Required Now)**
1. ✅ Create WebSocket server (`Server/Services/websocketService.js`)
2. ✅ Integrate broadcast calls in auto-promotion logic
3. ✅ Integrate broadcast calls in manual status updates
4. ✅ Add WebSocket server to main server startup

### **Priority 2: Important (Required Soon)**
1. ✅ Create React hooks for client-side integration
2. ✅ Add notification UI components
3. ✅ Implement acknowledgment system

### **Priority 3: Future Enhancements**
1. ⏳ Package locking broadcasts (Module 5)
2. ⏳ Persistent notifications (Module 5)

---

## 🎯 Files to Create

1. **`Server/Services/websocketService.js`** - Complete WebSocket implementation
2. **`Public/js/shared/inventoryNotifications.js`** - Client-side WebSocket handling
3. **`Views/partials/notification-banner.ejs`** - Notification UI component

## 🔧 Files to Modify

1. **`Server/server.js`**
   - Add WebSocket server initialization
   - Import and start websocketService

2. **`Server/Services/batchStatusService.js`**
   - Modify `promoteBatchesToSellable()` to call broadcast
   - Add product details extraction for broadcast

3. **`Server/Routes/module3-routes.js`**
   - Modify `PATCH /api/v1/batches/:id/status` to broadcast when status = 'Sellable'

4. **`package.json`**
   - Add `ws` dependency for WebSocket support

---

## ✅ What's Already Complete

All other Module 3 requirements from 1.0 through 9.0 are **100% IMPLEMENTED** and documented in `MODULE_3_IMPLEMENTATION_COMPLETE.md`:

- ✅ Database schema (12.1)
- ✅ Batch extraction query (12.2)
- ✅ Batch sync service (12.3)
- ✅ Master product creation & linking (12.4)
- ✅ Batch status management & auto-promotion (12.5)
- ✅ Pricing engine (12.6)
- ✅ Allocation system preview (12.7)
- ✅ API endpoints (12.8)
- ✅ Scheduling strategy (12.9)
- ✅ Integration points (12.10)
- ✅ Edge cases (12.11)

---

## 🚀 Next Steps

1. Install WebSocket dependency: `npm install ws`
2. Create `websocketService.js` with all broadcast methods
3. Integrate broadcast calls into existing auto-promotion logic
4. Add WebSocket server to main server startup
5. Test with external portal clients
6. Create React hooks for client-side integration
7. Update `MODULE_3_IMPLEMENTATION_COMPLETE.md` with section 12.12

---

## 📝 Conclusion

**NEW Requirements:** Only Section 10.0 & 11.0 (Real-Time Inventory Broadcasts via WebSocket)

**Status:** 0% Complete - Needs full implementation

**Complexity:** Medium (requires WebSocket server, client integration, and existing code modifications)

**Estimated Effort:** 2-3 days for full WebSocket implementation

**Dependencies:** `ws` npm package, client-side React updates (Module 4)
