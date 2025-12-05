# SSIM - Store Simulator

A merchant demo application that demonstrates e-commerce payment flows using BSIM (Banking Simulator) for authentication and NSIM (Network Simulator) for payment processing.

**Production URL:** https://ssim.banksim.ca

## Overview

SSIM is part of the BankSim ecosystem - a suite of applications that simulate real-world banking and payment infrastructure:

| Component | Description | URL |
|-----------|-------------|-----|
| **BSIM** | Core banking simulator with auth server | https://banksim.ca |
| **SSIM** | Store/merchant simulator (this repo) | https://ssim.banksim.ca |
| **NSIM** | Payment network simulator | https://payment.banksim.ca |
| **WSIM** | Wallet simulator for digital wallet payments | https://wsim.banksim.ca |

## Features

### E-Commerce & Payments
- **Store & Shopping Cart** - Product catalog with add-to-cart functionality
- **NSIM Payment Integration** - Full payment lifecycle (authorize, capture, void, refund)
- **WSIM Wallet Payments** - Pay with digital wallet alongside bank card payments
- **Payment Webhooks** - Real-time payment status updates with HMAC-SHA256 signature verification
- **Order Management** - Order history, details, and confirmation pages
- **Decline Handling** - Clear error messages with card retry support

### Admin Dashboard
- **Product Management** - Add, edit, delete, and toggle products
- **Order Management** - View all orders, capture/void/refund payments
- **Settings** - View configuration and environment settings
- **Access Control** - Email-based admin authorization via BSIM auth

### Authentication & Open Banking
- **OIDC Authentication** - Login via BSIM identity provider
- **PKCE Support** - Proof Key for Code Exchange for enhanced security
- **RP-Initiated Logout** - Ends session at both SSIM and BSIM
- **KENOK** - Open Banking integration to fetch account data from BSIM
- **OAuth 2.0 Resource Indicators** - RFC 8707 for JWT access tokens
- Clean, responsive UI with Tailwind CSS

## Quick Start

### Prerequisites

- Node.js 18+
- An OIDC provider (like BSIM auth server)

### Installation

```bash
# Clone the repository
git clone https://github.com/jordancrombie/ssim.git
cd ssim

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your OIDC provider configuration
```

### Configuration

Edit `.env` with your OIDC provider details:

```env
PORT=3005
SESSION_SECRET=your-secure-random-string
APP_BASE_URL=http://localhost:3005

OIDC_PROVIDERS='[
  {
    "id": "bsim",
    "name": "BSIM Bank",
    "issuer": "https://auth.banksim.ca",
    "clientId": "ssim-store",
    "clientSecret": "your-client-secret",
    "scopes": "openid profile email fdx:accountdetailed:read fdx:transactions:read"
  }
]'
```

### Running Locally

```bash
# Development mode (with hot reload)
npm run dev

# Production build
npm run build
npm start
```

Visit `http://localhost:3005` in your browser.

## Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -t ssim .
docker run -p 3005:3005 --env-file .env ssim
```

## AWS Deployment

SSIM is deployed to AWS ECS Fargate as part of the BSIM infrastructure. See [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md) for complete deployment instructions.

**Production URL:** https://ssim.banksim.ca

### Key Configuration for Production

When running behind a load balancer (AWS ALB, nginx), set these environment variables:

```env
NODE_ENV=production
TRUST_PROXY=true          # Required for secure cookies behind ALB
APP_BASE_URL=https://ssim.banksim.ca
```

### WSIM Wallet Integration

To enable wallet payments via WSIM, configure these environment variables:

```env
# Enable wallet payments
WSIM_ENABLED=true
WSIM_AUTH_URL=https://wsim-auth.banksim.ca
WSIM_CLIENT_ID=ssim-merchant
WSIM_CLIENT_SECRET=<your-wsim-client-secret>
```

When `WSIM_ENABLED=true`, the checkout page displays both "Pay with BSIM" (bank card) and "Pay with Wallet" options.

## Registering SSIM as an OAuth Client in BSIM

To use SSIM with BSIM's auth server, you need to register it as an OAuth client:

```sql
INSERT INTO oauth_clients (
  "clientId",
  "clientSecret",
  "clientName",
  "redirectUris",
  "grantTypes",
  "responseTypes",
  scope,
  "isActive"
) VALUES (
  'ssim-store',
  '$2b$10$...', -- bcrypt hash of your client secret
  'SSIM Store Simulator',
  ARRAY['http://localhost:3005/auth/callback/bsim', 'https://store.banksim.ca/auth/callback/bsim'],
  ARRAY['authorization_code', 'refresh_token'],
  ARRAY['code'],
  'openid profile email',
  true
);
```

## API Endpoints

### Pages
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Home page |
| `/login` | GET | Login page with provider selection |
| `/profile` | GET | User profile (after authentication) |
| `/kenok` | GET | KENOK - Open Banking account access |
| `/store` | GET | Product catalog |
| `/checkout` | GET | Shopping cart and checkout |
| `/orders` | GET | Order history |
| `/orders/:id` | GET | Order details |
| `/order-confirmation/:id` | GET | Order confirmation after payment |

### Authentication
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/providers` | GET | List available OIDC providers (JSON) |
| `/auth/login/:providerId` | GET | Initiate OIDC login flow |
| `/auth/callback/:providerId` | GET | OIDC callback handler |
| `/auth/logout` | GET | Logout (RP-Initiated Logout at provider) |
| `/auth/me` | GET | Get current user info (JSON) |

### Cart
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cart` | GET | Get cart contents |
| `/api/cart/add` | POST | Add item to cart |
| `/api/cart/remove/:productId` | DELETE | Remove item from cart |
| `/api/cart/clear` | POST | Clear cart |

### Payment (NSIM Integration)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/payment/initiate` | POST | Create order and redirect to BSIM/WSIM for card selection |
| `/payment/callback` | GET | BSIM OAuth callback, authorize bank payment via NSIM |
| `/payment/wallet-callback` | GET | WSIM OAuth callback, authorize wallet payment via NSIM |
| `/payment/capture/:orderId` | POST | Capture authorized payment |
| `/payment/void/:orderId` | POST | Void authorized payment |
| `/payment/refund/:orderId` | POST | Refund captured payment |

### Webhooks
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks/payment` | POST | Receive payment status updates from NSIM |
| `/webhooks/health` | GET | Webhook endpoint health check |

### Admin (Protected)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin` | GET | Admin dashboard |
| `/admin/products` | GET | Product management |
| `/admin/products/new` | GET | Add new product form |
| `/admin/products/:id/edit` | GET | Edit product form |
| `/admin/products` | POST | Create product |
| `/admin/products/:id` | POST | Update product |
| `/admin/products/:id/toggle` | POST | Toggle product active status |
| `/admin/products/:id/delete` | POST | Delete product |
| `/admin/orders` | GET | Order management |
| `/admin/orders/:id` | GET | Order details |
| `/admin/orders/:id/capture` | POST | Capture authorized payment |
| `/admin/orders/:id/void` | POST | Void authorization |
| `/admin/orders/:id/refund` | POST | Refund captured payment |
| `/admin/settings` | GET | View settings |
| `/admin/api/stats` | GET | Get dashboard statistics (JSON) |

### Other
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/accounts` | GET | Fetch accounts from Open Banking API |
| `/health` | GET | Health check endpoint |

## Architecture

```
ssim/
├── src/
│   ├── config/
│   │   ├── env.ts          # Environment configuration
│   │   └── oidc.ts         # OIDC client setup
│   ├── data/
│   │   ├── products.ts     # Product catalog
│   │   └── orders.ts       # Order storage
│   ├── models/
│   │   └── order.ts        # Order type definitions
│   ├── routes/
│   │   ├── admin.ts        # Admin dashboard routes
│   │   ├── api.ts          # Open Banking API proxy routes
│   │   ├── auth.ts         # Authentication routes
│   │   ├── cart.ts         # Shopping cart routes
│   │   ├── payment.ts      # NSIM payment integration
│   │   ├── webhooks.ts     # NSIM webhook handlers
│   │   └── pages.ts        # Page routes
│   ├── services/
│   │   └── payment.ts      # NSIM Payment API client
│   ├── types/
│   │   └── session.ts      # Session type extensions
│   ├── views/
│   │   ├── admin/          # Admin dashboard views
│   │   │   ├── layout.ejs         # Admin sidebar layout
│   │   │   ├── dashboard.ejs      # Dashboard with stats
│   │   │   ├── products.ejs       # Product list
│   │   │   ├── product-form.ejs   # Add/edit product
│   │   │   ├── orders.ejs         # Order list
│   │   │   ├── order-detail.ejs   # Order detail with actions
│   │   │   └── settings.ejs       # Settings display
│   │   ├── layout.ejs      # Base layout
│   │   ├── home.ejs        # Home page
│   │   ├── store.ejs       # Product catalog
│   │   ├── checkout.ejs    # Shopping cart/checkout
│   │   ├── orders.ejs      # Order history
│   │   ├── order-detail.ejs       # Order details
│   │   ├── order-confirmation.ejs # Payment confirmation
│   │   ├── kenok.ejs       # KENOK - Open Banking page
│   │   ├── login.ejs       # Login/provider selection
│   │   └── profile.ejs     # User profile display
│   ├── public/
│   │   └── logo.png        # SSIM logo for OIDC providers
│   └── server.ts           # Express app entry point
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## OIDC Flow

### Login Flow
1. User clicks "Login" and selects an identity provider
2. SSIM generates PKCE code verifier/challenge and state
3. SSIM includes `resource=https://openbanking.banksim.ca` for JWT access tokens
4. User is redirected to the OIDC provider's authorization endpoint
5. User authenticates with the provider
6. Provider redirects back to SSIM with authorization code
7. SSIM exchanges code for tokens (JWT access token, ID token)
8. User info is extracted from ID token claims
9. User is shown their profile with claims and token info

### KENOK Flow (Open Banking)
1. Authenticated user navigates to KENOK page
2. User clicks "Fetch My Accounts from BSIM"
3. SSIM calls Open Banking API with JWT Bearer token
4. Open Banking API validates JWT signature and audience
5. Account data is returned and displayed

### Logout Flow (RP-Initiated Logout)
1. User clicks "Logout"
2. SSIM destroys the local session
3. SSIM redirects to the provider's `end_session_endpoint` with the ID token
4. Provider ends the user's session
5. Provider redirects back to SSIM's home page

### Payment Flow (NSIM Integration)

SSIM supports two payment methods: **Bank Card** (via BSIM) and **Digital Wallet** (via WSIM).

#### Bank Card Payment Flow

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Customer  │────▶│  SSIM Store  │────▶│  BSIM Auth   │────▶│  NSIM API    │
│   Browser   │     │  (checkout)  │     │  (consent)   │     │  (payments)  │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

1. **Checkout** - User adds products to cart and clicks "Pay with BSIM"
2. **Card Selection** - SSIM redirects to BSIM auth with `payment:authorize` scope
3. **User Consent** - User selects a card and authorizes the payment amount
4. **Token Exchange** - BSIM returns authorization code; SSIM exchanges for JWT with `card_token`
5. **Payment Authorization** - SSIM calls NSIM `/api/v1/payments/authorize` with card token
6. **Processing** - NSIM validates with BSIM and checks card limits/balance
7. **Result** - On success, order is authorized; on decline, user sees specific reason

#### Wallet Payment Flow (WSIM)

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Customer  │────▶│  SSIM Store  │────▶│  WSIM Auth   │────▶│  NSIM API    │────▶│  BSIM API    │
│   Browser   │     │  (checkout)  │     │  (wallet)    │     │  (routing)   │     │  (auth)      │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

**Note:** Wallet payments do not require BSIM login. WSIM handles both authentication and card selection in a single flow.

1. **Checkout** - User adds products to cart and clicks "Pay with Wallet" (no login required)
2. **WSIM Authentication** - SSIM redirects to WSIM auth with `payment:authorize` scope
3. **User Login & Card Selection** - User logs in to WSIM and selects an enrolled wallet card
4. **Dual Token Exchange** - WSIM returns two tokens:
   - `wallet_card_token` - Used by NSIM to route to the correct bank
   - `card_token` - Used by BSIM to authorize the payment
5. **Session Creation** - SSIM creates a user session from WSIM's ID token
6. **Payment Authorization** - SSIM calls NSIM with both tokens
7. **Routing & Processing** - NSIM uses wallet token to route to BSIM for authorization
8. **Result** - On success, order is authorized with payment method tracked as "wallet"

### Payment Lifecycle

After authorization, merchants can perform these operations via NSIM:

| Operation | Description | SSIM Endpoint |
|-----------|-------------|---------------|
| **Authorize** | Reserve funds on customer's card | `POST /payment/initiate` |
| **Capture** | Settle the authorized amount | `POST /payment/capture/:orderId` |
| **Void** | Cancel before capture | `POST /payment/void/:orderId` |
| **Refund** | Return funds after capture | `POST /payment/refund/:orderId` |

### Webhook Events

SSIM automatically registers for payment webhooks on startup. NSIM sends real-time updates:

- `payment.authorized` - Payment successfully authorized
- `payment.captured` - Payment captured/settled
- `payment.voided` - Authorization cancelled
- `payment.refunded` - Funds returned to customer
- `payment.declined` - Authorization rejected (insufficient funds, etc.)
- `payment.expired` - Authorization timeout
- `payment.failed` - Processing error

## Future Improvements (TODO)

### Completed
- [x] **NSIM Payment Integration** - Full payment flow with authorize, capture, void, refund
- [x] **WSIM Wallet Integration** - Pay with digital wallet alongside bank card payments
- [x] **Payment Webhooks** - Real-time status updates with signature verification
- [x] **Production Deployment** - Deployed to AWS ECS Fargate at https://ssim.banksim.ca
- [x] **Decline Handling** - Clear error messages with card retry support

### Pending
- [ ] **Persistent storage** - Orders are currently in-memory; add database storage (PostgreSQL/Redis)
- [ ] **Payment capture UI** - Add UI buttons to capture/void authorized payments from order details page
- [ ] **Order expiration** - Auto-void authorized orders that aren't captured within timeout period
- [ ] **Email notifications** - Send order confirmation and status update emails
- [ ] **Partial refunds** - Support refunding less than the full captured amount
- [ ] **Receipt generation** - Generate PDF receipts for completed orders

## License

MIT
