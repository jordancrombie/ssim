# Changelog

All notable changes to SSIM (Store Simulator) will be documented in this file.

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
