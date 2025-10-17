# 🧪 METRC T3 API Testing Guide

## 📋 Overview

This guide provides comprehensive testing instructions for all METRC T3 API endpoints required for Module 2 implementation. Use this guide to test the APIs before implementing the sync services.

---

## 🔑 API Credentials

**Base URL**: `https://api.trackandtrace.tools/v2`  
**Hostname**: `mo.metrc.com`  
**Username**: `AGT007392`  
**Password**: `Metalhead4!`  
**License**: `CUL000063`

---

## 📊 Required API Endpoints (From REMAINING_FEATURES.md)

Based on the remaining features, we need to test these 6 critical endpoints:

### 1. **Active Packages** ✅ (Already Working)
- **Endpoint**: `GET /v2/packages/active`
- **Strategy**: Full Mirror Sync
- **Frequency**: Every 10 minutes

### 2. **Transferred Packages** ❌ (Needs Testing)
- **Endpoint**: `GET /v2/packages/transferred`
- **Strategy**: Incremental (Delta)
- **Frequency**: Every 10 minutes

### 3. **In-Transit Packages** ❌ (Needs Testing)
- **Endpoint**: `GET /v2/packages/intransit`
- **Strategy**: Full Mirror Sync
- **Frequency**: Every 5 minutes

### 4. **Outgoing Transfers** ❌ (Needs Testing)
- **Endpoint**: `GET /v2/transfers/outgoing/active`
- **Strategy**: Incremental (Delta)
- **Frequency**: Every 5 minutes

### 5. **Items** ❌ (Needs Testing)
- **Endpoint**: `GET /v2/items`
- **Strategy**: Incremental (Delta)
- **Frequency**: Every 60 minutes

### 6. **Strains** ❌ (Needs Testing)
- **Endpoint**: `GET /v2/strains`
- **Strategy**: Incremental (Delta)
- **Frequency**: Every 60 minutes

---

## 🔐 Authentication Flow

### Step 1: Get Access Token

**Endpoint**: `POST /v2/auth/credentials`

**Request**:
```bash
curl -X POST "https://api.trackandtrace.tools/v2/auth/credentials" \
  -H "Content-Type: application/json" \
  -H "accept: application/json" \
  -d '{
    "hostname": "mo.metrc.com",
    "username": "AGT007392",
    "password": "Metalhead4!"
  }'
```

**Response**:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Step 2: Use Access Token

Include the token in all subsequent requests:
```bash
-H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Step 3: Refresh Token (When Needed)

**Endpoint**: `POST /v2/auth/refresh`

**Request**:
```bash
curl -X POST "https://api.trackandtrace.tools/v2/auth/refresh" \
  -H "Authorization: Bearer YOUR_REFRESH_TOKEN" \
  -H "accept: application/json"
```

---

## 🧪 API Testing Commands

### 1. Active Packages (Already Working)

```bash
curl -X GET "https://api.trackandtrace.tools/v2/packages/active?licenseNumber=CUL000063&strictPagination=true&pageSize=500&page=1" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "accept: application/json"
```

### 2. Transferred Packages

```bash
curl -X GET "https://api.trackandtrace.tools/v2/packages/transferred?licenseNumber=CUL000063&strictPagination=true&pageSize=500&page=1" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "accept: application/json"
```

### 3. In-Transit Packages

```bash
curl -X GET "https://api.trackandtrace.tools/v2/packages/intransit?licenseNumber=CUL000063&strictPagination=true&pageSize=500&page=1" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "accept: application/json"
```

### 4. Outgoing Transfers

```bash
curl -X GET "https://api.trackandtrace.tools/v2/transfers/outgoing/active?licenseNumber=CUL000063&strictPagination=true&pageSize=500&page=1" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "accept: application/json"
```

### 5. Items

```bash
curl -X GET "https://api.trackandtrace.tools/v2/items?licenseNumber=CUL000063&strictPagination=true&pageSize=500&page=1" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "accept: application/json"
```

### 6. Strains

```bash
curl -X GET "https://api.trackandtrace.tools/v2/strains?licenseNumber=CUL000063&strictPagination=true&pageSize=500&page=1" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "accept: application/json"
```

---

## 📝 Testing Checklist

### Authentication Testing
- [ ] **Get Access Token**: Test credential authentication
- [ ] **Token Validity**: Verify token works with API calls
- [ ] **Token Refresh**: Test refresh token functionality
- [ ] **Token Expiration**: Test behavior when token expires

### Data Endpoint Testing
- [ ] **Active Packages**: Verify data structure and pagination
- [ ] **Transferred Packages**: Test incremental sync parameters
- [ ] **In-Transit Packages**: Verify full mirror sync data
- [ ] **Outgoing Transfers**: Test manifest data structure
- [ ] **Items**: Verify product/item data
- [ ] **Strains**: Test strain information

### Error Handling Testing
- [ ] **Invalid Credentials**: Test 401 responses
- [ ] **Expired Token**: Test token refresh flow
- [ ] **Rate Limiting**: Test API rate limits
- [ ] **Network Timeouts**: Test timeout handling
- [ ] **Invalid Parameters**: Test parameter validation

### Pagination Testing
- [ ] **Page Size Limits**: Test different page sizes (100, 500, 1000)
- [ ] **Page Navigation**: Test multiple pages
- [ ] **Empty Results**: Test when no data available
- [ ] **Large Datasets**: Test with large result sets

---

## 🔧 Common Parameters

### Standard Parameters for All Endpoints

```json
{
  "licenseNumber": "CUL000063",
  "strictPagination": true,
  "pageSize": 500,
  "page": 1
}
```

### Incremental Sync Parameters (For Delta Sync)

```json
{
  "licenseNumber": "CUL000063",
  "lastModified": "2025-01-01T00:00:00Z",
  "strictPagination": true,
  "pageSize": 500,
  "page": 1
}
```

---

## 📊 Expected Response Formats

### Successful Response
```json
{
  "data": [
    {
      "id": 12345,
      "label": "1A40E0100000067000001234",
      "item": {
        "id": 67890,
        "name": "Product Name"
      },
      "quantity": 10.5,
      "unitOfMeasureAbbreviation": "Grams",
      "lastModified": "2025-01-15T10:30:00Z"
    }
  ],
  "total": 1500,
  "page": 1,
  "pageSize": 500
}
```

### Error Response
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token"
  }
}
```

---

## 🚨 Common Issues & Solutions

### 1. Authentication Errors
**Problem**: 401 Unauthorized  
**Solution**: 
- Check credentials
- Refresh token
- Verify hostname

### 2. Rate Limiting
**Problem**: 429 Too Many Requests  
**Solution**: 
- Implement delays between requests
- Use exponential backoff
- Respect rate limits

### 3. Pagination Issues
**Problem**: Incomplete data  
**Solution**: 
- Use `strictPagination=true`
- Check `total` field for complete count
- Implement proper page iteration

### 4. Network Timeouts
**Problem**: Request timeouts  
**Solution**: 
- Increase timeout values
- Implement retry logic
- Use connection pooling

---

## 📈 Performance Testing

### Load Testing Parameters
- **Concurrent Requests**: 3 (as per MAX_CONCURRENT_API_REQUESTS)
- **Request Timeout**: 180 seconds
- **Retry Attempts**: 3 normal + 3 extended
- **Page Size**: 500 records per page

### Monitoring Metrics
- **Response Time**: Track average response time
- **Success Rate**: Monitor successful vs failed requests
- **Data Volume**: Track records per request
- **Token Usage**: Monitor token refresh frequency

---

## 🔍 Debugging Tips

### 1. Enable Debug Logging
```bash
# Add to your .ENV file
LOG_LEVEL=DEBUG
```

### 2. Test Individual Endpoints
```bash
# Test each endpoint separately
curl -v "https://api.trackandtrace.tools/v2/packages/active?licenseNumber=CUL000063&pageSize=10&page=1" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. Check Response Headers
```bash
# Include response headers for debugging
curl -I "https://api.trackandtrace.tools/v2/packages/active?licenseNumber=CUL000063"
```

### 4. Validate JSON Response
```bash
# Pretty print JSON response
curl "https://api.trackandtrace.tools/v2/packages/active?licenseNumber=CUL000063" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq '.'
```

---

## 📋 Test Results Template

### Endpoint Test Results

| Endpoint | Status | Response Time | Data Count | Notes |
|----------|--------|---------------|------------|-------|
| /auth/credentials | ✅ | 250ms | N/A | Authentication working |
| /packages/active | ✅ | 1.2s | 1,500 | Full data available |
| /packages/transferred | ⏳ | - | - | Testing in progress |
| /packages/intransit | ⏳ | - | - | Testing in progress |
| /transfers/outgoing/active | ⏳ | - | - | Testing in progress |
| /items | ⏳ | - | - | Testing in progress |
| /strains | ⏳ | - | - | Testing in progress |

### Issues Found
- [ ] Issue 1: Description
- [ ] Issue 2: Description
- [ ] Issue 3: Description

### Recommendations
- [ ] Recommendation 1
- [ ] Recommendation 2
- [ ] Recommendation 3

---

## 🎯 Next Steps

1. **Test Authentication**: Verify credentials work
2. **Test Each Endpoint**: Run all 6 API tests
3. **Document Results**: Fill out test results template
4. **Identify Issues**: Note any problems found
5. **Implement Fixes**: Address any issues before sync implementation
6. **Create Sync Services**: Build the 5 remaining sync scripts

---

## 📞 Support Resources

- **T3 API Documentation**: https://api.trackandtrace.tools/v2/docs/
- **METRC Support**: Contact METRC support for API issues
- **Development Team**: Internal team for implementation questions

---

**Last Updated**: January 2025  
**Status**: Ready for Testing  
**Priority**: High - Required for Module 2 Completion

