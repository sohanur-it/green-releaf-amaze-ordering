# Product Delete Function - Requirements Clarification

## 🎯 Questions for Client

Hi [Client Name],

I understand you'd like to add a delete function for products. However, this isn't as straightforward as it might seem. There are several critical edge cases and business logic decisions we need to clarify first, as they affect data integrity and your business workflow.

---

## ❓ Key Questions

### 1. **Delete Type**
**Should this be a soft delete or hard delete?**

- **Soft Delete (Recommended)**: 
  - Product marked as "deleted" or "archived" but remains in database
  - Can be restored if needed
  - Historical data and audit trail preserved
  - **Similar to how your user deletion works** (users are "revoked" not deleted)
  
- **Hard Delete**: 
  - Product permanently removed from database
  - Cannot be restored
  - May cause data integrity issues

**My Recommendation**: Soft delete (add `is_deleted` or `archived_at` column)

---

### 2. **Linked Batches - CRITICAL**
**What happens to batches linked to this product?**

Currently, your database has **`fk_master_product_id`** in batches table with **`ON DELETE SET NULL`**. This means:

**Scenario**: You have "Purple Octane x Jealousy - 7g Budlets" with 4 linked batches (sellable, on deck, on hold)

**If product is deleted:**
- ❓ Should batches become "orphaned" (fk_master_product_id = NULL)?
- ❓ Should batches be marked as "archived" too?
- ❓ Should batches be prevented from deletion if any have allocated quantity > 0?
- ❓ Should only products with NO batches be deletable?

**Options:**
1. **Restrict**: Cannot delete product if it has batches (client must unlink items first)
2. **Cascade Archive**: Product AND all batches marked as deleted/archived
3. **Orphan**: Batches remain but lose product link (current DB behavior)
4. **Status-Based**: Can only delete if all batches are "On Hold" or have 0 quantity

**My Recommendation**: Restrict deletion if product has any batches with `quantity > 0` or `allocated_quantity > 0`

---

### 3. **Active Orders**
**What if there are pending orders containing this product?**

**Scenario**: Product has batches, and those batches are referenced in `ORDERS-order-items`

- ❓ Should deletion be blocked if any orders reference this product's batches?
- ❓ What about historical/completed orders?

**My Recommendation**: Block deletion if ANY active (pending/processing) orders exist

---

### 4. **METRC Item Links**
**Should unlinking METRC items be required first?**

Your products have `metrc_linked_items` JSONB array (e.g., `["V1 Amaze Orange 3.5g", "V2 Amaze Orange 3.5g"]`)

- ❓ Must all METRC items be unlinked before deletion?
- ❓ Or should deletion auto-unlink them?

**My Recommendation**: Require manual unlinking first (prevents accidental data loss)

---

### 5. **Pricing History**
**What about price audit trail?**

Products have pricing information (`default_price`, `price_updated_at`, `price_updated_by`)

- ❓ Should price change history be preserved for reporting?
- ❓ Is this data needed for accounting/financial audits?

**My Recommendation**: If hard delete, export audit log first. If soft delete, this is preserved automatically.

---

### 6. **User Permissions**
**Who can delete products?**

- ❓ Only Administrators?
- ❓ Sales Admins too?
- ❓ Should there be a "double confirmation" (like bank wire transfers)?

**My Recommendation**: Administrator + Sales Admin only, with confirmation dialog

---

## 📋 My Proposed Implementation (Pending Your Approval)

Based on industry best practices and your existing system patterns:

### **Recommended Approach: Soft Delete with Strict Validation**

```sql
-- Add columns to ORDERS-products
ALTER TABLE "ORDERS-products" 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id);
```

### **Delete Rules:**
1. ✅ **Can delete if**:
   - Product has NO batches, OR
   - All batches have `quantity = 0` AND `allocated_quantity = 0`
   - Product has NO METRC items linked
   - No active orders reference any batches from this product

2. ❌ **Cannot delete if**:
   - Any batch has `quantity > 0` or `allocated_quantity > 0`
   - Any METRC items are still linked
   - Any pending/processing orders exist

3. 📝 **Soft Delete Process**:
   - Mark product as `is_deleted = TRUE`
   - Set `deleted_at = NOW()` and `deleted_by = user_id`
   - Keep all batch links intact but hidden from UI
   - Log action in audit trail
   - Add "Restore" function for administrators

### **UI Changes:**
- Add "Delete" button in product details page (with conditions check)
- Show warning modal explaining what will happen
- If conditions not met, show specific blockers:
  - "Cannot delete: 3 batches have inventory"
  - "Cannot delete: 2 METRC items still linked"
  - "Cannot delete: 1 pending order references this product"

---

## ⚠️ Alternative: "Archive" Instead of "Delete"

Some clients prefer the term "Archive" as it's clearer that data is preserved:
- Archived products hidden from normal views
- Still accessible in "Archived Products" section
- Can be "Unarchived" if needed
- More user-friendly than "deleted" terminology

**Would you prefer "Archive/Unarchive" over "Delete/Restore"?**

---

## 🚦 Next Steps

Please review the questions above and let me know:
1. Your preference on delete type (soft vs hard)
2. How to handle batches (restrict, cascade archive, orphan, status-based)
3. Should orders block deletion?
4. Must METRC items be unlinked first?
5. Who has permission to delete?
6. Do you prefer "Delete" or "Archive" terminology?

Once I have your answers, I can implement this safely and correctly in ~2-3 hours.

---

**Important Note**: This is about protecting your data integrity and business operations. A rushed implementation could cause:
- Lost sales data
- Broken audit trails  
- Inventory discrepancies
- Order fulfillment issues

Let's make sure we get this right! 🎯


