# Module 5: Fulfillment User Guide

## Overview

This guide covers the fulfillment workflow for Module 5, including scanning, manifest creation, and shipment management.

---

## Table of Contents

1. [Fulfillment Queue](#fulfillment-queue)
2. [Package Scanning](#package-scanning)
3. [Manifest Creation](#manifest-creation)
4. [Shipment Tracking](#shipment-tracking)
5. [Cancellation Workflow](#cancellation-workflow)
6. [Troubleshooting](#troubleshooting)

---

## 1. Fulfillment Queue

### Accessing the Queue

Navigate to **Admin > Fulfillment > Queue** to view all invoices ready for fulfillment.

### Queue Statuses

- **Approved**: Invoice approved, ready for fulfillment
- **Fulfillment_Accepted**: Fulfillment team has claimed the order
- **Fulfillment_Issue**: Issue detected during fulfillment
- **Manifested**: Manifest created in METRC
- **Shipped**: Packages shipped
- **Delivered**: Packages delivered

### Claiming an Order

1. Click **"Claim Order"** on an invoice
2. Order status changes to `Fulfillment_Accepted`
3. Order is locked to your user account
4. Begin scanning packages

---

## 2. Package Scanning

### Starting a Scanning Session

1. Click **"Start Scanning"** on a claimed invoice
2. Scanning session begins
3. Scan packages using barcode scanner or manual entry

### Package Validation

The system validates each scanned package:

- ✅ **Valid**: Package belongs to the order's batch
- ⚠️ **Warning**: Package from different batch (requires confirmation)
- ❌ **Error**: Package not found or invalid

### Package Locking

- Packages are automatically locked when scanned
- Locked packages show a lock icon 🔒
- Other workers cannot scan locked packages
- Locks are released when:
  - Scanning session ends
  - Worker disconnects
  - Order is completed

### Completing Scanning

1. Scan all required packages
2. Click **"Complete Scanning"**
3. Review scanned packages
4. Confirm completion

---

## 3. Manifest Creation

### Creating a Manifest

1. Navigate to invoice details
2. Click **"Create Manifest"**
3. Review manifest preview:
   - Package count
   - Destination license
   - Transportation details
4. Run **Dry Run Validation** (recommended)
5. Click **"Create Manifest"** to submit to METRC

### Dry Run Validation

Before creating the actual manifest, run a dry run to validate:

- Package availability in METRC
- Destination license validity
- Transportation details
- Any potential errors

### Manifest Status

- **Pending**: Manifest created, awaiting METRC confirmation
- **Accepted**: METRC accepted the manifest
- **Rejected**: METRC rejected (check errors)
- **Voided**: Manifest voided

---

## 4. Shipment Tracking

### Updating Shipment Status

1. Navigate to invoice details
2. Click **"Update Shipment Status"**
3. Enter transportation details:
   - Driver name
   - License plate
   - Departure time
4. Save changes

### Delivery Confirmation

When packages are delivered:

1. Update invoice status to **"Delivered"**
2. System automatically:
   - Updates batch inventory
   - Promotes "On Deck" batches to "Sellable" (if applicable)
   - Notifies financials module

---

## 5. Cancellation Workflow

### Cancelling a Shipment

1. Navigate to invoice details
2. Click **"Cancel Shipment"**
3. Select cancellation reason
4. Confirm cancellation

### Package Return Process

1. **Mark Packages Returned**: When packages return to inventory
2. **Verify in METRC**: System verifies packages in METRC
3. **Release Allocation**: Allocation is released automatically

### Missing Packages

If packages are missing:

1. Mark as **"Missing"**
2. Enter incident details
3. Admin team will investigate
4. Allocation cannot be released until resolved

### Destroyed Packages

If packages are destroyed:

1. Mark as **"Destroyed"**
2. Enter destruction reason
3. Accounting team is notified
4. Allocation is released

---

## 6. Troubleshooting

### Package Not Found

**Error**: "Package not found in METRC"

**Solutions**:
- Verify package label is correct (24 characters)
- Check if package was transferred or destroyed
- Verify package is in active inventory

### Wrong Package Scanned

**Error**: "Package from batch [X] does not belong to this order"

**Solutions**:
- Remove the package from the order
- Scan the correct package
- Contact admin if package needs to be manually added

### Manifest Creation Failed

**Error**: "METRC API validation failed"

**Solutions**:
- Check dry run validation results
- Verify all packages are available
- Check destination license is valid
- Contact admin if issue persists

### Scanning Session Stuck

**Issue**: Cannot start scanning session

**Solutions**:
- Check if another worker is scanning
- Verify invoice status is `Fulfillment_Accepted`
- Contact admin to release stuck sessions

---

## Best Practices

1. **Always run dry run validation** before creating manifest
2. **Lock packages** when scanning to prevent conflicts
3. **Verify package labels** before scanning
4. **Update shipment status** promptly
5. **Report issues** immediately if packages are missing

---

## Support

For issues or questions:
- Contact fulfillment admin
- Check audit logs for detailed error information
- Review system notifications



