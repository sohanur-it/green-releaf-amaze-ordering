# 🚀 Quick Start: Docker Development Setup

## 📋 What's Been Created

I've set up a complete Docker-based development environment for testing METRC APIs and sync services locally. Here's what's ready:

### 🐳 Docker Services
- **PostgreSQL**: Local development database
- **PgAdmin**: Web-based database administration
- **Redis**: Caching and session storage

### 📁 Files Created
- `docker-compose.yml` - Docker services configuration
- `docker/postgres/init/01-init-database.sql` - Database initialization
- `config/local.env` - Local development environment variables
- `scripts/switch-env.js` - Environment switcher script
- `DOCKER_SETUP_GUIDE.md` - Comprehensive setup guide

### 🔧 Enhanced Configuration
- Updated `Server/config/database.js` with local/production support
- Added Docker scripts to `package.json`
- Environment switching capabilities

---

## 🎯 Quick Start Commands

### 1. Start Docker Services
```bash
# Start all services
npm run docker:up

# Check status
docker-compose ps

# View logs
npm run docker:logs
```

### 2. Switch to Local Environment
```bash
# Switch to local development
npm run env:local

# Check current environment
npm run env:status
```

### 3. Test Database Connection
```bash
# Test connection
docker exec -it green-releaf-postgres psql -U postgres -d green_releaf_dev -c "SELECT version();"
```

### 4. Start Application
```bash
# Start with local database
npm start
```

---

## 🔍 Access Points

### Services
- **PostgreSQL**: `localhost:5432`
- **PgAdmin**: `http://localhost:8080`
- **Redis**: `localhost:6379`
- **Application**: `http://localhost:3000`

### PgAdmin Login
- **Email**: `admin@greenreleaf.com`
- **Password**: `admin123`

### Database Connection (PgAdmin)
- **Host**: `postgres` (container name)
- **Port**: `5432`
- **Database**: `green_releaf_dev`
- **Username**: `postgres`
- **Password**: `dev_password_123`

---

## 🧪 Testing METRC APIs

### 1. Test API Endpoints
```bash
# Run automated API tests
npm run test:metrc

# Test with local database
NODE_ENV=development node test-metrc-apis.js
```

### 2. Test Sync Services
```bash
# Test active packages sync
npm run sync:active

# Test with local database
NODE_ENV=development node Sync/sync-active-packages.js
```

### 3. Create Superuser
```bash
# Create initial superuser
npm run superuser
```

---

## 📊 Database Schema

The local database includes:

### Core Tables
- `users` - User accounts and authentication
- `roles` - System roles (superuser, admin, manager, etc.)
- `permissions` - Granular permissions
- `user_roles` - User-role assignments
- `role_permissions` - Role-permission assignments
- `user_sessions` - Active user sessions
- `audit_log` - System audit trail

### METRC Sync Tables
- `metrc.sync_status` - Sync service status
- `metrc.sync_log` - Sync operation logs
- `metrc.active_packages` - Active package data
- `metrc.transferred_packages` - Transferred package data
- `metrc.intransit_packages` - In-transit package data
- `metrc.outgoing_transfers` - Outgoing transfer data
- `metrc.items` - Item reference data
- `metrc.strains` - Strain reference data

---

## 🔄 Environment Switching

### Switch to Local Development
```bash
npm run env:local
```

### Switch to Production
```bash
npm run env:production
```

### Check Current Environment
```bash
npm run env:status
```

---

## 🛠️ Useful Commands

### Docker Management
```bash
# Start services
npm run docker:up

# Stop services
npm run docker:down

# Reset (delete all data)
npm run docker:reset

# View logs
npm run docker:logs
```

### Database Operations
```bash
# Initialize database
npm run db:init

# Backup database
npm run db:backup

# Restore database
npm run db:restore
```

### Development
```bash
# Test METRC APIs
npm run test:metrc

# Test sync services
npm run sync:active

# Create superuser
npm run superuser
```

---

## 🚨 Troubleshooting

### Common Issues

#### 1. Port Conflicts
```bash
# Check what's using port 5432
lsof -i :5432

# Stop conflicting service
sudo lsof -ti:5432 | xargs kill -9
```

#### 2. Database Connection Failed
```bash
# Check container status
docker-compose ps

# Check logs
docker-compose logs postgres

# Restart services
docker-compose restart postgres
```

#### 3. Permission Denied
```bash
# Check database permissions
docker exec -it green-releaf-postgres psql -U postgres -d green_releaf_dev -c "\du"

# Reset permissions
docker exec -it green-releaf-postgres psql -U postgres -d green_releaf_dev -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;"
```

---

## 🎯 Next Steps

1. **Start Docker Services**: `npm run docker:up`
2. **Switch to Local**: `npm run env:local`
3. **Test Database**: Verify connection
4. **Test METRC APIs**: `npm run test:metrc`
5. **Test Sync Services**: `npm run sync:active`
6. **Create Superuser**: `npm run superuser`
7. **Start Application**: `npm start`

---

## 📞 Support

- **Docker Issues**: Check `DOCKER_SETUP_GUIDE.md`
- **Database Issues**: Check PostgreSQL logs
- **Application Issues**: Check application logs
- **Development Team**: Internal team support

---

**Ready to start? Run `npm run docker:up` to begin! 🚀**
