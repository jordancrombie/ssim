/**
 * Order Details Utilities
 *
 * Provides types and helper functions for building orderDetails objects
 * to send to WSIM for enhanced mobile payment approval screens.
 *
 * @see ENHANCED_PURCHASE_INFO_PROPOSAL.md for full specification
 */

import type { Product } from '@prisma/client';

// ============================================
// Types (matching WSIM's OrderDetails schema)
// ============================================

export interface OrderLineItem {
  name: string;
  quantity: number;
  unitPrice: number; // In dollars (not cents)
  sku?: string;
  imageUrl?: string;
}

export interface OrderShipping {
  method?: string;
  amount: number;
}

export interface OrderTax {
  amount: number;
  rate?: number; // 0.13 for 13%
  label?: string; // "HST", "GST", "Sales Tax"
}

export interface OrderDiscount {
  code?: string;
  description?: string;
  amount: number; // Positive number (displayed as negative)
}

export interface OrderFee {
  label: string;
  amount: number;
}

export interface OrderDetails {
  version?: number;
  items?: OrderLineItem[];
  subtotal?: number;
  shipping?: OrderShipping;
  tax?: OrderTax;
  discounts?: OrderDiscount[];
  fees?: OrderFee[];
}

// ============================================
// Cart Item Interface (from session)
// ============================================

export interface CartItem {
  productId: string;
  quantity: number;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Build orderDetails object from cart items and products
 *
 * @param cart - Array of cart items from session
 * @param products - Map of product ID to Product object
 * @returns OrderDetails object ready to send to WSIM
 *
 * @example
 * const products = new Map(productList.map(p => [p.id, p]));
 * const orderDetails = buildOrderDetails(cart, products);
 */
export function buildOrderDetails(
  cart: CartItem[],
  products: Map<string, Product>
): OrderDetails {
  const items: OrderLineItem[] = [];
  let subtotal = 0;

  for (const cartItem of cart) {
    const product = products.get(cartItem.productId);
    if (!product) {
      // Skip items where product no longer exists
      // The amount field remains authoritative
      continue;
    }

    const unitPrice = product.price / 100; // cents → dollars
    const lineItem: OrderLineItem = {
      name: product.name,
      quantity: cartItem.quantity,
      unitPrice,
    };

    // Only include imageUrl if product has an image
    if (product.image) {
      lineItem.imageUrl = product.image;
    }

    items.push(lineItem);
    subtotal += unitPrice * cartItem.quantity;
  }

  return {
    version: 1,
    items,
    subtotal: roundToTwoDecimals(subtotal),
  };
}

/**
 * Generate a human-readable order description from cart items
 *
 * Used as fallback for older mwsim versions that don't support orderDetails.
 *
 * @param cart - Array of cart items from session
 * @param products - Map of product ID to Product object
 * @returns Description string like "2 items - Wireless Headphones, USB-C Cable"
 *
 * @example
 * const description = buildOrderDescription(cart, products);
 * // "3 items - Widget Pro, USB-C Cable, Backpack"
 */
export function buildOrderDescription(
  cart: CartItem[],
  products: Map<string, Product>
): string {
  const productNames: string[] = [];
  let totalQuantity = 0;

  for (const cartItem of cart) {
    const product = products.get(cartItem.productId);
    if (product) {
      productNames.push(product.name);
      totalQuantity += cartItem.quantity;
    }
  }

  if (productNames.length === 0) {
    return 'Store purchase';
  }

  const itemWord = totalQuantity === 1 ? 'item' : 'items';

  // Truncate long lists
  if (productNames.length > 3) {
    const first3 = productNames.slice(0, 3).join(', ');
    return `${totalQuantity} ${itemWord} - ${first3}, ...`;
  }

  return `${totalQuantity} ${itemWord} - ${productNames.join(', ')}`;
}

/**
 * Round a number to 2 decimal places
 * Avoids floating-point artifacts like 99.97000000000001
 */
function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
