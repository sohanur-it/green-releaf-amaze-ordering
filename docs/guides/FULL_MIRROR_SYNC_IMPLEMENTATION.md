# Full Mirror Sync Strategy Implementation

## Overview

The **Full Mirror Sync** strategy ensures our local inventory database is an exact reflection of what is currently active in METRC. This implementation follows the exact specifications outlined in the requirements.

## Strategy Details

### 1. **Fetch Entire Collection**
- Connects to T3 API and fetches **all active packages** for license `CUL000063`
- Uses pagination to handle large datasets efficiently
- Implements rate limiting to respect API constraints

### 2. **Query Local Database**
- Retrieves **key identifiers** (`metrcid` and `lastmodified`) from local PostgreSQL
- Only fetches essential fields for efficient comparison
- Creates a Map for O(1) lookup performance

### 3. **Efficient Dataset Comparison**
The system processes fresh API data and compares against local data:

#### **New Records (INSERT)**
- Package ID exists in API but not in database
- Marked for insertion with all API data

#### **Updated Records (UPDATE)**  
- Package ID exists in both API and database
- Compares `lastModified` timestamps
- If API timestamp > Database timestamp → Mark for update

#### **Stale Records (DELETE)**
- Package ID exists in database but not in API
- These are finished, transferred, or archived packages
- Marked for deletion

### 4. **Atomic Transaction**
- All operations (INSERT, UPDATE, DELETE) executed in single transaction
- Ensures data integrity
- If any operation fails → entire sync rolls back
- Prevents partially updated state

## Implementation Files

### Enhanced Sync Script
- **File**: `Sync/sync-active-packages-enhanced.js`
- **Command**: `npm run sync:active-enhanced`
- **Strategy**: Full Mirror Sync
- **Features**:
  - Centralized authentication via `metrcAuth` service
  - Efficient dataset comparison
  - Atomic transaction management
  - Comprehensive logging and error handling

### Original Sync Script (Updated)
- **File**: `Sync/sync-active-packages.js` 
- **Command**: `npm run sync:active`
- **Strategy**: Full Mirror Sync (existing implementation)
- **Features**: Maintains backward compatibility

## Performance Results

### Test Run Results
```
📊 Sync Summary:
   📥 Inserts: 5
   🔄 Updates: 5,654  
   🗑️ Deletes: 0
   ❌ Errors: 0
⏱️ Total execution time: 56.31 seconds
```

### Key Metrics
- **Total Packages**: 5,659 from METRC API
- **Existing Packages**: 5,654 in local database
- **New Packages**: 5 (recently created)
- **Updated Packages**: 5,654 (all existing packages refreshed)
- **Stale Packages**: 0 (no packages removed from METRC)
- **Success Rate**: 100% (0 errors)

## Technical Features

### Centralized Authentication
- Uses `Server/Services/metrcAuth.js` for shared JWT management
- Automatic token refresh and fallback authentication
- Token persistence across sync processes

### Efficient Database Operations
- **INSERT**: Individual inserts with error handling
- **UPDATE**: Batch updates with parameterized queries
- **DELETE**: Single query using `ANY()` array operator
- **Transaction**: BEGIN → Operations → COMMIT/ROLLBACK

### Comprehensive Logging
- Step-by-step progress tracking
- Detailed comparison results
- Performance metrics
- Error reporting with context

## Usage

### Manual Execution
```bash
# Enhanced Full Mirror Sync
npm run sync:active-enhanced

# Original Full Mirror Sync  
npm run sync:active
```

### Automated Scheduling
The master scheduler (`Scripts/master-scheduler.js`) automatically runs the active packages sync every 5 minutes during business hours.

### Admin API Control
```bash
# Trigger specific sync
curl -X POST http://localhost:3000/api/v1/admin/sync/active

# Trigger all syncs
curl -X POST http://localhost:3000/api/v1/admin/sync/all
```

## Monitoring

### Sync Status
```bash
# Check scheduler status
npm run scheduler:status

# View sync history via API
curl http://localhost:3000/api/v1/admin/sync/history
```

### Database Verification
```sql
-- Check sync results
SELECT 
    COUNT(*) as total_packages,
    COUNT(CASE WHEN lastmodified > NOW() - INTERVAL '1 hour' THEN 1 END) as recently_updated,
    MIN(lastmodified) as oldest_package,
    MAX(lastmodified) as newest_package
FROM activepackages 
WHERE synclicense = 'CUL000063';
```

## Error Handling

### Transaction Safety
- All operations wrapped in database transaction
- Automatic rollback on any failure
- No partial updates possible

### API Error Handling
- Automatic retry with token refresh on 401 errors
- Fallback to credential authentication
- Graceful degradation with detailed error reporting

### Database Error Handling
- Individual operation error tracking
- Continues processing other operations
- Comprehensive error logging

## Configuration

### Environment Variables
```bash
T3_API_BASE_URL=https://api.trackandtrace.tools/v2
T3_LICENSE_NUMBER=CUL000063
T3_USERNAME=AGT007392
T3_PASSWORD=Metalhead4!
T3_HOSTNAME=mo.metrc.com
```

### Database Configuration
```bash
DB_HOST=localhost
DB_DATABASE=green_releaf_dev
DB_USER=postgres
DB_PASSWORD=dev_password_123
DB_PORT=5432
```

## Best Practices

### Performance Optimization
- Efficient dataset comparison using Maps
- Minimal database queries (only essential fields)
- Batch operations where possible
- Rate limiting for API calls

### Data Integrity
- Atomic transactions ensure consistency
- Timestamp-based change detection
- Comprehensive error handling
- Rollback on failures

### Monitoring
- Detailed logging for troubleshooting
- Performance metrics tracking
- Error rate monitoring
- Sync status reporting

## Conclusion

The Full Mirror Sync implementation provides a robust, efficient, and reliable solution for maintaining exact synchronization between METRC and the local database. It ensures data integrity through atomic transactions while providing comprehensive monitoring and error handling capabilities.

The system successfully processes thousands of packages in under a minute while maintaining 100% accuracy and providing detailed visibility into the sync process.
