# WSIM Merchant API Integration Plan

## Overview

SSIM has implemented multiple checkout options using WSIM's Merchant API, giving us six total wallet payment methods:

| Option | Name | Description | Status |
|--------|------|-------------|--------|
| 1 | Popup | Opens WSIM in popup window | ✅ Implemented |
| 2 | Inline | Embeds WSIM in iframe | ✅ Implemented |
| 3 | Redirect | Full-page OAuth redirect to WSIM | ✅ Implemented |
| 4 | **API** | Original backend proxy (requires WSIM login) | ✅ Implemented |
| 5 | **API (Direct)** | Browser calls WSIM API directly with CORS | 🚧 Needs CORS |
| 6 | **API (Proxy)** | Explicit proxy variant (same as API) | ✅ Implemented |

This document focuses on **Option 5 (API Direct)** which requires WSIM to enable CORS.

---

## Current Problem

Option 4 (API Proxy) is partially implemented but has a session limitation:

```
Browser → SSIM Backend → WSIM API
              ↑
      Cannot forward WSIM session cookies
      (different origin)
```

When SSIM's backend calls WSIM's Merchant API, it cannot include the user's WSIM session cookie because:
- The session cookie is set for `wsim-dev.banksim.ca` domain
- SSIM backend runs on `ssim-dev.banksim.ca`
- Cookies are bound to their origin domain

**Result**: API flow asks user to authenticate, while Inline/Popup flows (running in browser context) have access to WSIM cookies.

---

## Option 3: API Direct (Frontend Calls WSIM)

### How It Works

```
Browser ──────────────────────────→ WSIM API
   │   Direct fetch() with              │
   │   credentials: 'include'           │
   │   (sends WSIM session cookie)      │
   │                                    │
   └──→ SSIM Backend ←──────────────────┘
         (payment completion only)
```

1. Browser fetches cards directly from `https://wsim-dev.banksim.ca/api/merchant/cards`
2. Browser has WSIM session cookie → user's cards are returned
3. User selects card, browser initiates payment with WSIM
4. Passkey authentication happens in browser
5. Browser sends tokens to SSIM backend for NSIM payment processing

### CORS Requirements for WSIM

WSIM needs to enable CORS on these endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/merchant/user` | GET | Check authentication status |
| `/api/merchant/cards` | GET | List user's enrolled cards |
| `/api/merchant/payment/initiate` | POST | Start payment, get WebAuthn challenge |
| `/api/merchant/payment/confirm` | POST | Verify passkey, get card tokens |

**Required CORS Headers:**

```
Access-Control-Allow-Origin: https://ssim-dev.banksim.ca
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-API-Key
```

**Important Notes:**
- `Access-Control-Allow-Origin` cannot be `*` when using credentials
- Must explicitly list allowed origins
- For production, add `https://ssim.banksim.ca` to allowed origins

### SSIM Implementation (Frontend)

```javascript
// Direct call to WSIM with credentials
async function fetchCardsDirectly() {
  const response = await fetch('https://wsim-dev.banksim.ca/api/merchant/cards', {
    method: 'GET',
    credentials: 'include',  // Include WSIM session cookie
    headers: {
      'X-API-Key': 'wsim_api_test123'  // API key in request
    }
  });
  return response.json();
}
```

### Security Considerations

1. **API Key Exposure**: The API key will be visible in browser network requests. This is acceptable if:
   - API key only grants read access to user's own cards (already authenticated via session)
   - API key is scoped to specific merchant
   - Rate limiting is in place

2. **CORS Origin Validation**: WSIM must validate the Origin header matches allowed list

3. **Session Cookie Security**: WSIM cookies should have:
   - `SameSite=None` (required for cross-origin requests)
   - `Secure=true` (HTTPS only)

---

## Option 4: API Proxy (Backend Calls WSIM)

### Current Implementation

Already implemented in SSIM at `/api/wsim/*` endpoints. Backend forwards requests but cannot include user's WSIM session.

### Token-Based Enhancement

To make this work without browser cookies, we could implement token-based authentication:

```
1. User clicks "API (Proxy)" button
2. SSIM opens small WSIM popup for token exchange
3. WSIM issues a short-lived merchant token
4. Token sent to SSIM via postMessage
5. SSIM backend uses token instead of session cookie
```

**WSIM Changes Required:**

1. New endpoint: `POST /api/merchant/token/exchange`
   - Input: User's session cookie (in popup)
   - Output: Short-lived merchant token (5-10 min expiry)

2. Accept token in `Authorization: Bearer <token>` header for all merchant API calls

This is more complex and can be implemented as a Phase 2 enhancement if needed.

---

## Implementation Timeline

### Phase 1: Option 3 (API Direct) - Immediate

**WSIM Team:**
1. Add CORS headers to `/api/merchant/*` endpoints
2. Allow origin: `https://ssim-dev.banksim.ca`
3. Ensure cookies have `SameSite=None; Secure`

**SSIM Team:**
1. Add "API (Direct)" button to checkout
2. Implement direct fetch calls with `credentials: 'include'`
3. Handle passkey authentication in browser
4. Send tokens to SSIM backend for NSIM processing

### Phase 2: Option 4 Enhancement (Future)

Only if direct API calls prove problematic:
1. Implement token exchange flow
2. Add Bearer token support to WSIM Merchant API

---

## Questions for WSIM Team

1. Can CORS be enabled on the Merchant API endpoints listed above?
2. Are the session cookies configured with `SameSite=None; Secure`?
3. Is there any concern with API key being visible in browser requests?
4. Should we implement any additional security measures?

---

## Testing Plan

1. **CORS Preflight**: Verify OPTIONS requests return correct headers
2. **Cookie Transmission**: Verify session cookie is sent with `credentials: 'include'`
3. **Card Retrieval**: Verify cards are returned without re-authentication
4. **Payment Flow**: Verify full payment with passkey works
5. **Cross-Browser**: Test on Chrome, Firefox, Safari

---

## Appendix: Current SSIM Endpoints

SSIM has these proxy endpoints ready (used by Option 4):

| Endpoint | Purpose |
|----------|---------|
| `GET /api/wsim/auth-check` | Check WSIM auth status |
| `GET /api/wsim/cards` | Get user's cards |
| `POST /api/wsim/payment/initiate` | Start payment |
| `POST /api/wsim/payment/confirm` | Confirm with passkey |
| `POST /api/wsim/payment/complete` | Complete via NSIM |

These will continue to be used for the final payment completion step, even with Option 3 (Direct), since NSIM authorization must happen on the backend.
