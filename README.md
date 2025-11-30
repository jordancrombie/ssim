# SSIM - Store Simulator

A simple web application that demonstrates OIDC (OpenID Connect) authentication by connecting to identity providers like BSIM (Banking Simulator).

## Features

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

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Home page |
| `/login` | GET | Login page with provider selection |
| `/profile` | GET | User profile (after authentication) |
| `/kenok` | GET | KENOK - Open Banking account access |
| `/auth/providers` | GET | List available OIDC providers (JSON) |
| `/auth/login/:providerId` | GET | Initiate OIDC login flow |
| `/auth/callback/:providerId` | GET | OIDC callback handler |
| `/auth/logout` | GET | Logout (RP-Initiated Logout at provider) |
| `/auth/me` | GET | Get current user info (JSON) |
| `/api/accounts` | GET | Fetch accounts from Open Banking API |
| `/health` | GET | Health check endpoint |

## Architecture

```
ssim/
├── src/
│   ├── config/
│   │   ├── env.ts          # Environment configuration
│   │   └── oidc.ts         # OIDC client setup
│   ├── routes/
│   │   ├── api.ts          # Open Banking API proxy routes
│   │   ├── auth.ts         # Authentication routes
│   │   └── pages.ts        # Page routes
│   ├── views/
│   │   ├── layout.ejs      # Base layout
│   │   ├── home.ejs        # Home page
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

## License

MIT
