# Production Schema Backup Scripts

This directory contains scripts to backup the complete schema from the production database to your local Docker database, ensuring exact schema replication for development.

## 📋 Overview

The schema backup process extracts the complete database structure (tables, indexes, constraints, functions, sequences, etc.) from the production RDS database and applies it to your local Docker PostgreSQL database.

## 🚀 Quick Start

### Prerequisites

1. **Docker Database Running**: Make sure your local Docker database is running:
   ```bash
   docker-compose up -d postgres
   ```

2. **PostgreSQL Client Tools**: Ensure you have `pg_dump` and `psql` installed:
   ```bash
   # macOS
   brew install postgresql
   
   # Ubuntu/Debian
   sudo apt-get install postgresql-client
   
   # Windows
   # Download from https://www.postgresql.org/download/windows/
   ```

3. **Network Access**: Ensure you can connect to the production RDS database.

### Running the Backup

#### Option 1: Bash Script (Recommended)
```bash
npm run db:backup-schema
```

#### Option 2: Node.js Script
```bash
npm run db:backup-schema-node
```

#### Option 3: Direct Execution
```bash
./scripts/backup-schema.sh
```

## 📁 Output Files

The backup process creates the following files:

- **Schema SQL File**: `./backups/schema/schema_YYYYMMDD_HHMMSS.sql`
- **Schema JSON File**: `./backups/schema/schema-YYYY-MM-DDTHH-MM-SS.json` (Node.js script only)

## 🔧 Configuration

### Production Database Settings
The scripts use the following production database configuration (from `config/production.env`):

```bash
PROD_HOST="n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com"
PROD_USER="master"
PROD_DB="postgres"
PROD_PORT="5432"
```

### Local Database Settings
The scripts connect to your local Docker database:

```bash
LOCAL_HOST="localhost"
LOCAL_USER="postgres"
LOCAL_DB="green_releaf_dev"
LOCAL_PORT="5432"
LOCAL_PASSWORD="dev_password_123"
```

## 📊 What Gets Backed Up

### Tables
- All table definitions with exact column types
- Primary keys, foreign keys, and constraints
- Default values and null constraints
- Check constraints and unique constraints

### Indexes
- All custom indexes (excluding primary key indexes)
- Index types and configurations
- Partial indexes and expression indexes

### Sequences
- Auto-increment sequences
- Sequence configurations (start, increment, min, max)
- Sequence ownership

### Functions
- Custom PostgreSQL functions
- Stored procedures
- Triggers and trigger functions

### Custom Types
- Enums and custom data types
- Domain types
- Composite types

## 🔍 Verification

After the backup completes, the script will show:

- **Table Count**: Number of tables created
- **Sequence Count**: Number of sequences created
- **Function Count**: Number of functions created
- **Schema Summary**: List of all tables and sequences

## ⚠️ Important Notes

### Data Safety
- **No Data Transfer**: Only schema is backed up, no data is transferred
- **Local Database Reset**: The local database schema will be completely replaced
- **Backup Files**: Original schema files are preserved in `./backups/schema/`

### Production Database
- **Read-Only Access**: Scripts only read from production, never write
- **SSL Connection**: Uses SSL for secure connection to RDS
- **No Impact**: Zero impact on production database performance

### Local Database
- **Complete Reset**: All existing tables, functions, and sequences will be dropped
- **Fresh Start**: Local database will have exact production schema
- **No Data Loss**: Only affects schema, not your local development data

## 🛠️ Troubleshooting

### Common Issues

#### 1. Connection Failed to Production
```
❌ Failed to extract schema from production database
```
**Solution**: Check network connectivity and production database credentials.

#### 2. Docker Database Not Running
```
❌ Docker database container 'green-releaf-postgres' is not running
```
**Solution**: Start Docker database:
```bash
docker-compose up -d postgres
```

#### 3. Permission Denied
```
❌ Permission denied: ./scripts/backup-schema.sh
```
**Solution**: Make script executable:
```bash
chmod +x scripts/backup-schema.sh
```

#### 4. pg_dump Not Found
```
❌ pg_dump is not installed
```
**Solution**: Install PostgreSQL client tools (see Prerequisites section).

### Manual Recovery

If the automated process fails, you can manually restore:

1. **Extract Schema Manually**:
   ```bash
   pg_dump --host=n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com \
           --port=5432 \
           --username=master \
           --dbname=postgres \
           --schema-only \
           --no-owner \
           --no-privileges \
           --clean \
           --if-exists \
           --create \
           --file=schema_backup.sql
   ```

2. **Apply to Local Database**:
   ```bash
   psql --host=localhost \
        --port=5432 \
        --username=postgres \
        --dbname=green_releaf_dev \
        --file=schema_backup.sql
   ```

## 📈 Usage Examples

### Daily Development Setup
```bash
# Start Docker database
docker-compose up -d postgres

# Backup production schema
npm run db:backup-schema

# Start development server
npm run dev:prod
```

### Schema Comparison
```bash
# Backup current production schema
npm run db:backup-schema

# Compare with previous backup
diff backups/schema/schema_20240101_120000.sql \
     backups/schema/schema_20240102_120000.sql
```

### Clean Development Environment
```bash
# Reset Docker database
docker-compose down -v
docker-compose up -d postgres

# Restore production schema
npm run db:backup-schema

# Initialize with test data
npm run db:init
```

## 🔒 Security

- **Credentials**: Production credentials are stored in `config/production.env`
- **SSL**: All connections to production use SSL encryption
- **Local Only**: No production data is stored locally
- **Backup Files**: Schema files contain no sensitive data

## 📞 Support

If you encounter issues:

1. Check the troubleshooting section above
2. Verify all prerequisites are met
3. Check Docker database is running
4. Ensure network connectivity to production
5. Review the backup logs for specific error messages

---

**Note**: This script is designed for development purposes only. Always test schema changes in a development environment before applying to production.
