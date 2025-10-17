# 🐳 Docker Development Setup Guide

## 📋 Overview

This guide sets up a local Docker-based development environment for the Green Releaf Amaze Ordering System. The setup includes:

- **PostgreSQL Database**: Local development database
- **PgAdmin**: Web-based database administration
- **Redis**: Caching and session storage
- **Local Environment**: Isolated from production RDS

---

## 🚀 Quick Start

### 1. Start Docker Services

```bash
# Start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f postgres
```

### 2. Verify Database Connection

```bash
# Test database connection
docker exec -it green-releaf-postgres psql -U postgres -d green_releaf_dev -c "SELECT version();"
```

### 3. Access Services

- **PostgreSQL**: `localhost:5432`
- **PgAdmin**: `http://localhost:8080`
- **Redis**: `localhost:6379`

---

## 🔧 Service Details

### PostgreSQL Database

**Container**: `green-releaf-postgres`  
**Image**: `postgres:15-alpine`  
**Port**: `5432`  
**Database**: `green_releaf_dev`  
**Username**: `postgres`  
**Password**: `dev_password_123`

**Features**:
- Automatic schema initialization
- RBAC tables and permissions
- METRC sync tables
- Audit logging
- Performance indexes

### PgAdmin

**Container**: `green-releaf-pgadmin`  
**Image**: `dpage/pgadmin4:latest`  
**Port**: `8080`  
**Email**: `admin@greenreleaf.com`  
**Password**: `admin123`

**Connection Settings**:
- **Host**: `postgres` (container name)
- **Port**: `5432`
- **Database**: `green_releaf_dev`
- **Username**: `postgres`
- **Password**: `dev_password_123`

### Redis

**Container**: `green-releaf-redis`  
**Image**: `redis:7-alpine`  
**Port**: `6379`  
**Password**: None (development only)

---

## 📁 File Structure

```
docker/
├── postgres/
│   └── init/
│       └── 01-init-database.sql    # Database initialization
├── docker-compose.yml             # Docker services configuration
└── config/
    └── local.env                  # Local development environment
```

---

## 🔄 Environment Configuration

### Local Development (.env.development)

The system automatically uses local Docker services when `NODE_ENV=development`:

```bash
# Database (Local Docker)
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=dev_password_123
DB_PORT=5432
DB_DATABASE=green_releaf_dev

# Redis (Local Docker)
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Production (.ENV)

Production continues to use AWS RDS:

```bash
# Database (AWS RDS)
DB_HOST=n8nstorage.c9c2iugeyzfa.us-east-2.rds.amazonaws.com
DB_USER=master
DB_PASSWORD=GreenReleaf123!
DB_PORT=5432
DB_DATABASE=postgres
```

---

## 🛠️ Development Workflow

### 1. Start Development Environment

```bash
# Start Docker services
docker-compose up -d

# Wait for services to be ready
docker-compose logs -f postgres

# Start application
npm start
```

### 2. Database Operations

```bash
# Connect to database
docker exec -it green-releaf-postgres psql -U postgres -d green_releaf_dev

# Run SQL scripts
docker exec -i green-releaf-postgres psql -U postgres -d green_releaf_dev < Queries/create-rbac-schema.sql

# Backup database
docker exec green-releaf-postgres pg_dump -U postgres green_releaf_dev > backup.sql

# Restore database
docker exec -i green-releaf-postgres psql -U postgres -d green_releaf_dev < backup.sql
```

### 3. Reset Development Database

```bash
# Stop services
docker-compose down

# Remove volumes (WARNING: This deletes all data)
docker-compose down -v

# Start fresh
docker-compose up -d
```

---

## 🧪 Testing METRC APIs

### 1. Test API Endpoints

```bash
# Run automated API tests
node test-metrc-apis.js

# Test with local database
NODE_ENV=development node test-metrc-apis.js
```

### 2. Test Sync Services

```bash
# Test active packages sync
NODE_ENV=development node Sync/sync-active-packages.js

# Test with local database
DB_HOST=localhost DB_USER=postgres DB_PASSWORD=dev_password_123 DB_DATABASE=green_releaf_dev node Sync/sync-active-packages.js
```

---

## 📊 Database Schema

### Core Tables

- **users**: User accounts and authentication
- **roles**: System roles (superuser, admin, manager, etc.)
- **permissions**: Granular permissions
- **user_roles**: User-role assignments
- **role_permissions**: Role-permission assignments
- **user_sessions**: Active user sessions
- **audit_log**: System audit trail

### METRC Sync Tables

- **metrc.sync_status**: Sync service status
- **metrc.sync_log**: Sync operation logs
- **metrc.active_packages**: Active package data
- **metrc.transferred_packages**: Transferred package data
- **metrc.intransit_packages**: In-transit package data
- **metrc.outgoing_transfers**: Outgoing transfer data
- **metrc.items**: Item reference data
- **metrc.strains**: Strain reference data

---

## 🔍 Troubleshooting

### Common Issues

#### 1. Port Conflicts

**Problem**: Port 5432 already in use  
**Solution**: 
```bash
# Check what's using the port
lsof -i :5432

# Stop conflicting service or change port in docker-compose.yml
```

#### 2. Database Connection Failed

**Problem**: Cannot connect to PostgreSQL  
**Solution**:
```bash
# Check container status
docker-compose ps

# Check logs
docker-compose logs postgres

# Restart services
docker-compose restart postgres
```

#### 3. Permission Denied

**Problem**: Database permission errors  
**Solution**:
```bash
# Check database permissions
docker exec -it green-releaf-postgres psql -U postgres -d green_releaf_dev -c "\du"

# Reset permissions
docker exec -it green-releaf-postgres psql -U postgres -d green_releaf_dev -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;"
```

#### 4. Schema Not Initialized

**Problem**: Tables don't exist  
**Solution**:
```bash
# Check initialization logs
docker-compose logs postgres | grep "init"

# Manually run initialization
docker exec -i green-releaf-postgres psql -U postgres -d green_releaf_dev < docker/postgres/init/01-init-database.sql
```

---

## 📈 Performance Optimization

### Database Tuning

```sql
-- Check database size
SELECT pg_size_pretty(pg_database_size('green_releaf_dev'));

-- Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM users WHERE username = 'test';
```

### Docker Resource Limits

```yaml
# Add to docker-compose.yml
services:
  postgres:
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
```

---

## 🔒 Security Considerations

### Development Only

⚠️ **WARNING**: This setup is for development only!

- **No encryption**: Passwords stored in plain text
- **Weak passwords**: Default development passwords
- **No SSL**: Unencrypted connections
- **Open access**: No network restrictions

### Production Security

For production, ensure:
- Strong passwords
- SSL/TLS encryption
- Network security groups
- Regular security updates
- Backup encryption

---

## 📋 Maintenance

### Daily Tasks

```bash
# Check service health
docker-compose ps

# Monitor logs
docker-compose logs --tail=100 postgres

# Check disk usage
docker system df
```

### Weekly Tasks

```bash
# Clean up unused containers
docker system prune

# Backup database
docker exec green-releaf-postgres pg_dump -U postgres green_releaf_dev > weekly_backup_$(date +%Y%m%d).sql

# Update images
docker-compose pull
```

### Monthly Tasks

```bash
# Full system cleanup
docker system prune -a

# Update Docker Compose
docker-compose down
docker-compose pull
docker-compose up -d
```

---

## 🎯 Next Steps

1. **Start Services**: `docker-compose up -d`
2. **Test Connection**: Verify database connectivity
3. **Run API Tests**: Test METRC API endpoints
4. **Test Sync Services**: Run sync scripts
5. **Develop Features**: Build remaining sync services
6. **Deploy to Production**: Use AWS RDS for production

---

## 📞 Support

- **Docker Issues**: Check Docker documentation
- **PostgreSQL Issues**: Check PostgreSQL logs
- **Application Issues**: Check application logs
- **Development Team**: Internal team support

---

**Ready to start? Run `docker-compose up -d` to begin! 🚀**
