# 🚀 Quick Start: METRC API Testing

## 📁 Files Created

1. **`METRC_API_TESTING_GUIDE.md`** - Comprehensive testing documentation
2. **`METRC_T3_API.postman_collection.json`** - Postman collection for interactive testing
3. **`test-metrc-apis.js`** - Automated testing script

---

## 🎯 Quick Testing Options

### Option 1: Automated Script (Recommended)

```bash
# Run the automated test script
node test-metrc-apis.js
```

**What it does:**
- Tests authentication automatically
- Tests all 6 required endpoints
- Generates detailed report
- Saves results to `metrc-api-test-results.json`

### Option 2: Postman Collection

1. **Import Collection**: Import `METRC_T3_API.postman_collection.json` into Postman
2. **Run Authentication**: Execute "Get Access Token" request
3. **Test Endpoints**: Run individual endpoint tests
4. **Use Test Scenarios**: Test pagination and error handling

### Option 3: Manual cURL Commands

```bash
# 1. Get access token
curl -X POST "https://api.trackandtrace.tools/v2/auth/credentials" \
  -H "Content-Type: application/json" \
  -d '{"hostname":"mo.metrc.com","username":"AGT007392","password":"Metalhead4!"}'

# 2. Test active packages (replace YOUR_TOKEN)
curl -X GET "https://api.trackandtrace.tools/v2/packages/active?licenseNumber=CUL000063&pageSize=10&page=1" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 📊 Required API Endpoints to Test

| # | Endpoint | Status | Priority | Strategy |
|---|----------|--------|----------|----------|
| 1 | `/packages/active` | ✅ Working | High | Full Mirror |
| 2 | `/packages/transferred` | ❌ Test | High | Incremental |
| 3 | `/packages/intransit` | ❌ Test | High | Full Mirror |
| 4 | `/transfers/outgoing/active` | ❌ Test | High | Incremental |
| 5 | `/items` | ❌ Test | Medium | Incremental |
| 6 | `/strains` | ❌ Test | Medium | Incremental |

---

## 🔍 What to Look For

### ✅ Success Indicators
- **Status Code**: 200 OK
- **Data Structure**: Valid JSON with `data` array
- **Pagination**: `total`, `page`, `pageSize` fields
- **Records**: Non-zero count in `data` array

### ❌ Failure Indicators
- **Status Code**: 401 (Unauthorized), 403 (Forbidden), 404 (Not Found)
- **Error Messages**: "Invalid token", "License not found", "Access denied"
- **Empty Data**: `data` array is empty or null
- **Missing Fields**: No `total` or pagination fields

---

## 🚨 Common Issues & Solutions

### 1. Authentication Failures
**Problem**: 401 Unauthorized  
**Solution**: 
- Verify credentials in `.ENV` file
- Check hostname format
- Ensure password is correct

### 2. License Issues
**Problem**: 403 Forbidden  
**Solution**: 
- Verify license number `CUL000063`
- Check if license is active
- Confirm API access permissions

### 3. Rate Limiting
**Problem**: 429 Too Many Requests  
**Solution**: 
- Add delays between requests
- Reduce page size
- Implement exponential backoff

### 4. Empty Results
**Problem**: No data returned  
**Solution**: 
- Check if data exists for your license
- Verify date ranges
- Test with different parameters

---

## 📋 Testing Checklist

### Pre-Testing Setup
- [ ] Verify `.ENV` file has correct credentials
- [ ] Check internet connection
- [ ] Ensure Node.js is installed (for script)
- [ ] Import Postman collection (for Postman)

### Authentication Testing
- [ ] Test credential authentication
- [ ] Verify token generation
- [ ] Test token refresh
- [ ] Check token expiration handling

### Endpoint Testing
- [ ] Test all 6 required endpoints
- [ ] Verify data structure
- [ ] Check pagination
- [ ] Test error handling

### Performance Testing
- [ ] Measure response times
- [ ] Test with different page sizes
- [ ] Check rate limiting behavior
- [ ] Verify concurrent request handling

---

## 📈 Expected Results

### Successful Test Output
```
🚀 Starting METRC T3 API Tests
==================================================
Hostname: mo.metrc.com
Username: AGT007392
License: CUL000063
Base URL: https://api.trackandtrace.tools/v2

🔐 Testing Authentication...
✅ Authentication successful

📊 Testing All Endpoints...
🧪 Testing Active Packages...
✅ Active Packages: 1500 records (1500 total)
🧪 Testing Transferred Packages...
✅ Transferred Packages: 250 records (250 total)
🧪 Testing In-Transit Packages...
✅ In-Transit Packages: 75 records (75 total)
🧪 Testing Outgoing Transfers...
✅ Outgoing Transfers: 45 records (45 total)
🧪 Testing Items...
✅ Items: 120 records (120 total)
🧪 Testing Strains...
✅ Strains: 85 records (85 total)

📋 Test Report
==================================================

🔐 Authentication: SUCCESS
   Details: {
     "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   }

📊 Endpoint Results:
   ✅ Active Packages: 1500 records (1500 total)
   ✅ Transferred Packages: 250 records (250 total)
   ✅ In-Transit Packages: 75 records (75 total)
   ✅ Outgoing Transfers: 45 records (45 total)
   ✅ Items: 120 records (120 total)
   ✅ Strains: 85 records (85 total)

📈 Summary:
   Total Endpoints: 6
   Successful: 6
   Failed: 0
   Success Rate: 100.0%

💾 Test results saved to: metrc-api-test-results.json
```

---

## 🎯 Next Steps After Testing

### If All Tests Pass ✅
1. **Implement Sync Services**: Create the 5 remaining sync scripts
2. **Add Scheduler**: Implement cron job scheduling
3. **Create API Endpoints**: Build admin sync API
4. **Add Monitoring**: Implement logging and error handling

### If Tests Fail ❌
1. **Fix Authentication**: Resolve credential issues
2. **Check Permissions**: Verify API access rights
3. **Contact Support**: Reach out to METRC support
4. **Review Documentation**: Check API documentation for changes

### If Partial Success ⚠️
1. **Identify Issues**: Note which endpoints fail
2. **Test Individually**: Use Postman for detailed testing
3. **Check Data Availability**: Verify data exists for your license
4. **Implement Workarounds**: Handle missing endpoints gracefully

---

## 📞 Support Resources

- **METRC API Documentation**: https://api.trackandtrace.tools/v2/docs/
- **METRC Support**: Contact METRC support for API issues
- **Development Team**: Internal team for implementation questions

---

**Ready to test? Run `node test-metrc-apis.js` to get started! 🚀**
