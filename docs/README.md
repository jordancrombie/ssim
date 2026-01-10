# SSIM API Documentation

This directory contains API specifications and integration guides for the Store Simulator (SSIM).

## API Specifications

SSIM provides two API specification files using industry-standard formats:

| File | Format | Purpose |
|------|--------|---------|
| [openapi.yaml](openapi.yaml) | OpenAPI 3.1 | REST API endpoints |
| [asyncapi.yaml](asyncapi.yaml) | AsyncAPI 3.0 | WebSocket interfaces |

### OpenAPI vs AsyncAPI: When to Use Which

#### OpenAPI (`openapi.yaml`)

**Use for**: Traditional request/response HTTP APIs

OpenAPI (formerly Swagger) is the standard for documenting REST APIs. Use this specification when:

- Building integrations that call SSIM endpoints
- Understanding available HTTP routes (`GET`, `POST`, `PUT`, `DELETE`)
- Generating API client code
- Testing endpoints with tools like Postman or curl

**SSIM REST APIs documented:**
- Cart operations (`/cart/*`)
- Payment initiation and processing (`/payment/*`)
- Mobile wallet payments (`/payment/mobile/*`)
- OIDC authentication (`/auth/*`)
- Terminal pairing and HTTP API (`/api/terminal/*`)
- Webhooks (`/webhooks/*`)
- Open Banking proxy (`/api/accounts`)

**Tools that work with OpenAPI:**
- [Swagger UI](https://swagger.io/tools/swagger-ui/) - Interactive documentation
- [Postman](https://www.postman.com/) - Import and test APIs
- [OpenAPI Generator](https://openapi-generator.tech/) - Generate client SDKs
- [Redoc](https://redocly.github.io/redoc/) - Beautiful documentation

#### AsyncAPI (`asyncapi.yaml`)

**Use for**: Event-driven and real-time WebSocket APIs

AsyncAPI is the standard for documenting asynchronous, event-driven APIs. Use this specification when:

- Building hardware terminals that connect via WebSocket
- Understanding real-time message formats
- Implementing bidirectional communication protocols
- Building terminal firmware or emulators

**SSIM WebSocket APIs documented:**
- Terminal WebSocket connection (`/terminal/ws`)
- Payment request messages (server → terminal)
- Payment status updates (terminal → server)
- Heartbeat protocol
- Configuration updates

**Tools that work with AsyncAPI:**
- [AsyncAPI Studio](https://studio.asyncapi.com/) - Interactive editor
- [AsyncAPI Generator](https://github.com/asyncapi/generator) - Generate code/docs
- [AsyncAPI Docs](https://www.asyncapi.com/docs) - Documentation generator

### Quick Reference

| If you need to... | Use this spec |
|-------------------|---------------|
| Call a REST endpoint | `openapi.yaml` |
| Build a shopping cart integration | `openapi.yaml` |
| Process payments via HTTP | `openapi.yaml` |
| Build an ESP32 terminal | `asyncapi.yaml` |
| Understand WebSocket messages | `asyncapi.yaml` |
| Handle real-time payment updates | `asyncapi.yaml` |

## Other Documentation

| Document | Description |
|----------|-------------|
| [Wallet-Integration-Guide.md](Wallet-Integration-Guide.md) | WSIM wallet payment integration |
| [API-Integration-Troubleshooting.md](API-Integration-Troubleshooting.md) | Common integration issues |
| [AWS-Deployment-Guide.md](AWS-Deployment-Guide.md) | Deploying SSIM to AWS |
| [TERMINAL_DEPLOYMENT.md](TERMINAL_DEPLOYMENT.md) | Hardware terminal setup |

## Viewing the Specifications

### Online Viewers

**OpenAPI:**
1. Go to [Swagger Editor](https://editor.swagger.io/)
2. File → Import URL → paste raw GitHub URL for `openapi.yaml`

**AsyncAPI:**
1. Go to [AsyncAPI Studio](https://studio.asyncapi.com/)
2. Import the `asyncapi.yaml` file

### Local Development

```bash
# Install Swagger UI for OpenAPI
npx @redocly/cli preview-docs docs/openapi.yaml

# Install AsyncAPI tools
npm install -g @asyncapi/cli
asyncapi generate fromTemplate docs/asyncapi.yaml @asyncapi/html-template -o docs/asyncapi-html
```

## Keeping Specs Updated

**Important:** These specifications should be updated whenever API changes are made.

See `CLAUDE.md` in the project root for development guidelines, including the requirement to update API specifications when modifying endpoints or WebSocket messages.

When making changes:
1. Update the relevant spec file (`openapi.yaml` or `asyncapi.yaml`)
2. Update the version number in the spec's `info.version` field
3. Add changelog entry if significant
