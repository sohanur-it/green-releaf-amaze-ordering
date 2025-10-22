#!/usr/bin/env node

/**
 * Test Script: Audit Logging System
 * 
 * This script demonstrates the audit logging system by:
 * 1. Creating a test order
 * 2. Updating it with various changes
 * 3. Querying the audit logs to show field-level tracking
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });

const { pool } = require('../Server/config/database');
const auditLogger = require('../Server/Services/auditLogger');

async function testAuditLogging() {
    console.log('🧪 Testing Audit Logging System...\n');
    
    try {
        // 1. Create a test order (simulating user action)
        console.log('📝 Step 1: Creating test order...');
        const orderResult = await pool.query(`
            INSERT INTO "ORDERS-orders" 
            (customer_id, total_amount, status, notes, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING *
        `, [999, 100.00, 'pending', 'Initial order']);
        
        const order = orderResult.rows[0];
        console.log(`✅ Order created: ID=${order.order_id}, Total=$${order.total_amount}, Status=${order.status}\n`);
        
        // Log the creation
        await auditLogger.logUserAction(
            42, // Test user ID
            'order_created',
            'Order',
            order.order_id.toString(),
            {
                customer_id: order.customer_id,
                initial_amount: order.total_amount,
                status: order.status
            },
            'success',
            '127.0.0.1'
        );
        
        // 2. Simulate order update with changes
        console.log('📝 Step 2: Updating order (simulating field changes)...');
        
        // Fetch before state
        const beforeResult = await pool.query(
            'SELECT * FROM "ORDERS-orders" WHERE order_id = $1',
            [order.order_id]
        );
        const beforeData = beforeResult.rows[0];
        
        // Update the order
        const updateResult = await pool.query(`
            UPDATE "ORDERS-orders" 
            SET total_amount = $1, status = $2, notes = $3, updated_at = NOW()
            WHERE order_id = $4
            RETURNING *
        `, [150.00, 'confirmed', 'Client requested more items', order.order_id]);
        
        const afterData = updateResult.rows[0];
        
        console.log('Before:', {
            total_amount: beforeData.total_amount,
            status: beforeData.status,
            notes: beforeData.notes
        });
        console.log('After:', {
            total_amount: afterData.total_amount,
            status: afterData.status,
            notes: afterData.notes
        });
        
        // Calculate changes
        const changes = [];
        if (beforeData.total_amount !== afterData.total_amount) {
            changes.push({
                field: 'total_amount',
                oldValue: beforeData.total_amount,
                newValue: afterData.total_amount
            });
        }
        if (beforeData.status !== afterData.status) {
            changes.push({
                field: 'status',
                oldValue: beforeData.status,
                newValue: afterData.status
            });
        }
        if (beforeData.notes !== afterData.notes) {
            changes.push({
                field: 'notes',
                oldValue: beforeData.notes,
                newValue: afterData.notes
            });
        }
        
        // Log the update with changes
        await auditLogger.logUserAction(
            42,
            'order_update',
            'Order',
            order.order_id.toString(),
            {
                method: 'PUT',
                beforeData: {
                    total_amount: beforeData.total_amount,
                    status: beforeData.status,
                    notes: beforeData.notes
                },
                afterData: {
                    total_amount: afterData.total_amount,
                    status: afterData.status,
                    notes: afterData.notes
                },
                changes
            },
            'success',
            '127.0.0.1'
        );
        
        console.log(`✅ Order updated with ${changes.length} field changes logged\n`);
        
        // 3. Query audit logs
        console.log('📊 Step 3: Querying audit logs for this order...\n');
        
        const auditLogs = await auditLogger.getLogs({
            resourceType: 'Order',
            resourceId: order.order_id.toString(),
            limit: 10
        });
        
        console.log(`Found ${auditLogs.length} audit log entries:\n`);
        
        auditLogs.forEach((log, index) => {
            console.log(`Entry ${index + 1}:`);
            console.log(`  Action: ${log.action}`);
            console.log(`  User ID: ${log.userId || 'SYSTEM'}`);
            console.log(`  Timestamp: ${log.timestamp}`);
            console.log(`  Status: ${log.status}`);
            
            if (log.details?.changes) {
                console.log(`  Changes:`);
                log.details.changes.forEach(change => {
                    console.log(`    - ${change.field}: ${change.oldValue} → ${change.newValue}`);
                });
            }
            console.log('');
        });
        
        // 4. Test batch update audit logging
        console.log('📝 Step 4: Testing batch status change audit...');
        
        // Check if we have any batches
        const batchCheck = await pool.query('SELECT * FROM "ORDERS-batches" LIMIT 1');
        
        if (batchCheck.rows.length > 0) {
            const batch = batchCheck.rows[0];
            const oldStatus = batch.status;
            const newStatus = oldStatus === 'On Hold' ? 'On Deck' : 'On Hold';
            
            // Update batch status
            await pool.query(
                'UPDATE "ORDERS-batches" SET status = $1 WHERE id = $2',
                [newStatus, batch.id]
            );
            
            // Log the status change
            await auditLogger.logUserAction(
                42,
                'batch_status_changed',
                'Batch',
                batch.id.toString(),
                {
                    batch_name: batch.batch_name,
                    changes: [{
                        field: 'status',
                        oldValue: oldStatus,
                        newValue: newStatus
                    }],
                    reason: 'Manual status change for testing'
                },
                'success',
                '127.0.0.1'
            );
            
            console.log(`✅ Batch ${batch.batch_name}: ${oldStatus} → ${newStatus}\n`);
        } else {
            console.log('⚠️  No batches found in database, skipping batch test\n');
        }
        
        // 5. Get audit statistics
        console.log('📊 Step 5: Getting audit statistics...\n');
        
        const stats = await auditLogger.getStats();
        
        console.log('Audit Log Statistics:');
        console.log(`  Total Logs: ${stats.totalLogs}`);
        console.log(`  Status Breakdown:`);
        stats.statusBreakdown.forEach(s => {
            console.log(`    - ${s.status}: ${s.count}`);
        });
        console.log(`  Top Actions:`);
        stats.topActions.slice(0, 5).forEach(a => {
            console.log(`    - ${a.action}: ${a.count}`);
        });
        console.log('');
        
        console.log('✅ Audit logging test completed successfully!');
        console.log('\n📖 See docs/guides/AUDIT_LOGGING_SYSTEM.md for full documentation');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
        await auditLogger.close();
    }
}

// Run the test
if (require.main === module) {
    testAuditLogging()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = { testAuditLogging };

