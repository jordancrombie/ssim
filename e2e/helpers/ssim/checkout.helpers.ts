/**
 * SSIM Checkout Helpers for E2E Tests
 *
 * Provides functions for interacting with the SSIM checkout page
 * and handling all payment methods:
 * - Pay with BSIM (bank direct)
 * - Wallet Popup
 * - Wallet Inline (Embed)
 * - Wallet Redirect
 * - Wallet API
 * - Wallet API Direct
 * - Wallet API Proxy
 */

import { Page, expect, BrowserContext, Frame } from '@playwright/test';
import { getUrls, SSIM_PAGES } from '../../fixtures/urls';
import {
  WebAuthnContext,
  simulatePasskeySuccess,
  setupVirtualAuthenticator,
  teardownVirtualAuthenticator,
  copyCredentials,
} from '../webauthn.helpers';

/**
 * Payment method types
 */
export type PaymentMethod =
  | 'bank'
  | 'wallet-popup'
  | 'wallet-inline'
  | 'wallet-redirect'
  | 'wallet-api'
  | 'wallet-api-direct'
  | 'wallet-api-proxy';

/**
 * Button IDs for each payment method
 */
export const PAYMENT_BUTTONS: Record<PaymentMethod, string> = {
  bank: '#payBankButton',
  'wallet-popup': '#payWalletPopupButton',
  'wallet-inline': '#payWalletEmbedButton',
  'wallet-redirect': '#payWalletButton',
  'wallet-api': '#payWalletApiButton',
  'wallet-api-direct': '#payWalletApiDirectButton',
  'wallet-api-proxy': '#payWalletApiProxyButton',
};

/**
 * Navigate to the SSIM checkout page
 *
 * @param page - Playwright page object
 */
export async function navigateToCheckout(page: Page): Promise<void> {
  const urls = getUrls();
  await page.goto(`${urls.ssim}${SSIM_PAGES.checkout}`);

  // Wait for checkout page to load
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({
    timeout: 10000,
  });
}

/**
 * Wait for cart contents to load on checkout page
 *
 * @param page - Playwright page object
 */
export async function waitForCartContents(page: Page): Promise<void> {
  // Wait for loading state to disappear and cart contents to appear
  await expect(page.locator('#loadingState')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#cartContents')).toBeVisible({ timeout: 10000 });
}

/**
 * Get the cart total from the checkout page
 *
 * @param page - Playwright page object
 * @returns Cart total as a string (e.g., "$99.99")
 */
export async function getCartTotal(page: Page): Promise<string> {
  await waitForCartContents(page);
  const totalElement = page.locator('#cartTotal');
  return (await totalElement.textContent()) || '$0.00';
}

/**
 * Initiate payment with BSIM (bank direct payment)
 *
 * This clicks the "Pay with BSIM" button which:
 * - If not authenticated: redirects to SSIM login page
 * - If authenticated: redirects to BSIM payment auth page
 *
 * @param page - Playwright page object
 */
export async function initiatePaymentWithBank(page: Page): Promise<void> {
  await waitForCartContents(page);
  await page.click(PAYMENT_BUTTONS.bank);

  // Wait for the redirect (either to SSIM login or BSIM auth)
  await page.waitForURL(/login|auth/, { timeout: 15000 });
}

/**
 * Complete BSIM OAuth flow for bank payment
 *
 * After clicking Pay with BSIM, the flow is:
 * 1. If not logged into SSIM, redirect to SSIM login page
 * 2. Click "Continue with BSIM Bank" to authenticate via BSIM OIDC
 * 3. If not logged into BSIM, fill in BSIM credentials
 * 4. Authorize the OIDC consent
 * 5. Return to SSIM checkout (now authenticated)
 * 6. Click Pay with BSIM again to initiate payment OAuth
 * 7. Complete BSIM payment consent
 * 8. Return to order confirmation
 *
 * @param page - Playwright page object
 * @param email - BSIM user email
 * @param password - BSIM user password
 */
export async function completeBsimPaymentAuth(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  const urls = getUrls();

  console.log('[E2E] completeBsimPaymentAuth - starting, current URL:', page.url());

  // Wait for any pending navigation to complete
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // Phase 1: Handle SSIM login redirect (if not authenticated)
  // The Pay with BSIM button triggers JS that redirects to /login if not authenticated
  let currentUrl = page.url();
  console.log('[E2E] Initial URL:', currentUrl);

  // Check if we're on the login page (either already there or redirected after Pay click)
  if (currentUrl.includes('/login')) {
    console.log('[E2E] On SSIM login page');

    // Click "Continue with BSIM Bank" to authenticate
    const ssimLoginButton = page.locator('a:has-text("Continue with BSIM Bank")');
    await expect(ssimLoginButton).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Clicking Continue with BSIM Bank');
    await ssimLoginButton.click();

    // Wait for BSIM auth page
    await page.waitForURL(/auth.*bsim|auth.*banksim|dev\.banksim/, { timeout: 15000 });
    console.log('[E2E] Redirected to BSIM auth:', page.url());

    // Handle BSIM login if not already logged in
    await handleBsimAuth(page, email, password);

    // Wait for redirect back to SSIM
    await page.waitForURL(/ssim/, { timeout: 15000 });
    console.log('[E2E] Back to SSIM after OIDC auth:', page.url());

    // Wait for page to settle
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    currentUrl = page.url();
    console.log('[E2E] After OIDC callback URL:', currentUrl);
  }

  // Phase 2: Ensure we're on checkout page
  if (!currentUrl.includes('/checkout')) {
    console.log('[E2E] Not on checkout, navigating there');
    await page.goto(`${urls.ssim}${SSIM_PAGES.checkout}`);
    await page.waitForLoadState('networkidle');
  }

  await waitForCartContents(page);

  // Phase 3: Initiate payment OAuth flow
  console.log('[E2E] Clicking Pay with BSIM to initiate payment');
  const payButton = page.locator(PAYMENT_BUTTONS.bank);
  await expect(payButton).toBeVisible({ timeout: 5000 });
  await expect(payButton).toBeEnabled({ timeout: 5000 });

  // Click and wait for navigation away from checkout
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes('/checkout'), { timeout: 15000 }),
    payButton.click(),
  ]);
  console.log('[E2E] After clicking Pay with BSIM:', page.url());

  // If redirected to login again, we need to repeat the OIDC flow
  if (page.url().includes('/login')) {
    console.log('[E2E] Session not persisted, redoing OIDC login');
    const ssimLoginButton = page.locator('a:has-text("Continue with BSIM Bank")');
    await expect(ssimLoginButton).toBeVisible({ timeout: 5000 });
    await ssimLoginButton.click();

    await page.waitForURL(/auth.*bsim|auth.*banksim|dev\.banksim/, { timeout: 15000 });
    await handleBsimAuth(page, email, password);

    await page.waitForURL(/ssim/, { timeout: 15000 });
    console.log('[E2E] Back to SSIM after second OIDC auth:', page.url());

    // Navigate to checkout and try again
    if (!page.url().includes('/checkout')) {
      await page.goto(`${urls.ssim}${SSIM_PAGES.checkout}`);
    }
    await waitForCartContents(page);

    console.log('[E2E] Clicking Pay with BSIM again');
    const payButton2 = page.locator(PAYMENT_BUTTONS.bank);
    await expect(payButton2).toBeVisible({ timeout: 5000 });
    await expect(payButton2).toBeEnabled({ timeout: 5000 });
    await payButton2.click();

    await page.waitForURL(/auth.*bsim|auth.*banksim|dev\.banksim/, { timeout: 15000 });
    console.log('[E2E] Now at BSIM payment auth:', page.url());
  }

  // Phase 4: Complete BSIM payment consent
  await handleBsimAuth(page, email, password);

  // Should redirect to SSIM after payment authorization
  await page.waitForURL(/ssim/, { timeout: 15000 });
  console.log('[E2E] Final URL after payment auth:', page.url());
}

/**
 * Handle BSIM authentication/consent page
 * Works for both OIDC login and payment consent flows
 */
async function handleBsimAuth(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  console.log('[E2E] handleBsimAuth - URL:', page.url());

  // Check if we need to login
  const emailInput = page.locator('#email');
  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('[E2E] BSIM login form visible, filling credentials');
    await emailInput.fill(email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');

    // Wait for either consent page or redirect
    await page.waitForTimeout(2000);
  }

  // Check for consent/authorize page
  const authorizeButton = page.locator(
    'button:has-text("Authorize"), button:has-text("Allow"), button:has-text("Approve")'
  );
  if (await authorizeButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('[E2E] Consent page visible, clicking authorize');
    await authorizeButton.first().click();
  }

  // Also check for card selection (payment flow)
  const cardSelector = page.locator('[data-testid="card-select"], .card-selection, select');
  if (await cardSelector.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('[E2E] Card selection visible');
    // Select first card if dropdown
    const firstOption = cardSelector.locator('option').first();
    if (await firstOption.isVisible().catch(() => false)) {
      await cardSelector.selectOption({ index: 1 });
    }

    // Click confirm/continue if present
    const confirmButton = page.locator(
      'button:has-text("Confirm"), button:has-text("Continue"), button:has-text("Pay")'
    );
    if (await confirmButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmButton.first().click();
    }
  }

  console.log('[E2E] handleBsimAuth complete');
}

/**
 * Open wallet popup payment flow
 *
 * @param context - Browser context to detect popup
 * @param page - Playwright page object
 * @returns The popup page object
 */
export async function openWalletPopup(
  context: BrowserContext,
  page: Page
): Promise<Page> {
  await waitForCartContents(page);

  // Wait for popup to open
  const popupPromise = context.waitForEvent('page');

  // Click popup button
  await page.click(PAYMENT_BUTTONS['wallet-popup']);

  // Get the popup page
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  return popup;
}

/**
 * Complete wallet payment in popup with passkey authentication
 *
 * The popup flow requires:
 * 1. Setting up a virtual authenticator for the popup page
 * 2. Copying credentials from the main page's authenticator
 * 3. Handling passkey login to WSIM
 * 4. Selecting a card
 * 5. Confirming payment with passkey
 *
 * @param popup - The popup page object
 * @param webauthn - WebAuthn context from main page for passkey credential copying
 * @param email - WSIM user email (for login if needed)
 * @param password - WSIM user password (for login if needed)
 */
export async function completeWalletPopupPayment(
  popup: Page,
  webauthn: WebAuthnContext,
  email?: string,
  password?: string
): Promise<void> {
  console.log('[E2E] completeWalletPopupPayment - starting, popup URL:', popup.url());

  // Wait for wallet payment UI to load
  await popup.waitForLoadState('networkidle').catch(() => {});

  // IMPORTANT: The virtual authenticator is page-specific in CDP.
  // We need to set up a new authenticator for the popup page AND
  // copy credentials from the main page's authenticator.
  const popupWebauthn = await setupVirtualAuthenticator(popup);
  console.log('[E2E] Set up virtual authenticator for popup');

  // Copy credentials from main authenticator to popup authenticator
  // so passkey authentication can find the registered credential
  const copiedCount = await copyCredentials(webauthn, popupWebauthn);
  console.log(`[E2E] Copied ${copiedCount} credentials to popup authenticator`);

  try {
    // Check for passkey authentication prompt in popup (WSIM uses passkey for login)
    const passkeyLoginButton = popup.locator('button:has-text("Sign in with Passkey"), button:has-text("Use Passkey"), button:has-text("Continue with Passkey")');
    if (await passkeyLoginButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[E2E] Passkey login auth in WSIM popup');
      await simulatePasskeySuccess(popupWebauthn, async () => {
        await passkeyLoginButton.first().click();
      });
      console.log('[E2E] Passkey login auth completed in popup');
      await popup.waitForTimeout(2000);
    }

    // Check for email/password login if passkey not available
    const emailInput = popup.locator('#email, input[type="email"]');
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      if (email && password) {
        console.log('[E2E] Filling WSIM credentials');
        await emailInput.fill(email);
        await popup.fill('#password, input[type="password"]', password);
        await popup.click('button[type="submit"]');
        await popup.waitForTimeout(2000);
      }
    }

    // After login, wait for card selection or payment confirmation screen
    // Different WSIM screens may show:
    // - "Select Payment Card" or "Select a Card" for card selection
    // - Direct payment confirmation buttons
    const cardSelectionHeader = popup.locator('text=Select Payment Card').or(popup.locator('text=Select a Card'));
    const confirmButton = popup.locator('button:has-text("Confirm with Passkey"), button:has-text("Pay"), button:has-text("Confirm"), button:has-text("Authorize")');

    // Wait for either card selection or confirm button
    await expect(cardSelectionHeader.or(confirmButton).first()).toBeVisible({ timeout: 15000 });
    console.log('[E2E] Card selection or payment screen visible in popup');

    // Select a card if card selection is shown
    if (await cardSelectionHeader.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[E2E] Card selection screen visible');
      const popupCardOption = popup.locator('[class*="card"], [data-card-id]').filter({ hasText: /VISA|MC|Mastercard/i });
      if (await popupCardOption.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('[E2E] Selecting first card in popup');
        await popupCardOption.first().click();
        await popup.waitForTimeout(500);
      }
    }

    // Find and click the pay/confirm button with passkey
    await expect(confirmButton.first()).toBeVisible({ timeout: 10000 });
    console.log('[E2E] Clicking confirm button in popup');

    await simulatePasskeySuccess(popupWebauthn, async () => {
      await confirmButton.first().click({ timeout: 10000 });
    });
    console.log('[E2E] Payment confirmed with passkey in popup');

  } finally {
    // Clean up popup's virtual authenticator
    await teardownVirtualAuthenticator(popupWebauthn).catch(() => {});
  }

  console.log('[E2E] completeWalletPopupPayment - done');
}

/**
 * Toggle wallet embed/inline payment
 *
 * @param page - Playwright page object
 */
export async function toggleWalletEmbed(page: Page): Promise<void> {
  await waitForCartContents(page);
  await page.click(PAYMENT_BUTTONS['wallet-inline']);

  // Wait for iframe to appear
  await expect(
    page.locator('iframe[src*="wsim"], iframe[id*="wallet"]')
  ).toBeVisible({ timeout: 10000 });
}

/**
 * Get the wallet embed iframe
 *
 * @param page - Playwright page object
 * @returns The iframe frame object
 */
export async function getWalletEmbedFrame(page: Page): Promise<Frame> {
  // Look for various iframe patterns - WSIM iframes may have different src/id patterns
  const iframe = page.locator('iframe[src*="wsim"], iframe[src*="wallet"], iframe[id*="wallet"], iframe').first();
  await iframe.waitFor({ state: 'attached', timeout: 10000 });
  const frame = await iframe.contentFrame();
  if (!frame) {
    throw new Error('Could not get wallet embed iframe frame');
  }
  return frame;
}

/**
 * Complete wallet payment in embed/inline mode with passkey
 *
 * The embed/iframe flow shares the same page context, so the virtual
 * authenticator should still work. But we need to handle the WSIM login
 * flow if the user isn't authenticated yet.
 *
 * @param page - Playwright page object
 * @param webauthn - WebAuthn context for passkey simulation
 */
export async function completeWalletEmbedPayment(
  page: Page,
  webauthn: WebAuthnContext
): Promise<void> {
  console.log('[E2E] completeWalletEmbedPayment - starting');
  const frame = await getWalletEmbedFrame(page);

  // Wait for iframe content to load
  await page.waitForTimeout(1000);

  // Check for passkey authentication prompt in iframe (WSIM uses passkey for login)
  // Button text may include emoji: "🔒 Sign in with Passkey"
  const passkeyLoginButton = frame.locator('button:has-text("Sign in with Passkey"), button:has-text("Use Passkey"), button:has-text("Continue with Passkey"), button:has-text("Passkey")');
  console.log('[E2E] Checking for passkey login button in iframe');
  if (await passkeyLoginButton.first().isVisible({ timeout: 10000 }).catch(() => false)) {
    console.log('[E2E] Passkey login auth in WSIM iframe');
    await simulatePasskeySuccess(webauthn, async () => {
      await passkeyLoginButton.first().click();
    });
    console.log('[E2E] Passkey login auth completed in iframe');
    // Wait for transition to card selection/payment screen
    await page.waitForTimeout(3000);
  } else {
    console.log('[E2E] No passkey login button found, checking for card selection');
  }

  // After login, wait for card selection or payment confirmation screen
  const cardSelectionHeader = frame.locator('text=Select Payment Card').or(frame.locator('text=Select a Card'));
  const confirmButton = frame.locator('button:has-text("Confirm with Passkey"), button:has-text("Pay"), button:has-text("Confirm"), button:has-text("Authorize")');

  // Wait for either card selection or confirm button
  await expect(cardSelectionHeader.or(confirmButton).first()).toBeVisible({ timeout: 15000 });
  console.log('[E2E] Card selection or payment screen visible in iframe');

  // Select a card if card selection is shown
  if (await cardSelectionHeader.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('[E2E] Card selection screen visible in iframe');
    const cardOption = frame.locator('[class*="card"], [data-card-id]').filter({ hasText: /VISA|MC|Mastercard/i });
    if (await cardOption.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[E2E] Selecting first card in iframe');
      await cardOption.first().click();
      await page.waitForTimeout(500);
    }
  }

  // Find and click pay button in iframe with passkey
  await expect(confirmButton.first()).toBeVisible({ timeout: 10000 });
  console.log('[E2E] Clicking confirm button in iframe');

  await simulatePasskeySuccess(webauthn, async () => {
    await confirmButton.first().click({ timeout: 10000 });
  });

  console.log('[E2E] completeWalletEmbedPayment - done');
}

/**
 * Initiate wallet redirect payment flow
 *
 * @param page - Playwright page object
 */
export async function initiateWalletRedirect(page: Page): Promise<void> {
  await waitForCartContents(page);
  await page.click(PAYMENT_BUTTONS['wallet-redirect']);

  // Wait for redirect to WSIM
  await page.waitForURL(/wsim.*banksim\.ca/, { timeout: 15000 });
}

/**
 * Complete wallet redirect payment with passkey
 *
 * For the redirect flow, the page navigates to WSIM for OIDC login.
 * The WSIM redirect uses a different flow:
 * 1. User enters email address
 * 2. WSIM checks if user has passkey, offers passkey auth
 * 3. User authenticates with passkey
 * 4. User selects card
 * 5. User confirms payment with passkey
 *
 * @param page - Playwright page object
 * @param webauthn - WebAuthn context for passkey simulation
 * @param email - WSIM user email (required for redirect flow)
 */
export async function completeWalletRedirectPayment(
  page: Page,
  webauthn: WebAuthnContext,
  email?: string
): Promise<void> {
  console.log('[E2E] completeWalletRedirectPayment - starting, URL:', page.url());

  // Wait for WSIM payment page to load
  await page.waitForLoadState('networkidle');

  // WSIM redirect flow first shows an email entry screen
  const emailInput = page.locator('input[type="email"], input[placeholder*="email"], input[name="email"]');
  if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('[E2E] WSIM email entry screen visible');
    if (!email) {
      throw new Error('WSIM redirect flow requires email to be provided');
    }
    await emailInput.fill(email);
    const continueButton = page.locator('button:has-text("Continue"), button[type="submit"]');
    await continueButton.first().click();
    console.log('[E2E] Entered email, clicked Continue');
    await page.waitForTimeout(2000);
  }

  // Check for passkey authentication prompt (WSIM uses passkey for login)
  // Button text may include emoji: "🔒 Sign in with Passkey"
  const passkeyLoginButton = page.locator('button:has-text("Sign in with Passkey"), button:has-text("Use Passkey"), button:has-text("Continue with Passkey"), button:has-text("Passkey")');
  console.log('[E2E] Checking for passkey login button');
  if (await passkeyLoginButton.first().isVisible({ timeout: 10000 }).catch(() => false)) {
    console.log('[E2E] Passkey login auth on WSIM redirect page');
    await simulatePasskeySuccess(webauthn, async () => {
      await passkeyLoginButton.first().click();
    });
    console.log('[E2E] Passkey login auth completed');
    await page.waitForTimeout(3000);
  } else {
    console.log('[E2E] No passkey login button found, checking for card selection');
  }

  // After login, wait for card selection or payment confirmation screen
  const cardSelectionHeader = page.locator('text=Select Payment Card').or(page.locator('text=Select a Card'));
  const confirmButton = page.locator('button:has-text("Confirm with Passkey"), button:has-text("Pay"), button:has-text("Confirm"), button:has-text("Authorize")');

  // Wait for either card selection or confirm button
  await expect(cardSelectionHeader.or(confirmButton).first()).toBeVisible({ timeout: 15000 });
  console.log('[E2E] Card selection or payment screen visible');

  // Select a card if card selection is shown
  if (await cardSelectionHeader.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('[E2E] Card selection screen visible');
    const cardOption = page.locator('[class*="card"], [data-card-id]').filter({ hasText: /VISA|MC|Mastercard/i });
    if (await cardOption.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[E2E] Selecting first card');
      await cardOption.first().click();
      await page.waitForTimeout(500);
    }
  }

  // Find and click pay button - may or may not require passkey depending on WSIM flow
  await expect(confirmButton.first()).toBeVisible({ timeout: 10000 });
  console.log('[E2E] Clicking confirm button');

  // Check if this is a passkey-protected button or simple submit
  const buttonText = await confirmButton.first().textContent();
  const requiresPasskey = buttonText?.toLowerCase().includes('passkey');

  if (requiresPasskey) {
    console.log('[E2E] Button requires passkey authentication');
    await simulatePasskeySuccess(webauthn, async () => {
      await confirmButton.first().click({ timeout: 10000 });
    });
  } else {
    console.log('[E2E] Button is simple submit (no passkey)');
    await confirmButton.first().click({ timeout: 10000 });
  }

  console.log('[E2E] Payment confirmed, waiting for redirect back to SSIM');

  // Wait for redirect back to SSIM order confirmation
  await page.waitForURL(/ssim.*order-confirmation|order-confirmation/, { timeout: 30000 });

  console.log('[E2E] completeWalletRedirectPayment - done, URL:', page.url());
}

/**
 * Initiate wallet API payment
 *
 * @param page - Playwright page object
 * @param apiType - Type of API payment: 'api', 'api-direct', or 'api-proxy'
 */
export async function initiateWalletApiPayment(
  page: Page,
  apiType: 'api' | 'api-direct' | 'api-proxy' = 'api'
): Promise<void> {
  await waitForCartContents(page);

  const buttonId = `wallet-${apiType}` as PaymentMethod;
  await page.click(PAYMENT_BUTTONS[buttonId]);
}

/**
 * Complete wallet API payment flow
 *
 * For API flows, the flow is typically:
 * 1. Click API button -> Shows card picker or "Sign In to Wallet" prompt
 * 2. If not signed into WSIM, complete WSIM auth via popup
 * 3. Select a card from the list
 * 4. Confirm payment with passkey authentication
 *
 * @param page - Playwright page object
 * @param webauthn - WebAuthn context for passkey simulation
 * @param wsimEmail - WSIM user email (for login if needed)
 * @param wsimPassword - WSIM user password (for login if needed)
 */
export async function completeWalletApiPayment(
  page: Page,
  webauthn: WebAuthnContext,
  wsimEmail?: string,
  wsimPassword?: string
): Promise<void> {
  console.log('[E2E] completeWalletApiPayment - starting, URL:', page.url());

  // Wait for card picker container to be visible (the JS removes 'hidden' class)
  // We need to wait for any one of the containers to become visible (not have 'hidden' class)
  const cardPickerContainer = page.locator(
    '#apiCardPickerContainer:not(.hidden), #apiDirectCardPickerContainer:not(.hidden), #apiProxyCardPickerContainer:not(.hidden)'
  );
  await expect(cardPickerContainer.first()).toBeVisible({ timeout: 10000 });
  console.log('[E2E] Card picker container visible');

  // Wait for loading to complete - the API call to check auth status may take a moment
  // Look for either the "not authenticated" state OR the cards list
  const notAuthState = page.locator('#apiNotAuthenticated:not(.hidden), #apiDirectNotAuthenticated:not(.hidden), #apiProxyNotAuthenticated:not(.hidden)');
  const cardsListState = page.locator('#apiCardsList:not(.hidden), #apiDirectCardsList:not(.hidden), #apiProxyCardsList:not(.hidden)');

  // Wait for either state to appear
  await expect(notAuthState.or(cardsListState).first()).toBeVisible({ timeout: 10000 });
  console.log('[E2E] Auth check complete');

  // Check if we need to sign into WSIM first (the "not authenticated" state is visible)
  if (await notAuthState.first().isVisible().catch(() => false)) {
    console.log('[E2E] WSIM sign-in required, clicking Sign In to Wallet');

    // Find the sign-in button within the visible not-auth container
    const signInButton = notAuthState.first().locator('button:has-text("Sign In to Wallet")');
    await expect(signInButton).toBeVisible({ timeout: 5000 });

    // Click to open WSIM login popup
    const context = page.context();
    const popupPromise = context.waitForEvent('page');
    await signInButton.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');

    console.log('[E2E] WSIM login popup opened, URL:', popup.url());

    // WSIM card picker popup may show login or passkey auth
    // Wait for the popup to fully load
    await popup.waitForLoadState('networkidle').catch(() => {});

    // IMPORTANT: The virtual authenticator is page-specific in CDP.
    // We need to set up a new authenticator for the popup page AND
    // copy credentials from the main page's authenticator.
    const popupWebauthn = await setupVirtualAuthenticator(popup);
    console.log('[E2E] Set up virtual authenticator for popup');

    // Copy credentials from main authenticator to popup authenticator
    // so passkey authentication can find the registered credential
    const copiedCount = await copyCredentials(webauthn, popupWebauthn);
    console.log(`[E2E] Copied ${copiedCount} credentials to popup authenticator`);

    try {
      // Check for passkey authentication prompt in popup (WSIM uses passkey for login)
      const passkeyLoginButton = popup.locator('button:has-text("Sign in with Passkey"), button:has-text("Use Passkey"), button:has-text("Continue with Passkey")');
      if (await passkeyLoginButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('[E2E] Passkey login auth in WSIM popup');
        await simulatePasskeySuccess(popupWebauthn, async () => {
          await passkeyLoginButton.first().click();
        });
        console.log('[E2E] Passkey login auth completed in popup');
        await popup.waitForTimeout(2000);
      }

      // Check for email/password login if passkey not available
      const emailInput = popup.locator('#email, input[type="email"]');
      if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        if (wsimEmail && wsimPassword) {
          console.log('[E2E] Filling WSIM credentials');
          await emailInput.fill(wsimEmail);
          await popup.fill('#password, input[type="password"]', wsimPassword);
          await popup.click('button[type="submit"]');
          await popup.waitForTimeout(2000);
        }
      }

      // After login, the popup transitions to card selection screen
      // Wait for "Select Payment Card" heading or card options to appear
      const cardSelectionHeader = popup.locator('text=Select Payment Card').or(popup.locator('text=Select a Card'));
      await expect(cardSelectionHeader.first()).toBeVisible({ timeout: 10000 });
      console.log('[E2E] Card selection screen visible in popup');

      // Select a card in the popup (first one should be selected by default, but click to ensure)
      const popupCardOption = popup.locator('[class*="card"], [data-card-id]').filter({ hasText: /VISA|MC|Mastercard/i });
      if (await popupCardOption.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('[E2E] Selecting first card in popup');
        await popupCardOption.first().click();
      }

      // Now click "Confirm with Passkey" button in popup to complete payment
      const confirmPaymentButton = popup.locator('button:has-text("Confirm with Passkey")');
      await expect(confirmPaymentButton).toBeVisible({ timeout: 5000 });
      console.log('[E2E] Clicking Confirm with Passkey in popup');

      await simulatePasskeySuccess(popupWebauthn, async () => {
        await confirmPaymentButton.click();
      });
      console.log('[E2E] Payment confirmed with passkey in popup');

      // Popup should close after successful payment confirmation
      try {
        await popup.waitForEvent('close', { timeout: 15000 });
        console.log('[E2E] WSIM popup closed after payment');
      } catch {
        // Popup might still be open or already closed
        console.log('[E2E] WSIM popup close wait ended');
      }
    } finally {
      // Clean up popup's virtual authenticator
      await teardownVirtualAuthenticator(popupWebauthn).catch(() => {});
    }

    // Payment was completed in popup, should redirect to order confirmation
    console.log('[E2E] Wallet API payment completed via popup');
    return;
  }

  // If no sign-in was needed (already authenticated), handle card selection on main page
  console.log('[E2E] User already authenticated, handling inline card selection');

  // Wait for card list to be visible (cards loaded)
  await cardsListState.first().waitFor({ state: 'visible', timeout: 10000 });
  console.log('[E2E] Cards list visible');

  // Look for card options - different API modes use different class names:
  // - Standard API: .card-option[data-card-id]
  // - Direct API: .card-option-direct[data-card-id]
  // - Proxy API: .card-option-proxy[data-card-id]
  const cardOption = page.locator('[class*="card-option"][data-card-id]');
  const cardCount = await cardOption.count();
  console.log(`[E2E] Found ${cardCount} card options`);

  if (cardCount > 0) {
    // Click the first card to select it
    console.log('[E2E] Selecting first card');
    await cardOption.first().click();
    // Wait a moment for selection to register
    await page.waitForTimeout(500);
  }

  // Look for confirm/pay button with passkey - use specific IDs and filter for visible non-hidden
  const confirmButton = page.locator(
    '#apiConfirmPayment:not(.hidden), #apiDirectConfirmPayment:not(.hidden), #apiProxyConfirmPayment:not(.hidden)'
  );

  await expect(confirmButton.first()).toBeVisible({ timeout: 10000 });
  await expect(confirmButton.first()).toBeEnabled({ timeout: 5000 });
  console.log('[E2E] Clicking confirm with passkey');

  await simulatePasskeySuccess(webauthn, async () => {
    await confirmButton.first().click();
  });

  console.log('[E2E] completeWalletApiPayment - done');
}

/**
 * Verify payment was successful
 *
 * After any payment method completes, we should be redirected to
 * the order confirmation page.
 *
 * @param page - Playwright page object
 * @returns The order ID from the URL
 */
export async function verifyPaymentSuccess(page: Page): Promise<string> {
  // Wait for redirect to order confirmation
  await page.waitForURL(/order-confirmation/, { timeout: 30000 });

  // Verify success UI elements
  await expect(
    page.getByRole('heading', { name: /Payment Successful|Order Confirmed/i })
  ).toBeVisible({ timeout: 10000 });

  // Extract order ID from URL
  const url = page.url();
  const match = url.match(/order-confirmation\/([^/?]+)/);
  return match ? match[1] : '';
}

/**
 * Verify payment failure or cancellation
 *
 * @param page - Playwright page object
 * @param expectedError - Optional expected error message
 */
export async function verifyPaymentFailure(
  page: Page,
  expectedError?: string
): Promise<void> {
  // Should still be on checkout page or redirected to error page
  const errorMessage = page.locator(
    '[data-testid="error-message"], .error-message, .text-red-500, text=failed, text=error, text=cancelled'
  );

  await expect(errorMessage.first()).toBeVisible({ timeout: 10000 });

  if (expectedError) {
    await expect(
      page.locator(`text=${expectedError}`)
    ).toBeVisible();
  }
}
