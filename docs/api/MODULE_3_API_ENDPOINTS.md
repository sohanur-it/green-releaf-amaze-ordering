# Module 3 API Endpoints

## Overview
This document lists all API endpoints for Module 3: Product & Inventory Management.

**Base URL:** `/api/v1`

---

## Master Product Management

### 1. Create Master Product
**`POST /api/v1/products/master`**

Creates a new master product.

**Request Body:**
```json
{
  "name": "Amaze Orange 3.5g",
  "category_name": "Flower - 3.5g Jars",
  "default_price": 50.00,
  "description": "Premium orange-flavored cannabis",
  "brand_name": "Amaze",
  "product_type_name": "Flower",
  "cultivar_name": "Orange Cookies",
  "lineage": "Orange x Cookies"
}
```

**Response:**
```json
{
  "success": true,
  "product_id": 123
}
```

---

### 2. Link METRC Items (Preview)
**`POST /api/v1/products/master/:id/link-items`**

Generates impact preview for linking METRC items to a master product.

**Request Body:**
```json
{
  "metrc_item_names": ["V1 Amaze Orange 3.5g", "V2 Amaze Orange 3.5g"]
}
```

**Response:**
```json
{
  "success": true,
  "preview": {
    "batches_affected": 15,
    "quantity_aggregated": 450,
    "allocated_quantity": 25,
    "statuses_present": "Sellable, On Deck",
    "conflicts": [],
    "warning_messages": [
      {
        "level": "SUCCESS",
        "message": "15 batches will be linked to this product, totaling 450 units."
      }
    ]
  }
}
```

---

### 3. Confirm METRC Item Linking
**`POST /api/v1/products/master/:id/link-items/confirm`**

Confirms and executes the linking of METRC items to master product.

**Request Body:**
```json
{
  "metrc_item_names": ["V1 Amaze Orange 3.5g", "V2 Amaze Orange 3.5g"]
}
```

**Response:**
```json
{
  "success": true,
  "batches_updated": 15,
  "linked_items_count": 2
}
```

---

### 4. Unlink METRC Item
**`DELETE /api/v1/products/master/:id/unlink-item`**

Unlinks a METRC item from a master product.

**Request Body:**
```json
{
  "metrc_item_name": "V1 Amaze Orange 3.5g"
}
```

**Response:**
```json
{
  "success": true,
  "batches_affected": 8,
  "remaining_linked_items": 1,
  "message": "Successfully unlinked V1 Amaze Orange 3.5g"
}
```

---

## Batch Management

### 5. Get Batches for Master Product
**`GET /api/v1/products/master/:id/batches`**

Retrieves all batches for a specific master product.

**Query Parameters:**
- `status` (optional): Filter by status ('Sellable', 'On Deck', 'On Hold')
- `sort` (optional): Sort order ('production_date_asc', 'production_date_desc', 'quantity_desc')

**Example:** `GET /api/v1/products/master/123/batches?status=Sellable&sort=production_date_asc`

**Response:**
```json
{
  "success": true,
  "master_product": {
    "name": "Amaze Orange 3.5g",
    "default_price": 50.00
  },
  "batches": [
    {
      "id": 789,
      "batch_name": "1A40E01...123_V1 Amaze Orange 3.5g",
      "quantity": 30,
      "allocated_quantity": 5,
      "available": 25,
      "thc_percentage": 28.5,
      "production_date": "2024-09-15",
      "effective_price": 50.00,
      "status": "Sellable",
      "full_package_details": {...},
      "partial_package_details": {...}
    }
  ]
}
```

---

### 6. Update Batch Status
**`PATCH /api/v1/batches/:id/status`**

Manually update batch status.

**Request Body:**
```json
{
  "status": "On Hold",
  "reason": "Reserved for VIP client"
}
```

**Response:**
```json
{
  "success": true,
  "changed": true,
  "old_status": "Sellable",
  "new_status": "On Hold"
}
```

---

### 7. Get Batch History
**`GET /api/v1/batches/:id/history`**

Retrieves complete history of changes for a batch.

**Response:**
```json
{
  "success": true,
  "batch_name": "1A40E01...123_V1 Amaze Orange 3.5g",
  "history": [
    {
      "id": 456,
      "change_type": "status_changed",
      "field_name": "status",
      "old_value": "On Deck",
      "new_value": "Sellable",
      "reason": "Auto-promoted: Sellable inventory depleted",
      "related_invoice_id": null,
      "related_package_label": null,
      "change_details": null,
      "changed_by": "SYSTEM",
      "changed_by_system": true,
      "timestamp": "2025-01-15T14:23:00Z"
    }
  ]
}
```

---

### 8. Set Batch Price Override
**`PATCH /api/v1/batches/:id/price`**

Sets a batch-specific price override.

**Request Body:**
```json
{
  "override_price": 40.00,
  "reason": "Aged inventory discount"
}
```

**Response:**
```json
{
  "success": true,
  "batch_id": 789,
  "batch_name": "1A40E01...123_V1 Amaze Orange 3.5g",
  "old_price": 50.00,
  "new_price": 40.00,
  "message": "Batch price override updated successfully"
}
```

---

### 9. Override THC Percentage
**`PATCH /api/v1/batches/:id/thc-override`**

Manually sets THC override for missing lab data.

**Request Body:**
```json
{
  "thc_override": 25.0
}
```

**Response:**
```json
{
  "success": true,
  "batch_id": 789,
  "batch_name": "1A40E01...123_V1 Amaze Orange 3.5g",
  "old_thc_override": null,
  "new_thc_override": 25.0,
  "original_thc_percentage": 28.5,
  "message": "THC override set successfully"
}
```

---

## Pricing Management

### 10. Update Product Default Price
**`PATCH /api/v1/products/master/:id/price`**

Updates the default price of a master product. Returns category siblings for potential bulk update.

**Request Body:**
```json
{
  "default_price": 55.00
}
```

**Response:**
```json
{
  "success": true,
  "updated": true,
  "product_id": 123,
  "product_name": "Amaze Orange 3.5g",
  "new_price": 55.00,
  "category": "Flower - 3.5g Jars",
  "category_siblings": [
    {
      "id": 124,
      "name": "Amaze Purple Octane 3.5g",
      "current_price": 50.00
    }
  ],
  "prompt_bulk_update": true
}
```

---

### 11. Bulk Update Category Prices
**`POST /api/v1/products/categories/:categoryName/bulk-price-update`**

Updates prices for multiple products within a category.

**Request Body:**
```json
{
  "new_price": 55.00,
  "exclude_product_ids": [123]
}
```

**Response:**
```json
{
  "success": true,
  "updated_count": 12,
  "products": [
    {
      "entry_id": 124,
      "name": "Amaze Purple Octane 3.5g"
    }
  ]
}
```

---

## Allocation Management (Module 4 Preview)

### 12. Allocate Batch to Order
**`POST /api/v1/batches/:id/allocate`**

Allocates batch inventory to an order with row locking to prevent overselling.

**Request Body:**
```json
{
  "order_id": 456,
  "requested_quantity": 10
}
```

**Response:**
```json
{
  "success": true,
  "batch_id": 789,
  "batch_name": "1A40E01...123_V1 Amaze Orange 3.5g",
  "old_allocated": 5,
  "new_allocated": 15,
  "available_before": 25,
  "available_after": 15,
  "order_item_id": 999,
  "unit_price": 50.00,
  "total_price": 500.00
}
```

**Error Response (Insufficient Inventory):**
```json
{
  "success": false,
  "error": "Insufficient inventory. Available: 5, Requested: 10",
  "batch_name": "1A40E01...123_V1 Amaze Orange 3.5g",
  "available": 5,
  "requested": 10
}
```

---

### 13. Release Allocation
**`POST /api/v1/orders/:id/release-allocation`**

Releases all batch allocations for an order (e.g., when order is cancelled).

**Response:**
```json
{
  "success": true,
  "released_count": 3,
  "batches": [
    {
      "batch_id": 789,
      "batch_name": "1A40E01...123_V1 Amaze Orange 3.5g",
      "released_quantity": 10
    }
  ]
}
```

---

## Admin / Sync

### 14. Force Batch Sync
**`POST /api/v1/admin/sync/batches`**

Manually triggers batch synchronization from METRC.

**Response:**
```json
{
  "success": true,
  "duration_ms": 3456,
  "changes": {
    "new_batches": 3,
    "updated_batches": 45,
    "removed_batches": 2,
    "package_changes": 12
  }
}
```

---

## Error Responses

All endpoints return error responses in the following format:

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `404` - Resource Not Found
- `500` - Internal Server Error

---

## Authentication

All endpoints require authentication. User ID is extracted from session:
- Primary: `req.session.userId`
- Fallback: `req.user.id`

---

## Audit Logging

All mutating operations are logged to:
- **`ORDERS-batch-history`** - Batch-level changes
- **`ORDERS-audit_log`** - System-wide audit log

---

## Transaction Safety

All database operations use transactions with proper rollback on error:
- `BEGIN` - Start transaction
- `COMMIT` - Commit on success
- `ROLLBACK` - Rollback on error

---

## Row Locking

Critical operations use `FOR UPDATE` row locking to prevent race conditions:
- Batch allocation (`allocateBatchToOrder`)
- Batch status updates (implicit via service layer)

