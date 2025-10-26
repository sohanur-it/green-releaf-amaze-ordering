# Complete METRC Sync System Documentation

## Overview

This document describes the complete METRC synchronization system that includes all 6 required endpoints with their respective sync strategies and frequencies.

## Available Sync Scripts

### 1. Active Packages
- **Script**: `Sync/sync-active-packages.js`
- **Command**: `npm run sync:active`
- **Endpoint**: `GET /v2/packages/active`
- **Strategy**: Full Mirror Sync
- **Frequency**: Every 5 minutes (Business Hours)
- **Table**: `activepackages`

### 2. Transferred Packages
- **Script**: `Sync/sync-transferred-packages.js`
- **Command**: `npm run sync:transferred`
- **Endpoint**: `GET /v2/packages/transferred`
- **Strategy**: Incremental (Delta)
- **Frequency**: Every 10 minutes (Business Hours)
- **Table**: `transferredpackages`

### 3. In-Transit Packages
- **Script**: `Sync/sync-intransit-packages.js`
- **Command**: `npm run sync:intransit`
- **Endpoint**: `GET /v2/packages/intransit`
- **Strategy**: Full Mirror Sync
- **Frequency**: Every 5 minutes (Business Hours)
- **Table**: `intransitpackages`

### 4. Outgoing Transfers
- **Script**: `Sync/sync-outgoing-transfers.js`
- **Command**: `npm run sync:outgoing`
- **Endpoint**: `GET /v2/transfers/outgoing/active`
- **Strategy**: Incremental (Delta)
- **Frequency**: Every 5 minutes (Business Hours)
- **Table**: `activeoutgoingtransfers`

### 5. Items
- **Script**: `Sync/sync-items.js`
- **Command**: `npm run sync:items`
- **Endpoint**: `GET /v2/items`
- **Strategy**: Incremental (Delta)
- **Frequency**: Every 60 minutes (Business Hours)
- **Table**: `items`

### 6. Strains
- **Script**: `Sync/sync-strains.js`
- **Command**: `npm run sync:strains`
- **Endpoint**: `GET /v2/strains`
- **Strategy**: Incremental (Delta)
- **Frequency**: Every 60 minutes (Business Hours)
- **Table**: `strains`

## Quick Start Commands

### Setup Database Schema
```bash
# First time setup - creates all tables and columns
npm run schema:setup
```

### Run Individual Sync Scripts
```bash
# Sync active packages (every 5 minutes)
npm run sync:active

# Sync transferred packages (every 10 minutes)
npm run sync:transferred

# Sync in-transit packages (every 5 minutes)
npm run sync:intransit

# Sync outgoing transfers (every 5 minutes)
npm run sync:outgoing

# Sync items (every 60 minutes)
npm run sync:items

# Sync strains (every 60 minutes)
npm run sync:strains
```

### Run All Sync Scripts
```bash
# Run all sync scripts in sequence
npm run sync:all
```

## Database Schema

### Tables Created
1. **activepackages** - Active package data
2. **transferredpackages** - Transferred package data
3. **intransitpackages** - In-transit package data
4. **activeoutgoingtransfers** - Outgoing transfer data
5. **items** - Item catalog data
6. **strains** - Strain catalog data

### Common Columns
All tables include these common columns:
- `metrcid` (BIGINT, PRIMARY KEY) - METRC ID
- `synclicense` (VARCHAR(50), NOT NULL) - License being synced
- `created_at` (TIMESTAMP) - Record creation time
- `updated_at` (TIMESTAMP) - Record last update time
- `retrievedat` (TIMESTAMP) - Last API fetch time

## Sync Strategies

### Full Mirror Sync
- **Used by**: Active Packages, In-Transit Packages
- **Behavior**: Complete replacement of data
- **Deletes**: Removes records not present in API response
- **Use case**: When you need exact mirror of current state

### Incremental (Delta) Sync
- **Used by**: Transferred Packages, Outgoing Transfers, Items, Strains
- **Behavior**: Only updates changed records
- **Deletes**: Removes records not present in API response
- **Use case**: When you want to track changes over time

## Environment Configuration

### Required Environment Variables
```bash
# METRC API Configuration
T3_API_BASE_URL=https://api.trackandtrace.tools/v2
T3_USERNAME=AGT007392
T3_PASSWORD=Metalhead4!
SYNC_LICENSE=CUL000063

# Database Configuration
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=dev_password_123
DB_PORT=5432
DB_DATABASE=green_releaf_dev

# Sync Configuration
MAX_CONCURRENT_API_REQUESTS=3
LOG_LEVEL=info
```

## Error Handling

### Common Issues
1. **Authentication Failures**: Check T3_USERNAME and T3_PASSWORD
2. **Database Connection**: Verify DB_* environment variables
3. **Missing Columns**: Run `npm run schema:setup` to add missing columns
4. **Rate Limiting**: Scripts include delays between API requests

### Logging
All scripts provide detailed logging:
- `[AUTH]` - Authentication events
- `[FETCH]` - API data fetching
- `[INSERT]` - Database insertions
- `[UPDATE]` - Database updates
- `[DELETE]` - Database deletions
- `[FAIL]` - Error conditions

## Performance Considerations

### API Rate Limits
- Scripts include 100ms delays between requests
- Maximum 3 concurrent requests (configurable)
- Pagination support for large datasets

### Database Performance
- Uses connection pooling
- Batch operations for better performance
- Transaction management for data integrity

## Monitoring and Maintenance

### Health Checks
```bash
# Check database connection
docker exec green-releaf-postgres psql -U postgres -d green_releaf_dev -c "SELECT NOW();"

# Check table sizes
docker exec green-releaf-postgres psql -U postgres -d green_releaf_dev -c "SELECT schemaname,tablename,pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"
```

### Backup and Recovery
```bash
# Backup database
npm run db:backup

# Restore database
npm run db:restore
```

## Troubleshooting

### Common Commands
```bash
# Check Docker containers
docker-compose ps

# View logs
docker-compose logs -f

# Reset database
npm run docker:reset

# Check environment
npm run env:status
```

### Debug Mode
Set `LOG_LEVEL=debug` in your environment for detailed logging.

## Next Steps

1. **Scheduler Integration**: Install `node-cron` and create a master scheduler
2. **API Endpoints**: Create REST API endpoints for on-demand sync
3. **Monitoring**: Add health check endpoints and monitoring
4. **Alerting**: Set up alerts for sync failures
5. **Analytics**: Add sync performance metrics and reporting

## Support

For issues or questions:
1. Check the logs for specific error messages
2. Verify environment variables are set correctly
3. Ensure Docker containers are running
4. Run `npm run schema:setup` if you encounter column errors
5. Check METRC API credentials and license number
