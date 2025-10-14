# Green Releaf Amaze Ordering System

## 📋 Project Overview

**Green Releaf Amaze Ordering System** is a comprehensive cannabis business management platform built with Node.js and Express.js. The system integrates with **Metrc's Track & Trace API** (a regulatory compliance system for cannabis businesses) and provides a **CRM (Customer Relationship Management)** interface for managing buyers, sales representatives, and business relationships.

---

## 🏗️ Architecture

This project consists of **two main components**:

### 1. **Express.js Web Application** (Main Application)
A full-stack web application providing CRM functionality for managing:
- **Buyers** (customers/clients)
- **Sales Representatives**
- **Contacts** (people associated with buyers)
- **Locations** (buyer locations)
- **Notes** (activity tracking)
- **Tags** (categorization)

### 2. **Data Synchronization Script** (Background Job)
A standalone Node.js script that syncs **Active Package** data from Metrc's API to PostgreSQL database.

---

## 🛠️ Technology Stack

### Backend
- **Node.js** - JavaScript runtime
- **Express.js** - Web framework
- **EJS** - Template engine for server-side rendering
- **PostgreSQL** - Database (hosted on AWS RDS)
- **pg** - PostgreSQL client for Node.js

### Frontend
- **EJS Templates** - Server-rendered views
- **TinyMCE** - Rich text editor
- **Vanilla JavaScript** - Client-side interactivity
- **CSS** - Custom styling

### External APIs
- **Metrc Track & Trace API v2** - Cannabis regulatory compliance data
- **T3 API** - Third-party Metrc API wrapper

### Infrastructure
- **AWS RDS (PostgreSQL)** - Database hosting
- **Environment Variables** - Configuration management

---

## 📁 Project Structure

```
green-releaf-amaze-ordering/
│
├── Server/                          # Express.js Application
│   ├── config/
│   │   └── database.js             # PostgreSQL connection pool
│   │
│   ├── Controllers/                 # Business logic layer
│   │   └── crm/
│   │       ├── buyerController.js  # Buyer CRUD operations
│   │       ├── contactController.js
│   │       ├── locationController.js
│   │       ├── noteController.js
│   │       ├── salesRepController.js
│   │       └── tagController.js
│   │
│   ├── Models/                      # Data access layer
│   │   └── crm/
│   │       ├── buyerModel.js       # Database queries for buyers
│   │       ├── contactModel.js
│   │       ├── locationModel.js
│   │       ├── noteModel.js
│   │       ├── salesRepModel.js
│   │       └── tagModel.js
│   │
│   ├── Routes/                      # URL routing
│   │   ├── admin-routes.js         # Admin panel routes
│   │   └── crm/
│   │       └── api.js              # REST API endpoints
│   │
│   ├── Middleware/
│   │   └── error-handler.js        # Centralized error handling
│   │
│   └── server.js                    # Application entry point
│
├── Views/                           # EJS Templates
│   ├── layouts/
│   │   └── main.ejs                # Main layout template
│   │
│   ├── admin/
│   │   ├── dashboard.ejs           # Admin dashboard
│   │   └── crm/
│   │       ├── index.ejs           # Buyers list
│   │       ├── add-buyer.ejs       # Add buyer form
│   │       ├── edit-buyer.ejs      # Edit buyer form
│   │       ├── buyer-profile.ejs   # Buyer details page
│   │       └── sales-reps.ejs      # Sales reps management
│   │
│   └── partials/                    # Reusable components
│       ├── contact-modal.ejs
│       ├── location-modal.ejs
│       ├── note-modal.ejs
│       ├── tag-modal.ejs
│       └── sales-rep-modal.ejs
│
├── Public/                          # Static assets
│   ├── css/
│   │   └── admin-style.css         # Application styles
│   ├── js/
│   │   ├── admin/                  # Admin-specific scripts
│   │   │   ├── buyer-profile.js
│   │   │   └── sales-reps.js
│   │   └── shared/                 # Shared utilities
│   │       ├── main.js
│   │       └── modal.js
│   └── lib/
│       └── tinymce/                # Rich text editor
│
├── Sync/                            # Data Synchronization
│   └── sync-active-packages.js     # Metrc API sync script
│
├── Queries/                         # SQL Query Files
│   ├── extract-orders-ddl.sql
│   └── metrc-batch-extractor-query.sql
│
├── Utilities/
│   └── logger.js                   # Logging utility
│
├── package.json                     # Dependencies & scripts
└── .ENV                            # Environment variables (not in git)
```

---

## 🔄 System Components

### 1. CRM Web Application

#### Features
- **Buyer Management**
  - Create, read, update, delete buyers
  - Track buyer stages (lead, prospect, customer, etc.)
  - Manage deal flows and buyer types
  - Website URL tracking
  
- **Sales Representative Management**
  - Assign sales reps to buyers
  - Track rep performance
  - Manage rep details

- **Contact Management**
  - Multiple contacts per buyer
  - Contact roles and information
  - Email and phone tracking

- **Location Management**
  - Multiple locations per buyer
  - Address and location details

- **Notes & Activity Tracking**
  - Add notes to buyers
  - Track interactions and activities
  - Rich text editor support

- **Tagging System**
  - Categorize buyers with tags
  - Filter and organize records

#### Database Schema (CRM)
The application uses the following main tables:
- `buyers` - Main buyer records
- `sales_reps` - Sales representatives
- `contacts` - Contact information
- `locations` - Buyer locations
- `notes` - Activity notes
- `tags` - Categorization tags
- `buyer_tags` - Many-to-many relationship
- `stages` - Buyer pipeline stages
- `deal_flows` - Sales workflows

---

### 2. Metrc Data Synchronization

#### Purpose
Automatically syncs **Active Package** data from Metrc's regulatory system to the local PostgreSQL database.

#### What is Metrc?
Metrc is a **cannabis regulatory compliance platform** used by state governments to track cannabis products from seed to sale. It monitors:
- Package tracking
- Inventory management
- Lab testing results
- Transfer manifests
- Product movement

#### Sync Script Features

**`sync-active-packages.js`**

**Authentication & Token Management**
- JWT-based authentication with Metrc API
- Automatic token refresh
- Token expiration handling
- Concurrent request queuing

**Data Fetching**
- Paginated API requests (500 records per page)
- Intelligent retry logic with extended timeouts
- Hanging request detection
- Average response time tracking

**Data Processing**
- Fetches all active packages from Metrc
- Filters out inactive packages
- Compares API data with database records
- Identifies changes (new, updated, deleted)

**Database Operations**
- **INSERT** - New packages not in database
- **UPDATE** - Changed package information
- **DELETE** - Packages no longer in API
- Transaction-based operations (all or nothing)
- Batch operations for performance

**Data Mapping**
The script maps 100+ fields from Metrc API to database columns:
- Package details (label, quantity, type)
- Item information (name, strain, THC/CBD content)
- Facility information
- Lab testing data
- Dates (packaged, expiration, etc.)
- Status flags (isDonation, isFinished, etc.)

**Filtering Logic**
- Excludes packages that exist in `inactivepackages` table
- Prevents inactive packages from appearing in active sync

#### Database Schema (Metrc Sync)
- `activepackages` - Active cannabis packages
- `inactivepackages` - Historical package records

#### Key Features
- **Smart Retry Logic**: Normal retries → Extended timeouts → Skip on failure
- **Transaction Safety**: All operations wrapped in BEGIN/COMMIT/ROLLBACK
- **Performance**: Batch inserts, individual updates
- **Logging**: Comprehensive logging with emoji indicators
- **Error Handling**: Graceful degradation and error reporting

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v14+)
- PostgreSQL database
- Metrc API credentials (for sync script)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd green-releaf-amaze-ordering
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**
Create a `.ENV` file in the root directory:
```env
# Database Configuration
DB_USER=your_db_user
DB_HOST=your_db_host
DB_DATABASE=your_database_name
DB_PASSWORD=your_db_password
DB_PORT=5432

# Server Configuration
PORT=3000

# Metrc API Configuration (for sync script)
T3_API_BASE_URL=https://api.trackandtrace.tools/v2
T3_HOSTNAME=mo.metrc.com
T3_USERNAME=your_metrc_username
T3_PASSWORD=your_metrc_password
SYNC_LICENSE=CUL000063

# Logging
LOG_LEVEL=INFO
MAX_CONCURRENT_API_REQUESTS=3
```

4. **Set up the database**
Run the SQL queries in the `Queries/` directory to create the necessary tables.

5. **Start the application**
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

6. **Access the application**
- Web Application: http://localhost:3000/admin
- API Endpoints: http://localhost:3000/api/crm

---

## 📊 Running the Sync Script

The Metrc synchronization script is a standalone Node.js script that can be run independently:

```bash
# Run the sync script
node Sync/sync-active-packages.js
```

### Recommended Usage
Run the sync script as a **scheduled job** (cron) to keep data up-to-date:
```bash
# Example: Run every hour
0 * * * * cd /path/to/project && node Sync/sync-active-packages.js
```

---

## 🔌 API Endpoints

### CRM API Routes (`/api/crm`)

#### Buyers
- `GET /api/crm/buyers` - Get all buyers
- `GET /api/crm/buyers/:id` - Get buyer by ID
- `POST /api/crm/buyers` - Create new buyer
- `PUT /api/crm/buyers/:id` - Update buyer
- `DELETE /api/crm/buyers/:id` - Delete buyer

#### Contacts
- `GET /api/crm/buyers/:buyerId/contacts` - Get buyer contacts
- `POST /api/crm/buyers/:buyerId/contacts` - Add contact
- `PUT /api/crm/contacts/:id` - Update contact
- `DELETE /api/crm/contacts/:id` - Delete contact

#### Locations
- `GET /api/crm/buyers/:buyerId/locations` - Get buyer locations
- `POST /api/crm/buyers/:buyerId/locations` - Add location
- `PUT /api/crm/locations/:id` - Update location
- `DELETE /api/crm/locations/:id` - Delete location

#### Notes
- `GET /api/crm/buyers/:buyerId/notes` - Get buyer notes
- `POST /api/crm/buyers/:buyerId/notes` - Add note
- `PUT /api/crm/notes/:id` - Update note
- `DELETE /api/crm/notes/:id` - Delete note

#### Tags
- `GET /api/crm/tags` - Get all tags
- `POST /api/crm/tags` - Create tag
- `POST /api/crm/buyers/:buyerId/tags` - Assign tag to buyer
- `DELETE /api/crm/buyers/:buyerId/tags/:tagId` - Remove tag from buyer

#### Sales Representatives
- `GET /api/crm/sales-reps` - Get all sales reps
- `POST /api/crm/sales-reps` - Create sales rep
- `PUT /api/crm/sales-reps/:id` - Update sales rep
- `DELETE /api/crm/sales-reps/:id` - Delete sales rep

---

## 🎯 Key Features

### Web Application
✅ Full CRUD operations for all entities  
✅ Rich text editor for notes  
✅ Modal-based forms for quick actions  
✅ Responsive admin interface  
✅ Centralized error handling  
✅ Request logging  

### Sync Script
✅ Automatic authentication & token refresh  
✅ Paginated data fetching  
✅ Intelligent retry logic  
✅ Transaction-based database operations  
✅ Comprehensive logging  
✅ Error recovery  
✅ Performance optimization  

---

## 🔒 Security Considerations

- Environment variables for sensitive data
- Parameterized SQL queries (prevents SQL injection)
- JWT token management
- Database connection pooling
- Error handling without exposing internals

---

## 📝 Logging

The application uses a custom logging system with emoji indicators:

- ℹ️ **INFO** - General information
- 🚀 **STEP** - Major process steps
- ⚙️ **PROCESS** - Data processing
- 🎣 **FETCH** - API/database fetching
- 💾 **DB** - Database operations
- ☁️ **API** - External API calls
- 🔑 **AUTH** - Authentication
- ✅ **DONE** - Successful completion
- ⚠️ **WARN** - Warnings
- ❌ **ERROR** - Errors
- 💥 **FAIL** - Failures
- 🔄 **RETRY** - Retry attempts
- 🧼 **CLEANUP** - Cleanup operations
- ➕ **INSERT** - Database inserts
- ✍️ **UPDATE** - Database updates
- ➖ **DELETE** - Database deletes

---

## 🛣️ Roadmap / Future Enhancements

- [ ] User authentication & authorization
- [ ] Role-based access control
- [ ] Email notifications
- [ ] Reporting & analytics dashboard
- [ ] Export functionality (CSV, PDF)
- [ ] Advanced search & filtering
- [ ] Audit trail for all changes
- [ ] Real-time notifications
- [ ] Mobile-responsive improvements
- [ ] API rate limiting
- [ ] Automated testing suite

---

## 🤝 Contributing

This is a private project for Green Releaf. For questions or issues, contact the development team.

---

## 📄 License

Private - All rights reserved

---

## 👥 Support

For technical support or questions:
- Check the documentation
- Review the code comments
- Contact the development team

---

## 📧 Contact

**Green Releaf**  
Cannabis Business Management System

---

*Last Updated: January 2025*

