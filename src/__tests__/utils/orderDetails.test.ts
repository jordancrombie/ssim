import {
  buildOrderDetails,
  buildOrderDescription,
  CartItem,
  OrderDetails,
} from '../../utils/orderDetails';
import type { Product } from '@prisma/client';

// Helper to create mock products
function createMockProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    storeId: 'store-1',
    name: 'Test Product',
    description: 'A test product',
    price: 1999, // $19.99 in cents
    currency: 'CAD',
    image: null,
    category: 'Electronics',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('buildOrderDetails', () => {
  it('should build orderDetails from cart and products', () => {
    const cart: CartItem[] = [
      { productId: 'prod-1', quantity: 2 },
      { productId: 'prod-2', quantity: 1 },
    ];

    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ id: 'prod-1', name: 'Widget', price: 1000 })],
      ['prod-2', createMockProduct({ id: 'prod-2', name: 'Gadget', price: 2500 })],
    ]);

    const result = buildOrderDetails(cart, products);

    expect(result.version).toBe(1);
    expect(result.items).toHaveLength(2);
    expect(result.items![0]).toEqual({
      name: 'Widget',
      quantity: 2,
      unitPrice: 10, // $10.00
    });
    expect(result.items![1]).toEqual({
      name: 'Gadget',
      quantity: 1,
      unitPrice: 25, // $25.00
    });
    expect(result.subtotal).toBe(45); // (10 * 2) + 25 = 45
  });

  it('should convert cents to dollars correctly', () => {
    const cart: CartItem[] = [{ productId: 'prod-1', quantity: 1 }];
    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ price: 14999 })], // $149.99
    ]);

    const result = buildOrderDetails(cart, products);

    expect(result.items![0].unitPrice).toBe(149.99);
    expect(result.subtotal).toBe(149.99);
  });

  it('should round subtotal to 2 decimal places', () => {
    const cart: CartItem[] = [
      { productId: 'prod-1', quantity: 3 },
    ];
    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ price: 333 })], // $3.33 * 3 = $9.99
    ]);

    const result = buildOrderDetails(cart, products);

    expect(result.subtotal).toBe(9.99);
  });

  it('should include imageUrl when product has image', () => {
    const cart: CartItem[] = [{ productId: 'prod-1', quantity: 1 }];
    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ image: 'https://example.com/image.jpg' })],
    ]);

    const result = buildOrderDetails(cart, products);

    expect(result.items![0].imageUrl).toBe('https://example.com/image.jpg');
  });

  it('should NOT include imageUrl when product has no image', () => {
    const cart: CartItem[] = [{ productId: 'prod-1', quantity: 1 }];
    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ image: null })],
    ]);

    const result = buildOrderDetails(cart, products);

    expect(result.items![0]).not.toHaveProperty('imageUrl');
  });

  it('should skip cart items where product is not found', () => {
    const cart: CartItem[] = [
      { productId: 'prod-1', quantity: 1 },
      { productId: 'prod-missing', quantity: 1 },
      { productId: 'prod-2', quantity: 1 },
    ];
    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ id: 'prod-1', name: 'Widget', price: 1000 })],
      ['prod-2', createMockProduct({ id: 'prod-2', name: 'Gadget', price: 2000 })],
    ]);

    const result = buildOrderDetails(cart, products);

    expect(result.items).toHaveLength(2);
    expect(result.items![0].name).toBe('Widget');
    expect(result.items![1].name).toBe('Gadget');
    expect(result.subtotal).toBe(30); // 10 + 20 (missing product skipped)
  });

  it('should return empty items for empty cart', () => {
    const cart: CartItem[] = [];
    const products = new Map<string, Product>();

    const result = buildOrderDetails(cart, products);

    expect(result.version).toBe(1);
    expect(result.items).toHaveLength(0);
    expect(result.subtotal).toBe(0);
  });

  it('should handle zero-price items', () => {
    const cart: CartItem[] = [{ productId: 'prod-1', quantity: 1 }];
    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ price: 0 })],
    ]);

    const result = buildOrderDetails(cart, products);

    expect(result.items![0].unitPrice).toBe(0);
    expect(result.subtotal).toBe(0);
  });

  it('should handle large quantities', () => {
    const cart: CartItem[] = [{ productId: 'prod-1', quantity: 100 }];
    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ price: 999 })], // $9.99
    ]);

    const result = buildOrderDetails(cart, products);

    expect(result.items![0].quantity).toBe(100);
    expect(result.subtotal).toBe(999); // 9.99 * 100
  });
});

describe('buildOrderDescription', () => {
  it('should build description with item count and product names', () => {
    const cart: CartItem[] = [
      { productId: 'prod-1', quantity: 2 },
      { productId: 'prod-2', quantity: 1 },
    ];
    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ name: 'Widget Pro' })],
      ['prod-2', createMockProduct({ name: 'USB-C Cable' })],
    ]);

    const result = buildOrderDescription(cart, products);

    expect(result).toBe('3 items - Widget Pro, USB-C Cable');
  });

  it('should use singular "item" for quantity of 1', () => {
    const cart: CartItem[] = [{ productId: 'prod-1', quantity: 1 }];
    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ name: 'Single Widget' })],
    ]);

    const result = buildOrderDescription(cart, products);

    expect(result).toBe('1 item - Single Widget');
  });

  it('should truncate to 3 products with ellipsis', () => {
    const cart: CartItem[] = [
      { productId: 'prod-1', quantity: 1 },
      { productId: 'prod-2', quantity: 1 },
      { productId: 'prod-3', quantity: 1 },
      { productId: 'prod-4', quantity: 1 },
    ];
    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ name: 'Product A' })],
      ['prod-2', createMockProduct({ name: 'Product B' })],
      ['prod-3', createMockProduct({ name: 'Product C' })],
      ['prod-4', createMockProduct({ name: 'Product D' })],
    ]);

    const result = buildOrderDescription(cart, products);

    expect(result).toBe('4 items - Product A, Product B, Product C, ...');
  });

  it('should return "Store purchase" for empty cart', () => {
    const cart: CartItem[] = [];
    const products = new Map<string, Product>();

    const result = buildOrderDescription(cart, products);

    expect(result).toBe('Store purchase');
  });

  it('should return "Store purchase" when no products found', () => {
    const cart: CartItem[] = [
      { productId: 'prod-missing', quantity: 1 },
    ];
    const products = new Map<string, Product>();

    const result = buildOrderDescription(cart, products);

    expect(result).toBe('Store purchase');
  });

  it('should skip missing products but include found ones', () => {
    const cart: CartItem[] = [
      { productId: 'prod-1', quantity: 2 },
      { productId: 'prod-missing', quantity: 1 },
    ];
    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ name: 'Found Product' })],
    ]);

    const result = buildOrderDescription(cart, products);

    expect(result).toBe('2 items - Found Product');
  });

  it('should handle exactly 3 products without ellipsis', () => {
    const cart: CartItem[] = [
      { productId: 'prod-1', quantity: 1 },
      { productId: 'prod-2', quantity: 1 },
      { productId: 'prod-3', quantity: 1 },
    ];
    const products = new Map<string, Product>([
      ['prod-1', createMockProduct({ name: 'A' })],
      ['prod-2', createMockProduct({ name: 'B' })],
      ['prod-3', createMockProduct({ name: 'C' })],
    ]);

    const result = buildOrderDescription(cart, products);

    expect(result).toBe('3 items - A, B, C');
  });
});
