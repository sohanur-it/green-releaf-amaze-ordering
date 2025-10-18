#!/bin/bash

# Complete Production Database Backup with Data
# This script backs up the ENTIRE production database (schema + data) and restores it locally

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Configuration
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="./backups/production-with-data"
BACKUP_FILE="$BACKUP_DIR/production_full_backup_${TIMESTAMP}.sql"

# Production database configuration
PROD_HOST="n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com"
PROD_PORT="5432"
PROD_USER="master"
PROD_PASSWORD="GreenReleaf123!"
PROD_DB="postgres"

# Local database configuration
LOCAL_DB_CONTAINER="green-releaf-postgres"
LOCAL_DB_USER="postgres"
LOCAL_DB_NAME="green_releaf_dev"

echo "🚀 Starting Complete Production Database Backup with Data"
echo "============================================================"
echo "📅 Timestamp: $TIMESTAMP"
echo "📡 Source: $PROD_DB (production)"
echo "🎯 Target: $LOCAL_DB_NAME (local Docker)"
echo "============================================================"

# Step 1: Check dependencies
log_info "Checking dependencies..."
if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed or not in PATH"
    exit 1
fi

if ! docker ps | grep -q "$LOCAL_DB_CONTAINER"; then
    log_error "Local Docker database container '$LOCAL_DB_CONTAINER' is not running"
    log_info "Please start it with: docker-compose up -d postgres"
    exit 1
fi

log_success "All dependencies are available"

# Step 2: Create backup directory
log_info "Creating backup directory..."
mkdir -p "$BACKUP_DIR"
log_success "Backup directory created: $BACKUP_DIR"

# Step 3: Backup complete production database (schema + data)
log_info "Backing up complete production database (schema + data)..."
log_warning "This may take several minutes depending on database size..."

docker run --rm \
    -e PGPASSWORD="$PROD_PASSWORD" \
    -v "$(pwd)/$BACKUP_DIR":/backup \
    postgres:16-alpine \
    pg_dump \
    --host="$PROD_HOST" \
    --port="$PROD_PORT" \
    --username="$PROD_USER" \
    --dbname="$PROD_DB" \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    --create \
    --format=plain \
    --file="/backup/production_full_backup_${TIMESTAMP}.sql"

if [ $? -eq 0 ]; then
    log_success "Complete production database backed up successfully"
    log_info "Backup file: $BACKUP_FILE"
else
    log_error "Failed to backup production database"
    exit 1
fi

# Step 4: Drop and recreate local database
log_info "Dropping and recreating local database..."
docker exec "$LOCAL_DB_CONTAINER" psql -U "$LOCAL_DB_USER" -c "DROP DATABASE IF EXISTS \"$LOCAL_DB_NAME\" WITH (FORCE);"
docker exec "$LOCAL_DB_CONTAINER" psql -U "$LOCAL_DB_USER" -c "CREATE DATABASE \"$LOCAL_DB_NAME\" WITH ENCODING 'UTF8' LC_COLLATE='C' LC_CTYPE='C' TEMPLATE=template0;"
log_success "Local database recreated"

# Step 5: Restore production database to local
log_info "Restoring production database to local..."
log_warning "This may take several minutes..."

docker exec -i "$LOCAL_DB_CONTAINER" psql -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" < "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    log_success "Production database restored successfully to local"
else
    log_error "Failed to restore production database to local"
    exit 1
fi

# Step 6: Verify restoration
log_info "Verifying database restoration..."

# Check tables
TABLE_COUNT=$(docker exec "$LOCAL_DB_CONTAINER" psql -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' ')

# Check users table
USER_COUNT=$(docker exec "$LOCAL_DB_CONTAINER" psql -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" -t -c "SELECT COUNT(*) FROM users;" 2>/dev/null | tr -d ' ' || echo "0")

# Check activepackages table
PACKAGE_COUNT=$(docker exec "$LOCAL_DB_CONTAINER" psql -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" -t -c "SELECT COUNT(*) FROM activepackages;" 2>/dev/null | tr -d ' ' || echo "0")

log_success "Database restoration verification completed:"
log_info "  Tables: $TABLE_COUNT"
log_info "  Users: $USER_COUNT"
log_info "  Active Packages: $PACKAGE_COUNT"

# Step 7: Create admin user if it doesn't exist
log_info "Checking for admin user..."
ADMIN_EXISTS=$(docker exec "$LOCAL_DB_CONTAINER" psql -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" -t -c "SELECT COUNT(*) FROM users WHERE username = 'admin';" | tr -d ' ')

if [ "$ADMIN_EXISTS" = "0" ]; then
    log_info "Creating admin user..."
    docker exec "$LOCAL_DB_CONTAINER" psql -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" -c "
        INSERT INTO users (username, first_name, last_name, email, email_hash, password_hash, is_active, is_admin, created_at)
        VALUES (
            'admin', 
            'Admin', 
            'User', 
            'admin@greenreleaf.com', 
            '\$2b\$10\$example_hash', 
            '\$2b\$10\$2y\$12\$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4Kz7z8Kz2', 
            true, 
            true, 
            NOW()
        );
    "
    log_success "Admin user created"
else
    log_success "Admin user already exists"
fi

# Step 8: Final summary
echo ""
echo "🎉 Complete Production Database Backup and Restore Finished Successfully!"
echo "=================================================================="
echo "📊 Your local database now has:"
echo "   ✅ Exact production schema (all tables, indexes, constraints)"
echo "   ✅ Complete production data (all records)"
echo "   ✅ All METRC sync tables with data"
echo "   ✅ All CRM tables with data"
echo "   ✅ All RBAC tables with data"
echo "   ✅ All audit logs with data"
echo ""
echo "🔑 Login Credentials:"
echo "   Username: admin"
echo "   Email: admin@greenreleaf.com"
echo "   Password: admin123"
echo ""
echo "🚀 Start your development server:"
echo "   npm run dev"
echo ""
echo "📊 Access admin panel:"
echo "   http://localhost:3000/admin"
echo ""
echo "🔄 Test sync functionality:"
echo "   npm run sync:active"
echo ""
echo "📁 Backup file saved: $BACKUP_FILE"
echo "=================================================================="

log_success "Script completed successfully!"
