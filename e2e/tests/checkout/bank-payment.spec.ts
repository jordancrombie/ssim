/**
 * SSIM Bank Payment E2E Tests
 *
 * Tests the "Pay with BSIM" checkout flow where the user pays
 * directly from their BSIM bank account via OAuth authorization.
 *
 * Prerequisites:
 * - BSIM user account with credit cards
 *
 * Flow:
 * 1. Navigate to SSIM store
 * 2. Add products to cart
 * 3. Go to checkout
 * 4. Click "Pay with BSIM"
 * 5. Complete BSIM OAuth authorization
 * 6. Verify order confirmation
 */

import { test, expect } from '@playwright/test';
import { createTestUser, BSIM_CARDS, TestUser } from '../../fixtures/test-data';
import { signupBsimUser, loginBsimUser } from '../../helpers/bsim/auth.helpers';
import { addBsimCreditCard } from '../../helpers/bsim/cards.helpers';
import {
  navigateToStore,
  addProductToCart,
} from '../../helpers/ssim/store.helpers';
import {
  navigateToCheckout,
  waitForCartContents,
  initiatePaymentWithBank,
  completeBsimPaymentAuth,
  verifyPaymentSuccess,
} from '../../helpers/ssim/checkout.helpers';
import { verifyOrderConfirmation } from '../../helpers/ssim/order.helpers';

test.describe('SSIM Bank Payment (Pay with BSIM)', () => {
  // Run tests serially - each depends on the previous
  test.describe.configure({ mode: 'serial' });

  let testUser: TestUser;

  test.beforeAll(async () => {
    testUser = createTestUser({ firstName: 'Bank', lastName: 'Payment' });
    console.log(`Created test user for bank payment: ${testUser.email}`);
  });

  test('setup: create BSIM user with credit card', async ({ page }) => {
    // Sign up new BSIM user
    await signupBsimUser(page, testUser, { skipPasskeyPrompt: true });

    // Add a credit card
    await addBsimCreditCard(page, BSIM_CARDS.visa);

    // Store user info
    test.info().annotations.push({
      type: 'test-user',
      description: testUser.email,
    });
  });

  test('complete checkout with bank payment', async ({ page }) => {
    // Navigate to SSIM store and add product
    await navigateToStore(page);
    await addProductToCart(page);

    // Go to checkout
    await navigateToCheckout(page);
    await waitForCartContents(page);

    // Initiate bank payment
    await initiatePaymentWithBank(page);

    // Complete BSIM OAuth authorization
    await completeBsimPaymentAuth(page, testUser.email, testUser.password);

    // Verify payment success
    const orderId = await verifyPaymentSuccess(page);
    expect(orderId).toBeTruthy();

    // Verify order details
    await verifyOrderConfirmation(page, orderId, 'authorized', 'bank');

    console.log(`Bank payment successful! Order ID: ${orderId}`);

    test.info().annotations.push({
      type: 'order-id',
      description: orderId,
    });
  });

  test('checkout with multiple items', async ({ page }) => {
    // Login to BSIM first (in case session expired)
    await loginBsimUser(page, testUser.email, testUser.password);

    // Navigate to SSIM store and add multiple products
    await navigateToStore(page);
    await addProductToCart(page);
    await addProductToCart(page);
    await addProductToCart(page);

    // Go to checkout
    await navigateToCheckout(page);
    await waitForCartContents(page);

    // Initiate bank payment
    await initiatePaymentWithBank(page);

    // Complete BSIM OAuth (should already be logged in)
    await completeBsimPaymentAuth(page, testUser.email, testUser.password);

    // Verify success
    const orderId = await verifyPaymentSuccess(page);
    expect(orderId).toBeTruthy();

    console.log(`Multi-item bank payment successful! Order ID: ${orderId}`);
  });
});

test.describe('SSIM Bank Payment - Error Scenarios', () => {
  test('checkout without items shows empty cart', async ({ page }) => {
    await navigateToCheckout(page);

    // Should show empty cart state
    await expect(page.locator('#emptyState')).toBeVisible({ timeout: 10000 });

    // Pay button should not be visible
    await expect(page.locator('#payBankButton')).toBeHidden();
  });

  test('unauthenticated user can still see checkout', async ({ page }) => {
    // Add item to cart without being logged in
    await navigateToStore(page);
    await addProductToCart(page);

    // Go to checkout
    await navigateToCheckout(page);
    await waitForCartContents(page);

    // Pay button should be visible
    await expect(page.locator('#payBankButton')).toBeVisible();

    // Clicking it should redirect to login
    await page.click('#payBankButton');

    // Should be redirected to login
    await page.waitForURL(/login|auth/, { timeout: 10000 });
  });
});
