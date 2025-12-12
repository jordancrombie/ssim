# SSIM TODO

This file tracks planned features and improvements for the Store Simulator.

## Priority: High

### Session Storage
- [ ] **Redis Sessions** - Replace MemoryStore with Redis
  - Currently using MemoryStore (warning in logs)
  - Would allow horizontal scaling with multiple instances

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
- [ ] **Credential Encryption** - Encrypt sensitive values (API keys, secrets) at rest in database
  - Consider when adding admin-configurable payment credentials (v1.13.0)

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

- [x] **Complete Payment Method Toggles** - Added all remaining toggles (v1.12.0)
  - Wallet Inline toggle for embedded iframe checkout
  - Wallet API toggle controls API, API (Direct), API (Proxy) buttons
  - Fixed Inline button to use correct toggle (was using Popup)
- [x] **Admin Payment Methods** - Toggle payment options from admin panel (v1.11.0)
  - Control visibility of Bank Payment, Wallet Redirect, Popup, Quick Checkout
  - Settings persist in database per-store
- [x] **Store Branding** - Admin-configurable themes, logos, environment badges (v1.10.0)
- [x] **Persistent Storage** - PostgreSQL database with Prisma ORM (v1.9.0)
  - Products, Orders, Store settings all persisted
  - Database migrations for schema management
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
├── /                # Dashboard with key metrics
├── /products        # Product CRUD
├── /orders          # Order management
├── /branding        # Store branding config
├── /payment-methods # Payment method toggles
└── /settings        # Store configuration (read-only)
```

### Database
Database schema is managed via Prisma ORM. See `prisma/schema.prisma` for current schema.

Key models:
- `Store` - Store settings, branding, payment method toggles
- `StoreUser` - Users who have logged in via BSIM
- `StoreAdmin` - Admin access control
- `Product` - Product catalog
- `Order` - Orders with payment details

### Environment Variables (Admin)
```env
# Admin Configuration
ADMIN_ENABLED=true
ADMIN_EMAILS=admin@example.com,manager@example.com
# Or use BSIM role-based access
ADMIN_ROLE=ssim:admin
```
