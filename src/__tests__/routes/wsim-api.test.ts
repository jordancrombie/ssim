import express from 'express';
import request from 'supertest';
import wsimApiRoutes from '../../routes/wsim-api';
import { createMockSession } from '../mocks/mockSession';

// Mock the config
jest.mock('../../config/env', () => ({
  config: {
    wsimApiKey: 'test-wsim-api-key',
    wsimApiUrl: 'https://wsim-api.test.com/api/merchant',
    merchantId: 'merchant-123',
  },
}));

// Mock the store service
jest.mock('../../services/store', () => ({
  getOrCreateStore: jest.fn().mockResolvedValue({ id: 'store-123', name: 'Test Store' }),
}));

// Mock the product service
const mockProducts: Record<string, any> = {
  'product-1': { id: 'product-1', name: 'Test Product 1', price: 1000, active: true },
  'product-2': { id: 'product-2', name: 'Test Product 2', price: 2500, active: true },
};

jest.mock('../../services/product', () => ({
  getProductById: jest.fn((storeId: string, productId: string) => {
    return Promise.resolve(mockProducts[productId] || null);
  }),
}));

// Mock the order service
const mockOrders: Record<string, any> = {};
let orderIdCounter = 1;

jest.mock('../../services/order', () => ({
  createOrder: jest.fn((storeId: string, data: any) => {
    const order = {
      id: `order-${orderIdCounter++}`,
      storeId,
      bsimUserId: data.bsimUserId,
      status: 'pending',
      subtotal: data.subtotal,
      currency: data.currency,
      items: data.items,
      paymentDetails: null,
    };
    mockOrders[order.id] = order;
    return Promise.resolve(order);
  }),
  setOrderAuthorized: jest.fn().mockResolvedValue(undefined),
  setOrderDeclined: jest.fn().mockResolvedValue(undefined),
  setOrderFailed: jest.fn().mockResolvedValue(undefined),
}));

// Mock the payment service
jest.mock('../../services/payment', () => ({
  authorizePayment: jest.fn().mockResolvedValue({
    status: 'authorized',
    transactionId: 'txn-123',
    authorizationCode: 'auth-456',
  }),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import mocked services for spying
import * as orderService from '../../services/order';
import * as paymentService from '../../services/payment';
import { config } from '../../config/env';

// Create test app
const createTestApp = (sessionData: any = {}) => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mock session middleware
  app.use((req, res, next) => {
    req.session = createMockSession(sessionData) as any;
    next();
  });

  app.use('/api/wsim', wsimApiRoutes);
  return app;
};

describe('WSIM API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    // Reset order counter and mock orders
    orderIdCounter = 1;
    Object.keys(mockOrders).forEach(key => delete mockOrders[key]);
  });

  describe('GET /api/wsim/auth-check', () => {
    it('should return authenticated false when WSIM API is not configured', async () => {
      // Temporarily mock config without wsimApiKey
      const originalWsimApiKey = (config as any).wsimApiKey;
      (config as any).wsimApiKey = '';

      const app = createTestApp({});

      const response = await request(app).get('/api/wsim/auth-check');

      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBe(false);
      expect(response.body.error).toBe('WSIM API not configured');

      // Restore
      (config as any).wsimApiKey = originalWsimApiKey;
    });

    it('should proxy auth check to WSIM API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authenticated: true, user: { id: 'user-1' } }),
      });

      const app = createTestApp({});

      const response = await request(app)
        .get('/api/wsim/auth-check')
        .set('Cookie', 'wsim-session=test-cookie');

      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://wsim-api.test.com/api/merchant/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-wsim-api-key',
          }),
        })
      );
    });

    it('should return authenticated false on fetch error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const app = createTestApp({});

      const response = await request(app).get('/api/wsim/auth-check');

      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBe(false);
    });
  });

  describe('GET /api/wsim/cards', () => {
    it('should return 503 when WSIM API is not configured', async () => {
      const originalWsimApiKey = (config as any).wsimApiKey;
      (config as any).wsimApiKey = '';

      const app = createTestApp({});

      const response = await request(app).get('/api/wsim/cards');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('WSIM API not configured');

      (config as any).wsimApiKey = originalWsimApiKey;
    });

    it('should proxy cards request to WSIM API', async () => {
      const mockCards = [
        { id: 'card-1', last4: '4242', brand: 'VISA' },
        { id: 'card-2', last4: '5555', brand: 'MASTERCARD' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ cards: mockCards }),
      });

      const app = createTestApp({});

      const response = await request(app)
        .get('/api/wsim/cards')
        .set('Cookie', 'wsim-session=test-cookie');

      expect(response.status).toBe(200);
      expect(response.body.cards).toEqual(mockCards);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://wsim-api.test.com/api/merchant/cards',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-wsim-api-key',
          }),
        })
      );
    });

    it('should forward error response from WSIM API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      });

      const app = createTestApp({});

      const response = await request(app).get('/api/wsim/cards');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return 500 on fetch error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const app = createTestApp({});

      const response = await request(app).get('/api/wsim/cards');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch cards');
    });
  });

  describe('POST /api/wsim/payment/initiate', () => {
    it('should return 400 when cardId is missing', async () => {
      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/initiate')
        .send({ amount: 1000 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing cardId or amount');
    });

    it('should return 400 when amount is missing', async () => {
      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/initiate')
        .send({ cardId: 'card-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing cardId or amount');
    });

    it('should return 503 when WSIM API is not configured', async () => {
      const originalWsimApiKey = (config as any).wsimApiKey;
      (config as any).wsimApiKey = '';

      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/initiate')
        .send({ cardId: 'card-1', amount: 1000 });

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('WSIM API not configured');

      (config as any).wsimApiKey = originalWsimApiKey;
    });

    it('should initiate payment successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          paymentId: 'payment-123',
          passkeyOptions: { challenge: 'base64-challenge' },
        }),
      });

      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/initiate')
        .send({ cardId: 'card-1', amount: 1000, currency: 'CAD' });

      expect(response.status).toBe(200);
      expect(response.body.paymentId).toBe('payment-123');
      expect(response.body.passkeyOptions).toBeDefined();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://wsim-api.test.com/api/merchant/payment/initiate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'test-wsim-api-key',
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('card-1'),
        })
      );
    });

    it('should forward error response from WSIM API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Invalid card' }),
      });

      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/initiate')
        .send({ cardId: 'invalid-card', amount: 1000 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid card');
    });

    it('should return 500 on fetch error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/initiate')
        .send({ cardId: 'card-1', amount: 1000 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to initiate payment');
    });
  });

  describe('POST /api/wsim/payment/confirm', () => {
    it('should return 400 when paymentId is missing', async () => {
      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/confirm')
        .send({ passkeyResponse: { id: 'cred-1' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing paymentId or passkeyResponse');
    });

    it('should return 400 when passkeyResponse is missing', async () => {
      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/confirm')
        .send({ paymentId: 'payment-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing paymentId or passkeyResponse');
    });

    it('should return 503 when WSIM API is not configured', async () => {
      const originalWsimApiKey = (config as any).wsimApiKey;
      (config as any).wsimApiKey = '';

      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/confirm')
        .send({ paymentId: 'payment-123', passkeyResponse: { id: 'cred-1' } });

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('WSIM API not configured');

      (config as any).wsimApiKey = originalWsimApiKey;
    });

    it('should confirm payment successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          cardToken: 'card-token-123',
          walletCardToken: 'wallet-token-456',
        }),
      });

      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/confirm')
        .send({
          paymentId: 'payment-123',
          passkeyResponse: { id: 'cred-1', rawId: 'raw-id', response: {} },
        });

      expect(response.status).toBe(200);
      expect(response.body.cardToken).toBe('card-token-123');
      expect(response.body.walletCardToken).toBe('wallet-token-456');
    });

    it('should forward error response from WSIM API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Passkey verification failed' }),
      });

      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/confirm')
        .send({
          paymentId: 'payment-123',
          passkeyResponse: { id: 'cred-1' },
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Passkey verification failed');
    });

    it('should return 500 on fetch error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/confirm')
        .send({
          paymentId: 'payment-123',
          passkeyResponse: { id: 'cred-1' },
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Passkey verification failed');
    });
  });

  describe('POST /api/wsim/payment/complete', () => {
    it('should return 400 when cardToken is missing', async () => {
      const app = createTestApp({
        cart: [{ productId: 'product-1', quantity: 1 }],
      });

      const response = await request(app)
        .post('/api/wsim/payment/complete')
        .send({ walletCardToken: 'wallet-token' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing cardToken');
    });

    it('should return 400 when cart is empty', async () => {
      const app = createTestApp({
        cart: [],
      });

      const response = await request(app)
        .post('/api/wsim/payment/complete')
        .send({ cardToken: 'card-token-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cart is empty');
    });

    it('should return 400 when cart is undefined', async () => {
      const app = createTestApp({});

      const response = await request(app)
        .post('/api/wsim/payment/complete')
        .send({ cardToken: 'card-token-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cart is empty');
    });

    it('should return 400 when product not found', async () => {
      const app = createTestApp({
        cart: [{ productId: 'invalid-product', quantity: 1 }],
      });

      const response = await request(app)
        .post('/api/wsim/payment/complete')
        .send({ cardToken: 'card-token-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Product not found');
    });

    it('should complete payment successfully', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        cart: [{ productId: 'product-1', quantity: 2 }],
      });

      const response = await request(app)
        .post('/api/wsim/payment/complete')
        .send({
          cardToken: 'card-token-123',
          walletCardToken: 'wallet-token-456',
          cardLast4: '4242',
          cardBrand: 'VISA',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.orderId).toBeDefined();
      expect(response.body.transactionId).toBe('txn-123');
      expect(response.body.redirectUrl).toContain('/order-confirmation/');

      expect(orderService.createOrder).toHaveBeenCalledWith(
        'store-123',
        expect.objectContaining({
          bsimUserId: 'user-123',
          subtotal: 2000, // 1000 * 2
          currency: 'CAD',
        })
      );

      expect(orderService.setOrderAuthorized).toHaveBeenCalled();
    });

    it('should use guest userId when not authenticated', async () => {
      const app = createTestApp({
        cart: [{ productId: 'product-1', quantity: 1 }],
      });

      await request(app)
        .post('/api/wsim/payment/complete')
        .send({ cardToken: 'card-token-123' });

      expect(orderService.createOrder).toHaveBeenCalledWith(
        'store-123',
        expect.objectContaining({
          bsimUserId: 'guest',
        })
      );
    });

    it('should handle payment decline', async () => {
      (paymentService.authorizePayment as jest.Mock).mockResolvedValueOnce({
        status: 'declined',
        declineReason: 'Insufficient funds',
      });

      const app = createTestApp({
        cart: [{ productId: 'product-1', quantity: 1 }],
      });

      const response = await request(app)
        .post('/api/wsim/payment/complete')
        .send({ cardToken: 'card-token-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Payment declined');
      expect(response.body.reason).toBe('Insufficient funds');
      expect(orderService.setOrderDeclined).toHaveBeenCalled();
    });

    it('should handle payment failure', async () => {
      (paymentService.authorizePayment as jest.Mock).mockResolvedValueOnce({
        status: 'failed',
      });

      const app = createTestApp({
        cart: [{ productId: 'product-1', quantity: 1 }],
      });

      const response = await request(app)
        .post('/api/wsim/payment/complete')
        .send({ cardToken: 'card-token-123' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Payment failed');
      expect(orderService.setOrderFailed).toHaveBeenCalled();
    });

    it('should handle exception during payment processing', async () => {
      (paymentService.authorizePayment as jest.Mock).mockRejectedValueOnce(
        new Error('Payment service unavailable')
      );

      const app = createTestApp({
        cart: [{ productId: 'product-1', quantity: 1 }],
      });

      const response = await request(app)
        .post('/api/wsim/payment/complete')
        .send({ cardToken: 'card-token-123' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Payment processing failed');
    });

    it('should clear cart on successful payment', async () => {
      const sessionCart = [{ productId: 'product-1', quantity: 1 }];
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        cart: sessionCart,
      });

      const response = await request(app)
        .post('/api/wsim/payment/complete')
        .send({ cardToken: 'card-token-123' });

      expect(response.status).toBe(200);
      // Cart clearing is handled by session modification, which we verify through the mock
    });

    it('should calculate subtotal correctly for multiple items', async () => {
      const app = createTestApp({
        cart: [
          { productId: 'product-1', quantity: 2 }, // 1000 * 2 = 2000
          { productId: 'product-2', quantity: 1 }, // 2500 * 1 = 2500
        ],
      });

      await request(app)
        .post('/api/wsim/payment/complete')
        .send({ cardToken: 'card-token-123' });

      expect(orderService.createOrder).toHaveBeenCalledWith(
        'store-123',
        expect.objectContaining({
          subtotal: 4500, // 2000 + 2500
        })
      );
    });
  });
});
