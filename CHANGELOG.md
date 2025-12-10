# Changelog

All notable changes to SSIM (Store Simulator) will be documented in this file.

## [1.10.1] - 2025-12-10

### Fixed
- **Consistent Branding Across All Pages** - All customer-facing pages now display store branding
  - Profile, KENOK, Orders, Order Detail, and Order Confirmation pages now show theme colors and store name
  - Fixed routes to pass `store` branding and `themeCSS` to all page templates
  - Updated view includes to pass branding data to layout

- **Consistent Navigation** - All pages now have the same nav items
  - Checkout page nav updated to include Profile and KENOK links
  - Navigation styling consistent across all pages (Store, Cart, Orders, Profile, KENOK, Logout)

## [1.10.0] - 2025-12-10

### Added
- **Store Branding** - Admin-configurable store customization
  - Store name, tagline, and description
  - Logo and hero image uploads (stored in `/uploads/`)
  - 5 theme presets: Default (Purple), Amazon (Orange), Walmart (Blue), Staples (Red), Regal Moose (Forest Green)
  - CSS custom properties for dynamic theming without rebuild

- **Environment Badge** - Visual environment indicator in header
  - Single-letter badge (e.g., "D" for dev, "P" for prod) displayed in colored circle
  - Configurable via admin branding page
  - Visible on all customer-facing pages

- **New E-Commerce Homepage** - Modern storefront at `/`
  - Featured products section with random selection
  - Hero section with store branding
  - "About Us" section from store description
  - Feature highlights (Secure Payments, Quick Checkout, Trusted & Safe)

- **Admin Branding Page** - New `/admin/branding` page
  - Theme preview with live color updates
  - File upload for logo and hero images
  - Environment badge configuration

### Changed
- **Homepage Moved** - Original OIDC demo page moved from `/` to `/demo`
- **Themed Customer Pages** - Store, checkout, and homepage now use theme colors
- **Checkout Header** - Now uses theme gradient instead of hardcoded purple

### Database Migrations
- `20251209183707_add_store_branding` - Adds tagline, description, logoUrl, heroImageUrl, themePreset
- `20251209234000_add_env_badge` - Adds envBadge field

### New Files
- `src/config/themes.ts` - Theme preset definitions
- `src/helpers/theme.ts` - CSS generation helper
- `src/services/upload.ts` - File upload service (multer)
- `src/views/homepage.ejs` - New e-commerce homepage
- `src/views/demo.ejs` - Renamed from home.ejs
- `src/views/admin/branding.ejs` - Admin branding form

### Dependencies
- Added `multer` and `@types/multer` for file uploads

## [1.9.0] - 2025-12-08

### Added
- **PostgreSQL Database Integration** - Persistent storage using Prisma ORM
  - Multi-tenant database schema with store isolation
  - Six database tables: `stores`, `store_users`, `products`, `orders`, `store_admins`
  - All data persists across container restarts

- **Persistent Products** - Product catalog stored in database
  - Auto-seeding of default products when store is first created
  - Products survive container restarts and redeployments
  - Admin-managed product CRUD operations now persist

- **Persistent Orders** - Order history stored in database
  - Complete order history with payment details (JSONB)
  - Orders linked to users and stores
  - Transaction tracking across sessions

- **Database-Backed Admin Roles** - Role-based access control
  - Four roles: `admin`, `product_editor`, `order_manager`, `viewer`
  - Admins can be added/managed via admin panel
  - Environment-based super admins (`ADMIN_EMAILS`) always have full access

- **WSIM JWT Persistence** - Quick Checkout works across sessions
  - WSIM wallet tokens stored in user database record
  - Token restored on login for seamless Quick Checkout
  - New `/api/user/wsim-token` endpoints for token management

- **OIDC Consent Skipping** - Returning users skip consent screen
  - Consented scopes stored per user in database
  - Smoother login experience for repeat customers

- **WSIM API Diagnostic Page** - Debug tool at `/wsim-diagnostic`
  - Test CORS configuration and session handling
  - Verify WSIM API connectivity

### Fixed
- **Passkey Authentication** - Fixed `@simplewebauthn/browser@10` API change
  - Updated `startAuthentication(options)` to `startAuthentication({ optionsJSON: options })`
  - Affects all Quick Checkout and API checkout flows

### New Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `STORE_DOMAIN` | No | Store identifier (defaults to hostname) |
| `STORE_NAME` | No | Display name (defaults to "SSIM Store") |

### Database Schema
- `stores` - Store configuration and multi-tenant isolation
- `store_users` - User records with WSIM JWT storage and consent tracking
- `products` - Product catalog with pricing, categories, images
- `orders` - Order history with JSONB items and payment details
- `store_admins` - Role-based admin access per store

### Dependencies
- Added `prisma` and `@prisma/client` for database ORM
- Requires PostgreSQL 14+

### Documentation
- Added production deployment guide for shared RDS setup
- Database migration instructions for existing deployments

## [1.8.5] - 2025-12-07

### Fixed
- **E2E Test Suite** - Fixed all checkout payment flow E2E tests
  - Bank payment (Pay with BSIM) - OIDC flow session handling fixed
  - Wallet API payment - CDP virtual authenticator credential copying for popups
  - Wallet OIDC Popup - Passkey credential sharing between main page and popup
  - Wallet OIDC Inline - Iframe passkey authentication with emoji button text handling
  - Wallet OIDC Redirect - Email entry flow and smart passkey detection

### E2E Test Improvements
- **WebAuthn helpers** - Added `addCredential()` and `copyCredentials()` functions for sharing passkey credentials between CDP authenticator instances (required for popup windows)
- **Consolidated test structure** - Combined setup and checkout into single tests because CDP virtual authenticators are page-scoped (credentials don't persist between tests)
- **Skipped CORS-blocked tests** - API Direct, API Proxy, and Combined Flow tests properly skipped with clear reason (WSIM CORS configuration required)

### Technical Details
- CDP (Chrome DevTools Protocol) virtual authenticators are bound to their page context
- Popup windows and iframes need their own authenticator with credentials copied from the main page
- WSIM redirect flow uses email-first authentication (different from popup/inline flows)
- Some WSIM confirm buttons don't require passkey (simple submit), handled with smart detection

## [1.8.4] - 2025-12-07

### Documentation
- **AWS Deployment Guide** - Added [AWS-Deployment-Guide.md](docs/AWS-Deployment-Guide.md)
  - General AWS ECS Fargate deployment instructions for external developers
  - Architecture overview with diagram
  - Step-by-step ECR, task definition, and ECS service setup
  - Environment variables reference (required, payment, wallet, admin)
  - Deployment commands, troubleshooting, cost estimates, security considerations

- **Wallet Integration Guide** - Added [Wallet-Integration-Guide.md](docs/Wallet-Integration-Guide.md)
  - Comprehensive guide for integrating wallet payments
  - Token architecture explanation (`wallet_card_token` for routing, `card_token` for authorization)
  - OIDC flow implementation (popup/inline/redirect)
  - Merchant API implementation with code examples
  - Error codes reference table with recommended actions
  - CORS configuration for API Direct mode
  - Security considerations and testing checklist

- **WSIM API Integration Plan** - Updated [WSIM-API-Integration-Plan.md](docs/WSIM-API-Integration-Plan.md)
  - Added error codes reference table
  - Added card data structure documentation
  - Documented field name fallback for cardholderName (from v1.8.3 fix)
  - Added links to related documentation

- **README Updates**
  - Updated deployment documentation table to link to new AWS-Deployment-Guide.md

### Internal
- Moved internal deployment plans to `LOCAL_DEPLOYMENT_PLANS/` directory (excluded from repo via `.gitignore`)
- Internal plans shared via filesystem for team integrations

### Fixed
- **API Test Environment Compatibility** - Fixed `api.test.ts` to use `config.openbankingBaseUrl` instead of hardcoded URL
  - Test now works in both development and production environments
  - All 75 tests passing

## [1.8.3] - 2025-12-06

### Fixed
- **Card Picker Display** - Fixed "undefined" showing in cardholder name field for API checkout card pickers
  - WSIM Merchant API returns different field names than expected
  - Added fallback field name resolution (`cardholderName`, `holderName`, `name`, `ownerName`)
  - Added debug logging to identify WSIM API response structure
  - Affects API, API (Direct), and API (Proxy) card selection UIs

## [1.8.2] - 2025-12-06

### Fixed
- **API (Direct) and API (Proxy) Checkout Flows** - Applied same fixes from v1.8.1 to remaining API checkout options
  - Both `openWalletLoginPopupForDirect()` and `openWalletLoginPopupForProxy()` now handle WSIM messages correctly
  - Added `paymentCompleted` flag to prevent race conditions with popup close detection
  - Fixed message data structure parsing (flat object, not nested)
  - All three API checkout options (API, API Direct, API Proxy) now work correctly

### Documentation
- Added [SSIM-Production-Deployment-v1.8.md](docs/SSIM-Production-Deployment-v1.8.md) for BSIM team
  - Step-by-step deployment instructions for AWS ECS
  - New environment variables for WSIM integration
  - Updated task definition with all required variables
  - Verification checklist and rollback procedures

## [1.8.1] - 2025-12-06

### Fixed
- **API Checkout Flow** - Fixed critical bug where passkey authentication completed but payment didn't finalize
  - Fixed race condition between popup close detection and message handling
  - Fixed WSIM message data structure parsing (flat object, not nested)
  - API checkout now correctly redirects to order confirmation after passkey auth

### Documentation
- Added [API-Integration-Troubleshooting.md](docs/API-Integration-Troubleshooting.md)
  - Detailed debugging steps for postMessage issues
  - Race condition prevention patterns
  - Testing checklist for API checkout flow

## [1.8.0] - 2025-12-06

### Added
- **WSIM Merchant API Integration** - Multiple API-based checkout options
  - **API** button - Original backend proxy for WSIM Merchant API
  - **API (Direct)** button - Browser calls WSIM API directly (requires CORS)
  - **API (Proxy)** button - Explicit proxy variant with clear labeling
  - Custom card selection UI with passkey authentication
  - WebAuthn/Passkey integration for secure payment confirmation

### New Environment Variables
- `WSIM_API_KEY` - API key for WSIM Merchant API
- `WSIM_API_URL` - WSIM Merchant API endpoint URL

### New Routes
- `GET /api/wsim/auth-check` - Check WSIM authentication status
- `GET /api/wsim/cards` - Fetch user's enrolled wallet cards
- `POST /api/wsim/payment/initiate` - Start payment and get WebAuthn challenge
- `POST /api/wsim/payment/confirm` - Verify passkey and get payment tokens
- `POST /api/wsim/payment/complete` - Complete payment via NSIM

### Documentation
- Added [WSIM-API-Integration-Plan.md](docs/WSIM-API-Integration-Plan.md) for WSIM team
  - CORS requirements for API (Direct) option
  - Implementation details for both proxy and direct modes
  - Security considerations for cross-origin requests

### Technical Details
- Six wallet checkout options now available: Popup, Inline, Redirect, API, API (Direct), API (Proxy)
- API (Direct) requires WSIM to enable CORS headers for `ssim-dev.banksim.ca`
- Passkey authentication handled via `@simplewebauthn/browser` library
- CORS error detection with user-friendly fallback messaging

## [1.7.1] - 2025-12-05

### Improved
- **Wallet-Only Authentication Flow** - Users can now pay with wallet without logging into BSIM first
  - Wallet payments skip BSIM login requirement
  - WSIM handles both authentication and card selection in a single redirect
  - User session is created from WSIM identity on wallet callback
  - Guest users can complete wallet purchases without creating a separate account

### Changed
- `/payment/initiate` now allows unauthenticated users for wallet payments
- Wallet callback extracts user identity from WSIM ID token claims
- Checkout page only redirects to BSIM login for bank payments, not wallet

### Technical Details
- Orders created by unauthenticated wallet users use 'guest' userId initially
- Wallet callback updates order with real userId from WSIM identity
- Session `userInfo` populated from WSIM ID token (sub, name, email, etc.)

## [1.7.0] - 2025-12-05

### Added
- **WSIM Wallet Payment Integration** - Pay with digital wallet alongside bank payments
  - "Pay with Wallet" button on checkout (when WSIM_ENABLED=true)
  - WSIM OIDC client for wallet authorization flow
  - Wallet callback handler at `/payment/wallet-callback`
  - Dual token support: `wallet_card_token` (routing) + `card_token` (authorization)
  - Payment method tracking in order model (`bank` or `wallet`)

### New Features
- **Payment Provider Selection** - Users can choose between bank card or wallet
- **Payment Method Display** - Order confirmation and admin show payment method
- **Admin Orders Enhancement** - Payment method column in orders table

### Technical Details
- Updated `/payment/initiate` to accept `provider` parameter
- Added `walletCardToken` support in payment service for NSIM routing
- Extended `PaymentDetails` with `paymentMethod` and `walletCardToken` fields
- Updated session types with `provider` field in `PaymentState`

### Environment Variables
- `WSIM_ENABLED` - Enable wallet payments (default: false)
- `WSIM_AUTH_URL` - WSIM OIDC provider URL
- `WSIM_CLIENT_ID` - OAuth client ID for WSIM
- `WSIM_CLIENT_SECRET` - OAuth client secret for WSIM

### Dependencies
- Requires WSIM auth server to be available
- Requires NSIM to accept `walletCardToken` for routing

## [1.6.1] - 2025-12-03

### Changed
- **Tailwind CSS Production Build** - Replaced CDN with compiled CSS
  - Installed Tailwind CSS v4 with CLI for build-time compilation
  - Added `npm run css:build` and `npm run css:watch` scripts
  - CSS compiled and minified during Docker build (~30KB)
  - Added `/css` static route to serve compiled stylesheet

### Fixed
- CSS MIME type error - Added dedicated `/css` Express static route

## [1.6.0] - 2025-12-03

### Added
- **Admin Dashboard** - Full administrative interface at `/admin`
  - Dashboard with product and order statistics
  - Revenue tracking and quick action buttons
  - Recent orders overview
  - Shared sidebar partial for consistent navigation

### Admin Features
- **Product Management** - Full CRUD operations
  - Add new products with name, description, price, category
  - Edit existing products
  - Toggle product active/inactive status
  - Delete products from catalog

- **Order Management** - View and manage all orders
  - List all orders with status and details
  - Capture authorized payments
  - Void pending authorizations
  - Process refunds for captured payments

- **Settings Page** - View current configuration
  - Application settings (Base URL)
  - Payment settings (NSIM API URL, Merchant ID)
  - Admin access settings (authorized emails)
  - Environment information

### Security
- Admin authentication via BSIM OAuth
- Email-based access control via `ADMIN_EMAILS` environment variable
- All admin routes protected by `requireAdmin` middleware

### Fixed
- EJS template rendering - Rewrote admin views as standalone HTML documents with shared `_sidebar.ejs` partial (fixes "Could not find matching close tag" error from template literals containing EJS tags)

### Environment Variables
- `ADMIN_ENABLED` - Enable/disable admin dashboard (default: true)
- `ADMIN_EMAILS` - Comma-separated list of authorized admin email addresses

## [1.5.0] - 2025-12-03

### Production Deployment
- **NSIM Payment Integration Live** - Full payment flow deployed to production
- Production URL: https://ssim.banksim.ca
- Payment API: https://payment.banksim.ca

### Added
- Production environment variables for NSIM integration:
  - `PAYMENT_API_URL` - NSIM payment API endpoint
  - `PAYMENT_AUTH_URL` - BSIM auth for payment consent
  - `PAYMENT_CLIENT_ID` / `PAYMENT_CLIENT_SECRET` - OAuth credentials
  - `MERCHANT_ID` - Merchant identifier for NSIM
  - `WEBHOOK_SECRET` - HMAC secret for webhook verification
- Automatic webhook registration with NSIM on startup
- Updated AWS deployment documentation with payment configuration

### Infrastructure
- ECS task definition updated with payment environment variables
- Docker build now uses `docker buildx` for ARM/Apple Silicon compatibility
- Webhook endpoint registered: `https://ssim.banksim.ca/webhooks/payment`

## [1.4.1] - 2025-12-03

### Improved
- **Payment Decline Handling** - Show specific decline reasons (e.g., "Insufficient credit") with clear UI
- **Card Selection on Retry** - Users now see card selection screen on every payment attempt
- Payment authorization uses `prompt=consent` to always show BSIM card picker
- Orange-styled decline messages with "Please try a different payment method" guidance
- Decline reasons passed from NSIM are displayed to users

### Fixed
- Payment declines now properly return to checkout with specific error message instead of generic error
- Users can retry with different card after decline (previously would reuse same card)

## [1.4.0] - 2025-12-03

### Added
- **Payment Webhooks** - Async payment status updates from NSIM
- Webhook endpoint at `/webhooks/payment` with HMAC-SHA256 signature verification
- Automatic webhook registration with NSIM on server startup
- Support for all payment events: authorized, captured, voided, refunded, declined, expired, failed
- Order lookup by transaction ID for webhook processing
- `WEBHOOK_SECRET` environment variable for signature verification

### Technical Details
- Webhooks are registered automatically when SSIM starts
- Signature verification uses timing-safe comparison to prevent timing attacks
- Non-fatal webhook registration - server continues if NSIM is unavailable
- All webhook events return 200 quickly to prevent NSIM retries

## [1.3.0] - 2025-12-03

### Added
- **Store & Shopping Cart** - Product catalog with add-to-cart functionality
- **NSIM Payment Integration** - Full payment flow with BSIM card authorization
- **Order Management** - Order history, order details, and order confirmation pages
- Product catalog with sample products (src/data/products.ts)
- In-memory order storage (src/data/orders.ts)
- Payment service for NSIM API integration (src/services/payment.ts)
- Cart API endpoints for managing shopping cart
- Payment OAuth flow with `payment:authorize` scope
- Support for card token extraction from JWT access tokens

### Payment Flow
1. User adds items to cart and proceeds to checkout
2. SSIM redirects to BSIM auth with `payment:authorize` scope
3. User selects card and consents to payment
4. BSIM returns authorization code with `card_token` in JWT
5. SSIM calls NSIM `/api/v1/payments/authorize` endpoint
6. On success, order is marked as authorized

### New Pages
- `/store` - Product catalog
- `/checkout` - Shopping cart and payment initiation
- `/orders` - Order history
- `/orders/:id` - Order details
- `/order-confirmation/:id` - Payment confirmation

### New API Endpoints
- `GET /api/cart` - Get cart contents
- `POST /api/cart/add` - Add item to cart
- `DELETE /api/cart/remove/:productId` - Remove item from cart
- `POST /api/cart/clear` - Clear cart
- `POST /payment/initiate` - Create order and start payment OAuth flow
- `GET /payment/callback` - Handle payment OAuth callback
- `POST /payment/capture/:orderId` - Capture authorized payment
- `POST /payment/void/:orderId` - Void authorized payment
- `POST /payment/refund/:orderId` - Refund captured payment

### Environment Variables
- `PAYMENT_API_URL` - NSIM payment API endpoint
- `PAYMENT_AUTH_URL` - BSIM auth URL for payment consent
- `PAYMENT_API_KEY` - API key for NSIM (optional)
- `MERCHANT_ID` - Merchant ID (must match OAuth client_id)
- `PAYMENT_CLIENT_ID` - OAuth client ID for payment flow
- `PAYMENT_CLIENT_SECRET` - OAuth client secret for payment flow

### Technical Details
- Amounts are stored in cents internally, converted to dollars for NSIM API
- Card tokens are extracted from JWT `card_token` claim
- Merchant ID must match the OAuth client_id used during consent
- PKCE is used for payment authorization flow

## [1.2.0] - 2024-11-30

### Added
- AWS ECS Fargate deployment support
- `AWS_DEPLOYMENT.md` - Comprehensive deployment documentation
- `ssim-task-definition.json` - ECS task definition template
- `TRUST_PROXY` environment variable support for running behind load balancers
- Configurable `OPENBANKING_BASE_URL` environment variable

### Fixed
- **Session persistence behind ALB** - Added `trust proxy` support to fix "Invalid session state" error during OIDC callback when running behind AWS ALB or nginx reverse proxy
- Secure cookies now work correctly with HTTPS termination at load balancer

### Infrastructure
- Production deployment at https://ssim.banksim.ca
- Deployed as ECS Fargate service in BSIM AWS infrastructure
- CloudWatch logging at `/ecs/bsim-ssim`

## [1.1.0] - 2024-11-29

### Added
- **KENOK Page** - New Open Banking integration page for fetching account data
- Open Banking API client with JWT Bearer token authentication
- Resource indicator support for obtaining JWT access tokens
- SSIM logo served at `/logo.png` for OIDC provider display
- Debug logging for token analysis during development

### Changed
- Authorization flow now includes `resource` parameter for JWT access tokens
- Token callback extracts user info from ID token claims (required for resource-restricted tokens)
- Session save is now explicit before OIDC redirect to prevent race conditions

### API Endpoints
- `GET /kenok` - KENOK page for Open Banking account access
- `GET /api/accounts` - Proxy endpoint to fetch accounts from BSIM Open Banking API

### Technical Details
- Uses OAuth 2.0 Resource Indicators (RFC 8707) to request JWT access tokens
- Access tokens are audience-restricted to `https://openbanking.banksim.ca`
- User profile data extracted from ID token since access token is resource-bound

## [1.0.1] - 2024-11-29

### Added
- RP-Initiated Logout support - logging out now also ends the session at the OIDC provider
- Users are properly redirected back to SSIM after provider logout

### Changed
- Logout flow now redirects to provider's `end_session_endpoint` when available
- Falls back to local-only logout if provider doesn't support RP-Initiated Logout

## [1.0.0] - 2024-11-29

### Added
- Initial release of SSIM Store Simulator
- Express.js + TypeScript backend
- OIDC client authentication using `openid-client` library
- PKCE (Proof Key for Code Exchange) support for enhanced security
- Support for multiple OIDC providers via environment configuration
- Session-based authentication state management
- Clean, responsive UI with Tailwind CSS
- EJS server-side templating

### Pages
- Home page with welcome message and login call-to-action
- Login page with OIDC provider selection
- Profile page displaying user claims and token information

### API Endpoints
- `GET /auth/providers` - List available OIDC providers
- `GET /auth/login/:providerId` - Initiate OIDC authorization flow
- `GET /auth/callback/:providerId` - Handle OIDC callback
- `GET /auth/logout` - End session and logout from provider
- `GET /auth/me` - Get current authenticated user info (JSON)
- `GET /health` - Health check endpoint

### Infrastructure
- Docker support with multi-stage build
- Docker Compose configuration
- Environment-based configuration with `.env` files
