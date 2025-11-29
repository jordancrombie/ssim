# Changelog

All notable changes to SSIM (Store Simulator) will be documented in this file.

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
