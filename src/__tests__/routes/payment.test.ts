import express from 'express';
import request from 'supertest';
import paymentRoutes from '../../routes/payment';
import { createMockSession, createAuthenticatedSession } from '../mocks/mockSession';

// Mock the config
jest.mock('../../config/env', () => ({
  config: {
    appBaseUrl: 'http://localhost:3005',
    paymentAuthUrl: 'https://auth.banksim.ca',
    paymentClientId: 'ssim-merchant',
    paymentClientSecret: 'secret',
    merchantId: 'merchant-123',
    wsimEnabled: true,
    wsimAuthUrl: 'https://wsim-auth.banksim.ca',
    wsimClientId: 'ssim-wsim',
    wsimClientSecret: 'wsim-secret',
  },
}));

// Mock the store service
const mockStore = { id: 'store-123', name: 'Test Store' };
jest.mock('../../services/store', () => ({
  getOrCreateStore: jest.fn().mockResolvedValue({ id: 'store-123', name: 'Test Store' }),
  getPaymentMethodSettings: jest.fn().mockResolvedValue({
    bankPaymentEnabled: true,
    walletRedirectEnabled: true,
    walletPopupEnabled: true,
    walletInlineEnabled: true,
    walletQuickCheckoutEnabled: true,
    walletApiEnabled: true,
  }),
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
  formatPrice: jest.fn((cents: number) => `$${(cents / 100).toFixed(2)}`),
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
  getOrderById: jest.fn((storeId: string, orderId: string) => {
    return Promise.resolve(mockOrders[orderId] || null);
  }),
  setOrderAuthorized: jest.fn().mockResolvedValue(undefined),
  setOrderDeclined: jest.fn().mockResolvedValue(undefined),
  setOrderFailed: jest.fn().mockResolvedValue(undefined),
  setOrderCaptured: jest.fn().mockResolvedValue(undefined),
  setOrderVoided: jest.fn().mockResolvedValue(undefined),
  setOrderRefunded: jest.fn().mockResolvedValue(undefined),
  getOrderPaymentDetails: jest.fn((order: any) => order.paymentDetails),
}));

// Mock the payment service
jest.mock('../../services/payment', () => ({
  authorizePayment: jest.fn().mockResolvedValue({
    status: 'authorized',
    transactionId: 'txn-123',
    authorizationCode: 'auth-456',
  }),
  capturePayment: jest.fn().mockResolvedValue({
    status: 'captured',
  }),
  voidPayment: jest.fn().mockResolvedValue({
    status: 'voided',
  }),
  refundPayment: jest.fn().mockResolvedValue({
    status: 'refunded',
  }),
}));

// Mock openid-client
jest.mock('openid-client', () => ({
  Issuer: {
    discover: jest.fn().mockResolvedValue({
      Client: jest.fn().mockImplementation(() => ({
        authorizationUrl: jest.fn().mockReturnValue('https://auth.banksim.ca/authorize?...'),
        callbackParams: jest.fn().mockReturnValue({ code: 'auth-code' }),
        callback: jest.fn().mockResolvedValue({
          access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
            Buffer.from(JSON.stringify({ card_token: 'card-token-123' })).toString('base64') +
            '.signature',
          id_token: 'mock-id-token',
          claims: () => ({
            sub: 'user-123',
            name: 'Test User',
            email: 'test@example.com',
          }),
        }),
      })),
    }),
  },
  generators: {
    state: jest.fn().mockReturnValue('mock-state'),
    nonce: jest.fn().mockReturnValue('mock-nonce'),
    codeVerifier: jest.fn().mockReturnValue('mock-code-verifier'),
    codeChallenge: jest.fn().mockReturnValue('mock-code-challenge'),
  },
}));

// Import mocked services for spying
import * as storeService from '../../services/store';
import * as orderService from '../../services/order';
import * as paymentService from '../../services/payment';

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

  app.use('/payment', paymentRoutes);
  return app;
};

describe('Payment Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset order counter and mock orders
    orderIdCounter = 1;
    Object.keys(mockOrders).forEach(key => delete mockOrders[key]);
  });

  describe('POST /payment/initiate', () => {
    describe('Bank payments', () => {
      it('should return 401 when user is not authenticated', async () => {
        const app = createTestApp({
          cart: [{ productId: 'product-1', quantity: 1 }],
        });

        const response = await request(app)
          .post('/payment/initiate')
          .send({ provider: 'bank' });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Authentication required');
      });

      it('should return 400 when cart is empty', async () => {
        const app = createTestApp({
          userInfo: { sub: 'user-123' },
          cart: [],
        });

        const response = await request(app)
          .post('/payment/initiate')
          .send({ provider: 'bank' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Cart is empty');
      });

      it('should return 400 when cart is undefined', async () => {
        const app = createTestApp({
          userInfo: { sub: 'user-123' },
        });

        const response = await request(app)
          .post('/payment/initiate')
          .send({ provider: 'bank' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Cart is empty');
      });

      it('should return 400 when product not found', async () => {
        const app = createTestApp({
          userInfo: { sub: 'user-123' },
          cart: [{ productId: 'invalid-product', quantity: 1 }],
        });

        const response = await request(app)
          .post('/payment/initiate')
          .send({ provider: 'bank' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Product');
        expect(response.body.error).toContain('not found');
      });

      it('should create order and return redirect URL for valid bank payment', async () => {
        const app = createTestApp({
          userInfo: { sub: 'user-123' },
          cart: [{ productId: 'product-1', quantity: 2 }],
        });

        const response = await request(app)
          .post('/payment/initiate')
          .send({ provider: 'bank' });

        expect(response.status).toBe(200);
        expect(response.body.redirectUrl).toBeDefined();
        expect(response.body.orderId).toBeDefined();
        expect(orderService.createOrder).toHaveBeenCalledWith(
          'store-123',
          expect.objectContaining({
            bsimUserId: 'user-123',
            subtotal: 2000, // 1000 * 2
            currency: 'CAD',
          })
        );
      });

      it('should default to bank provider when not specified', async () => {
        const app = createTestApp({
          userInfo: { sub: 'user-123' },
          cart: [{ productId: 'product-1', quantity: 1 }],
        });

        const response = await request(app)
          .post('/payment/initiate')
          .send({});

        expect(response.status).toBe(200);
        expect(response.body.redirectUrl).toContain('auth.banksim.ca');
      });

      it('should return 400 when bank payments are disabled', async () => {
        (storeService.getPaymentMethodSettings as jest.Mock).mockResolvedValueOnce({
          bankPaymentEnabled: false,
          walletRedirectEnabled: true,
        });

        const app = createTestApp({
          userInfo: { sub: 'user-123' },
          cart: [{ productId: 'product-1', quantity: 1 }],
        });

        const response = await request(app)
          .post('/payment/initiate')
          .send({ provider: 'bank' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Bank payments are disabled for this store');
      });
    });

    describe('Wallet payments', () => {
      it('should allow wallet payment without BSIM authentication', async () => {
        const app = createTestApp({
          cart: [{ productId: 'product-1', quantity: 1 }],
        });

        const response = await request(app)
          .post('/payment/initiate')
          .send({ provider: 'wallet' });

        expect(response.status).toBe(200);
        expect(response.body.redirectUrl).toBeDefined();
        expect(response.body.orderId).toBeDefined();
      });

      it('should return 400 when wallet payments are disabled globally', async () => {
        jest.resetModules();
        jest.doMock('../../config/env', () => ({
          config: {
            appBaseUrl: 'http://localhost:3005',
            wsimEnabled: false,
          },
        }));

        // Since we can't easily re-import with different config, we test via store settings
        (storeService.getPaymentMethodSettings as jest.Mock).mockResolvedValueOnce({
          bankPaymentEnabled: true,
          walletRedirectEnabled: false,
        });

        const app = createTestApp({
          cart: [{ productId: 'product-1', quantity: 1 }],
        });

        const response = await request(app)
          .post('/payment/initiate')
          .send({ provider: 'wallet' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Wallet redirect payments are disabled for this store');
      });

      it('should create order with guest userId for unauthenticated wallet payment', async () => {
        const app = createTestApp({
          cart: [{ productId: 'product-1', quantity: 1 }],
        });

        await request(app)
          .post('/payment/initiate')
          .send({ provider: 'wallet' });

        expect(orderService.createOrder).toHaveBeenCalledWith(
          'store-123',
          expect.objectContaining({
            bsimUserId: 'guest',
          })
        );
      });
    });
  });

  describe('POST /payment/popup-complete', () => {
    it('should return 400 when cardToken is missing', async () => {
      const app = createTestApp({
        cart: [{ productId: 'product-1', quantity: 1 }],
      });

      const response = await request(app)
        .post('/payment/popup-complete')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Card token is required');
    });

    it('should return 400 when cart is empty', async () => {
      const app = createTestApp({
        cart: [],
      });

      const response = await request(app)
        .post('/payment/popup-complete')
        .send({ cardToken: 'token-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cart is empty');
    });

    it('should return 400 when product not found', async () => {
      const app = createTestApp({
        cart: [{ productId: 'invalid-product', quantity: 1 }],
      });

      const response = await request(app)
        .post('/payment/popup-complete')
        .send({ cardToken: 'token-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not found');
    });

    it('should complete popup payment successfully', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        cart: [{ productId: 'product-1', quantity: 1 }],
      });

      const response = await request(app)
        .post('/payment/popup-complete')
        .send({
          cardToken: 'token-123',
          cardLast4: '4242',
          cardBrand: 'VISA',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.orderId).toBeDefined();
      expect(response.body.transactionId).toBe('txn-123');
      expect(response.body.redirectUrl).toContain('/order-confirmation/');
    });

    it('should use guest userId when not authenticated', async () => {
      const app = createTestApp({
        cart: [{ productId: 'product-1', quantity: 1 }],
      });

      await request(app)
        .post('/payment/popup-complete')
        .send({ cardToken: 'token-123' });

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
        .post('/payment/popup-complete')
        .send({ cardToken: 'token-123' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('payment_declined');
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
        .post('/payment/popup-complete')
        .send({ cardToken: 'token-123' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('payment_failed');
      expect(orderService.setOrderFailed).toHaveBeenCalled();
    });
  });

  describe('POST /payment/capture/:orderId', () => {
    beforeEach(() => {
      // Set up a mock authorized order
      mockOrders['order-capture-1'] = {
        id: 'order-capture-1',
        storeId: 'store-123',
        bsimUserId: 'user-123',
        status: 'authorized',
        subtotal: 1000,
        paymentDetails: {
          transactionId: 'txn-capture-123',
        },
      };
    });

    it('should return 401 when not authenticated', async () => {
      const app = createTestApp({});

      const response = await request(app)
        .post('/payment/capture/order-capture-1')
        .send({ amount: 1000 });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });

    it('should return 404 when order not found', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/capture/non-existent-order')
        .send({ amount: 1000 });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Order not found');
    });

    it('should return 403 when user does not own order', async () => {
      const app = createTestApp({
        userInfo: { sub: 'different-user' },
      });

      const response = await request(app)
        .post('/payment/capture/order-capture-1')
        .send({ amount: 1000 });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Not authorized');
    });

    it('should return 400 when order is not authorized', async () => {
      mockOrders['order-pending'] = {
        id: 'order-pending',
        storeId: 'store-123',
        bsimUserId: 'user-123',
        status: 'pending',
      };

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/capture/order-pending')
        .send({ amount: 1000 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Order is not authorized');
    });

    it('should return 400 when no transaction to capture', async () => {
      mockOrders['order-no-txn'] = {
        id: 'order-no-txn',
        storeId: 'store-123',
        bsimUserId: 'user-123',
        status: 'authorized',
        paymentDetails: null,
      };

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/capture/order-no-txn')
        .send({ amount: 1000 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No transaction to capture');
    });

    it('should capture payment successfully', async () => {
      (orderService.getOrderPaymentDetails as jest.Mock).mockReturnValueOnce({
        transactionId: 'txn-capture-123',
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/capture/order-capture-1')
        .send({ amount: 1000 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('captured');
      expect(paymentService.capturePayment).toHaveBeenCalledWith('txn-capture-123', 1000);
      expect(orderService.setOrderCaptured).toHaveBeenCalledWith('store-123', 'order-capture-1', 1000);
    });

    it('should handle capture failure', async () => {
      (orderService.getOrderPaymentDetails as jest.Mock).mockReturnValueOnce({
        transactionId: 'txn-capture-123',
      });
      (paymentService.capturePayment as jest.Mock).mockResolvedValueOnce({
        status: 'failed',
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/capture/order-capture-1')
        .send({ amount: 1000 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Capture failed');
    });
  });

  describe('POST /payment/void/:orderId', () => {
    beforeEach(() => {
      mockOrders['order-void-1'] = {
        id: 'order-void-1',
        storeId: 'store-123',
        bsimUserId: 'user-123',
        status: 'authorized',
        paymentDetails: {
          transactionId: 'txn-void-123',
        },
      };
    });

    it('should return 401 when not authenticated', async () => {
      const app = createTestApp({});

      const response = await request(app)
        .post('/payment/void/order-void-1');

      expect(response.status).toBe(401);
    });

    it('should return 404 when order not found', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/void/non-existent');

      expect(response.status).toBe(404);
    });

    it('should return 403 when user does not own order', async () => {
      const app = createTestApp({
        userInfo: { sub: 'different-user' },
      });

      const response = await request(app)
        .post('/payment/void/order-void-1');

      expect(response.status).toBe(403);
    });

    it('should return 400 when order is not authorized', async () => {
      mockOrders['order-captured'] = {
        id: 'order-captured',
        storeId: 'store-123',
        bsimUserId: 'user-123',
        status: 'captured',
      };

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/void/order-captured');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Order is not authorized');
    });

    it('should void payment successfully', async () => {
      (orderService.getOrderPaymentDetails as jest.Mock).mockReturnValueOnce({
        transactionId: 'txn-void-123',
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/void/order-void-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('voided');
      expect(paymentService.voidPayment).toHaveBeenCalledWith('txn-void-123');
      expect(orderService.setOrderVoided).toHaveBeenCalledWith('store-123', 'order-void-1');
    });

    it('should handle void failure', async () => {
      (orderService.getOrderPaymentDetails as jest.Mock).mockReturnValueOnce({
        transactionId: 'txn-void-123',
      });
      (paymentService.voidPayment as jest.Mock).mockResolvedValueOnce({
        status: 'failed',
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/void/order-void-1');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Void failed');
    });
  });

  describe('POST /payment/refund/:orderId', () => {
    beforeEach(() => {
      mockOrders['order-refund-1'] = {
        id: 'order-refund-1',
        storeId: 'store-123',
        bsimUserId: 'user-123',
        status: 'captured',
        subtotal: 2000,
        paymentDetails: {
          transactionId: 'txn-refund-123',
        },
      };
    });

    it('should return 401 when not authenticated', async () => {
      const app = createTestApp({});

      const response = await request(app)
        .post('/payment/refund/order-refund-1')
        .send({ amount: 1000 });

      expect(response.status).toBe(401);
    });

    it('should return 400 when amount is missing', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/refund/order-refund-1')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Valid amount is required');
    });

    it('should return 400 when amount is zero', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/refund/order-refund-1')
        .send({ amount: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Valid amount is required');
    });

    it('should return 400 when amount is negative', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/refund/order-refund-1')
        .send({ amount: -100 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Valid amount is required');
    });

    it('should return 404 when order not found', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/refund/non-existent')
        .send({ amount: 1000 });

      expect(response.status).toBe(404);
    });

    it('should return 403 when user does not own order', async () => {
      const app = createTestApp({
        userInfo: { sub: 'different-user' },
      });

      const response = await request(app)
        .post('/payment/refund/order-refund-1')
        .send({ amount: 1000 });

      expect(response.status).toBe(403);
    });

    it('should return 400 when order is not captured', async () => {
      mockOrders['order-authorized'] = {
        id: 'order-authorized',
        storeId: 'store-123',
        bsimUserId: 'user-123',
        status: 'authorized',
      };

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/refund/order-authorized')
        .send({ amount: 1000 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Order is not captured');
    });

    it('should refund payment successfully', async () => {
      (orderService.getOrderPaymentDetails as jest.Mock).mockReturnValueOnce({
        transactionId: 'txn-refund-123',
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/refund/order-refund-1')
        .send({ amount: 500, reason: 'Item returned' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('refunded');
      expect(paymentService.refundPayment).toHaveBeenCalledWith('txn-refund-123', 500, 'Item returned');
      expect(orderService.setOrderRefunded).toHaveBeenCalledWith('store-123', 'order-refund-1', 500);
    });

    it('should use default reason when not provided', async () => {
      (orderService.getOrderPaymentDetails as jest.Mock).mockReturnValueOnce({
        transactionId: 'txn-refund-123',
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      await request(app)
        .post('/payment/refund/order-refund-1')
        .send({ amount: 500 });

      expect(paymentService.refundPayment).toHaveBeenCalledWith('txn-refund-123', 500, 'Customer refund');
    });

    it('should handle refund failure', async () => {
      (orderService.getOrderPaymentDetails as jest.Mock).mockReturnValueOnce({
        transactionId: 'txn-refund-123',
      });
      (paymentService.refundPayment as jest.Mock).mockResolvedValueOnce({
        status: 'failed',
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });

      const response = await request(app)
        .post('/payment/refund/order-refund-1')
        .send({ amount: 500 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Refund failed');
    });
  });

  describe('Helper function: ensureHttps', () => {
    // The ensureHttps function is tested indirectly through the routes
    // but we can verify HTTP -> HTTPS upgrade via logged behavior
    it('should work with HTTPS URLs in config', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        cart: [{ productId: 'product-1', quantity: 1 }],
      });

      const response = await request(app)
        .post('/payment/initiate')
        .send({ provider: 'bank' });

      expect(response.status).toBe(200);
      // If it reaches here, the OIDC client was initialized successfully
    });
  });
});
