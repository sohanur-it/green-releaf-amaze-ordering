# Admin Sync API Testing Guide

## 🎯 Overview

This guide explains how to test the admin sync API endpoints that allow administrators to trigger METRC sync services on demand. The system includes centralized JWT authentication, token persistence, and automatic token refresh.

## 🔐 Authentication System

### JWT Token Management
- **Authentication Endpoint**: `POST /v2/auth/credentials`
- **Token Refresh Endpoint**: `POST /v2/auth/refresh`
- **Token Persistence**: Cached in file store for sharing across sync processes
- **Automatic Refresh**: Tokens are refreshed automatically when expired

### Credentials Storage
- METRC credentials stored securely in environment variables
- Single user credentials for all endpoints
- Environment-specific configuration (`config/production.env`)

## 🧪 Testing Methods

### Method 1: Direct API Testing (Requires Authentication)

#### Test Sync Status API
```bash
curl -X GET http://localhost:3000/api/v1/admin/sync/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>"
```

#### Test Individual Sync Endpoints
```bash
# Active Packages Sync
curl -X POST http://localhost:3000/api/v1/admin/sync/active-packages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>"

# Outgoing Transfers Sync
curl -X POST http://localhost:3000/api/v1/admin/sync/outgoing-transfers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>"

# Strains Sync
curl -X POST http://localhost:3000/api/v1/admin/sync/strains \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>"

# Items Sync
curl -X POST http://localhost:3000/api/v1/admin/sync/items \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>"

# Transferred Packages Sync
curl -X POST http://localhost:3000/api/v1/admin/sync/transferred-packages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>"

# In-Transit Packages Sync
curl -X POST http://localhost:3000/api/v1/admin/sync/intransit-packages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>"
```

### Method 2: Automated Testing Script

#### Run Comprehensive API Test
```bash
npm run test:sync-api
```

**Expected Output:**
```
🧪 Testing Admin Sync API Endpoints
📊 Environment: production
🌐 Server: http://localhost:3000

📡 Testing Sync API Endpoints:
✅ Active Packages Sync: 302 - Redirect to login (Authentication required)
✅ Outgoing Transfers Sync: 302 - Redirect to login (Authentication required)
✅ Strains Sync: 302 - Redirect to login (Authentication required)
✅ Items Sync: 302 - Redirect to login (Authentication required)
✅ Transferred Packages Sync: 302 - Redirect to login (Authentication required)
✅ In-Transit Packages Sync: 302 - Redirect to login (Authentication required)
✅ Sync Status: 302 - Redirect to login (Authentication required)

🔄 Testing Manual Sync Execution:
✅ Active Packages Manual Sync: Authentication successful, 100 packages retrieved
✅ Outgoing Transfers Manual Sync: Authentication successful, 8 transfers processed
✅ Strains Manual Sync: Authentication successful, 100 strains processed

⏰ Testing Scheduler Status:
✅ Scheduler Status: running with all 6 sync jobs scheduled
```

### Method 3: Direct Command Line Testing

#### Test Individual Sync Commands
```bash
# Test Active Packages Sync
npm run sync:active:prod

# Test Outgoing Transfers Sync
npm run sync:outgoing:prod

# Test Strains Sync
npm run sync:strains:prod

# Test Items Sync
npm run sync:items:prod

# Test Transferred Packages Sync
npm run sync:transferred:prod

# Test In-Transit Packages Sync
npm run sync:intransit:prod

# Test All Syncs
npm run sync:all:prod
```

## 📊 API Endpoint Specifications

### Sync Status Endpoint
- **URL**: `GET /api/v1/admin/sync/status`
- **Purpose**: Get current sync status and scheduler information
- **Response**: JSON with scheduler status, running jobs, and schedules

### Individual Sync Endpoints
- **URL**: `POST /api/v1/admin/sync/{serviceName}`
- **Purpose**: Trigger specific sync service on demand
- **Service Names**:
  - `active-packages`
  - `outgoing-transfers`
  - `strains`
  - `items`
  - `transferred-packages`
  - `intransit-packages`

## 🔍 Authentication Testing

### Test METRC Authentication
```bash
# Test METRC API connectivity
npm run test:metrc

# Test production environment
npm run test:production
```

### Verify Token Persistence
```bash
# Check if tokens are cached
ls -la | grep -i token

# Check authentication logs
# Look for "Loaded cached METRC tokens" in server logs
```

## 🚨 Current Issues and Solutions

### Issue 1: Database Connection Timeout
**Problem**: Login functionality fails due to database connection timeouts
**Impact**: API endpoints redirect to login, preventing direct API testing
**Solution**: 
1. Check database connectivity: `npm run schema:check`
2. Verify production database credentials
3. Test database connection: `npm run test:sync-data`

### Issue 2: Authentication Required
**Problem**: All sync API endpoints require authentication
**Impact**: Direct API testing requires valid JWT tokens
**Solution**: 
1. Use manual sync commands for testing
2. Implement proper authentication flow
3. Test authenticated API calls

## ✅ Verification Checklist

### API Endpoints
- [ ] Sync status endpoint accessible
- [ ] All 6 sync endpoints respond correctly
- [ ] Proper HTTP status codes returned
- [ ] Authentication protection working

### Manual Sync Commands
- [ ] Active packages sync working
- [ ] Outgoing transfers sync working
- [ ] Strains sync working
- [ ] Items sync working
- [ ] Transferred packages sync working
- [ ] In-transit packages sync working

### Authentication System
- [ ] METRC API authentication working
- [ ] Token persistence functioning
- [ ] Token refresh mechanism working
- [ ] Centralized authentication module working

### Scheduler Integration
- [ ] Scheduler running and monitoring
- [ ] All sync jobs scheduled correctly
- [ ] Manual triggers working
- [ ] Automated execution functioning

## 🎯 Success Criteria

### API Testing Success
- ✅ All sync endpoints return proper status codes
- ✅ Authentication protection is working
- ✅ Manual sync commands execute successfully
- ✅ Scheduler status is accessible

### Authentication Success
- ✅ METRC API authentication working
- ✅ Token persistence and refresh working
- ✅ Centralized authentication module functioning
- ✅ Sync processes sharing authentication tokens

### Integration Success
- ✅ API endpoints trigger sync processes
- ✅ Manual and automated syncs working
- ✅ Real-time data synchronization
- ✅ Error handling and recovery working

## 📞 Troubleshooting

### Common Issues
1. **302 Redirects**: Expected behavior - endpoints require authentication
2. **Database Timeouts**: Check production database connectivity
3. **Authentication Failures**: Verify METRC credentials and token persistence
4. **Sync Failures**: Check individual sync script logs

### Debug Commands
```bash
# Check server status
curl http://localhost:3000

# Check scheduler status
npm run scheduler:status

# Test database connectivity
npm run schema:check

# Test sync data
npm run test:sync-data

# Run comprehensive API test
npm run test:sync-api
```

---

**Last Updated:** October 17, 2025  
**Version:** Admin Sync API Testing Guide v1.0
