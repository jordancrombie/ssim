/**
 * SSIM Order Helpers for E2E Tests
 *
 * Provides functions for verifying order confirmation and
 * viewing order history.
 */

import { Page, expect } from '@playwright/test';
import { getUrls, SSIM_PAGES } from '../../fixtures/urls';

/**
 * Order status types
 */
export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'voided'
  | 'refunded'
  | 'failed';

/**
 * Navigate to the order confirmation page
 *
 * @param page - Playwright page object
 * @param orderId - The order ID to view
 */
export async function navigateToOrderConfirmation(
  page: Page,
  orderId: string
): Promise<void> {
  const urls = getUrls();
  await page.goto(`${urls.ssim}${SSIM_PAGES.orderConfirmation}/${orderId}`);

  // Wait for page to load
  await expect(
    page.getByRole('heading', { name: /Payment Successful|Order/i })
  ).toBeVisible({ timeout: 10000 });
}

/**
 * Verify order confirmation page shows correct details
 *
 * @param page - Playwright page object
 * @param expectedOrderId - Expected order ID
 * @param expectedStatus - Expected order status (optional)
 * @param expectedPaymentMethod - Expected payment method (optional)
 */
export async function verifyOrderConfirmation(
  page: Page,
  expectedOrderId: string,
  expectedStatus?: OrderStatus,
  expectedPaymentMethod?: 'wallet' | 'bank'
): Promise<void> {
  // Verify order ID is displayed
  await expect(page.locator(`text=${expectedOrderId}`)).toBeVisible({
    timeout: 10000,
  });

  // Verify status if provided
  if (expectedStatus) {
    const statusBadge = page.locator(
      `text=${expectedStatus.charAt(0).toUpperCase() + expectedStatus.slice(1)}`
    );
    await expect(statusBadge).toBeVisible();
  }

  // Verify payment method if provided
  if (expectedPaymentMethod) {
    const methodText =
      expectedPaymentMethod === 'wallet' ? 'Digital Wallet' : 'Bank Card';
    await expect(page.locator(`text=${methodText}`)).toBeVisible();
  }
}

/**
 * Get the order status from the confirmation page
 *
 * @param page - Playwright page object
 * @returns The order status
 */
export async function getOrderStatus(page: Page): Promise<OrderStatus> {
  const statuses: OrderStatus[] = [
    'authorized',
    'captured',
    'voided',
    'refunded',
    'failed',
    'pending',
  ];

  for (const status of statuses) {
    const statusText =
      status.charAt(0).toUpperCase() + status.slice(1);
    const statusElement = page.locator(`text=${statusText}`);
    if (await statusElement.isVisible({ timeout: 1000 }).catch(() => false)) {
      return status;
    }
  }

  return 'pending';
}

/**
 * Get the transaction ID from the confirmation page
 *
 * @param page - Playwright page object
 * @returns The transaction ID or null if not found
 */
export async function getTransactionId(page: Page): Promise<string | null> {
  // Transaction ID is typically shown in a monospace font
  const transactionElement = page.locator(
    '[class*="font-mono"]:near(:text("Transaction ID"))'
  );

  try {
    const transactionId = await transactionElement.textContent({ timeout: 5000 });
    return transactionId?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Navigate to the orders history page
 *
 * @param page - Playwright page object
 */
export async function navigateToOrders(page: Page): Promise<void> {
  const urls = getUrls();
  await page.goto(`${urls.ssim}${SSIM_PAGES.orders}`);

  // Wait for page to load
  await expect(
    page.getByRole('heading', { name: /Orders|Order History/i })
  ).toBeVisible({ timeout: 10000 });
}

/**
 * Get the count of orders in the order history
 *
 * @param page - Playwright page object
 * @returns The number of orders
 */
export async function getOrderCount(page: Page): Promise<number> {
  await navigateToOrders(page);

  // Count order rows/cards
  const orderItems = page.locator(
    '[data-testid="order-item"], .order-item, [class*="order"]'
  );

  await page.waitForTimeout(1000);
  return await orderItems.count();
}

/**
 * Find an order in the order history by ID
 *
 * @param page - Playwright page object
 * @param orderId - The order ID to find
 * @returns true if found
 */
export async function findOrderInHistory(
  page: Page,
  orderId: string
): Promise<boolean> {
  await navigateToOrders(page);

  const orderElement = page.locator(`text=${orderId}`);
  return await orderElement.isVisible({ timeout: 5000 }).catch(() => false);
}

/**
 * Click on an order in the history to view details
 *
 * @param page - Playwright page object
 * @param orderId - The order ID to click
 */
export async function viewOrderFromHistory(
  page: Page,
  orderId: string
): Promise<void> {
  await navigateToOrders(page);

  // Click on the order row/card
  const orderLink = page.locator(`a:has-text("${orderId}"), text=${orderId}`);
  await orderLink.first().click();

  // Wait for order detail page
  await expect(page.locator(`text=${orderId}`)).toBeVisible({ timeout: 10000 });
}

/**
 * Verify the order total on confirmation page
 *
 * @param page - Playwright page object
 * @param expectedTotal - Expected total as formatted string (e.g., "$99.99")
 */
export async function verifyOrderTotal(
  page: Page,
  expectedTotal: string
): Promise<void> {
  const totalElement = page.locator(
    '[class*="text-purple-600"][class*="font-bold"]'
  );
  await expect(totalElement).toContainText(expectedTotal);
}

/**
 * Navigate back to store from order confirmation
 *
 * @param page - Playwright page object
 */
export async function continueShoppingFromConfirmation(
  page: Page
): Promise<void> {
  const continueButton = page.locator(
    'a:has-text("Continue Shopping"), a:has-text("Back to Store"), a:has-text("Browse Store")'
  );
  await continueButton.first().click();

  // Wait for store page
  await expect(page.getByRole('heading', { name: 'Store' })).toBeVisible({
    timeout: 10000,
  });
}
