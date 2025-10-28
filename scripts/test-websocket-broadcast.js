/**
 * WebSocket Broadcast Test Script
 * 
 * Usage: node scripts/test-websocket-broadcast.js
 * 
 * This script allows you to manually test WebSocket broadcasts
 * by triggering inventory updates and new inventory availability messages
 */

const path = require('path');
const net = require('net');
const WebSocket = require('ws');
require('dotenv').config({ path: path.join(__dirname, '../config/local.env') });

/**
 * Check if a port is in use
 */
function isPortInUse(port) {
    return new Promise((resolve) => {
        const server = net.createServer()
            .listen(port, () => {
                server.once('close', () => resolve(false));
                server.close();
            })
            .on('error', () => resolve(true));
    });
}

async function testWebSocketBroadcast() {
    try {
        console.log('🧪 Starting WebSocket Client Test...\n');

        // Check if WebSocket server port is in use
        const portInUse = await isPortInUse(8080);
        
        if (!portInUse) {
            console.log('⚠️  WebSocket server is not running!');
            console.log('💡 Please start the main server first: npm start');
            console.log('   The WebSocket server should be running on port 8080\n');
            process.exit(1);
        }

        console.log('✅ WebSocket server is running on port 8080');
        console.log('📡 Connecting to WebSocket server...\n');

        // Connect as a WebSocket client
        const ws = new WebSocket('ws://localhost:8080');

        ws.on('open', () => {
            console.log('✅ Connected to WebSocket server!\n');
            
            // Subscribe to a test batch
            const batchId = process.argv[2] || 1;
            console.log(`📊 Subscribing to batch ID: ${batchId}\n`);
            ws.send(JSON.stringify({
                type: 'subscribe_batch',
                batch_id: parseInt(batchId)
            }));

            console.log('👂 Listening for messages...');
            console.log('💡 To test broadcasts, use the API or admin panel');
            console.log('   - Auto-promotion: Deplete inventory to trigger auto-promote');
            console.log('   - Manual status: Change batch status via API\n');
            console.log('   Example API call:');
            console.log('   curl -X PATCH http://localhost:3000/api/v1/batches/1/status \\');
            console.log('     -H "Content-Type: application/json" \\');
            console.log('     -d \'{"status": "Sellable"}\'\n');
            console.log('⏳ Waiting for messages (press Ctrl+C to exit)...\n');
        });

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                console.log('📨 Received message:', message);
            } catch (err) {
                console.log('📨 Received (raw):', data.toString());
            }
        });

        ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error.message);
        });

        ws.on('close', () => {
            console.log('\n🔌 Connection closed');
            process.exit(0);
        });

        // Keep the script running
        process.on('SIGINT', () => {
            console.log('\n\n👋 Disconnecting...');
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            } else {
                process.exit(0);
            }
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Run the test
testWebSocketBroadcast();

