# Green Releaf Amaze Ordering System

A comprehensive cannabis ordering and inventory management system with METRC T3 API integration.

## 🚀 Quick Start

### Production Deployment (5 Steps)

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

### Development Setup

```bash
# Install dependencies
npm install

# Start Docker services
npm run docker:up

# Initialize database
npm run db:init

# Start development server
npm run dev
```

## 📁 Project Structure

```
├── docs/                    # Documentation
│   ├── api/                 # API documentation and testing
│   ├── deployment/          # Production deployment guides
│   └── guides/              # User guides and implementation docs
├── scripts/                 # Utility scripts
│   ├── schema/              # Database schema management
│   ├── sync/                # METRC sync operations
│   └── utils/               # General utilities
├── tests/                   # Test files
│   ├── api/                 # API tests
│   └── integration/         # Integration tests
├── Server/                  # Express.js application
│   ├── Controllers/         # Route controllers
│   ├── Models/              # Database models
│   ├── Routes/              # API routes
│   ├── Services/            # Business logic services
│   └── Middleware/          # Express middleware
├── Views/                   # EJS templates
├── Public/                  # Static assets
├── config/                  # Environment configurations
└── docker/                  # Docker configuration
```

## 🔧 Available Commands

### Environment Management
- `npm run env:local` - Switch to local development
- `npm run env:production` - Switch to production
- `npm run env:status` - Check current environment

### Database Operations
- `npm run db:init` - Initialize local database
- `npm run db:backup` - Backup database
- `npm run db:restore` - Restore database

### METRC Sync Operations
- `npm run sync:all:prod` - Run all production syncs
- `npm run sync:active:prod` - Sync active packages
- `npm run sync:strains:prod` - Sync strains
- `npm run sync:items:prod` - Sync items
- `npm run sync:transferred:prod` - Sync transferred packages
- `npm run sync:intransit:prod` - Sync in-transit packages
- `npm run sync:outgoing:prod` - Sync outgoing transfers

### Testing
- `npm run test:metrc` - Test METRC API connectivity
- `npm run test:production` - Test production environment
- `npm run test:sync-data` - Test production sync data
- `npm run test:api` - Test API endpoints
- `npm run test:sync-api` - Test admin sync API endpoints

### Automation
- `npm run scheduler:start` - Start automated sync scheduling
- `npm run scheduler:status` - Check scheduler status

## 📚 Documentation

- **[Module 2 Production Testing Guide](MODULE_2_PRODUCTION_TESTING_GUIDE.md)** - Complete testing guide for Module 2 integrations
- **[Admin Sync API Testing Guide](ADMIN_SYNC_API_TESTING_GUIDE.md)** - Comprehensive guide for testing admin sync API endpoints
- **[Production Sync Guide](docs/deployment/MODULE_2_PRODUCTION_SYNC_GUIDE.md)** - Complete production setup guide
- **[Docker Setup Guide](docs/deployment/DOCKER_SETUP_GUIDE.md)** - Local development setup
- **[METRC API Testing](docs/api/METRC_API_TESTING_GUIDE.md)** - API testing procedures
- **[Implementation Status](docs/guides/MODULE_2_IMPLEMENTATION_STATUS.md)** - Current implementation status

## 🔐 Environment Configuration

The system supports two environments:

- **Development**: Uses Docker PostgreSQL (`config/local.env`)
- **Production**: Uses AWS RDS (`config/production.env`)

## 🌐 Application Access

Once running, access the application at:
- **Main Application**: `http://localhost:3000`
- **Admin Dashboard**: `http://localhost:3000/admin`
- **Authentication**: `http://localhost:3000/auth/login`
- **API Endpoints**: `http://localhost:3000/api/v1/`

## 🧪 Module 2 Integrations Testing

### Quick Production Test
```bash
# 1. Start production system
NODE_ENV=production npm start &
npm run scheduler:start &

# 2. Test all sync operations
npm run sync:all:prod

# 3. Verify data synchronization
npm run test:sync-data

# 4. Test API endpoints
npm run test:api

# 5. Check scheduler status
npm run scheduler:status
```

### Comprehensive Testing
For detailed testing procedures, see the **[Module 2 Production Testing Guide](MODULE_2_PRODUCTION_TESTING_GUIDE.md)** which includes:
- ✅ System status verification
- ✅ Manual sync testing
- ✅ Data verification procedures
- ✅ API endpoint testing
- ✅ Automated scheduler testing
- ✅ Troubleshooting guide
- ✅ Production checklist

## 🛠️ Support

For technical support or questions:
- Check the documentation in the `docs/` folder
- Review application logs for error details
- Use the admin API endpoints for system status
- Contact the development team for complex issues

---

**The Green Releaf Amaze Ordering System is ready for production use!** 🚀
