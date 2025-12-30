// Server/Services/metrcRateLimiter.js
// Module 13.2: METRC API Rate Limiting

class MetrcRateLimiter {
    constructor() {
        this.requests = [];
        this.maxRequestsPerMinute = 60; // METRC typically allows 60 requests/minute
        this.retryDelays = [1000, 2000, 4000]; // Exponential backoff delays in ms
    }

    /**
     * Check if request can be made (rate limit check)
     */
    canMakeRequest() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        
        // Remove requests older than 1 minute
        this.requests = this.requests.filter(timestamp => timestamp > oneMinuteAgo);
        
        return this.requests.length < this.maxRequestsPerMinute;
    }

    /**
     * Record a request
     */
    recordRequest() {
        this.requests.push(Date.now());
    }

    /**
     * Wait if rate limit exceeded
     */
    async waitIfNeeded() {
        if (!this.canMakeRequest()) {
            const waitTime = 60000 - (Date.now() - this.requests[0]);
            if (waitTime > 0) {
                console.log(`[Rate Limiter] Rate limit reached, waiting ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    /**
     * Execute request with rate limiting and retry logic
     */
    async executeWithRateLimit(requestFn, retryCount = 0) {
        await this.waitIfNeeded();
        
        try {
            this.recordRequest();
            return await requestFn();
        } catch (error) {
            // Handle 429 Too Many Requests
            if (error.response && error.response.status === 429) {
                if (retryCount < this.retryDelays.length) {
                    const delay = this.retryDelays[retryCount];
                    console.log(`[Rate Limiter] 429 error, retrying after ${delay}ms (attempt ${retryCount + 1})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.executeWithRateLimit(requestFn, retryCount + 1);
                } else {
                    throw new Error('Rate limit exceeded after retries');
                }
            }
            throw error;
        }
    }

    /**
     * Get current rate limit status
     */
    getStatus() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        this.requests = this.requests.filter(timestamp => timestamp > oneMinuteAgo);
        
        return {
            requests_in_last_minute: this.requests.length,
            max_requests_per_minute: this.maxRequestsPerMinute,
            can_make_request: this.canMakeRequest(),
            wait_time_ms: this.canMakeRequest() ? 0 : 60000 - (now - this.requests[0])
        };
    }
}

module.exports = new MetrcRateLimiter();



