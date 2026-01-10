# CLAUDE.md - Project Context for AI Assistants

This file provides context for AI assistants (like Claude Code) working on this project.

## Project Overview

**SSIM (Store Simulator)** is a demonstration e-commerce application showcasing Open Banking payment integration. It integrates with:

- **BSIM** - Bank Simulator (authentication and Open Banking API)
- **NSIM** - Network/Payment Simulator (payment processing)
- **WSIM** - Wallet Simulator (digital wallet payments)
- **mwsim** - Mobile Wallet Simulator app

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Views**: EJS templates
- **Auth**: OpenID Connect (OIDC) with multiple providers
- **Real-time**: WebSocket (ws) for terminal communication

## Key Commands

```bash
# Development
npm run dev          # Start with hot reload
npm run build        # Compile TypeScript
npm start            # Production start

# Database
npx prisma migrate dev    # Run migrations
npx prisma generate       # Generate client
npx prisma studio         # Database GUI

# Testing
npm test             # Run all tests
npm run test:watch   # Watch mode

# Linting
npm run lint         # ESLint
npm run lint:fix     # Auto-fix
```

## Project Structure

```
src/
├── config/          # Environment and OIDC configuration
├── routes/          # Express route handlers
│   ├── auth.ts      # OIDC authentication
│   ├── payment.ts   # Payment processing
│   ├── cart.ts      # Shopping cart
│   ├── terminal.ts  # Terminal management (admin)
│   └── terminal-api.ts  # Terminal HTTP API (ESP32)
├── services/        # Business logic
├── views/           # EJS templates
└── __tests__/       # Jest tests
```

## API Specifications - KEEP UPDATED

**Important:** When modifying API endpoints or WebSocket messages, update the corresponding specification files:

| Change Type | Update This File |
|-------------|------------------|
| REST API endpoints | `docs/openapi.yaml` |
| WebSocket messages | `docs/asyncapi.yaml` |
| Terminal API | Both files |

### Specification Guidelines

1. **Version bump**: Update `info.version` in the spec when making breaking changes
2. **Document all fields**: Include descriptions for parameters and response fields
3. **Examples**: Add examples for complex request/response bodies
4. **Error responses**: Document all possible error codes

See [docs/README.md](docs/README.md) for more details on the API specifications.

## Multi-Instance Considerations

SSIM supports multiple instances sharing the same database. Key isolation points:

- **Store identity**: Determined by `STORE_DOMAIN` environment variable
- **Orders**: Scoped by `storeId` - always filter queries
- **Terminals**: Scoped by `storeId` - verify ownership on all operations
- **OIDC sessions**: Instance-specific, don't share sessions

When writing queries, always include `storeId` filtering:
```typescript
// Good
const order = await prisma.order.findFirst({
  where: { id: orderId, storeId: store.id }
});

// Bad - could return orders from other stores
const order = await prisma.order.findFirst({
  where: { id: orderId }
});
```

## Environment Variables

Key variables (see `.env.example` for full list):

| Variable | Purpose |
|----------|---------|
| `STORE_DOMAIN` | Store identity for multi-instance |
| `OIDC_PROVIDERS` | JSON array of OIDC provider configs |
| `PAYMENT_API_URL` | NSIM payment API endpoint |
| `WSIM_ENABLED` | Enable wallet payments |

## Testing Patterns

- Use Jest with `ts-jest`
- Mock Prisma client for database tests
- Mock `fetch` for external API tests
- Test files: `*.test.ts` in `__tests__/` directory

## Common Pitfalls

1. **Session race conditions**: Always call `req.session.save()` before redirects
2. **Store isolation**: Never query without `storeId` filter
3. **HTTPS in prod**: Use `ensureHttps()` helper for URLs
4. **Terminal WebSocket**: Verify store ownership before accepting connections
