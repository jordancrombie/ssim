# SSIM - Store Simulator

A simple web application that demonstrates OIDC (OpenID Connect) authentication by connecting to identity providers like BSIM (Banking Simulator).

## Features

- **Store & Shopping Cart** - Product catalog with add-to-cart functionality
- **Payment Integration (NSIM)** - Card payments via BSIM OAuth consent and NSIM payment network
- **Order Management** - Order history and order details pages
- **Payment Webhooks** - Async payment status updates from NSIM with signature verification
- Simple login page with OIDC provider selection
- Supports multiple OIDC providers
- Displays user claims and token information after authentication
- PKCE (Proof Key for Code Exchange) support for enhanced security
- RP-Initiated Logout (ends session at both SSIM and the identity provider)
- **KENOK** - Open Banking integration to fetch account data from BSIM
- OAuth 2.0 Resource Indicators (RFC 8707) for JWT access tokens
- Session-based authentication state
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
| `/payment/initiate` | POST | Create order and redirect to BSIM for card selection |
| `/payment/callback` | GET | OAuth callback, authorize payment via NSIM |
| `/payment/capture/:orderId` | POST | Capture authorized payment |
| `/payment/void/:orderId` | POST | Void authorized payment |
| `/payment/refund/:orderId` | POST | Refund captured payment |

### Webhooks
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks/payment` | POST | Receive payment status updates from NSIM |
| `/webhooks/health` | GET | Webhook endpoint health check |

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
1. User adds products to cart and proceeds to checkout
2. User clicks "Pay with BSIM Card"
3. SSIM creates an order and redirects to BSIM auth with `payment:authorize` scope
4. User selects a card and consents to the payment
5. BSIM redirects back with authorization code
6. SSIM exchanges code for tokens containing `card_token` claim
7. SSIM calls NSIM `/api/v1/payments/authorize` with card token
8. NSIM processes authorization through BSIM
9. On success, user sees order confirmation

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Customer  │────▶│  SSIM Store  │────▶│  BSIM Auth   │────▶│  NSIM API    │
│   Browser   │     │  (checkout)  │     │  (consent)   │     │  (payments)  │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

## Future Improvements (TODO)

- [ ] **Persistent storage** - Orders are currently in-memory; add database storage (PostgreSQL/Redis)
- [ ] **Payment capture UI** - Add UI buttons to capture/void authorized payments from order details page
- [ ] **Better error handling** - Show specific payment errors to users (e.g., "Insufficient funds", "Card expired")
- [ ] **Production deployment** - Update production `.env` with proper payment credentials
- [ ] **Order expiration** - Auto-void authorized orders that aren't captured within timeout period
- [ ] **Email notifications** - Send order confirmation and status update emails

## License

MIT
