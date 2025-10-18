#!/bin/bash

# Production Schema Backup Script
# This script uses pg_dump to extract schema from production and restore to local Docker database

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROD_HOST="n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com"
PROD_USER="master"
PROD_DB="postgres"
PROD_PORT="5432"

LOCAL_HOST="localhost"
LOCAL_USER="postgres"
LOCAL_DB="green_releaf_dev"
LOCAL_PORT="5432"
LOCAL_PASSWORD="dev_password_123"

BACKUP_DIR="./backups/schema"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
SCHEMA_FILE="${BACKUP_DIR}/schema_${TIMESTAMP}.sql"

# Functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if required tools are installed
check_dependencies() {
    log_info "Checking dependencies..."
    
    if ! command -v pg_dump &> /dev/null; then
        log_error "pg_dump is not installed. Please install PostgreSQL client tools."
        exit 1
    fi
    
    if ! command -v psql &> /dev/null; then
        log_error "psql is not installed. Please install PostgreSQL client tools."
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker."
        exit 1
    fi
    
    log_success "All dependencies are available"
}

# Check if Docker database is running
check_docker_db() {
    log_info "Checking if Docker database is running..."
    
    if ! docker ps | grep -q "green-releaf-postgres"; then
        log_error "Docker database container 'green-releaf-postgres' is not running."
        log_info "Please start it with: docker-compose up -d postgres"
        exit 1
    fi
    
    log_success "Docker database is running"
}

# Create backup directory
create_backup_dir() {
    log_info "Creating backup directory..."
    mkdir -p "$BACKUP_DIR"
    log_success "Backup directory created: $BACKUP_DIR"
}

# Extract schema from production database
extract_schema() {
    log_info "Extracting schema from production database..."
    
    # Use Docker container with PostgreSQL 16 to avoid version mismatch
    docker run --rm \
        -e PGPASSWORD="GreenReleaf123!" \
        -v "$(pwd)/$BACKUP_DIR":/backup \
        postgres:16-alpine \
        pg_dump \
        --host="$PROD_HOST" \
        --port="$PROD_PORT" \
        --username="$PROD_USER" \
        --dbname="$PROD_DB" \
        --schema-only \
        --no-owner \
        --no-privileges \
        --clean \
        --if-exists \
        --create \
        --format=plain \
        --file="/backup/schema_${TIMESTAMP}.sql"
    
    if [ $? -eq 0 ]; then
        log_success "Schema extracted successfully to: $SCHEMA_FILE"
    else
        log_error "Failed to extract schema from production database"
        exit 1
    fi
}

# Apply schema to local Docker database
apply_schema() {
    log_info "Applying schema to local Docker database..."
    
    # Set PGPASSWORD for local database
    export PGPASSWORD="$LOCAL_PASSWORD"
    
    # Apply schema to local database
    psql \
        --host="$LOCAL_HOST" \
        --port="$LOCAL_PORT" \
        --username="$LOCAL_USER" \
        --dbname="$LOCAL_DB" \
        --file="$SCHEMA_FILE"
    
    if [ $? -eq 0 ]; then
        log_success "Schema applied successfully to local database"
    else
        log_error "Failed to apply schema to local database"
        exit 1
    fi
    
    # Unset password
    unset PGPASSWORD
}

# Verify schema application
verify_schema() {
    log_info "Verifying schema application..."
    
    export PGPASSWORD="$LOCAL_PASSWORD"
    
    # Get table count
    TABLE_COUNT=$(psql \
        --host="$LOCAL_HOST" \
        --port="$LOCAL_PORT" \
        --username="$LOCAL_USER" \
        --dbname="$LOCAL_DB" \
        --tuples-only \
        --no-align \
        --command="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
    
    # Get sequence count
    SEQUENCE_COUNT=$(psql \
        --host="$LOCAL_HOST" \
        --port="$LOCAL_PORT" \
        --username="$LOCAL_USER" \
        --dbname="$LOCAL_DB" \
        --tuples-only \
        --no-align \
        --command="SELECT COUNT(*) FROM information_schema.sequences WHERE sequence_schema = 'public';")
    
    # Get function count
    FUNCTION_COUNT=$(psql \
        --host="$LOCAL_HOST" \
        --port="$LOCAL_PORT" \
        --username="$LOCAL_USER" \
        --dbname="$LOCAL_DB" \
        --tuples-only \
        --no-align \
        --command="SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public';")
    
    unset PGPASSWORD
    
    log_success "Schema verification completed:"
    log_info "  Tables: $TABLE_COUNT"
    log_info "  Sequences: $SEQUENCE_COUNT"
    log_info "  Functions: $FUNCTION_COUNT"
}

# Show schema summary
show_schema_summary() {
    log_info "Schema Summary:"
    
    export PGPASSWORD="$LOCAL_PASSWORD"
    
    echo ""
    echo "📊 Tables in local database:"
    psql \
        --host="$LOCAL_HOST" \
        --port="$LOCAL_PORT" \
        --username="$LOCAL_USER" \
        --dbname="$LOCAL_DB" \
        --command="SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
    
    echo ""
    echo "🔢 Sequences in local database:"
    psql \
        --host="$LOCAL_HOST" \
        --port="$LOCAL_PORT" \
        --username="$LOCAL_USER" \
        --dbname="$LOCAL_DB" \
        --command="SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' ORDER BY sequence_name;"
    
    unset PGPASSWORD
}

# Cleanup function
cleanup() {
    log_info "Cleaning up..."
    unset PGPASSWORD
}

# Main execution
main() {
    echo "🚀 Starting Production Schema Backup..."
    echo "📅 Timestamp: $TIMESTAMP"
    echo ""
    
    check_dependencies
    check_docker_db
    create_backup_dir
    extract_schema
    apply_schema
    verify_schema
    show_schema_summary
    
    echo ""
    log_success "Schema backup completed successfully!"
    log_info "Backup file: $SCHEMA_FILE"
    log_info "Local database: $LOCAL_DB"
}

# Handle script interruption
trap cleanup EXIT INT TERM

# Run main function
main "$@"
