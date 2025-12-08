/**
 * SSIM Wallet OIDC Payment E2E Tests
 *
 * Tests the wallet payment flows that use OIDC/OAuth for authentication:
 * - Popup: Opens WSIM in a popup window
 * - Inline: Embeds WSIM in an iframe
 * - Redirect: Redirects to WSIM
 *
 * Prerequisites:
 * - BSIM user account with credit cards
 * - WSIM enrollment with passkey
 *
 * Flow:
 * 1. Create BSIM user with cards
 * 2. Enroll in WSIM
 * 3. Register passkey in WSIM
 * 4. Navigate to SSIM checkout
 * 5. Complete wallet payment with passkey
 *
 * NOTE: Setup and checkout are consolidated into single tests because
 * CDP virtual authenticators are page-scoped. Passkey credentials registered
 * in a setup test would be lost in a separate checkout test.
 */

import { test, expect } from '@playwright/test';
import { createTestUser, BSIM_CARDS, TestUser } from '../../fixtures/test-data';
import { signupBsimUser } from '../../helpers/bsim/auth.helpers';
import { addBsimCreditCard } from '../../helpers/bsim/cards.helpers';
import { enrollWsimUser } from '../../helpers/wsim/enroll.helpers';
import { registerWsimPasskey } from '../../helpers/wsim/passkey.helpers';
import {
  setupVirtualAuthenticator,
  teardownVirtualAuthenticator,
  WebAuthnContext,
} from '../../helpers/webauthn.helpers';
import {
  navigateToStore,
  addProductToCart,
} from '../../helpers/ssim/store.helpers';
import {
  navigateToCheckout,
  waitForCartContents,
  openWalletPopup,
  completeWalletPopupPayment,
  toggleWalletEmbed,
  completeWalletEmbedPayment,
  initiateWalletRedirect,
  completeWalletRedirectPayment,
  verifyPaymentSuccess,
} from '../../helpers/ssim/checkout.helpers';
import { verifyOrderConfirmation } from '../../helpers/ssim/order.helpers';

// Skip entire file on non-Chromium browsers (WebAuthn requirement)
test.skip(({ browserName }) => browserName !== 'chromium',
  'WebAuthn virtual authenticator requires Chromium');

// Run tests serially - each depends on the previous
test.describe.configure({ mode: 'serial' });

test.describe('SSIM Wallet OIDC Payment - Popup', () => {
  let testUser: TestUser;
  let webauthn: WebAuthnContext;

  test.beforeAll(async () => {
    testUser = createTestUser({ firstName: 'WalletPopup', lastName: 'User' });
    console.log(`Created test user for wallet popup: ${testUser.email}`);
  });

  test.afterEach(async () => {
    if (webauthn) {
      await teardownVirtualAuthenticator(webauthn);
    }
  });

  test('setup and complete checkout with wallet popup', async ({ page, context }) => {
    // Set up virtual authenticator - same instance for registration and payment
    webauthn = await setupVirtualAuthenticator(page);

    // Sign up BSIM user
    await signupBsimUser(page, testUser, { skipPasskeyPrompt: true });

    // Add credit cards
    await addBsimCreditCard(page, BSIM_CARDS.visa);
    await addBsimCreditCard(page, BSIM_CARDS.mastercard);

    // Enroll in WSIM
    await enrollWsimUser(page, {
      skipPassword: true,
      selectAllCards: true,
      bsimEmail: testUser.email,
      bsimPassword: testUser.password,
    });

    // Register passkey in WSIM - credential stored in virtual authenticator
    await registerWsimPasskey(page, webauthn);

    console.log(`Wallet popup user setup complete: ${testUser.email}`);

    test.info().annotations.push({
      type: 'test-user',
      description: testUser.email,
    });

    // Now proceed with checkout in the same test (same authenticator)
    // Navigate to SSIM store and add product
    await navigateToStore(page);
    await addProductToCart(page);

    // Go to checkout
    await navigateToCheckout(page);
    await waitForCartContents(page);

    // Open wallet popup
    const popup = await openWalletPopup(context, page);

    // Complete payment in popup with passkey
    await completeWalletPopupPayment(
      popup,
      webauthn,
      testUser.email,
      testUser.password
    );

    // Wait for popup to close and main page to update
    await popup.waitForEvent('close', { timeout: 30000 });

    // Verify success on main page
    const orderId = await verifyPaymentSuccess(page);
    expect(orderId).toBeTruthy();

    await verifyOrderConfirmation(page, orderId, 'authorized', 'wallet');

    console.log(`Wallet popup payment successful! Order ID: ${orderId}`);
  });
});

test.describe('SSIM Wallet OIDC Payment - Inline', () => {
  let testUser: TestUser;
  let webauthn: WebAuthnContext;

  test.beforeAll(async () => {
    testUser = createTestUser({ firstName: 'WalletInline', lastName: 'User' });
    console.log(`Created test user for wallet inline: ${testUser.email}`);
  });

  test.afterEach(async () => {
    if (webauthn) {
      await teardownVirtualAuthenticator(webauthn);
    }
  });

  test('setup and complete checkout with wallet inline (embed)', async ({ page }) => {
    // Set up virtual authenticator - same instance for registration and payment
    webauthn = await setupVirtualAuthenticator(page);

    // Sign up BSIM user
    await signupBsimUser(page, testUser, { skipPasskeyPrompt: true });

    // Add credit cards
    await addBsimCreditCard(page, BSIM_CARDS.visa);

    // Enroll in WSIM
    await enrollWsimUser(page, {
      skipPassword: true,
      selectAllCards: true,
      bsimEmail: testUser.email,
      bsimPassword: testUser.password,
    });

    // Register passkey in WSIM
    await registerWsimPasskey(page, webauthn);

    console.log(`Wallet inline user setup complete: ${testUser.email}`);

    // Now proceed with checkout in the same test (same authenticator)
    // Navigate to SSIM store and add product
    await navigateToStore(page);
    await addProductToCart(page);

    // Go to checkout
    await navigateToCheckout(page);
    await waitForCartContents(page);

    // Toggle inline wallet embed
    await toggleWalletEmbed(page);

    // Complete payment in embed with passkey
    await completeWalletEmbedPayment(page, webauthn);

    // Verify success
    const orderId = await verifyPaymentSuccess(page);
    expect(orderId).toBeTruthy();

    await verifyOrderConfirmation(page, orderId, 'authorized', 'wallet');

    console.log(`Wallet inline payment successful! Order ID: ${orderId}`);
  });
});

test.describe('SSIM Wallet OIDC Payment - Redirect', () => {
  let testUser: TestUser;
  let webauthn: WebAuthnContext;

  test.beforeAll(async () => {
    testUser = createTestUser({ firstName: 'WalletRedirect', lastName: 'User' });
    console.log(`Created test user for wallet redirect: ${testUser.email}`);
  });

  test.afterEach(async () => {
    if (webauthn) {
      await teardownVirtualAuthenticator(webauthn);
    }
  });

  test('setup and complete checkout with wallet redirect', async ({ page }) => {
    // Set up virtual authenticator - same instance for registration and payment
    webauthn = await setupVirtualAuthenticator(page);

    // Sign up BSIM user
    await signupBsimUser(page, testUser, { skipPasskeyPrompt: true });

    // Add credit cards
    await addBsimCreditCard(page, BSIM_CARDS.visa);

    // Enroll in WSIM
    await enrollWsimUser(page, {
      skipPassword: true,
      selectAllCards: true,
      bsimEmail: testUser.email,
      bsimPassword: testUser.password,
    });

    // Register passkey in WSIM
    await registerWsimPasskey(page, webauthn);

    console.log(`Wallet redirect user setup complete: ${testUser.email}`);

    // Now proceed with checkout in the same test (same authenticator)
    // Navigate to SSIM store and add product
    await navigateToStore(page);
    await addProductToCart(page);

    // Go to checkout
    await navigateToCheckout(page);
    await waitForCartContents(page);

    // Initiate wallet redirect
    await initiateWalletRedirect(page);

    // Complete payment on WSIM with passkey (redirect flow requires email)
    await completeWalletRedirectPayment(page, webauthn, testUser.email);

    // Verify success (should be back on SSIM)
    const orderId = await verifyPaymentSuccess(page);
    expect(orderId).toBeTruthy();

    await verifyOrderConfirmation(page, orderId, 'authorized', 'wallet');

    console.log(`Wallet redirect payment successful! Order ID: ${orderId}`);
  });
});
