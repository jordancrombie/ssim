# Wallet Integration Guide

This guide covers integrating digital wallet payments into SSIM. It explains the token architecture, available integration methods, and provides implementation examples.

## Overview

Wallet payments allow users to pay using cards enrolled in their digital wallet, without needing to re-enter card details. SSIM supports multiple integration methods:

| Method | Description | User Experience | Implementation |
|--------|-------------|-----------------|----------------|
| **Popup** | Opens wallet in popup window | Standard | Simple |
| **Inline** | Embeds wallet in iframe | Seamless | Simple |
| **Redirect** | Full-page OAuth redirect | Standard | Simple |
| **API** | Backend proxy to Merchant API | Custom UI | Medium |
| **API Direct** | Browser calls API directly | Custom UI | Medium |
| **API Proxy** | Explicit backend proxy | Custom UI | Medium |

## Architecture

### Payment Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ WALLET PAYMENT FLOW                                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. User clicks "Pay with Wallet" on checkout                       │
│  2. SSIM initiates wallet flow (popup/redirect/API)                 │
│  3. User authenticates and selects card in wallet                   │
│  4. Wallet returns two tokens to SSIM:                              │
│     - wallet_card_token (for routing)                               │
│     - card_token (for authorization)                                │
│  5. SSIM calls Payment API with BOTH tokens                         │
│  6. Payment API routes to correct bank using wallet_card_token      │
│  7. Bank validates card_token and authorizes payment                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Token Architecture

SSIM receives **two tokens** from the wallet for each payment:

| Token | Purpose | Format | Lifetime |
|-------|---------|--------|----------|
| `wallet_card_token` | **Routing** - tells Payment API which bank to route to | `wsim_bsim_{uniqueId}` | Per-transaction |
| `card_token` | **Authorization** - used by bank to authorize payment | JWT | 5-15 minutes |

**Important:** Token claims use **underscore** notation (`wallet_card_token`, `card_token`), not camelCase.

## Environment Configuration

```env
# Enable wallet payments
WSIM_ENABLED=true

# Wallet Auth Server (for OIDC flows)
WSIM_AUTH_URL=https://wallet-auth.example.com
WSIM_CLIENT_ID=your-merchant-id
WSIM_CLIENT_SECRET=your-client-secret
WSIM_POPUP_URL=https://wallet-auth.example.com

# Wallet Merchant API (for API flows)
WSIM_API_KEY=wsim_api_xxx
WSIM_API_URL=https://wallet.example.com/api/merchant
```

## Integration Methods

### Method 1: OIDC Flows (Popup/Inline/Redirect)

These methods use standard OAuth 2.0 authorization code flow.

#### Implementation

```typescript
// 1. Initiate payment - redirect to wallet
router.post('/payment/initiate', async (req, res) => {
  const { provider } = req.body; // 'wallet'

  // Create order
  const order = createOrder({ ... });

  // Generate PKCE values
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();

  // Store in session
  req.session.paymentState = {
    orderId: order.id,
    codeVerifier,
    state,
    provider: 'wallet'
  };

  // Build authorization URL
  const authUrl = walletClient.authorizationUrl({
    scope: 'openid payment:authorize',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  res.json({ redirectUrl: authUrl });
});

// 2. Handle callback - exchange code for tokens
router.get('/payment/wallet-callback', async (req, res) => {
  const { orderId, codeVerifier, state } = req.session.paymentState;

  // Exchange code for tokens
  const tokenSet = await walletClient.callback(
    `${APP_BASE_URL}/payment/wallet-callback`,
    req.query,
    { state, code_verifier: codeVerifier }
  );

  // Extract tokens from JWT claims
  const payload = JSON.parse(
    Buffer.from(tokenSet.access_token.split('.')[1], 'base64').toString()
  );

  const walletCardToken = payload.wallet_card_token;
  const cardToken = payload.card_token;

  // Authorize via Payment API
  const result = await authorizePayment({
    merchantId: MERCHANT_ID,
    amount: order.subtotal,
    cardToken,
    walletCardToken,
    orderId,
  });

  // Handle result...
});
```

### Method 2: Merchant API (Custom UI)

For a fully custom checkout experience, use the Merchant API to build your own card selection UI.

#### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/merchant/user` | GET | Check if user is authenticated |
| `/api/merchant/cards` | GET | Get user's enrolled cards |
| `/api/merchant/payment/initiate` | POST | Start payment, get passkey challenge |
| `/api/merchant/payment/confirm` | POST | Verify passkey, get tokens |

#### Implementation

```typescript
// Backend proxy routes (src/routes/wsim-api.ts)

// Check authentication
router.get('/auth-check', async (req, res) => {
  const response = await fetch(`${WSIM_API_URL}/user`, {
    headers: {
      'X-API-Key': WSIM_API_KEY,
      'Cookie': req.headers.cookie || '',
    },
  });
  res.json(await response.json());
});

// Get user's cards
router.get('/cards', async (req, res) => {
  const response = await fetch(`${WSIM_API_URL}/cards`, {
    headers: {
      'X-API-Key': WSIM_API_KEY,
      'Cookie': req.headers.cookie || '',
    },
  });

  const data = await response.json();
  // Response: { cards: [{ id, cardType, lastFour, cardholderName, isDefault }] }
  res.json(data);
});

// Initiate payment
router.post('/payment/initiate', async (req, res) => {
  const { cardId, amount, currency } = req.body;

  const response = await fetch(`${WSIM_API_URL}/payment/initiate`, {
    method: 'POST',
    headers: {
      'X-API-Key': WSIM_API_KEY,
      'Content-Type': 'application/json',
      'Cookie': req.headers.cookie || '',
    },
    body: JSON.stringify({
      cardId,
      amount,
      currency,
      merchantName: 'Your Store',
    }),
  });

  const data = await response.json();
  // Response: { paymentId, passkeyOptions }
  res.json(data);
});

// Confirm with passkey
router.post('/payment/confirm', async (req, res) => {
  const { paymentId, passkeyResponse } = req.body;

  const response = await fetch(`${WSIM_API_URL}/payment/confirm`, {
    method: 'POST',
    headers: {
      'X-API-Key': WSIM_API_KEY,
      'Content-Type': 'application/json',
      'Cookie': req.headers.cookie || '',
    },
    body: JSON.stringify({ paymentId, passkeyResponse }),
  });

  const data = await response.json();
  // Response: { walletCardToken, cardToken, expiresAt }
  res.json(data);
});
```

#### Frontend Implementation

```javascript
import { startAuthentication } from '@simplewebauthn/browser';

// Card selection UI
async function showWalletCards() {
  // Check auth status
  const authCheck = await fetch('/api/wsim/auth-check');
  const { authenticated } = await authCheck.json();

  if (!authenticated) {
    // Open wallet login popup
    openWalletLoginPopup();
    return;
  }

  // Fetch and display cards
  const cardsResponse = await fetch('/api/wsim/cards');
  const { cards } = await cardsResponse.json();

  renderCardPicker(cards);
}

// Payment confirmation with passkey
async function confirmPayment(cardId, amount) {
  // 1. Initiate payment
  const initResponse = await fetch('/api/wsim/payment/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, amount, currency: 'CAD' }),
  });

  const { paymentId, passkeyOptions } = await initResponse.json();

  // 2. Trigger browser passkey prompt
  const passkeyResponse = await startAuthentication(passkeyOptions);

  // 3. Confirm with wallet
  const confirmResponse = await fetch('/api/wsim/payment/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId, passkeyResponse }),
  });

  const { walletCardToken, cardToken } = await confirmResponse.json();

  // 4. Complete payment via your backend
  const paymentResponse = await fetch('/api/wsim/payment/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletCardToken, cardToken }),
  });

  if (paymentResponse.ok) {
    const { orderId } = await paymentResponse.json();
    window.location.href = `/order-confirmation/${orderId}`;
  }
}
```

## Error Handling

### Error Codes

| HTTP Status | Error Code | Description | Recommended Action |
|-------------|------------|-------------|-------------------|
| 401 | `missing_api_key` | No `X-API-Key` header | Check environment config |
| 401 | `invalid_api_key` | API key not found/invalid | Contact wallet provider |
| 401 | `not_authenticated` | User not logged in | Show login prompt |
| 400 | `no_cards` | User has no enrolled cards | Show enrollment link |
| 400 | `card_not_found` | Selected card doesn't exist | Refresh card list |
| 400 | `no_passkey` | User has no passkeys registered | Show passkey setup |
| 400 | `passkey_verification_failed` | Passkey authentication failed | Allow retry |
| 404 | `payment_not_found` | Payment session expired | Restart payment flow |
| 500 | `payment_failed` | Payment processing error | Show error, allow retry |

### Error Handling Example

```typescript
try {
  const result = await confirmPayment(cardId, amount);
} catch (error) {
  if (error.code === 'not_authenticated') {
    openWalletLoginPopup();
  } else if (error.code === 'passkey_verification_failed') {
    showMessage('Passkey verification failed. Please try again.');
  } else if (error.code === 'payment_failed') {
    showMessage('Payment could not be processed. Please try a different card.');
  } else {
    showMessage('An error occurred. Please try again.');
  }
}
```

## Card Data Structure

When fetching cards from the Merchant API, expect this structure:

```typescript
interface WalletCard {
  id: string;           // Unique card identifier
  cardType: string;     // "VISA", "MC", "AMEX", etc.
  lastFour: string;     // Last 4 digits
  cardholderName: string; // Or: holderName, name, ownerName (varies by provider)
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  bankName?: string;
}
```

**Note:** Field names may vary between wallet providers. Use fallbacks:

```javascript
const cardholderName = card.cardholderName || card.holderName || card.name || card.ownerName || '';
```

## CORS Configuration (API Direct)

For "API Direct" mode where the browser calls the wallet API directly, CORS must be configured:

**Wallet Server Requirements:**
```
Access-Control-Allow-Origin: https://your-store.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-API-Key
```

**Session Cookies:**
```
Set-Cookie: session=xxx; SameSite=None; Secure
```

**Browser Code:**
```javascript
const response = await fetch('https://wallet.example.com/api/merchant/cards', {
  headers: { 'X-API-Key': apiKey },
  credentials: 'include',  // Required for cross-origin cookies
});
```

## Security Considerations

1. **API Key Protection**
   - Never expose `WSIM_API_KEY` to the client
   - Use backend proxy routes for API calls
   - Exception: API Direct mode exposes the key (use with caution)

2. **Token Handling**
   - Payment tokens expire in 5-15 minutes
   - Never log full tokens
   - Clear tokens from memory after use

3. **Session Security**
   - Use secure, HttpOnly cookies
   - Implement CSRF protection
   - Validate state parameters in OAuth flows

4. **Passkey Security**
   - Passkeys are phishing-resistant
   - Require user verification (biometric/PIN)
   - Server validates attestation

## Testing Checklist

- [ ] Wallet environment variables configured
- [ ] OAuth client registered with wallet provider
- [ ] `/api/wsim/auth-check` returns correct status
- [ ] Card list displays correctly
- [ ] Card selection UI works
- [ ] Passkey prompt appears in browser
- [ ] Payment completes successfully
- [ ] Order confirmation shows "Wallet" payment method
- [ ] Error cases handled gracefully
- [ ] Bank payment flow still works (regression)

## Comparison: When to Use Each Method

| Scenario | Recommended Method |
|----------|-------------------|
| Quick implementation | OIDC (Popup/Redirect) |
| Standard wallet experience | OIDC (Popup) |
| Embedded checkout | OIDC (Inline) |
| Custom branded checkout | Merchant API |
| Single-page application | Merchant API |
| Inline card selection without popups | Merchant API |

## Related Documentation

- [README.md](../README.md) - Project overview
- [WSIM-API-Integration-Plan.md](WSIM-API-Integration-Plan.md) - Technical API reference
- [API-Integration-Troubleshooting.md](API-Integration-Troubleshooting.md) - Debugging tips
- [AWS-Deployment-Guide.md](AWS-Deployment-Guide.md) - Production deployment
