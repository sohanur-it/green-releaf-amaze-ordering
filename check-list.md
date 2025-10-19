# ✅ T3 / METRC API Integration - Feature & Endpoint Verification Checklist

This document serves as a **comprehensive implementation checklist** for validating all **authentication and synchronization endpoints** within the METRC Track & Trace (T3) API v2 integration. It ensures all endpoints, logic layers, and token management flows are implemented correctly across the sync service.

---

## 📘 1. Authentication & Token Management

### 🔹 1.1 Credential-Based Authentication
- [ ] Implement **`POST /v2/auth/credentials`** endpoint
- [ ] Accepts credentials: `username`, `password`, and `licenseKey`
- [ ] Returns both `accessToken` and `refreshToken`
- [ ] Stores both tokens securely in cache/database or environment file
- [ ] Automatically logs timestamp and expiry time for tokens
- [ ] Handle invalid credentials with proper error logging

### 🔹 1.2 Token Refresh Flow
- [ ] Implement **`POST /v2/auth/refresh`** endpoint
- [ ] Uses stored `refreshToken` to obtain a new `accessToken`
- [ ] Handles token expiry gracefully (e.g., auto-refresh before expiration)
- [ ] Detects 401 errors → triggers token refresh automatically
- [ ] Stores refreshed tokens with updated expiry metadata
- [ ] If refresh fails, falls back to full credential re-authentication

### 🔹 1.3 Token Validation Utility
- [ ] Create `is_token_valid()` utility to check expiry timestamps
- [ ] Cache token validity status to reduce redundant checks
- [ ] Handle race conditions if multiple threads/processes refresh token
- [ ] Include audit logging for all auth events (login, refresh, expiry)

---

## 🔐 2. Secure Credential Handling
- [ ] Use `.env` or secret manager for credentials
- [ ] Never hardcode credentials or tokens in source
- [ ] Use environment variable fallbacks for local/dev/prod environments
- [ ] Encrypt tokens or use secure file storage if persisted
- [ ] Implement periodic token cleanup job (for expired refresh tokens)

---

## ⚙️ 3. Core API Endpoints (Sync Layer)
Below are essential endpoints that must be verified in the METRC/T3 data sync pipeline.

### 🔹 3.1 Facility / License Management
- [ ] `GET /v2/facilities` → Retrieve all active facility profiles
- [ ] `GET /v2/facilities/{id}` → Verify individual facility details
- [ ] `GET /v2/licenses` → Fetch license details

### 🔹 3.2 Inventory Management
- [ ] `GET /v2/items` → Fetch master item catalog
- [ ] `GET /v2/strains` → Fetch strain list
- [ ] `GET /v2/packages/active` → Retrieve active package list
- [ ] `GET /v2/packages/inactive` → Retrieve inactive package list
- [ ] `GET /v2/packages/in-transit` → Retrieve packages currently in transit
- [ ] `GET /v2/packages/{id}` → Package details view

### 🔹 3.3 Transfers Management
- [ ] `GET /v2/transfers/active` → Active outgoing transfers
- [ ] `GET /v2/transfers/incoming` → Incoming transfers
- [ ] `GET /v2/transfers/in-transit` → Transfers currently in movement
- [ ] `GET /v2/transfers/completed` → Past/fulfilled transfers
- [ ] `POST /v2/transfers/create` → Create new manifest/transfer
- [ ] `PUT /v2/transfers/{id}/update` → Update existing manifest
- [ ] `DELETE /v2/transfers/{id}` → Cancel/Delete manifest

### 🔹 3.4 Orders / Sales Management
- [ ] `GET /v2/orders` → Retrieve sales orders
- [ ] `POST /v2/orders/create` → Create new order entry
- [ ] `PUT /v2/orders/{id}` → Update order details
- [ ] `GET /v2/orders/{id}/audit` → Verify order audit log

### 🔹 3.5 Audit & Logs
- [ ] `GET /v2/audit/logs` → Retrieve audit history (system-wide)
- [ ] `GET /v2/audit/logs/{entity}` → Entity-level audit (package, order, transfer)
- [ ] Ensure all critical API calls store local audit records

---

## 🔄 4. Sync Orchestration & Caching
- [ ] Implement scheduled sync jobs for core entities (packages, transfers, items)
- [ ] Maintain last sync timestamps in DB or cache
- [ ] Auto-retry failed sync jobs with exponential backoff
- [ ] Cache frequently accessed datasets (e.g., items, strains)
- [ ] Purge cache on data changes (invalidate old data)
- [ ] Implement delta sync (fetch only changed records since last timestamp)

---

## 🧠 5. Error Handling & Logging
- [ ] Centralized error handler for all API responses
- [ ] Graceful fallback on 4xx and 5xx errors
- [ ] Retry policy with capped exponential backoff
- [ ] Structured JSON logging for all requests/responses
- [ ] Log levels (DEBUG, INFO, WARNING, ERROR, CRITICAL)
- [ ] Include correlation ID for each sync operation
- [ ] Store failed requests for post-mortem analysis

---

## 📊 6. Testing & Verification
- [ ] Mock T3 API responses for local development
- [ ] Unit tests for auth module (token create, refresh, expiry)
- [ ] Integration tests for endpoint responses (200, 401, 403)
- [ ] Simulate expired token scenario (force refresh)
- [ ] Validate DB persistence of synced data
- [ ] End-to-end test: authenticate → fetch packages → store locally

---

## 🧩 7. Deployment & CI/CD Integration
- [ ] Environment‑based config (dev, staging, prod)
- [ ] CI pipeline validation for API schema consistency
- [ ] Token storage and refresh secrets managed via environment
- [ ] Scheduled job (e.g., Celery, Cron) for regular sync cycles
- [ ] Notify team via Slack/Email on failed sync or token expiration

---

## 🧭 8. Observability & Metrics
- [ ] Add metrics collection (Prometheus/Grafana integration)
- [ ] Monitor token refresh rate, error count, and latency
- [ ] Healthcheck endpoint `/health` returns API status + last sync times
- [ ] Setup alerts for 401 / 403 errors exceeding threshold

---

## ✅ 9. Verification Summary Template

| Module | Endpoint / Function | Status | Notes |
|--------|----------------------|--------|-------|
| Auth | POST /v2/auth/credentials | ☐ |  |
| Auth | POST /v2/auth/refresh | ☐ |  |
| Facilities | GET /v2/facilities | ☐ |  |
| Packages | GET /v2/packages/active | ☐ |  |
| Transfers | POST /v2/transfers/create | ☐ |  |
| Audit | GET /v2/audit/logs | ☐ |  |

---
