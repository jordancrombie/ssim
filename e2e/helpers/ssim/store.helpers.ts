/**
 * SSIM Store Helpers for E2E Tests
 *
 * Provides functions for interacting with the SSIM store page,
 * including adding products to cart.
 */

import { Page, expect } from '@playwright/test';
import { getUrls, SSIM_PAGES } from '../../fixtures/urls';

/**
 * Navigate to the SSIM store page
 *
 * @param page - Playwright page object
 */
export async function navigateToStore(page: Page): Promise<void> {
  const urls = getUrls();
  await page.goto(`${urls.ssim}${SSIM_PAGES.store}`);

  // Wait for page to load - look for store heading
  await expect(page.getByRole('heading', { name: 'Store' })).toBeVisible({
    timeout: 10000,
  });
}

/**
 * Add a product to the cart by clicking its Add button
 *
 * @param page - Playwright page object
 * @param productName - Name of the product to add (e.g., "Laptop", "Phone")
 * @returns The new cart count
 */
export async function addProductToCart(
  page: Page,
  productName?: string
): Promise<number> {
  // Get current cart count before adding
  const cartCountElement = page.locator('#cartCount');
  const beforeCount = parseInt((await cartCountElement.textContent()) || '0', 10);

  // If no product name specified, click the first Add button
  if (!productName) {
    const addButton = page.locator('button:has-text("Add")').first();
    await addButton.click();
  } else {
    // Find the product card containing the product name and click its Add button
    const productCard = page
      .locator('div')
      .filter({ hasText: productName })
      .locator('button:has-text("Add")')
      .first();
    await productCard.click();
  }

  // Wait for cart count to increase (more reliable than toast)
  await expect(cartCountElement).not.toHaveText(String(beforeCount), {
    timeout: 5000,
  });

  // Get the updated cart count
  const afterCountText = await cartCountElement.textContent();
  return parseInt(afterCountText || '0', 10);
}

/**
 * Add multiple products to the cart
 *
 * @param page - Playwright page object
 * @param count - Number of products to add (default: 1)
 * @returns The final cart count
 */
export async function addMultipleProductsToCart(
  page: Page,
  count = 1
): Promise<number> {
  let cartCount = 0;

  for (let i = 0; i < count; i++) {
    cartCount = await addProductToCart(page);
    // Small delay between additions
    await page.waitForTimeout(300);
  }

  return cartCount;
}

/**
 * Get the current cart count displayed on the store page
 *
 * @param page - Playwright page object
 * @returns The cart count
 */
export async function getStoreCartCount(page: Page): Promise<number> {
  const cartCountElement = page.locator('#cartCount');
  const cartCountText = await cartCountElement.textContent();
  return parseInt(cartCountText || '0', 10);
}

/**
 * Navigate to checkout from the store page
 *
 * @param page - Playwright page object
 */
export async function navigateToCheckoutFromStore(page: Page): Promise<void> {
  // Click the Cart link/button in the store page header
  await page.click('a[href="/checkout"]');

  // Wait for checkout page to load
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({
    timeout: 10000,
  });
}

/**
 * Add products and go to checkout (convenience function)
 *
 * @param page - Playwright page object
 * @param productCount - Number of products to add (default: 1)
 */
export async function addProductsAndCheckout(
  page: Page,
  productCount = 1
): Promise<void> {
  await navigateToStore(page);
  await addMultipleProductsToCart(page, productCount);
  await navigateToCheckoutFromStore(page);
}
