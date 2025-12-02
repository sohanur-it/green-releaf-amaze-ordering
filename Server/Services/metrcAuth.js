/**
 * Centralized METRC Authentication Service
 * 
 * Handles token management, refresh, and persistence across all sync processes
 * Implements token caching in file store for sharing across processes
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

/**
 * Decode JWT token without verification (to extract expiry)
 */
function decodeJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            return null;
        }
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        return payload;
    } catch (error) {
        return null;
    }
}

class MetrcAuthService {
    constructor() {
        this.apiBaseUrl = process.env.T3_API_BASE_URL || 'https://api.trackandtrace.tools/v2';
        this.username = process.env.T3_USERNAME;
        this.password = process.env.T3_PASSWORD;
        this.hostname = process.env.T3_HOSTNAME || 'mo.metrc.com';
        this.licenseNumber = process.env.T3_LICENSE_NUMBER || 'CUL000063';
        
        // Token cache file path
        this.tokenCacheFile = path.join(__dirname, '../../cache/metrc-tokens.json');
        
        // In-memory token cache
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
        this.refreshTokenExpiry = null;
        
        // Load cached tokens on initialization
        this.loadCachedTokens();
    }

    /**
     * Load tokens from cache file
     */
    async loadCachedTokens() {
        try {
            const cacheDir = path.dirname(this.tokenCacheFile);
            await fs.mkdir(cacheDir, { recursive: true });
            
            const tokenData = await fs.readFile(this.tokenCacheFile, 'utf8');
            const tokens = JSON.parse(tokenData);
            
            // Check if tokens are still valid
            if (tokens.accessToken && tokens.tokenExpiry && new Date() < new Date(tokens.tokenExpiry)) {
                this.accessToken = tokens.accessToken;
                this.refreshToken = tokens.refreshToken;
                this.tokenExpiry = new Date(tokens.tokenExpiry);
                this.refreshTokenExpiry = tokens.refreshTokenExpiry ? new Date(tokens.refreshTokenExpiry) : null;
                
                console.log('🔐 Loaded cached METRC tokens');
                return true;
            } else {
                console.log('🔐 Cached METRC tokens expired, will re-authenticate');
                return false;
            }
        } catch (error) {
            console.log('🔐 No cached METRC tokens found, will authenticate');
            return false;
        }
    }

    /**
     * Save tokens to cache file
     */
    async saveCachedTokens() {
        try {
            const cacheDir = path.dirname(this.tokenCacheFile);
            await fs.mkdir(cacheDir, { recursive: true });
            
            const tokenData = {
                accessToken: this.accessToken,
                refreshToken: this.refreshToken,
                tokenExpiry: this.tokenExpiry?.toISOString(),
                refreshTokenExpiry: this.refreshTokenExpiry?.toISOString(),
                cachedAt: new Date().toISOString()
            };
            
            await fs.writeFile(this.tokenCacheFile, JSON.stringify(tokenData, null, 2));
            console.log('🔐 METRC tokens cached successfully');
        } catch (error) {
            console.error('❌ Failed to cache METRC tokens:', error.message);
        }
    }

    /**
     * Authenticate with METRC T3 API using credentials
     */
    async authenticateWithCredentials() {
        try {
            console.log('🔐 Authenticating with METRC T3 API using credentials...');
            console.log(`🔐 Using hostname: ${this.hostname}, username: ${this.username}`);
            
            const response = await axios.post(`${this.apiBaseUrl}/auth/credentials`, {
                username: this.username,
                password: this.password,
                hostname: this.hostname
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'accept': 'application/json'
                },
                validateStatus: function (status) {
                    return status < 500; // Don't throw for 4xx errors, we'll handle them
                }
            });

            // Check for error response
            if (response.status !== 200) {
                const errorMsg = response.data?.error?.message || response.data?.message || 'Unknown error';
                throw new Error(`METRC API returned ${response.status}: ${errorMsg}`);
            }
            
            if (response.data && response.data.accessToken) {
                this.accessToken = response.data.accessToken;
                this.refreshToken = response.data.refreshToken || null;
                
                // Parse JWT to get actual expiry time from the token
                const decodedToken = decodeJWT(this.accessToken);
                if (decodedToken && decodedToken.exp) {
                    // Use the actual expiry time from the JWT (exp is in seconds)
                    this.tokenExpiry = new Date(decodedToken.exp * 1000);
                    console.log(`🔐 Token expires at: ${this.tokenExpiry.toISOString()}`);
                } else {
                    // Fallback to 24 hours if we can't parse the token
                    this.tokenExpiry = new Date(Date.now() + (24 * 60 * 60 * 1000));
                    console.log('⚠️  Could not parse token expiry, using 24-hour default');
                }
                
                // Set refresh token expiry (typically 30 days)
                if (this.refreshToken) {
                    const decodedRefresh = decodeJWT(this.refreshToken);
                    if (decodedRefresh && decodedRefresh.exp) {
                        this.refreshTokenExpiry = new Date(decodedRefresh.exp * 1000);
                    } else {
                        this.refreshTokenExpiry = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
                    }
                }
                
                // Cache the tokens
                await this.saveCachedTokens();
                
                console.log('✅ METRC authentication successful');
                return true;
            } else {
                throw new Error('Invalid authentication response - no access token received');
            }
        } catch (error) {
            console.error('❌ METRC authentication failed:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', error.response.data);
            }
            return false;
        }
    }

    /**
     * Refresh access token using refresh token
     */
    async refreshAccessToken() {
        try {
            if (!this.refreshToken) {
                console.log('🔐 No refresh token available, falling back to credential authentication');
                return await this.authenticateWithCredentials();
            }

            console.log('🔐 Refreshing METRC access token...');
            
            const response = await axios.post(`${this.apiBaseUrl}/auth/refresh`, {
                refreshToken: this.refreshToken
            });

            if (response.data && response.data.accessToken) {
                this.accessToken = response.data.accessToken;
                
                // Update refresh token if provided
                if (response.data.refreshToken) {
                    this.refreshToken = response.data.refreshToken;
                }
                
                // Parse JWT to get actual expiry time from the token
                const decodedToken = decodeJWT(this.accessToken);
                if (decodedToken && decodedToken.exp) {
                    // Use the actual expiry time from the JWT (exp is in seconds)
                    this.tokenExpiry = new Date(decodedToken.exp * 1000);
                    console.log(`🔐 Refreshed token expires at: ${this.tokenExpiry.toISOString()}`);
                } else {
                    // Fallback to 24 hours if we can't parse the token
                    this.tokenExpiry = new Date(Date.now() + (24 * 60 * 60 * 1000));
                }
                
                // Cache the updated tokens
                await this.saveCachedTokens();
                
                console.log('✅ METRC token refresh successful');
                return true;
            } else {
                throw new Error('Invalid refresh response - no access token received');
            }
        } catch (error) {
            console.error('❌ METRC token refresh failed:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', error.response.data);
            }
            
            // If refresh fails, fall back to credential authentication
            console.log('🔐 Token refresh failed, falling back to credential authentication');
            return await this.authenticateWithCredentials();
        }
    }

    /**
     * Check if access token is valid
     */
    isAccessTokenValid() {
        return this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry;
    }

    /**
     * Check if refresh token is valid
     */
    isRefreshTokenValid() {
        return this.refreshToken && this.refreshTokenExpiry && new Date() < this.refreshTokenExpiry;
    }

    /**
     * Ensure we have a valid access token
     * Automatically refreshes if needed
     */
    async ensureValidToken() {
        if (this.isAccessTokenValid()) {
            return true;
        }

        console.log('🔐 Access token expired or invalid, attempting refresh...');
        
        if (this.isRefreshTokenValid()) {
            const refreshSuccess = await this.refreshAccessToken();
            if (refreshSuccess) {
                return true;
            }
        }

        console.log('🔐 Refresh token expired or refresh failed, re-authenticating with credentials...');
        return await this.authenticateWithCredentials();
    }

    /**
     * Make an authenticated request to METRC API
     * Automatically handles token refresh if needed
     */
    async makeAuthenticatedRequest(config) {
        // Ensure we have a valid token
        const hasValidToken = await this.ensureValidToken();
        if (!hasValidToken) {
            throw new Error('Failed to obtain valid METRC authentication token');
        }

        // Add authorization header
        const requestConfig = {
            ...config,
            headers: {
                ...config.headers,
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        try {
            const response = await axios(requestConfig);
            return response;
        } catch (error) {
            // Enhanced error logging for debugging
            if (error.response) {
                const status = error.response.status;
                const statusText = error.response.statusText;
                const responseData = error.response.data;
                
                console.error(`❌ METRC API Error: ${status} ${statusText}`);
                console.error(`   URL: ${config.url || requestConfig.url}`);
                console.error(`   Method: ${config.method || requestConfig.method || 'GET'}`);
                
                if (responseData) {
                    console.error(`   Response Data:`, JSON.stringify(responseData).substring(0, 500));
                }
                
                // If we get a 401, try to refresh token and retry once
                if (status === 401) {
                    console.log('🔐 Received 401 error, attempting token refresh...');
                    
                    const refreshSuccess = await this.refreshAccessToken();
                    if (refreshSuccess) {
                        // Retry the request with new token
                        requestConfig.headers['Authorization'] = `Bearer ${this.accessToken}`;
                        console.log('🔐 Retrying request with refreshed token...');
                        return await axios(requestConfig);
                    }
                }
                
                // For 500 errors, provide more context
                if (status === 500) {
                    console.error('❌ METRC API returned 500 Internal Server Error');
                    console.error('   This may indicate a temporary METRC API issue');
                    console.error('   The request will be retried on the next sync cycle');
                }
            } else if (error.request) {
                console.error(`❌ METRC API Request Error: No response received`);
                console.error(`   URL: ${config.url || requestConfig.url}`);
                console.error(`   Error: ${error.message}`);
            } else {
                console.error(`❌ METRC API Error: ${error.message}`);
            }
            
            throw error;
        }
    }

    /**
     * Get current token status for debugging
     */
    getTokenStatus() {
        return {
            hasAccessToken: !!this.accessToken,
            hasRefreshToken: !!this.refreshToken,
            accessTokenValid: this.isAccessTokenValid(),
            refreshTokenValid: this.isRefreshTokenValid(),
            accessTokenExpiry: this.tokenExpiry?.toISOString(),
            refreshTokenExpiry: this.refreshTokenExpiry?.toISOString()
        };
    }

    /**
     * Get the current access token (for direct use in API calls)
     */
    async getAccessToken() {
        const hasValidToken = await this.ensureValidToken();
        if (!hasValidToken) {
            throw new Error('Failed to obtain valid METRC authentication token');
        }
        return this.accessToken;
    }

    /**
     * Clear all tokens (for testing or logout)
     */
    async clearTokens() {
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
        this.refreshTokenExpiry = null;
        
        try {
            await fs.unlink(this.tokenCacheFile);
            console.log('🔐 METRC tokens cleared');
        } catch (error) {
            // File might not exist, that's okay
        }
    }
}

// Export singleton instance
module.exports = new MetrcAuthService();