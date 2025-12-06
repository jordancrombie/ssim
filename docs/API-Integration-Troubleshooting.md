# API Integration Troubleshooting Guide

This document details the debugging process and fixes applied to the WSIM API checkout integration. It serves as a reference for similar issues in the future.

## Issue Summary

**Date:** 2025-12-06
**Affected Feature:** API checkout button (WSIM Merchant API integration)
**Symptom:** After successful passkey authentication in the popup, users were returned to the checkout page instead of being redirected to the order confirmation page.

---

## Debugging Process

### Step 1: Initial Observation

The user reported that after clicking the API button:
1. Sign in to wallet popup appeared - **working**
2. Card list was displayed - **working**
3. Card was selected and passkey prompt appeared - **working**
4. Passkey authentication completed successfully - **working**
5. **Expected:** Redirect to order confirmation page
6. **Actual:** Returned to checkout page with no error

### Step 2: Backend Log Analysis

Checked the SSIM backend logs:
```
[WSIM API] GET /auth-check called
[WSIM API] Auth check response: {"authenticated": false}
```

Notably absent: No calls to `/payment/popup-complete` or `/api/wsim/payment/complete`.

**Conclusion:** The frontend JavaScript was not calling the backend to complete the payment.

### Step 3: Race Condition Investigation

Identified a potential race condition in the popup close detection:

```javascript
// Original code
const checkInterval = setInterval(() => {
  if (walletLoginPopup && walletLoginPopup.closed) {
    clearInterval(checkInterval);
    window.removeEventListener('message', loginListener);
    showApiCardPicker(); // This was being called even after successful auth!
  }
}, 500);
```

**Problem:** When the popup closed after passkey verification, the interval detected the close and called `showApiCardPicker()` before the message could be processed.

**Fix 1:** Added a `paymentCompleted` flag to track if the flow completed via message:

```javascript
let paymentCompleted = false;

// In message handler:
if (type === 'wsim:card-selected') {
  paymentCompleted = true; // Mark as completed BEFORE processing
  // ... process tokens
}

// In close detection:
if (!paymentCompleted) {
  showApiCardPicker(); // Only if payment wasn't completed via message
}
```

### Step 4: Browser Console Debugging

Added extensive logging to trace message flow:

```javascript
console.log('[Checkout] API popup received message from origin:', event.origin);
console.log('[Checkout] API popup expected origin starts with:', wsimPopupUrl);
console.log('[Checkout] API popup message data:', event.data);
```

### Step 5: Message Data Structure Discovery

Browser console revealed the **root cause**:

```
[Checkout] API popup message data: {type: 'wsim:card-selected', cardToken: '...', cardLast4: '2580', cardBrand: 'visa', ...}
[Checkout] API login popup message: wsim:card-selected undefined
[Checkout] No cardToken in popup data, showing card picker. Data: undefined
```

**Problem:** The code assumed a nested data structure:

```javascript
// Incorrect assumption
const { type, data } = event.data;
// Expected: event.data = { type: '...', data: { cardToken: '...' } }

// Actual: event.data = { type: '...', cardToken: '...' }
// Result: type = 'wsim:card-selected', data = undefined
```

**Fix 2:** Correctly access the flat message structure:

```javascript
// Correct approach
const messageData = event.data;
const type = messageData.type;
if (messageData.cardToken) {
  await completeApiPaymentWithTokens(messageData);
}
```

---

## Summary of Fixes

### Fix 1: Race Condition Prevention

**File:** `src/views/checkout.ejs` (around line 1115)

Added `paymentCompleted` flag to prevent the popup close interval from interfering with successful message handling.

### Fix 2: Message Data Structure

**File:** `src/views/checkout.ejs` (around line 1129)

Changed from:
```javascript
const { type, data } = event.data;
if (data && data.cardToken) { ... }
```

To:
```javascript
const messageData = event.data;
const type = messageData.type;
if (messageData.cardToken) { ... }
```

### Fix 3: Correct Endpoint

**File:** `src/views/checkout.ejs` (completeApiPaymentWithTokens function)

Changed to use `/payment/popup-complete` endpoint (same as the working Popup flow) instead of `/api/wsim/payment/complete`.

---

## Key Learnings

1. **Always log the full event.data structure** when debugging postMessage flows
2. **Don't assume nested data structures** - different systems have different conventions
3. **Race conditions with popup close detection** are common - use flags to track completion state
4. **Reuse working code paths** when possible (e.g., using the same endpoint as the working Popup flow)

---

## Testing Checklist

After making changes to the API checkout flow, verify:

- [ ] Clicking API button shows "Sign In to Wallet" card picker UI
- [ ] "Sign In to Wallet" button opens WSIM popup
- [ ] User can authenticate and select a card in the popup
- [ ] Passkey verification prompt appears and works
- [ ] After passkey confirmation, popup closes
- [ ] User is redirected to order confirmation page
- [ ] Order appears in order history
- [ ] Backend logs show successful payment flow

---

## Related Files

- `src/views/checkout.ejs` - Frontend checkout page with API integration
- `src/routes/wsim-api.ts` - WSIM API proxy routes
- `src/routes/payment.ts` - Payment routes including `/popup-complete`
- `docs/WSIM-API-Integration-Plan.md` - Overall integration architecture
