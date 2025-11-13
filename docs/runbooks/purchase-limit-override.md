# Purchase Limit Override Runbook

This runbook documents the approved process for adjusting per-location purchase limits (order total, unshipped invoice count, unpaid invoice count). Use this playbook whenever sales leadership authorises a temporary or permanent change.

---

## Preconditions

- You must have console access to the production application host.
- `scripts/purchase-limit-set.js` ships with the application and relies on the same environment configuration:
  - For production, always export `NODE_ENV=production`.
  - Ensure the latest `.env` for the target environment is present under `config/production.env`.
- You need the internal `users.id` for the administrator approving the change (used for audit logging).

---

## Step-by-step

1. **Identify the location**
   - From the admin portal, open the buyer location record and note `locations.entry_id`.
   - Alternatively run:
     ```sql
     SELECT entry_id, name, state_license
     FROM "ORDERS-buyer_locations"
     WHERE name ILIKE '%<location-name>%';
     ```

2. **Run the CLI utility**
   - Syntax:
     ```bash
     NODE_ENV=production node scripts/purchase-limit-set.js \
       --location <LOCATION_ID> \
       --order <MAX_ORDER_TOTAL_OR_default> \
       --unshipped <MAX_UNSHIPPED_OR_default> \
       --unpaid <MAX_UNPAID_OR_default> \
       --user <ADMIN_USER_ID> \
       --reason "Business justification"
     ```
   - Example (raise order total to $25k, allow 4 unshipped, reset unpaid to default):
     ```bash
     NODE_ENV=production node scripts/purchase-limit-set.js \
       --location 42 \
       --order 25000 \
       --unshipped 4 \
       --unpaid default \
       --user 17 \
       --reason "CFO approved for 11/2025 VIP allocation"
     ```
   - Passing `default` (or omitting a flag) reverts that dimension to the system default (20,000 / 3 / 6).

3. **Validate**
   - Re-run the script with no changes to fetch the persisted row (returns full payload).
   - Verify the admin portal: attempt invoice approval for the affected buyer/location to confirm the new thresholds apply.

4. **Communicate**
   - Capture the CLI output (include the audit log ID) and share with Finance & Compliance via the #ops-notifications channel.

---

## Observability & Audit

- Every invocation records to `ORDERS-audit_log` with action `purchase_limit_override`.
- The affected row in `ORDERS-purchase-limits` captures `last_modified_by` and `last_modified_at`.
- Grafana dashboard `Module4/PurchaseLimits` exposes current overrides and recent CLI activity.

---

## Rollback

- Re-run the CLI setting all values to `default`, e.g.:
  ```bash
  NODE_ENV=production node scripts/purchase-limit-set.js \
    --location 42 \
    --order default \
    --unshipped default \
    --unpaid default \
    --user 17 \
    --reason "Rollback after event"
  ```
- Confirm via admin portal that validations reference defaults again.

---

## Escalation

- For repeated overrides in a short window, involve Finance to reassess the buyer’s standing.
- Any CLI failure logs to the audit trail with status `failure`; escalate to DevOps if the script exits non-zero twice in a row.

