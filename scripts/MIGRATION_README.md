# Module 5 Schema Migrations

This directory contains migration scripts to apply Module 5 schema improvements to the database.

## Migration Scripts

1. **add-module5-invoice-constraints.sql** - Invoice table constraints and validations
2. **add-scanning-sessions-improvements.sql** - Scanning sessions enum, archive table
3. **add-cancelled-shipments-improvements.sql** - Cancelled shipments enum, archive table
4. **add-manifest-packages-improvements.sql** - Manifest packages enum, system_config, archive
5. **add-rejected-packages-improvements.sql** - Rejected packages fields and constraints

## Quick Start

### Option 1: Automated Script (Recommended)

Run the automated migration script that applies all migrations in order:

```bash
# Apply all migrations to production database
NODE_ENV=production node scripts/apply-module5-migrations.js
```

The script will:
- ✅ Read database credentials from `config/production.env`
- ✅ Verify database connection
- ✅ Check all migration files exist
- ✅ Apply migrations in order
- ✅ Provide detailed progress and error reporting
- ✅ Show summary of results

### Option 2: Manual Execution

Run each migration script individually using psql:

```bash
# Set environment variables
export PGHOST=n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com
export PGPORT=5432
export PGDATABASE=postgres
export PGUSER=master
export PGPASSWORD=GreenReleaf123!

# Run migrations in order
psql -f scripts/add-module5-invoice-constraints.sql
psql -f scripts/add-scanning-sessions-improvements.sql
psql -f scripts/add-cancelled-shipments-improvements.sql
psql -f scripts/add-manifest-packages-improvements.sql
psql -f scripts/add-rejected-packages-improvements.sql
```

### Option 3: Using Node.js Database Connection

You can also use the existing database connection:

```bash
NODE_ENV=production node -e "
const { query, pool } = require('./Server/config/database');
const fs = require('fs');
const scripts = [
  'scripts/add-module5-invoice-constraints.sql',
  'scripts/add-scanning-sessions-improvements.sql',
  'scripts/add-cancelled-shipments-improvements.sql',
  'scripts/add-manifest-packages-improvements.sql',
  'scripts/add-rejected-packages-improvements.sql'
];
(async () => {
  for (const script of scripts) {
    console.log('Running:', script);
    const sql = fs.readFileSync(script, 'utf8');
    await query(sql);
    console.log('Completed:', script);
  }
  await pool.end();
})();
"
```

## Safety Features

All migration scripts are:
- ✅ **Idempotent** - Safe to run multiple times
- ✅ **Error-tolerant** - Handles "already exists" errors gracefully
- ✅ **Transaction-safe** - Each migration is atomic
- ✅ **Backward-compatible** - Won't break existing functionality

## What Gets Applied

### 1.1 Invoice Table
- CHECK constraints for data validation
- ON DELETE SET NULL for foreign keys
- Status transition validation trigger

### 1.2 Scanning Sessions
- Enum type for session status
- `abandoned_at` timestamp field
- Archive table and archive function

### 1.3 Cancelled Shipments
- Enum type for incident type
- Archive table and archive function
- Bulk update validation triggers

### 1.4 Manifest Packages
- Enum type for package status
- System configuration table
- Archive table and archive function
- Audit table for deleted records
- Performance index

### 1.5 Rejected Packages
- Missing fields (`fk_invoice_id`, `admin_verified`)
- Foreign key constraints
- Validation constraints

## Verification

After running migrations, verify the changes:

```sql
-- Check enum types were created
SELECT typname FROM pg_type WHERE typname IN (
  'scanning_session_status',
  'incident_type',
  'manifest_package_status'
);

-- Check archive tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_name LIKE '%archive%' 
AND table_schema = 'public';

-- Check system_config table
SELECT * FROM system_config WHERE config_key = 'manifest_void_strategy';

-- Check constraints
SELECT constraint_name, table_name 
FROM information_schema.table_constraints 
WHERE constraint_name LIKE 'chk_%' 
AND table_name LIKE 'ORDERS-%';
```

## Troubleshooting

### Connection Issues
- Verify database credentials in `config/production.env`
- Check network connectivity to RDS instance
- Ensure security groups allow your IP

### Migration Errors
- Most errors are expected if objects already exist (idempotent)
- Check PostgreSQL logs for detailed error messages
- Run migrations individually to isolate issues

### Rollback
These migrations are additive only. To rollback:
1. Drop archive tables (if needed)
2. Drop enum types (if needed)
3. Drop constraints (if needed)
4. Remove added columns (if needed)

**Note:** Always backup your database before running migrations!

## Support

If you encounter issues:
1. Check the error message in the migration output
2. Review PostgreSQL logs
3. Verify database permissions
4. Ensure all prerequisites are met


