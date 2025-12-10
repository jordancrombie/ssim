# SSIM TODO

This file tracks planned features and improvements for the Store Simulator.

## Priority: High

### Persistent Storage
- [ ] **Database Integration** - Replace in-memory storage
  - PostgreSQL for orders and products
  - Redis for sessions (currently MemoryStore warning in logs)
  - Migration scripts for schema setup

## Priority: Medium

### Payment Enhancements
- [ ] **Partial Capture** - Capture less than authorized amount
- [ ] **Partial Refund** - Refund portion of captured amount
- [ ] **Auto-void Expired Auth** - Background job to void old authorizations
- [ ] **Payment Receipt** - Generate PDF receipts

### User Experience
- [ ] **Order Search** - Search orders by ID, date, status
- [ ] **Cart Persistence** - Save cart to database (survives session expiry)
- [ ] **Product Images** - Actual product images instead of placeholder icons
- [ ] **Product Categories** - Organize products by category
- [ ] **Quantity Limits** - Max quantity per product

### Notifications
- [ ] **Email Notifications** - Order confirmation and status updates
- [ ] **Webhook Logging** - Log all webhook events for debugging
- [ ] **Admin Alerts** - Notify admin of failed payments, refunds

## Priority: Low

### Analytics
- [ ] **Sales Dashboard** - Revenue, orders, popular products
- [ ] **Payment Analytics** - Authorization rate, decline reasons
- [ ] **Customer Insights** - Repeat customers, average order value

### Developer Experience
- [ ] **API Documentation** - OpenAPI/Swagger spec
- [ ] **Test Coverage** - Expand unit and integration tests
- [ ] **Seed Data** - Script to populate demo products and orders

### Security
- [ ] **Rate Limiting** - Protect payment endpoints
- [ ] **CSRF Protection** - Add CSRF tokens to forms
- [ ] **Audit Logging** - Log admin actions

## Known Issues / Investigations

### JWT Quick Checkout - Passkey Per Transaction (2025-12-10)
**Status:** Under investigation (likely WSIM-side issue)

**Problem:** When using JWT Quick Checkout for multiple transactions in the same session:
- First transaction: User authenticates to WSIM via popup, gets JWT token, passkey prompt works correctly
- Second transaction (same session): User is NOT prompted for passkey at all

**Requirement:** At least one passkey authentication should be required per transaction.

**Analysis:**
- SSIM code in `checkout.ejs` looks correct - `confirmJwtPayment()` always calls `navigator.credentials.get()` with `passkeyOptions` from WSIM's `/payment/initiate` response
- The issue is likely in **WSIM's `/payment/initiate` endpoint** - it may be:
  1. Not returning `passkeyOptions` for subsequent transactions (session-based bypass)
  2. Returning a flag that allows direct confirmation without passkey
  3. Auto-confirming based on recent passkey auth in the same session

**Files involved:**
- `src/views/checkout.ejs` - `confirmJwtPayment()` function (lines 1928-2055)
- WSIM `/payment/initiate` and `/payment/confirm` endpoints

**Next steps:** WSIM team to investigate their payment initiation logic to ensure `passkeyOptions` is always returned for each new transaction.

---

## Completed

- [x] **WSIM Merchant API Integration** - Multiple API checkout options (v1.8.0)
  - API, API (Direct), API (Proxy) buttons
  - Custom card selection with passkey authentication
  - Backend proxy routes for WSIM API
  - CORS-ready frontend for direct browser-to-WSIM calls
  - Integration plan documented for WSIM team
- [x] **Admin Dashboard** - Full admin UI at `/admin` (v1.6.0)
  - Dashboard with stats (products, orders, revenue)
  - Product management (add/edit/delete/toggle active)
  - Order management (view all orders, capture/void/refund)
  - Settings page (read-only config display)
  - Email-based access control via `ADMIN_EMAILS`
- [x] **NSIM Payment Integration** - Full payment lifecycle (v1.3.0)
- [x] **Payment Webhooks** - Real-time status updates (v1.4.0)
- [x] **Decline Handling** - Clear error messages with retry (v1.4.1)
- [x] **Production Deployment** - AWS ECS Fargate (v1.5.0)
- [x] **Open Banking (KENOK)** - Account data from BSIM (v1.1.0)
- [x] **RP-Initiated Logout** - End session at provider (v1.0.1)

## Architecture Notes

### Admin Routes Structure
```
/admin
├── /login          # Admin authentication
├── /dashboard      # Overview with key metrics
├── /products       # Product CRUD
├── /orders         # Order management
├── /settings       # Store configuration
└── /webhooks       # Webhook logs and status
```

### Database Schema (Future)
```sql
-- Products table (replaces src/data/products.ts)
CREATE TABLE products (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'CAD',
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Orders table (replaces src/data/orders.ts)
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'CAD',
  transaction_id VARCHAR(255),
  authorization_code VARCHAR(255),
  card_token VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Order items table
CREATE TABLE order_items (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders(id),
  product_id UUID REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL
);

-- Admin users table
CREATE TABLE admin_users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  bsim_sub VARCHAR(255) UNIQUE,  -- BSIM user subject
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Settings table
CREATE TABLE store_settings (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Environment Variables (Admin)
```env
# Admin Configuration
ADMIN_ENABLED=true
ADMIN_EMAILS=admin@example.com,manager@example.com
# Or use BSIM role-based access
ADMIN_ROLE=ssim:admin
```
