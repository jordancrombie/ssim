import express from 'express';
import request from 'supertest';
import cartRoutes from '../../routes/cart';
import { createMockSession } from '../mocks/mockSession';

// Mock the store service
jest.mock('../../services/store', () => ({
  getOrCreateStore: jest.fn().mockResolvedValue({ id: 'store-123', name: 'Test Store' }),
}));

// Mock the product service
const mockProducts: Record<string, any> = {
  'product-1': { id: 'product-1', name: 'Test Product 1', price: 1000, active: true },
  'product-2': { id: 'product-2', name: 'Test Product 2', price: 2500, active: true },
  'product-3': { id: 'product-3', name: 'Test Product 3', price: 500, active: true },
};

jest.mock('../../services/product', () => ({
  getProductById: jest.fn((storeId: string, productId: string) => {
    return Promise.resolve(mockProducts[productId] || null);
  }),
  formatPrice: jest.fn((cents: number) => `$${(cents / 100).toFixed(2)}`),
}));

// Create test app
const createTestApp = (sessionData: any = {}) => {
  const app = express();
  app.use(express.json());

  // Mock session middleware
  app.use((req, res, next) => {
    req.session = createMockSession(sessionData) as any;
    next();
  });

  app.use('/api/cart', cartRoutes);
  return app;
};

describe('Cart Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/cart', () => {
    it('should return empty cart when no items', async () => {
      const app = createTestApp({ cart: [] });
      const response = await request(app).get('/api/cart');

      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
      expect(response.body.itemCount).toBe(0);
      expect(response.body.total).toBe(0);
    });

    it('should return cart with items and totals', async () => {
      const app = createTestApp({
        cart: [
          { productId: 'product-1', quantity: 2 },
          { productId: 'product-2', quantity: 1 },
        ],
      });
      const response = await request(app).get('/api/cart');

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(2);
      expect(response.body.itemCount).toBe(3); // 2 + 1
      expect(response.body.total).toBe(4500); // (1000*2) + (2500*1)
      expect(response.body.formattedTotal).toBe('$45.00');
    });

    it('should filter out items with invalid products', async () => {
      const app = createTestApp({
        cart: [
          { productId: 'product-1', quantity: 1 },
          { productId: 'invalid-product', quantity: 1 },
        ],
      });
      const response = await request(app).get('/api/cart');

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].productId).toBe('product-1');
    });

    it('should handle undefined cart in session', async () => {
      const app = createTestApp({});
      const response = await request(app).get('/api/cart');

      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
      expect(response.body.itemCount).toBe(0);
    });
  });

  describe('POST /api/cart/add', () => {
    it('should add item to empty cart', async () => {
      const app = createTestApp({ cart: [] });
      const response = await request(app)
        .post('/api/cart/add')
        .send({ productId: 'product-1', quantity: 1 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Test Product 1 added to cart');
      expect(response.body.itemCount).toBe(1);
    });

    it('should increment quantity for existing item', async () => {
      const app = createTestApp({
        cart: [{ productId: 'product-1', quantity: 2 }],
      });
      const response = await request(app)
        .post('/api/cart/add')
        .send({ productId: 'product-1', quantity: 3 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.itemCount).toBe(5); // 2 + 3
    });

    it('should default quantity to 1', async () => {
      const app = createTestApp({ cart: [] });
      const response = await request(app)
        .post('/api/cart/add')
        .send({ productId: 'product-1' });

      expect(response.status).toBe(200);
      expect(response.body.itemCount).toBe(1);
    });

    it('should return 400 when productId is missing', async () => {
      const app = createTestApp({ cart: [] });
      const response = await request(app)
        .post('/api/cart/add')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Product ID is required');
    });

    it('should return 404 for invalid product', async () => {
      const app = createTestApp({ cart: [] });
      const response = await request(app)
        .post('/api/cart/add')
        .send({ productId: 'invalid-product' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Product not found');
    });

    it('should add new item to cart with existing items', async () => {
      const app = createTestApp({
        cart: [{ productId: 'product-1', quantity: 1 }],
      });
      const response = await request(app)
        .post('/api/cart/add')
        .send({ productId: 'product-2', quantity: 2 });

      expect(response.status).toBe(200);
      expect(response.body.itemCount).toBe(3); // 1 + 2
    });
  });

  describe('PUT /api/cart/update', () => {
    it('should update item quantity', async () => {
      const app = createTestApp({
        cart: [{ productId: 'product-1', quantity: 2 }],
      });
      const response = await request(app)
        .put('/api/cart/update')
        .send({ productId: 'product-1', quantity: 5 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.itemCount).toBe(5);
    });

    it('should remove item when quantity is 0', async () => {
      const app = createTestApp({
        cart: [
          { productId: 'product-1', quantity: 2 },
          { productId: 'product-2', quantity: 1 },
        ],
      });
      const response = await request(app)
        .put('/api/cart/update')
        .send({ productId: 'product-1', quantity: 0 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.itemCount).toBe(1); // Only product-2 remains
    });

    it('should remove item when quantity is negative', async () => {
      const app = createTestApp({
        cart: [{ productId: 'product-1', quantity: 2 }],
      });
      const response = await request(app)
        .put('/api/cart/update')
        .send({ productId: 'product-1', quantity: -1 });

      expect(response.status).toBe(200);
      expect(response.body.itemCount).toBe(0);
    });

    it('should return 400 when productId is missing', async () => {
      const app = createTestApp({ cart: [] });
      const response = await request(app)
        .put('/api/cart/update')
        .send({ quantity: 5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Product ID and quantity are required');
    });

    it('should return 400 when quantity is missing', async () => {
      const app = createTestApp({ cart: [] });
      const response = await request(app)
        .put('/api/cart/update')
        .send({ productId: 'product-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Product ID and quantity are required');
    });

    it('should return 404 when item not in cart', async () => {
      const app = createTestApp({ cart: [] });
      const response = await request(app)
        .put('/api/cart/update')
        .send({ productId: 'product-1', quantity: 5 });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Item not in cart');
    });
  });

  describe('DELETE /api/cart/remove/:productId', () => {
    it('should remove item from cart', async () => {
      const app = createTestApp({
        cart: [
          { productId: 'product-1', quantity: 2 },
          { productId: 'product-2', quantity: 1 },
        ],
      });
      const response = await request(app).delete('/api/cart/remove/product-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.itemCount).toBe(1); // Only product-2 remains
    });

    it('should return 404 when item not in cart', async () => {
      const app = createTestApp({ cart: [] });
      const response = await request(app).delete('/api/cart/remove/product-1');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Item not in cart');
    });

    it('should handle removing last item', async () => {
      const app = createTestApp({
        cart: [{ productId: 'product-1', quantity: 1 }],
      });
      const response = await request(app).delete('/api/cart/remove/product-1');

      expect(response.status).toBe(200);
      expect(response.body.itemCount).toBe(0);
    });
  });

  describe('POST /api/cart/clear', () => {
    it('should clear all items from cart', async () => {
      const app = createTestApp({
        cart: [
          { productId: 'product-1', quantity: 2 },
          { productId: 'product-2', quantity: 1 },
        ],
      });
      const response = await request(app).post('/api/cart/clear');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.itemCount).toBe(0);
    });

    it('should handle clearing empty cart', async () => {
      const app = createTestApp({ cart: [] });
      const response = await request(app).post('/api/cart/clear');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.itemCount).toBe(0);
    });
  });
});
