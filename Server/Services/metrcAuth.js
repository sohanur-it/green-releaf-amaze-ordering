/**
 * Centralized METRC Authentication Service
 * 
 * Handles JWT token management, persistence, and refresh logic
 * Shared across all sync services and API endpoints
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class MetrcAuthService {
    constructor() {
        this.apiBaseUrl = process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
        this.hostname = process.env.T3_HOSTNAME || 'mo.metrc.com';
        this.username = process.env.T3_USERNAME || 'AGT007392';
        this.password = process.env.T3_PASSWORD || 'Metalhead4!';
        
        this.tokenCacheFile = path.join(__dirname, '../.metrc-tokens.json');
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
        this.isRefreshing = false;
        this.refreshSubscribers = [];
        
        // Load cached tokens on initialization
        this.loadCachedTokens();
    }

    /**
     * Load tokens from cache file
     */
    async loadCachedTokens() {
        try {
            const tokenData = await fs.readFile(this.tokenCacheFile, 'utf8');
            const tokens = JSON.parse(tokenData);
            
            this.accessToken = tokens.accessToken;
            this.refreshToken = tokens.refreshToken;
            this.tokenExpiry = tokens.expiry ? new Date(tokens.expiry) : null;
            
            console.log('🔐 Loaded cached METRC tokens');
        } catch (error) {
            // File doesn't exist or is invalid, start fresh
            console.log('🔐 No cached tokens found, will authenticate fresh');
        }
    }

    /**
     * Save tokens to cache file
     */
    async saveCachedTokens() {
        try {
            const tokenData = {
                accessToken: this.accessToken,
                refreshToken: this.refreshToken,
                expiry: this.tokenExpiry ? this.tokenExpiry.toISOString() : null,
                cachedAt: new Date().toISOString()
            };
            
            await fs.writeFile(this.tokenCacheFile, JSON.stringify(tokenData, null, 2));
            console.log('🔐 Cached METRC tokens');
        } catch (error) {
            console.error('❌ Failed to cache tokens:', error.message);
        }
    }

    /**
     * Check if current token is valid
     */
    isTokenValid() {
        if (!this.accessToken || !this.tokenExpiry) {
            return false;
        }
        
        // Check if token expires in the next 5 minutes
        const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
        return this.tokenExpiry > fiveMinutesFromNow;
    }

    /**
     * Authenticate with METRC API using credentials
     */
    async authenticateWithCredentials() {
        try {
            console.log('🔐 Authenticating with METRC API using credentials...');
            
            const response = await axios.post(`${this.apiBaseUrl}/auth/credentials`, {
                hostname: this.hostname,
                username: this.username,
                password: this.password
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'accept': 'application/json'
                },
                timeout: 30000
            });

            if (response.data && response.data.accessToken) {
                this.accessToken = response.data.accessToken;
                this.refreshToken = response.data.refreshToken || this.refreshToken;
                
                // Set expiry to 1 hour from now (typical JWT expiry)
                this.tokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
                
                await this.saveCachedTokens();
                console.log('✅ METRC authentication successful');
                
                return this.accessToken;
            } else {
                throw new Error('Invalid authentication response');
            }
        } catch (error) {
            console.error('❌ METRC authentication failed:', error.response?.data?.message || error.message);
            throw error;
        }
    }

    /**
     * Refresh access token using refresh token
     */
    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        try {
            console.log('🔄 Refreshing METRC access token...');
            
            const response = await axios.post(`${this.apiBaseUrl}/auth/refresh`, {}, {
                headers: {
                    'Authorization': `Bearer ${this.refreshToken}`,
                    'accept': 'application/json'
                },
                timeout: 30000
            });

            if (response.data && response.data.accessToken) {
                this.accessToken = response.data.accessToken;
                this.refreshToken = response.data.refreshToken || this.refreshToken;
                
                // Set expiry to 1 hour from now
                this.tokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
                
                await this.saveCachedTokens();
                console.log('✅ METRC token refresh successful');
                
                return this.accessToken;
            } else {
                throw new Error('Invalid refresh response');
            }
        } catch (error) {
            console.error('❌ METRC token refresh failed:', error.response?.data?.message || error.message);
            throw error;
        }
    }

    /**
     * Get valid access token (handles refresh automatically)
     */
    async getValidToken() {
        // If already refreshing, wait for it to complete
        if (this.isRefreshing) {
            return new Promise((resolve) => {
                this.refreshSubscribers.push(resolve);
            });
        }

        // Check if current token is valid
        if (this.isTokenValid()) {
            return this.accessToken;
        }

        // Try to refresh token first
        if (this.refreshToken) {
            try {
                this.isRefreshing = true;
                const newToken = await this.refreshAccessToken();
                
                // Notify waiting subscribers
                this.refreshSubscribers.forEach(resolve => resolve(newToken));
                this.refreshSubscribers = [];
                this.isRefreshing = false;
                
                return newToken;
            } catch (error) {
                console.log('🔄 Token refresh failed, falling back to credential authentication');
                this.isRefreshing = false;
                this.refreshSubscribers.forEach(resolve => resolve(null));
                this.refreshSubscribers = [];
            }
        }

        // Fall back to credential authentication
        return await this.authenticateWithCredentials();
    }

    /**
     * Make authenticated API request with automatic token management
     */
    async makeAuthenticatedRequest(config) {
        const token = await this.getValidToken();
        
        if (!token) {
            throw new Error('Failed to obtain valid access token');
        }

        // Add authorization header
        config.headers = {
            ...config.headers,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'accept': 'application/json'
        };

        try {
            return await axios(config);
        } catch (error) {
            // If 401 error, try to refresh token and retry once
            if (error.response?.status === 401) {
                console.log('🔄 Received 401, attempting token refresh...');
                
                try {
                    await this.refreshAccessToken();
                    const newToken = await this.getValidToken();
                    
                    config.headers['Authorization'] = `Bearer ${newToken}`;
                    return await axios(config);
                } catch (refreshError) {
                    console.error('❌ Token refresh failed, re-authenticating...');
                    await this.authenticateWithCredentials();
                    const newToken = await this.getValidToken();
                    
                    config.headers['Authorization'] = `Bearer ${newToken}`;
                    return await axios(config);
                }
            }
            
            throw error;
        }
    }

    /**
     * Clear cached tokens (for logout or reset)
     */
    async clearTokens() {
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
        
        try {
            await fs.unlink(this.tokenCacheFile);
            console.log('🔐 Cleared cached METRC tokens');
        } catch (error) {
            // File might not exist, that's okay
        }
    }

    /**
     * Get token status for monitoring
     */
    getTokenStatus() {
        return {
            hasAccessToken: !!this.accessToken,
            hasRefreshToken: !!this.refreshToken,
            isTokenValid: this.isTokenValid(),
            tokenExpiry: this.tokenExpiry,
            isRefreshing: this.isRefreshing
        };
    }
}

// Export singleton instance
module.exports = new MetrcAuthService();
