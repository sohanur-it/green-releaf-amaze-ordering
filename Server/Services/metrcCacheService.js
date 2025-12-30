// Server/Services/metrcCacheService.js
// Module 22.2: Caching Strategy for METRC Lookups

/**
 * METRC Cache Service
 * 
 * Caches METRC lookup values (unit IDs, transfer types, etc.) for 24 hours
 * Uses Redis if available, falls back to in-memory cache if Redis is not configured
 */

class MetrcCacheService {
    constructor() {
        this.cacheTTL = 86400; // 24 hours in seconds
        this.memoryCache = new Map(); // Fallback in-memory cache
        this.redisClient = null;
        this.useRedis = false;
        
        // Try to initialize Redis if available
        this.initializeRedis();
    }

    /**
     * Initialize Redis client if Redis is available
     */
    async initializeRedis() {
        try {
            // Check if Redis is configured via environment variable
            const redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST;
            
            if (redisUrl) {
                const redis = require('redis');
                this.redisClient = redis.createClient({
                    url: redisUrl,
                    socket: {
                        reconnectStrategy: (retries) => {
                            if (retries > 10) {
                                console.warn('[METRC Cache] Redis reconnection failed after 10 attempts, using memory cache');
                                return false; // Stop reconnecting
                            }
                            return Math.min(retries * 100, 3000); // Exponential backoff
                        }
                    }
                });

                this.redisClient.on('error', (err) => {
                    console.warn('[METRC Cache] Redis error, falling back to memory cache:', err.message);
                    this.useRedis = false;
                });

                this.redisClient.on('connect', () => {
                    console.log('[METRC Cache] Redis connected successfully');
                    this.useRedis = true;
                });

                await this.redisClient.connect();
                this.useRedis = true;
            } else {
                console.log('[METRC Cache] Redis not configured, using in-memory cache');
            }
        } catch (error) {
            console.warn('[METRC Cache] Redis initialization failed, using memory cache:', error.message);
            this.useRedis = false;
        }
    }

    /**
     * Get cached METRC lookup value
     * @param {string} key - Cache key (e.g., 'unit_ids', 'transfer_types')
     * @param {Function} fetchFunction - Function to fetch value if not cached
     * @returns {Promise<any>} - Cached or fetched value
     */
    async getCachedMETRCLookup(key, fetchFunction) {
        const cacheKey = `metrc:${key}`;
        
        try {
            // Try Redis first if available
            if (this.useRedis && this.redisClient) {
                try {
                    const cached = await this.redisClient.get(cacheKey);
                    if (cached) {
                        console.log(`[METRC Cache] Cache HIT (Redis): ${key}`);
                        return JSON.parse(cached);
                    }
                } catch (redisError) {
                    console.warn('[METRC Cache] Redis get failed, falling back to memory cache:', redisError.message);
                    this.useRedis = false;
                }
            }

            // Check memory cache
            const memoryCached = this.memoryCache.get(cacheKey);
            if (memoryCached && memoryCached.expiry > Date.now()) {
                console.log(`[METRC Cache] Cache HIT (Memory): ${key}`);
                return memoryCached.value;
            }

            // Cache miss - fetch and cache
            console.log(`[METRC Cache] Cache MISS: ${key}`);
            const value = await fetchFunction();

            // Cache in Redis if available
            if (this.useRedis && this.redisClient) {
                try {
                    await this.redisClient.setEx(cacheKey, this.cacheTTL, JSON.stringify(value));
                    console.log(`[METRC Cache] Cached in Redis: ${key} (TTL: ${this.cacheTTL}s)`);
                } catch (redisError) {
                    console.warn('[METRC Cache] Redis set failed:', redisError.message);
                }
            }

            // Cache in memory as fallback
            this.memoryCache.set(cacheKey, {
                value: value,
                expiry: Date.now() + (this.cacheTTL * 1000)
            });

            // Clean up expired memory cache entries periodically
            if (this.memoryCache.size > 1000) {
                this.cleanupMemoryCache();
            }

            return value;
        } catch (error) {
            console.error(`[METRC Cache] Error getting cached value for ${key}:`, error);
            // On error, try to fetch directly
            return await fetchFunction();
        }
    }

    /**
     * Invalidate cache for a specific key
     * @param {string} key - Cache key to invalidate
     */
    async invalidateCache(key) {
        const cacheKey = `metrc:${key}`;
        
        // Invalidate Redis cache
        if (this.useRedis && this.redisClient) {
            try {
                await this.redisClient.del(cacheKey);
                console.log(`[METRC Cache] Invalidated Redis cache: ${key}`);
            } catch (error) {
                console.warn('[METRC Cache] Redis delete failed:', error.message);
            }
        }

        // Invalidate memory cache
        this.memoryCache.delete(cacheKey);
        console.log(`[METRC Cache] Invalidated memory cache: ${key}`);
    }

    /**
     * Clear all METRC caches
     */
    async clearAllCache() {
        // Clear Redis cache (pattern match)
        if (this.useRedis && this.redisClient) {
            try {
                const keys = await this.redisClient.keys('metrc:*');
                if (keys.length > 0) {
                    await this.redisClient.del(keys);
                    console.log(`[METRC Cache] Cleared ${keys.length} Redis cache entries`);
                }
            } catch (error) {
                console.warn('[METRC Cache] Redis clear failed:', error.message);
            }
        }

        // Clear memory cache
        const memoryKeys = Array.from(this.memoryCache.keys()).filter(k => k.startsWith('metrc:'));
        memoryKeys.forEach(key => this.memoryCache.delete(key));
        console.log(`[METRC Cache] Cleared ${memoryKeys.length} memory cache entries`);
    }

    /**
     * Clean up expired memory cache entries
     */
    cleanupMemoryCache() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, entry] of this.memoryCache.entries()) {
            if (entry.expiry <= now) {
                this.memoryCache.delete(key);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            console.log(`[METRC Cache] Cleaned up ${cleaned} expired memory cache entries`);
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            redis_enabled: this.useRedis,
            memory_cache_size: this.memoryCache.size,
            cache_ttl_seconds: this.cacheTTL
        };
    }
}

module.exports = new MetrcCacheService();



