// Server/Services/websocketPerformanceService.js
// Module 13.3: WebSocket Performance Monitoring

class WebSocketPerformanceService {
    constructor() {
        this.broadcasts = [];
        this.maxBroadcastsToTrack = 1000;
    }

    /**
     * Record broadcast latency
     * Should be <100ms
     */
    recordBroadcast(messageType, latencyMs) {
        this.broadcasts.push({
            message_type: messageType,
            latency_ms: latencyMs,
            timestamp: Date.now()
        });

        // Keep only recent broadcasts
        if (this.broadcasts.length > this.maxBroadcastsToTrack) {
            this.broadcasts.shift();
        }
    }

    /**
     * Get broadcast performance metrics
     */
    getBroadcastMetrics(timeWindowMs = 60000) {
        const now = Date.now();
        const windowStart = now - timeWindowMs;
        
        const recentBroadcasts = this.broadcasts.filter(
            b => b.timestamp > windowStart
        );

        if (recentBroadcasts.length === 0) {
            return {
                count: 0,
                avg_latency_ms: 0,
                p50_latency_ms: 0,
                p95_latency_ms: 0,
                p99_latency_ms: 0,
                threshold_ms: 100,
                status: 'no_data'
            };
        }

        const latencies = recentBroadcasts.map(b => b.latency_ms).sort((a, b) => a - b);
        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const p50 = latencies[Math.floor(latencies.length * 0.5)];
        const p95 = latencies[Math.floor(latencies.length * 0.95)];
        const p99 = latencies[Math.floor(latencies.length * 0.99)];

        return {
            count: recentBroadcasts.length,
            avg_latency_ms: Math.round(avg),
            p50_latency_ms: p50,
            p95_latency_ms: p95,
            p99_latency_ms: p99,
            threshold_ms: 100,
            status: p95 < 100 ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get performance by message type
     */
    getMetricsByMessageType(timeWindowMs = 60000) {
        const now = Date.now();
        const windowStart = now - timeWindowMs;
        
        const recentBroadcasts = this.broadcasts.filter(
            b => b.timestamp > windowStart
        );

        const byType = {};
        recentBroadcasts.forEach(b => {
            if (!byType[b.message_type]) {
                byType[b.message_type] = [];
            }
            byType[b.message_type].push(b.latency_ms);
        });

        const result = {};
        Object.keys(byType).forEach(type => {
            const latencies = byType[type].sort((a, b) => a - b);
            const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
            result[type] = {
                count: latencies.length,
                avg_latency_ms: Math.round(avg),
                p95_latency_ms: latencies[Math.floor(latencies.length * 0.95)]
            };
        });

        return result;
    }
}

module.exports = new WebSocketPerformanceService();



