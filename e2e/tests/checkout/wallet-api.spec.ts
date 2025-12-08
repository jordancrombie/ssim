/**
 * SSIM Wallet API Payment E2E Tests
 *
 * Tests the wallet payment flows that use the WSIM Merchant API:
 * - API: Standard Merchant API flow
 * - API Direct: Direct API call (no popup/redirect)
 * - API Proxy: Proxied API through SSIM backend
 *
 * Prerequisites:
 * - BSIM user account with credit cards
 * - WSIM enrollment with passkey
 *
 * These flows use the WSIM Merchant API which allows SSIM
 * to initiate payments server-side, with passkey authentication
 * for user confirmation.
 */

import { test, expect } from '@playwright/test';
import { createTestUser, BSIM_CARDS, TestUser } from '../../fixtures/test-data';
import { signupBsimUser, loginBsimUser } from '../../helpers/bsim/auth.helpers';
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
  initiateWalletApiPayment,
  completeWalletApiPayment,
  verifyPaymentSuccess,
} from '../../helpers/ssim/checkout.helpers';
import { verifyOrderConfirmation } from '../../helpers/ssim/order.helpers';

// Skip entire file on non-Chromium browsers (WebAuthn requirement)
test.skip(({ browserName }) => browserName !== 'chromium',
  'WebAuthn virtual authenticator requires Chromium');

// Run tests serially - each depends on the previous
test.describe.configure({ mode: 'serial' });

test.describe('SSIM Wallet API Payment', () => {
  let testUser: TestUser;
  let webauthn: WebAuthnContext;

  test.beforeAll(async () => {
    testUser = createTestUser({ firstName: 'WalletAPI', lastName: 'User' });
    console.log(`Created test user for wallet API: ${testUser.email}`);
  });

  test.afterEach(async () => {
    if (webauthn) {
      await teardownVirtualAuthenticator(webauthn);
    }
  });

  test('setup and complete checkout with wallet API', async ({ page }) => {
    // Set up virtual authenticator - this same authenticator will be used
    // for both passkey registration and payment authentication
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

    // Register passkey in WSIM - this registers a credential that will be
    // used for payment authentication. The credential is stored in the
    // virtual authenticator associated with `webauthn`.
    await registerWsimPasskey(page, webauthn);

    console.log(`Wallet API user setup complete: ${testUser.email}`);

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

    // Initiate API payment
    await initiateWalletApiPayment(page, 'api');

    // Complete payment with passkey - the popup will get credentials copied
    // from this authenticator so it can authenticate with the registered passkey
    await completeWalletApiPayment(page, webauthn);

    // Verify success
    const orderId = await verifyPaymentSuccess(page);
    expect(orderId).toBeTruthy();

    await verifyOrderConfirmation(page, orderId, 'authorized', 'wallet');

    console.log(`Wallet API payment successful! Order ID: ${orderId}`);
  });
});

test.describe('SSIM Wallet API Direct Payment', () => {
  // SKIP: Direct API requires CORS configuration on WSIM for browser→WSIM requests
  test.skip(true, 'Direct API requires CORS configuration on WSIM - skipped until WSIM enables cross-origin requests from SSIM');

  let testUser: TestUser;
  let webauthn: WebAuthnContext;

  test.beforeAll(async () => {
    testUser = createTestUser({ firstName: 'WalletAPIDirect', lastName: 'User' });
    console.log(`Created test user for wallet API direct: ${testUser.email}`);
  });

  test.afterEach(async () => {
    if (webauthn) {
      await teardownVirtualAuthenticator(webauthn);
    }
  });

  test('setup and complete checkout with wallet API direct', async ({ page }) => {
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

    console.log(`Wallet API direct user setup complete: ${testUser.email}`);

    // Navigate to SSIM store and add product
    await navigateToStore(page);
    await addProductToCart(page);

    // Go to checkout
    await navigateToCheckout(page);
    await waitForCartContents(page);

    // Initiate API direct payment
    await initiateWalletApiPayment(page, 'api-direct');

    // Complete payment with passkey
    await completeWalletApiPayment(page, webauthn);

    // Verify success
    const orderId = await verifyPaymentSuccess(page);
    expect(orderId).toBeTruthy();

    await verifyOrderConfirmation(page, orderId, 'authorized', 'wallet');

    console.log(`Wallet API direct payment successful! Order ID: ${orderId}`);
  });
});

test.describe('SSIM Wallet API Proxy Payment', () => {
  // SKIP: Proxy API routes through SSIM backend but still has CORS issues for passkey auth
  test.skip(true, 'Proxy API has CORS issues for passkey authentication - skipped until resolved');

  let testUser: TestUser;
  let webauthn: WebAuthnContext;

  test.beforeAll(async () => {
    testUser = createTestUser({ firstName: 'WalletAPIProxy', lastName: 'User' });
    console.log(`Created test user for wallet API proxy: ${testUser.email}`);
  });

  test.afterEach(async () => {
    if (webauthn) {
      await teardownVirtualAuthenticator(webauthn);
    }
  });

  test('setup and complete checkout with wallet API proxy', async ({ page }) => {
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

    console.log(`Wallet API proxy user setup complete: ${testUser.email}`);

    // Navigate to SSIM store and add product
    await navigateToStore(page);
    await addProductToCart(page);

    // Go to checkout
    await navigateToCheckout(page);
    await waitForCartContents(page);

    // Initiate API proxy payment
    await initiateWalletApiPayment(page, 'api-proxy');

    // Complete payment with passkey
    await completeWalletApiPayment(page, webauthn);

    // Verify success
    const orderId = await verifyPaymentSuccess(page);
    expect(orderId).toBeTruthy();

    await verifyOrderConfirmation(page, orderId, 'authorized', 'wallet');

    console.log(`Wallet API proxy payment successful! Order ID: ${orderId}`);
  });
});

test.describe('SSIM Wallet API - Combined Flow Test', () => {
  // SKIP: Combined test includes Direct and Proxy flows which have CORS issues
  test.skip(true, 'Combined test includes Direct/Proxy flows with CORS issues - skipped until resolved');

  /**
   * This test creates a single user and tests all three API flows
   * in a single test to ensure the same authenticator instance is used.
   */
  let testUser: TestUser;
  let webauthn: WebAuthnContext;

  test.beforeAll(async () => {
    testUser = createTestUser({ firstName: 'WalletAPIAll', lastName: 'User' });
    console.log(`Created test user for all wallet API flows: ${testUser.email}`);
  });

  test.afterEach(async () => {
    if (webauthn) {
      await teardownVirtualAuthenticator(webauthn);
    }
  });

  test('setup and test all API flows (API, Direct, Proxy)', async ({ page }) => {
    // Set up virtual authenticator - used throughout this test
    webauthn = await setupVirtualAuthenticator(page);

    // Setup user
    await signupBsimUser(page, testUser, { skipPasskeyPrompt: true });
    await addBsimCreditCard(page, BSIM_CARDS.visa);
    await addBsimCreditCard(page, BSIM_CARDS.mastercard);

    await enrollWsimUser(page, {
      skipPassword: true,
      selectAllCards: true,
      bsimEmail: testUser.email,
      bsimPassword: testUser.password,
    });

    await registerWsimPasskey(page, webauthn);
    console.log(`Combined API test user setup complete: ${testUser.email}`);

    // Test 1: API flow
    console.log('[Combined Test] Testing API flow...');
    await navigateToStore(page);
    await addProductToCart(page);
    await navigateToCheckout(page);
    await waitForCartContents(page);
    await initiateWalletApiPayment(page, 'api');
    await completeWalletApiPayment(page, webauthn);
    let orderId = await verifyPaymentSuccess(page);
    expect(orderId).toBeTruthy();
    console.log(`API payment: Order ${orderId}`);

    // Test 2: API Direct flow
    console.log('[Combined Test] Testing API Direct flow...');
    await navigateToStore(page);
    await addProductToCart(page);
    await navigateToCheckout(page);
    await waitForCartContents(page);
    await initiateWalletApiPayment(page, 'api-direct');
    await completeWalletApiPayment(page, webauthn);
    orderId = await verifyPaymentSuccess(page);
    expect(orderId).toBeTruthy();
    console.log(`API Direct payment: Order ${orderId}`);

    // Test 3: API Proxy flow
    console.log('[Combined Test] Testing API Proxy flow...');
    await navigateToStore(page);
    await addProductToCart(page);
    await navigateToCheckout(page);
    await waitForCartContents(page);
    await initiateWalletApiPayment(page, 'api-proxy');
    await completeWalletApiPayment(page, webauthn);
    orderId = await verifyPaymentSuccess(page);
    expect(orderId).toBeTruthy();
    console.log(`API Proxy payment: Order ${orderId}`);

    console.log('[Combined Test] All API flows completed successfully!');
  });
});
