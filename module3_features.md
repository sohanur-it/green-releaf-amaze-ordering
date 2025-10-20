# Module 3 – Product & Inventory Management

## 🎯 Core Objective
Transform raw METRC package data into a **sales-optimized product and batch management system**.  
This includes schema extensions, synchronization logic, pricing engine, and operational APIs with full auditing and traceability.

---

## ✅ 1. Database Schema (DDL + Migrations)

<details>
<summary>📂 ORDERS-products (Modify)</summary>

- [ ] Add `metrc_linked_items jsonb DEFAULT '[]'::jsonb`
- [ ] Add `default_price numeric(10,2)`
- [ ] Add `price_updated_at timestamptz`
- [ ] Add `price_updated_by int REFERENCES users(id)`
- [ ] Create index for JSONB lookups on `metrc_linked_items`
</details>

<details>
<summary>📂 ORDERS-batches (Create)</summary>

- [ ] Fields: counts, JSONB details, potency, production dates, flags, status enum (`batch_status`)
- [ ] Include: `override_price`, linkage to master product (`fk_master_product_id`)
- [ ] Indexes:
  - [ ] `fk_master_product_id`
  - [ ] `status`
  - [ ] `metrc_item_name`
  - [ ] `production_date`
  - [ ] `synclicense`
  - [ ] Partial composite: `(fk_master_product_id, status, quantity)` where `quantity > allocated_quantity`
</details>

<details>
<summary>📂 ORDERS-batch-history (Create)</summary>

- [ ] Full audit schema: `type`, `field`, `old/new`, `details`, `reason`, `user/system`
- [ ] Indexes: `batch_id`, `timestamp`, `change_type`
</details>

<details>
<summary>📂 ORDERS-product-categories (Create)</summary>

- [ ] Add table and FK `fk_category_id` to `ORDERS-products`
</details>

**Acceptance Criteria:**
- [ ] All migrations run idempotently on production
- [ ] Constraints, FKs, and indexes verified
- [ ] Permissions consistent with existing roles

---

## ✅ 2. Batch Extraction Query (METRC → Business Batches)

- [ ] Implement `metrc-batch-extractor-query.sql`
- [ ] Use CTEs:
  - [ ] `filtered_packages`
  - [ ] THC join (`thc_results` + `test_dates`)
  - [ ] Join to items for weight/unit specs
- [ ] Classify full vs partial packages
- [ ] Add data quality flags
- [ ] Aggregate by `(item_name, first_sourcepackage_label, synclicense)`

**Output:**
- [ ] One row per batch
- [ ] Include `sellable_quantity`, averaged THC, storage, flags, and key dates

**Acceptance:**
- [ ] Query runs efficiently on production dataset
- [ ] Results align with business validation

---

## ✅ 3. Batch Sync Service

**Main Function:** `BatchSyncService.syncBatches()`

- [ ] Execute extraction query
- [ ] Load existing `orders-batches`
- [ ] Detect changes (new, updated, removed, package-level)
- [ ] Investigate removed packages (allocated/transferred/inactive/unknown)
- [ ] Apply updates in DB transaction, preserving existing status
- [ ] Log all changes in `orders-batch-history`

**Helper Methods:**
- [ ] `executeBatchExtractionQuery()`
- [ ] `loadExistingBatches()`
- [ ] `detectChanges()`
- [ ] `comparePackageLabels()`
- [ ] `applyChangesWithHistory()`
- [ ] `investigateRemovedPackage()`
- [ ] `getBatchIdByName()`

**Acceptance:**
- [ ] Idempotent and retry-safe
- [ ] History entries accurate
- [ ] Runtime within cron window

---

## ✅ 4. Auto-Promotion & Status Management

**Auto-Promotion Logic**
- [ ] Trigger when sum of `(quantity - allocated_quantity)` for all Sellable batches = 0
- [ ] Promote all “On Deck” batches for the same master product to “Sellable”
- [ ] Log status changes in history and audit tables

**Manual Status Change**
- [ ] API for updating batch status
- [ ] Validation: block “Sellable” if critical flags or missing potency (unless overridden)

**Acceptance:**
- [ ] Handles edge cases (no On Deck, existing allocations)
- [ ] Prevents invalid Sellable transitions

---

## ✅ 5. Pricing Engine

**Effective Price Resolver**
- [ ] `override_price` (batch) > `default_price` (product)

**Product Price Management**
- [ ] Update product `default_price` with `price_updated_at` and `price_updated_by`
- [ ] Fetch sibling products in category for bulk update prompt

**Bulk Category Pricing**
- [ ] Apply new price to all in category (excluding exceptions)
- [ ] Audit all changes

**Batch Override Price**
- [ ] Set override per batch
- [ ] Log old/new values + reason

**Acceptance:**
- [ ] Deterministic price resolution in API responses
- [ ] Bulk ops safe and auditable

---

## ✅ 6. Allocation Scaffolding (Module 4 Preview)

- [ ] Support `FOR UPDATE` row locking
- [ ] Increment `allocated_quantity`
- [ ] Post-allocation: trigger auto-promotion check

**Acceptance:**
- [ ] No overselling under concurrent requests
- [ ] Verified with parallel test runs

---

## ✅ 7. API Endpoints

<details>
<summary>🧱 Master Product APIs</summary>

- [ ] `POST /api/v1/products/master` — Create Master Product  
- [ ] `POST /api/v1/products/master/:id/link-items` — Preview linked METRC items  
- [ ] `POST /api/v1/products/master/:id/link-items/confirm` — Confirm link  
- [ ] `DELETE /api/v1/products/master/:id/unlink-item` — Unlink item
</details>

<details>
<summary>📦 Batch APIs</summary>

- [ ] `GET /api/v1/products/master/:id/batches?status=&sort=` — List batches  
- [ ] `PATCH /api/v1/batches/:id/status` — Change batch status  
- [ ] `PATCH /api/v1/batches/:id/price` — Override batch price  
- [ ] `PATCH /api/v1/batches/:id/thc-override` — Override potency  
- [ ] `GET /api/v1/batches/:id/history` — View change history
</details>

<details>
<summary>💰 Pricing APIs</summary>

- [ ] `PATCH /api/v1/products/master/:id/price` — Update product price  
- [ ] `POST /api/v1/products/categories/:categoryName/bulk-price-update` — Bulk update by category
</details>

<details>
<summary>🧭 Admin / Sync APIs</summary>

- [ ] `POST /api/v1/admin/sync/batches` — Trigger manual batch sync
</details>

**Acceptance:**
- [ ] RBAC permissions enforced  
- [ ] Swagger documentation ready  
- [ ] Input validation and error handling verified

---

## ✅ 8. Scheduling & Orchestration

- [ ] Cron job: `*/15 8-18 * * 1-5`  
- [ ] Prevent overlapping runs  
- [ ] On-demand manual sync endpoint  
- [ ] Log summary (new/updated/removed counts, duration)

**Acceptance:**
- [ ] Appears in master scheduler status dashboard  
- [ ] No concurrent execution conflicts

---

## ✅ 9. Auditing & History

- [ ] Log all system/user actions:
  - Batch updates  
  - Product price changes (single + bulk)  
  - Linking/unlinking METRC items  
  - Auto-promotions
- [ ] Maintain immutable, queryable logs

**Acceptance:**
- [ ] Full compliance audit trail maintained

---

## ✅ 10. Swagger Documentation

- [ ] Annotate all new endpoints with OpenAPI
- [ ] Include request/response schemas and examples
- [ ] Integrate JWT/session-based security

**Acceptance:**
- [ ] All endpoints visible and testable in `/api-docs`

---

## ✅ 11. Permissions & Security

- [ ] Define scopes:
  - `inventory.read`
  - `inventory.write`
  - `pricing.write`
  - `batch.update_status`
  - `admin.sync`
- [ ] Enforce with middleware

**Acceptance:**
- [ ] Unauthorized → `401/403`  
- [ ] Valid scopes enforced at route level

---

## ✅ 12. Testing & Validation

- [ ] SQL smoke tests for migrations & indexes
- [ ] Unit tests:
  - [ ] Change detection  
  - [ ] Validation logic  
  - [ ] Promotion logic  
  - [ ] Pricing resolution
- [ ] Integration tests for sync cycle → API read verification
- [ ] Load tests for batch extraction query

**Acceptance:**
- [ ] All tests pass  
- [ ] Meets runtime performance benchmarks

---

## ✅ 13. Operational Considerations

| Area | Tasks |
|------|-------|
| Migration rollout | [ ] Backup before DDL; feature flags for safety |
| Observability | [ ] Structured logs (counts, timings) |
| Metrics | [ ] Hook into monitoring for dashboards |
| Rollback plan | [ ] Revert scripts for schema and data |

---

## ✅ 14. Risks & Mitigations

| Risk | Mitigation |
|------|-------------|
| Long extraction queries | Optimize with indexes and filters |
| Data quality issues | Flags and validation gates |
| Race conditions on allocation | Row locks + retries |
| Promotion storms | Debounce per master product |

---

🧾 **Summary**
Module 3 provides the operational backbone for **product, batch, and pricing management**, integrating seamlessly with METRC and internal allocation logic.  
Every change is auditable, sync operations are idempotent, and all actions are governed by strict RBAC and traceability.
