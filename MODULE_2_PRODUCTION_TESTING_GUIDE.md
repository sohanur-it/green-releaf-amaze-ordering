# Module 2: Production Testing Guide

## 🎯 Overview

This guide provides comprehensive instructions for testing the Module 2 METRC Integration system in production mode. The system includes automated data synchronization, API endpoints, and a master scheduler for real-time METRC data management.

## 🚀 Quick Start

### Prerequisites
- Production server running on `http://localhost:3000`
- Master scheduler running in background
- Production RDS database connected
- METRC T3 API credentials configured

### Start Production System
```bash
# Terminal 1: Start the main application
NODE_ENV=production npm start

# Terminal 2: Start the automated scheduler
npm run scheduler:start
```

## 📊 System Status Verification

### 1. Check Server Status
```bash
# Test server connectivity
curl http://localhost:3000
# Expected: Redirect to /admin

# Check admin dashboard
curl http://localhost:3000/admin
# Expected: 200 OK
```

### 2. Verify Scheduler Status
```bash
# Check scheduler configuration and status
npm run scheduler:status
```

**Expected Output:**
```json
{
  "status": "running",
  "timestamp": "2025-10-17T09:42:36.643Z",
  "runningJobs": 0,
  "recentJobs": [],
  "schedules": [
    {
      "name": "activePackages",
      "description": "Active Packages Sync (Full Mirror)",
      "schedule": "*/10 8-18 * * 1-5",
      "script": "sync:active:prod"
    },
    // ... other schedules
  ]
}
```

### 3. Verify Database Connection
```bash
# Test production database connectivity
npm run schema:check
```

## 🧪 Manual Sync Testing

### Test Individual Sync Scripts

#### Active Packages Sync (Full Mirror)
```bash
npm run sync:active:prod
```
**Expected:** Successfully syncs active packages with insert/update/delete operations

#### Outgoing Transfers Sync (Incremental)
```bash
npm run sync:outgoing:prod
```
**Expected:** Syncs only new/updated outgoing transfers since last sync

#### Strains Sync (Incremental)
```bash
npm run sync:strains:prod
```
**Expected:** Syncs strain data with proper data type conversion

#### Items Sync (Incremental)
```bash
npm run sync:items:prod
```
**Expected:** Syncs item catalog data

#### Transferred Packages Sync (Incremental)
```bash
npm run sync:transferred:prod
```
**Expected:** Syncs historical transferred package data

#### In-Transit Packages Sync (Full Mirror)
```bash
npm run sync:intransit:prod
```
**Expected:** Full sync of in-transit packages

### Test All Sync Scripts
```bash
npm run sync:all:prod
```
**Expected:** All 6 sync scripts execute successfully in sequence

## 📈 Data Verification

### Check Sync Data Status
```bash
npm run test:sync-data
```

**Expected Output:**
```
📦 Active Packages:
  - Total Records: 100+
  - Latest Sync: Recent timestamp
  - Earliest Sync: Historical timestamp

🚚 Outgoing Transfers:
  - Total Records: 8+
  - Latest Sync: Recent timestamp
  - Earliest Sync: Historical timestamp

🌿 Strains:
  - Total Records: 651+
  - Latest Sync: Recent timestamp
  - Earliest Sync: Historical timestamp

📋 Items:
  - Total Records: 1541+
  - Latest Sync: Recent timestamp
  - Earliest Sync: Historical timestamp

📦 Transferred Packages:
  - Total Records: 63904+
  - Latest Sync: Recent timestamp
  - Earliest Sync: Historical timestamp

🚛 In-Transit Packages:
  - Total Records: 463+
  - Latest Sync: Recent timestamp
  - Earliest Sync: Historical timestamp
```

## 🌐 API Endpoint Testing

### Test API Endpoints
```bash
npm run test:api
```

**Expected Results:**
- ✅ Root endpoint: 302 - Redirect
- ✅ Admin dashboard: 200 - OK
- ✅ Login page: 200 - OK
- ✅ Sync status API: 302 - Redirect (Protected)
- ✅ All sync APIs: 302 - Redirect (Protected)

### Test Admin Sync API Endpoints
```bash
npm run test:sync-api
```

**Expected Results:**
- ✅ All sync endpoints: 302 - Redirect (Authentication required)
- ✅ Manual sync commands: Working successfully
- ✅ METRC authentication: Working
- ✅ Scheduler status: Running

### Manual API Testing with cURL

#### Test Sync Status API
```bash
curl -X GET http://localhost:3000/api/v1/admin/sync/status
# Expected: 302 Redirect to login (Authentication required)
```

#### Test Manual Sync Trigger
```bash
curl -X POST http://localhost:3000/api/v1/admin/sync/active-packages
# Expected: 302 Redirect to login (Authentication required)
```

### Admin Sync API Testing
For comprehensive testing of the admin sync API endpoints, see the **[Admin Sync API Testing Guide](ADMIN_SYNC_API_TESTING_GUIDE.md)** which includes:
- ✅ JWT token management testing
- ✅ Individual sync endpoint testing
- ✅ Authentication system verification
- ✅ Token persistence and refresh testing
- ✅ Centralized authentication module testing

## ⏰ Automated Scheduler Testing

### Scheduler Configuration
The master scheduler runs the following automated sync jobs during business hours (8 AM - 6 PM, Monday-Friday):

| Sync Job | Schedule | Strategy | Frequency |
|----------|----------|----------|-----------|
| Active Packages | `*/10 8-18 * * 1-5` | Full Mirror | Every 10 minutes |
| In-Transit Packages | `*/5 8-18 * * 1-5` | Full Mirror | Every 5 minutes |
| Outgoing Transfers | `*/5 8-18 * * 1-5` | Incremental | Every 5 minutes |
| Transferred Packages | `*/10 8-18 * * 1-5` | Incremental | Every 10 minutes |
| Items | `0 8-18 * * 1-5` | Incremental | Every hour |
| Strains | `30 8-18 * * 1-5` | Incremental | Every hour at 30 minutes |

### Monitor Scheduler Activity
```bash
# Check if scheduler process is running
ps aux | grep "master-scheduler"

# Check scheduler status
npm run scheduler:status
```

## 🔍 Troubleshooting

### Common Issues and Solutions

#### 1. Server Not Starting
```bash
# Check if port 3000 is available
lsof -i :3000

# Kill existing process if needed
kill -9 <PID>

# Restart server
NODE_ENV=production npm start
```

#### 2. Database Connection Issues
```bash
# Test database connectivity
npm run schema:check

# Check environment variables
cat config/production.env
```

#### 3. Sync Script Failures
```bash
# Check individual sync script
npm run sync:active:prod

# Check logs for specific errors
# Look for authentication, API, or database errors
```

#### 4. Scheduler Not Running
```bash
# Check if scheduler process exists
ps aux | grep "master-scheduler"

# Restart scheduler
npm run scheduler:start
```

### Log Monitoring
Monitor the terminal output for:
- ✅ Authentication success messages
- ✅ API response success indicators
- ✅ Database operation confirmations
- ❌ Error messages and stack traces

## 📋 Production Checklist

### Pre-Deployment Verification
- [ ] Production server starts successfully
- [ ] Database connection established
- [ ] METRC API authentication working
- [ ] All 6 sync scripts execute without errors
- [ ] Scheduler starts and shows "running" status
- [ ] API endpoints respond correctly
- [ ] Data is being synced to production database

### Ongoing Monitoring
- [ ] Scheduler remains running
- [ ] Sync jobs execute on schedule
- [ ] No authentication failures
- [ ] Database operations complete successfully
- [ ] API endpoints remain accessible
- [ ] Data freshness maintained

## 🎯 Success Criteria

### System Operational
- ✅ Server running on port 3000
- ✅ Scheduler running and monitoring
- ✅ Database connected and accessible
- ✅ All sync scripts working

### Data Synchronization
- ✅ Real-time METRC data flowing
- ✅ All 6 data types syncing
- ✅ Incremental and full mirror strategies working
- ✅ Data integrity maintained

### API Functionality
- ✅ Endpoints accessible
- ✅ Authentication protection working
- ✅ Manual sync triggers available
- ✅ Status monitoring available

## 📞 Support

If you encounter any issues during testing:

1. **Check Logs**: Review terminal output for error messages
2. **Verify Configuration**: Ensure all environment variables are set
3. **Test Connectivity**: Verify database and API connections
4. **Restart Services**: Try restarting server and scheduler
5. **Contact Support**: Provide detailed error logs and system status

---

**Last Updated:** October 17, 2025  
**Version:** Module 2 Production Testing Guide v1.0
