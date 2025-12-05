# SSIM Wallet Integration Plan

This document outlines SSIM's integration with WSIM (Wallet Simulator) to enable "Pay with Wallet" functionality alongside existing BSIM bank payments.

## Overview

WSIM allows users to pay using cards they've enrolled in their digital wallet. SSIM needs to:
1. Offer "Pay with Wallet" as a checkout option
2. Redirect to WSIM for card selection
3. Receive two tokens: `wallet_card_token` (routing) + `card_token` (authorization)
4. Forward both tokens to NSIM for payment processing

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ PAYMENT FLOW (SSIM → WSIM → NSIM → BSIM)                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. User clicks "Pay with Wallet" on checkout                       │
│  2. SSIM redirects to WSIM /authorize endpoint                      │
│  3. User selects enrolled card in WSIM                              │
│  4. WSIM returns authorization code to SSIM callback                │
│  5. SSIM exchanges code for tokens:                                 │
│     - wallet_card_token (routing: wsim_bsim_xxx)                    │
│     - card_token (JWT for BSIM authorization)                       │
│  6. SSIM calls NSIM /api/v1/payments/authorize with BOTH tokens     │
│  7. NSIM uses wallet_card_token to route to correct bank            │
│  8. BSIM validates card_token and authorizes payment                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Token Architecture

| Token | Purpose | Format | Source | Lifetime |
|-------|---------|--------|--------|----------|
| `wallet_card_token` | **Routing** - tells NSIM which bank to route to | `wsim_bsim_{uniqueId}` | WSIM JWT claims | Per-transaction |
| `card_token` | **Authorization** - used by BSIM to authorize payment | JWT | WSIM JWT claims | 15 minutes |

**Important**: Token claims use **underscore** notation (`wallet_card_token`, `card_token`), not camelCase.

---

## Implementation Status

**Status: COMPLETE** - All tasks implemented and tested successfully on 2025-12-05.

## Implementation Tasks

### Task 1: Environment Configuration ✅

**File:** `src/config/env.ts`

Add WSIM configuration:

```typescript
// WSIM (Wallet) integration
wsimEnabled: process.env.WSIM_ENABLED === 'true',
wsimAuthUrl: process.env.WSIM_AUTH_URL || '',
wsimClientId: process.env.WSIM_CLIENT_ID || 'ssim-merchant',
wsimClientSecret: process.env.WSIM_CLIENT_SECRET || '',
```

**Environment Variables:**
```env
# Wallet Integration
WSIM_ENABLED=true
WSIM_AUTH_URL=https://wsim-auth-dev.banksim.ca
WSIM_CLIENT_ID=ssim-merchant
WSIM_CLIENT_SECRET=<provided-by-wsim-team>
```

---

### Task 2: WSIM OIDC Client Setup ✅

**File:** `src/routes/payment.ts`

Add WSIM client alongside existing BSIM payment client:

```typescript
// Store WSIM OIDC client (initialized on first use)
let wsimClient: Client | null = null;

async function getWsimClient() {
  if (!wsimClient && config.wsimEnabled) {
    console.log('[Payment] Discovering WSIM issuer:', config.wsimAuthUrl);
    const issuer = await Issuer.discover(config.wsimAuthUrl);
    wsimClient = new issuer.Client({
      client_id: config.wsimClientId,
      client_secret: config.wsimClientSecret,
      redirect_uris: [`${config.appBaseUrl}/payment/wallet-callback`],
      response_types: ['code'],
    });
  }
  return wsimClient;
}
```

---

### Task 3: Update Payment Initiation Route ✅

**File:** `src/routes/payment.ts`

Modify `/payment/initiate` to accept a `provider` parameter:

```typescript
router.post('/initiate', async (req: Request, res: Response) => {
  const { provider = 'bank' } = req.body; // 'bank' or 'wallet'

  // ... existing order creation logic ...

  // Store provider in payment state
  req.session.paymentState = {
    orderId: order.id,
    state,
    nonce,
    codeVerifier,
    provider,  // NEW: track which provider
  };

  if (provider === 'wallet' && config.wsimEnabled) {
    // Use WSIM for wallet payments
    const client = await getWsimClient();
    const authUrl = client.authorizationUrl({
      scope: 'openid payment:authorize',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      claims: JSON.stringify({
        payment: {
          amount: (order.subtotal / 100).toFixed(2),
          currency: order.currency,
          merchantId: config.merchantId,
          orderId: order.id,
        }
      }),
    });
    res.json({ redirectUrl: authUrl, orderId: order.id });
  } else {
    // Use existing BSIM for bank payments (unchanged)
    const client = await getPaymentClient();
    // ... existing auth URL generation ...
  }
});
```

---

### Task 4: Wallet Callback Handler ✅

**File:** `src/routes/payment.ts`

Create new wallet-specific callback route:

```typescript
router.get('/wallet-callback', async (req: Request, res: Response) => {
  const paymentState = req.session.paymentState;

  if (!paymentState || paymentState.provider !== 'wallet') {
    return res.redirect('/checkout?error=invalid_state');
  }

  const { orderId, state, nonce, codeVerifier } = paymentState;

  // Verify state
  if (req.query.state !== state) {
    return res.redirect('/checkout?error=state_mismatch');
  }

  // Check for error from auth server
  if (req.query.error) {
    console.error('[Payment] WSIM auth error:', req.query.error);
    return res.redirect(`/checkout?error=${req.query.error}`);
  }

  const order = getOrderById(orderId);
  if (!order) {
    return res.redirect('/checkout?error=order_not_found');
  }

  try {
    const client = await getWsimClient();
    const params = client.callbackParams(req);
    const redirectUri = `${config.appBaseUrl}/payment/wallet-callback`;

    const tokenSet = await client.callback(redirectUri, params, {
      state,
      nonce,
      code_verifier: codeVerifier,
    });

    // Extract BOTH tokens from JWT claims (underscore notation!)
    const accessToken = tokenSet.access_token;
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());

    const walletCardToken = payload.wallet_card_token;  // Routing
    const cardToken = payload.card_token;                // Authorization

    if (!walletCardToken || !cardToken) {
      throw new Error('Missing wallet tokens in response');
    }

    // Clear payment state
    delete req.session.paymentState;

    // Authorize via NSIM with both tokens
    const authResult = await authorizePayment({
      merchantId: config.merchantId,
      amount: order.subtotal,
      currency: order.currency,
      cardToken,
      walletCardToken,
      orderId: order.id,
    });

    if (authResult.status === 'authorized') {
      setOrderAuthorized(order.id, authResult.transactionId, authResult.authorizationCode || '', cardToken, 'wallet', walletCardToken);
      req.session.cart = [];
      res.redirect(`/order-confirmation/${order.id}`);
    } else if (authResult.status === 'declined') {
      setOrderDeclined(order.id);
      const reason = encodeURIComponent(authResult.declineReason || 'Payment declined');
      res.redirect(`/checkout?error=payment_declined&reason=${reason}`);
    } else {
      setOrderFailed(order.id);
      res.redirect('/checkout?error=payment_failed');
    }
  } catch (error) {
    console.error('[Payment] Wallet callback error:', error);
    setOrderFailed(orderId);
    res.redirect('/checkout?error=payment_error');
  }
});
```

---

### Task 5: Update Payment Service ✅

**File:** `src/services/payment.ts`

Add optional `walletCardToken` to authorization:

```typescript
export interface AuthorizeParams {
  merchantId: string;
  amount: number;
  currency: string;
  cardToken: string;
  walletCardToken?: string;  // NEW: for wallet payments
  orderId: string;
}

export async function authorizePayment(params: AuthorizeParams): Promise<AuthorizeResult> {
  const amountInDollars = params.amount / 100;

  const body: Record<string, unknown> = {
    merchantId: params.merchantId,
    amount: amountInDollars,
    currency: params.currency,
    cardToken: params.cardToken,
    orderId: params.orderId,
  };

  // Include wallet routing token if present
  if (params.walletCardToken) {
    body.walletCardToken = params.walletCardToken;
  }

  return makePaymentRequest<AuthorizeResult>('/authorize', 'POST', body);
}
```

---

### Task 6: Update Order Model & Data ✅

**File:** `src/models/order.ts`

Track payment method:

```typescript
export type PaymentMethod = 'bank' | 'wallet';

export interface PaymentDetails {
  transactionId: string;
  authorizationCode?: string;
  cardToken?: string;
  walletCardToken?: string;      // NEW
  paymentMethod?: PaymentMethod; // NEW
  capturedAmount?: number;
  refundedAmount?: number;
}
```

**File:** `src/data/orders.ts`

Update `setOrderAuthorized` function signature:

```typescript
export function setOrderAuthorized(
  orderId: string,
  transactionId: string,
  authorizationCode: string,
  cardToken: string,
  paymentMethod: PaymentMethod = 'bank',
  walletCardToken?: string
): void {
  // ... update order with payment details including method
}
```

---

### Task 7: Update Checkout UI ✅

**File:** `src/views/checkout.ejs`

Add "Pay with Wallet" button alongside existing "Pay with BSIM":

Update the authenticated section to show both payment options:

```html
<!-- Pay with Bank -->
<button
  id="payBankButton"
  onclick="initiatePayment('bank')"
  class="w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white py-4 px-6 rounded-xl font-semibold..."
>
  <svg class="w-6 h-6" ...><!-- bank icon --></svg>
  <span>Pay with BSIM</span>
</button>

<!-- Pay with Wallet (conditional) -->
<% if (wsimEnabled) { %>
<div class="mt-4">
  <div class="flex items-center my-4">
    <div class="flex-grow border-t border-gray-200"></div>
    <span class="mx-4 text-gray-400 text-sm">or</span>
    <div class="flex-grow border-t border-gray-200"></div>
  </div>
  <button
    id="payWalletButton"
    onclick="initiatePayment('wallet')"
    class="w-full bg-gradient-to-r from-violet-600 to-purple-600 text-white py-4 px-6 rounded-xl font-semibold..."
  >
    <svg class="w-6 h-6" ...><!-- wallet icon --></svg>
    <span>Pay with Wallet</span>
  </button>
</div>
<% } %>
```

Update JavaScript:
```javascript
async function initiatePayment(provider = 'bank') {
  const button = provider === 'wallet' ?
    document.getElementById('payWalletButton') :
    document.getElementById('payBankButton');

  button.disabled = true;
  button.innerHTML = `<svg class="animate-spin...">...</svg> Processing...`;

  try {
    const response = await fetch('/payment/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    });

    const data = await response.json();
    if (response.ok && data.redirectUrl) {
      window.location.href = data.redirectUrl;
    } else {
      throw new Error(data.error || 'Failed to initiate payment');
    }
  } catch (error) {
    // Reset button and show error
  }
}
```

---

### Task 8: Update Order Confirmation & Admin ✅

**File:** `src/views/order-confirmation.ejs`

Show payment method:

```html
<div class="flex justify-between py-2">
  <span class="text-gray-500">Payment Method</span>
  <span class="font-medium flex items-center">
    <% if (order.paymentDetails?.paymentMethod === 'wallet') { %>
      <svg class="w-5 h-5 mr-2 text-purple-600"><!-- wallet icon --></svg>
      Digital Wallet
    <% } else { %>
      <svg class="w-5 h-5 mr-2 text-blue-600"><!-- bank icon --></svg>
      Bank Card
    <% } %>
  </span>
</div>
```

**File:** `src/views/admin/orders.ejs`

Add payment method column in admin order list.

---

### Task 9: Session Types ✅

**File:** `src/types/session.ts`

Update payment state:

```typescript
interface PaymentState {
  orderId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  provider: 'bank' | 'wallet';  // NEW
}
```

---

### Task 10: Pass wsimEnabled to Views ✅

**File:** `src/routes/pages.ts`

Update checkout route to pass wsimEnabled:

```typescript
router.get('/checkout', (req, res) => {
  res.render('checkout', {
    title: 'Checkout',
    userInfo: req.session.userInfo,
    cartCount: (req.session.cart || []).reduce((sum, item) => sum + item.quantity, 0),
    wsimEnabled: config.wsimEnabled,  // NEW
  });
});
```

---

## Error Handling

| Error | Description | User Message |
|-------|-------------|--------------|
| `access_denied` | User cancelled card selection | "Payment cancelled" |
| `invalid_scope` | Permission not granted | "Permission denied" |
| `server_error` | WSIM/BSIM communication failure | "Payment service unavailable" |

All errors redirect to checkout with error parameter for display.

---

## Implementation Order

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | Environment config | `src/config/env.ts` | ✅ Complete |
| 2 | WSIM OIDC client | `src/routes/payment.ts` | ✅ Complete |
| 3 | Update payment initiation | `src/routes/payment.ts` | ✅ Complete |
| 4 | Wallet callback handler | `src/routes/payment.ts` | ✅ Complete |
| 5 | Payment service update | `src/services/payment.ts` | ✅ Complete |
| 6 | Order model update | `src/models/order.ts`, `src/data/orders.ts` | ✅ Complete |
| 7 | Session types | `src/types/session.ts` | ✅ Complete |
| 8 | Checkout UI | `src/views/checkout.ejs` | ✅ Complete |
| 9 | Order confirmation UI | `src/views/order-confirmation.ejs` | ✅ Complete |
| 10 | Admin views | `src/views/admin/orders.ejs` | ✅ Complete |
| 11 | Pass wsimEnabled to views | `src/routes/pages.ts` | ✅ Complete |
| 12 | Testing | Manual E2E | ✅ Complete |
| 13 | Documentation | `CHANGELOG.md`, `README.md` | ✅ Complete |

---

## Environment Variables Summary

### Development
```env
WSIM_ENABLED=true
WSIM_AUTH_URL=https://wsim-auth-dev.banksim.ca
WSIM_CLIENT_ID=ssim-merchant
WSIM_CLIENT_SECRET=<dev-secret>
```

### Production
```env
WSIM_ENABLED=true
WSIM_AUTH_URL=https://wsim-auth.banksim.ca
WSIM_CLIENT_ID=ssim-merchant
WSIM_CLIENT_SECRET=<prod-secret>
```

---

## OAuth Client Registration

SSIM must be registered in **WSIM's auth server**:

| Field | Value |
|-------|-------|
| Client ID | `ssim-merchant` |
| Client Secret | `<generated>` |
| Redirect URI (dev) | `https://ssim-dev.banksim.ca/payment/wallet-callback` |
| Redirect URI (prod) | `https://ssim.banksim.ca/payment/wallet-callback` |
| Scopes | `openid payment:authorize` |
| Grant Types | `authorization_code` |

---

## Success Criteria

- [x] `WSIM_ENABLED` config is parsed correctly
- [x] WSIM OIDC client is created on first use (when enabled)
- [x] Checkout shows "Pay with Wallet" button (when enabled)
- [x] Clicking "Pay with Wallet" redirects to WSIM auth
- [x] WSIM callback extracts both `wallet_card_token` and `card_token`
- [x] SSIM sends both tokens to NSIM for authorization
- [x] Order confirmation shows payment method (wallet vs bank)
- [x] Order model tracks `paymentMethod`
- [x] Admin dashboard distinguishes wallet vs bank payments
- [x] Error handling works for wallet-specific errors
- [x] Existing bank payment flow still works

---

## Testing Strategy

1. **Manual Testing**
   - End-to-end wallet payment flow
   - Bank payment still works (regression)
   - Error scenarios (cancel, decline)

2. **Unit Tests**
   - Token extraction from WSIM response
   - Payment service with wallet tokens

3. **Integration Tests**
   - Full wallet payment flow with mocked WSIM
   - Both bank and wallet payment paths

---

## Dependencies

| System | Requirement | Status |
|--------|-------------|--------|
| **WSIM** | OIDC provider + card selection flow | ✅ Ready |
| **NSIM** | Accept `walletCardToken` for routing | ✅ Ready |
| **BSIM** | Validate card tokens from WSIM | ✅ Ready |
| **SSIM** | This integration | ✅ **Complete** |

---

## Notes

- **Redirect-based flow**: Standard OIDC redirect pattern (no embedded widget)
- **Two tokens**: Wallet payments require both `wallet_card_token` (routing) and `card_token` (auth)
- **Backward compatible**: Existing bank payment flow unchanged
- **Feature flag**: `WSIM_ENABLED` controls wallet payment visibility
- **Token notation**: WSIM uses underscores (`wallet_card_token`), not camelCase
