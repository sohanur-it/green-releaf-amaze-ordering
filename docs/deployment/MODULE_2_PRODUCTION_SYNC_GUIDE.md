# Module 2: Production METRC Sync System - Complete Guide

## Overview

This document provides a comprehensive guide to the METRC T3 API synchronization system implemented in Module 2. The system automatically syncs cannabis tracking data from METRC's Track & Trace API to your production PostgreSQL database, ensuring your local inventory database remains an exact mirror of METRC data.

## ⚡ Quick Start - Production Deployment

**Need to get up and running immediately? Follow these 5 steps:**

```bash
# 1. Switch to production environment
npm run env:production

# 2. Start the application server
NODE_ENV=production npm start

# 3. Run initial data sync
npm run sync:all:prod

# 4. Start automated scheduling
npm run scheduler:start

# 5. Access your application
# Open: http://localhost:3000
```

**That's it! Your production system is now running with:**
- ✅ Express.js server connected to production RDS
- ✅ All METRC data synchronized
- ✅ Automated sync scheduling active
- ✅ Web interface accessible at `http://localhost:3000`

## 🏗️ System Architecture

### Core Components

1. **METRC T3 API Integration**: Direct connection to METRC's Track & Trace API
2. **PostgreSQL Database**: Production RDS database storing synchronized data
3. **Sync Scripts**: Automated Node.js scripts for data synchronization
4. **Authentication Service**: Centralized JWT token management
5. **Scheduler**: Automated sync triggers during business hours
6. **Admin API**: Manual sync control endpoints

### Database Schema

The system maintains 6 core tables synchronized from METRC:

- **`activepackages`**: Currently active cannabis packages
- **`transferredpackages`**: Packages that have been transferred
- **`intransitpackages`**: Packages currently in transit
- **`activeoutgoingtransfers`**: Active outgoing transfer manifests
- **`items`**: Cannabis product items/catalog
- **`strains`**: Cannabis strain information

## 🔄 Sync Strategies

### 1. Full Mirror Sync (Active Packages & In-Transit Packages)

**Purpose**: Ensures local database is an exact reflection of METRC data

**Process**:
1. Fetches entire collection from METRC API
2. Compares with local database using `metrcid` and `lastmodified` timestamps
3. Identifies new, updated, and stale records
4. Executes atomic transaction: INSERT new, UPDATE changed, DELETE stale

**Frequency**: Every 5-10 minutes during business hours

### 2. Incremental/Delta Sync (Transferred, Outgoing Transfers, Items, Strains)

**Purpose**: Efficiently sync only new/updated records

**Process**:
1. Queries local database for latest `lastmodified` timestamp
2. Requests only records modified after that timestamp from METRC API
3. Performs bulk UPSERT operations (INSERT or UPDATE)

**Frequency**: Every 5-60 minutes during business hours

## 🚀 Production Setup

### Environment Configuration

The system uses environment-specific configuration files:

- **Development**: `config/local.env` (Docker PostgreSQL)
- **Production**: `config/production.env` (AWS RDS)

### Running the Server with Production Database

To run the Express.js server connected to your production RDS database:

#### 1. Switch to Production Environment

```bash
# Switch to production environment configuration
npm run env:production

# Verify environment is set correctly
npm run env:status
```

#### 2. Start the Production Server

```bash
# Start the server with production database
NODE_ENV=production npm start

# Or for development with auto-restart
NODE_ENV=production npm run dev
```

#### 3. Verify Production Connection

The server will automatically:
- ✅ Load `config/production.env` configuration
- ✅ Connect to your RDS database (`n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com`)
- ✅ Use production METRC credentials
- ✅ Enable SSL connections for security

#### 4. Access the Application

Once started, the server will be available at:
- **Main Application**: `http://localhost:3000`
- **Admin Dashboard**: `http://localhost:3000/admin`
- **Authentication**: `http://localhost:3000/auth/login`
- **API Endpoints**: `http://localhost:3000/api/v1/`

#### 5. Production Server Logs

The server will display connection information:
```
[2025-10-17T05:45:00.000Z] INFO: 🗄️ Connected to production database
[2025-10-17T05:45:00.001Z] INFO: 📊 Database: postgres
[2025-10-17T05:45:00.002Z] INFO: 📊 Host: n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com
[2025-10-17T05:45:00.003Z] INFO: 📊 Environment: production
[2025-10-17T05:45:00.004Z] INFO: 🚀 Server running on port 3000
```

### Environment Switching Commands

```bash
# Switch to local development (Docker PostgreSQL)
npm run env:local

# Switch to production (AWS RDS)
npm run env:production

# Check current environment status
npm run env:status
```

### Production Database Configuration

```bash
# Production RDS Database
DB_HOST=n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com
DB_USER=master
DB_PASSWORD=GreenReleaf123!
DB_DATABASE=postgres
DB_PORT=5432
```

### METRC API Credentials

```bash
# METRC T3 API Configuration
T3_API_BASE_URL=https://api.trackandtrace.tools/v2
T3_HOSTNAME=mo.metrc.com
T3_USERNAME=AGT007392
T3_PASSWORD=Metalhead4!
T3_LICENSE_NUMBER=CUL000063
```

## 🔄 Complete Production Workflow

### Full Production Setup Process

Here's the complete process to run your application in production:

#### Step 1: Environment Setup
```bash
# Switch to production environment
npm run env:production

# Verify configuration
npm run env:status
```

#### Step 2: Start the Application Server
```bash
# Start the Express.js server with production database
NODE_ENV=production npm start
```

#### Step 3: Run Initial Data Sync
```bash
# Run all sync operations to populate the database
npm run sync:all:prod
```

#### Step 4: Start Automated Scheduling (Optional)
```bash
# Start the master scheduler for automated syncs
npm run scheduler:start
```

#### Step 5: Access the Application
- **Web Interface**: `http://localhost:3000`
- **Admin Panel**: `http://localhost:3000/admin`
- **API Documentation**: `http://localhost:3000/api/v1/`

### Production Server Features

When running with `NODE_ENV=production`, the server provides:

- **CRM Management**: Buyer profiles, sales reps, contacts, locations
- **User Authentication**: Login/logout with RBAC (Role-Based Access Control)
- **Admin Dashboard**: User management and system monitoring
- **API Endpoints**: RESTful APIs for all operations
- **Audit Logging**: Complete action history tracking
- **Manifest Creation**: METRC manifest generation (Module 5 prep)

## 📋 Available Sync Commands

### Individual Sync Operations

```bash
# Active Packages (Full Mirror Sync)
npm run sync:active:prod

# Strains (Incremental Sync)
npm run sync:strains:prod

# Items (Incremental Sync)
npm run sync:items:prod

# Transferred Packages (Incremental Sync)
npm run sync:transferred:prod

# In-Transit Packages (Full Mirror Sync)
npm run sync:intransit:prod

# Outgoing Transfers (Incremental Sync)
npm run sync:outgoing:prod
```

### Batch Operations

```bash
# Run All Production Syncs
npm run sync:all:prod

# Test Production Environment
npm run test:production
```

## ⏰ Automated Scheduling

### Master Scheduler

The system includes a master scheduler (`Scripts/master-scheduler.js`) that automatically triggers sync operations during business hours:

- **Active Packages**: Every 10 minutes (8 AM - 6 PM)
- **In-Transit Packages**: Every 5 minutes (8 AM - 6 PM)
- **Outgoing Transfers**: Every 5 minutes (8 AM - 6 PM)
- **Transferred Packages**: Every 10 minutes (8 AM - 6 PM)
- **Items**: Every 60 minutes (8 AM - 6 PM)
- **Strains**: Every 60 minutes (8 AM - 6 PM)

### Starting the Scheduler

```bash
# Start automated scheduling
npm run scheduler:start

# Check scheduler status
npm run scheduler:status
```

## 🔧 Manual Control via Admin API

### Sync Management Endpoints

The system provides REST API endpoints for manual sync control:

```bash
# Trigger specific sync service
POST /api/v1/admin/sync/:serviceName

# Available service names:
# - active-packages
# - transferred-packages
# - intransit-packages
# - outgoing-transfers
# - items
# - strains
```

### Example API Calls

```bash
# Trigger active packages sync
curl -X POST http://localhost:3000/api/v1/admin/sync/active-packages

# Trigger strains sync
curl -X POST http://localhost:3000/api/v1/admin/sync/strains
```

## 🔐 Authentication & Security

### METRC API Authentication

The system uses JWT-based authentication with automatic token refresh:

1. **Initial Authentication**: Uses credentials to obtain access token
2. **Token Persistence**: Caches tokens for reuse across sync processes
3. **Automatic Refresh**: Refreshes expired tokens automatically
4. **Fallback Authentication**: Re-authenticates if refresh fails

### Database Security

- SSL connections to production RDS
- Environment-based credential management
- Connection pooling for optimal performance

## 📊 Monitoring & Logging

### Sync Status Monitoring

Each sync operation provides detailed logging:

```
[2025-10-17T05:39:17.179Z] STEP: 🚀 === STRAINS SYNC SCRIPT ===
[2025-10-17T05:39:17.180Z] INFO: 📊 License: CUL000063
[2025-10-17T05:39:25.819Z] STEP: 🚀 🚀 STARTING STRAINS SYNC (INCREMENTAL) 🚀
[2025-10-17T05:39:35.916Z] DONE: ✅ Fetched 652 total strains from API
[2025-10-17T05:39:37.639Z] INFO: 📊 Processing: 1 inserts, 651 updates, 0 deletes
[2025-10-17T05:39:37.639Z] INSERT: ➕ Executing 1 INSERTs...
[2025-10-17T05:39:37.640Z] UPDATE: 🔄 Executing 651 UPDATEs...
[2025-10-17T05:39:37.641Z] DONE: ✅ Strains Database Sync Operations Complete!
[2025-10-17T05:39:37.642Z] DONE: ✅ ✅ STRAINS SYNC SUCCESS ✅
[2025-10-17T05:39:37.643Z] INFO: 📊 Sync Summary: Inserts: 1, Updates: 651, Deletes: 0, Errors: 0
```

### Error Handling

The system includes comprehensive error handling:

- **API Failures**: Automatic retry with exponential backoff
- **Database Errors**: Detailed error logging with record data
- **Authentication Issues**: Automatic token refresh and fallback
- **Network Issues**: Timeout handling and connection retry

## 🛠️ Troubleshooting

### Common Issues

1. **Server Startup Issues**
   ```bash
   # Check if environment is set correctly
   npm run env:status
   
   # Verify production configuration
   cat config/production.env
   
   # Test database connection
   npm run test:production
   ```

2. **Database Connection Issues**
   ```bash
   # Test database connection
   npm run test:production
   
   # Check if RDS is accessible
   psql -h n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com -U master -d postgres -c "SELECT NOW();"
   ```

3. **Authentication Failures**
   - Check METRC credentials in `config/production.env`
   - Verify license number `CUL000063`
   - Check API endpoint accessibility

4. **Schema Mismatches**
   - Run schema consistency check
   - Update production database schema if needed

5. **Port Already in Use**
   ```bash
   # Check what's using port 3000
   lsof -i :3000
   
   # Kill existing process if needed
   kill -9 <PID>
   ```

### Debugging Commands

```bash
# Check environment configuration
npm run env:status

# Test individual sync with verbose logging
NODE_ENV=production node Sync/sync-strains.js

# Check database schema
psql -h n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com -U master -d postgres -c "\d strains"
```

## 📈 Performance Optimization

### Database Optimization

- **Indexes**: Optimized indexes on `metrcid`, `lastmodified`, and `synclicense`
- **Connection Pooling**: Efficient database connection management
- **Batch Operations**: Chunked processing to prevent database locks

### API Optimization

- **Pagination**: Handles large datasets efficiently
- **Rate Limiting**: Respects METRC API rate limits
- **Caching**: Token caching reduces authentication overhead

## 🔄 Data Flow Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   METRC T3 API  │───▶│  Sync Scripts    │───▶│  PostgreSQL    │
│                 │    │                  │    │  Production DB  │
│ • Active Pkgs   │    │ • Authentication │    │ • activepackages│
│ • Transferred   │    │ • Data Fetch     │    │ • transferred   │
│ • In-Transit    │    │ • Data Compare   │    │ • intransit     │
│ • Outgoing      │    │ • Data Sync      │    │ • outgoing      │
│ • Items         │    │ • Error Handling │    │ • items         │
│ • Strains       │    │ • Logging        │    │ • strains       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  JWT Tokens     │    │  Master Scheduler│    │  Admin API      │
│ • Access Token  │    │ • Cron Jobs      │    │ • Manual Triggers│
│ • Refresh Token │    │ • Business Hours │    │ • Status Check  │
│ • Auto Refresh  │    │ • Error Recovery │    │ • Monitoring    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 📋 Maintenance Procedures

### Daily Operations

1. **Monitor Sync Status**: Check logs for successful sync operations
2. **Verify Data Integrity**: Compare record counts between METRC and local DB
3. **Check Error Logs**: Review any failed sync operations

### Weekly Maintenance

1. **Database Performance**: Monitor query performance and index usage
2. **API Rate Limits**: Ensure sync frequency doesn't exceed METRC limits
3. **Storage Usage**: Monitor database growth and cleanup old data if needed

### Monthly Tasks

1. **Schema Updates**: Review METRC API changes and update schemas
2. **Performance Tuning**: Optimize sync frequencies based on usage patterns
3. **Security Review**: Audit authentication tokens and database access

## 🚨 Emergency Procedures

### Sync Failure Recovery

1. **Identify Issue**: Check error logs and sync status
2. **Manual Sync**: Use admin API to trigger specific sync operations
3. **Database Repair**: If needed, run schema consistency scripts
4. **Escalation**: Contact development team for complex issues

### Data Corruption Recovery

1. **Stop Sync Operations**: Prevent further data corruption
2. **Backup Current State**: Create database backup
3. **Full Resync**: Run complete sync operations to restore data integrity
4. **Verify Results**: Confirm data accuracy before resuming normal operations

## 📞 Support & Contact

For technical support or questions about the METRC sync system:

- **Documentation**: Refer to this guide and inline code comments
- **Logs**: Check application logs for detailed error information
- **Monitoring**: Use admin API endpoints for system status
- **Development Team**: Contact for complex issues or feature requests

---

## 🎯 Quick Start Checklist

- [ ] Switch to production environment (`npm run env:production`)
- [ ] Verify production environment configuration
- [ ] Test database connectivity (`npm run test:production`)
- [ ] Start the application server (`NODE_ENV=production npm start`)
- [ ] Run initial sync operations (`npm run sync:all:prod`)
- [ ] Start master scheduler (`npm run scheduler:start`)
- [ ] Access web interface (`http://localhost:3000`)
- [ ] Monitor sync status and logs
- [ ] Set up alerting for sync failures
- [ ] Document any custom configurations
- [ ] Train operations team on monitoring procedures

**The complete METRC sync system and web application is now ready for production use!** 🚀
