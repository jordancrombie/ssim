import express from 'express';
import request from 'supertest';
import session from 'express-session';
import pageRoutes from '../../routes/pages';
import { createMockSession, createAuthenticatedSession } from '../mocks/mockSession';

// Mock the oidc module
jest.mock('../../config/oidc', () => ({
  getAllProviders: jest.fn().mockReturnValue([
    { id: 'bsim', name: 'BSIM Bank' },
  ]),
}));

// Mock the config
jest.mock('../../config/env', () => ({
  config: {
    wsimEnabled: true,
    wsimPopupUrl: 'https://wsim.example.com/popup',
    wsimApiUrl: 'https://wsim.example.com/api',
    wsimApiKey: 'test-api-key',
  },
}));

// Mock the store service
jest.mock('../../services/store', () => ({
  getOrCreateStore: jest.fn().mockResolvedValue({
    id: 'store-123',
    name: 'Test Store',
  }),
  getStoreBranding: jest.fn().mockResolvedValue({
    name: 'Test Store',
    tagline: 'Best store ever',
    themePreset: 'default',
  }),
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
jest.mock('../../services/product', () => ({
  getAllProducts: jest.fn().mockResolvedValue([
    { id: 'product-1', name: 'Product 1', price: 1000, active: true },
    { id: 'product-2', name: 'Product 2', price: 2000, active: true },
  ]),
  formatPrice: jest.fn((cents: number) => `$${(cents / 100).toFixed(2)}`),
}));

// Mock the order service
jest.mock('../../services/order', () => ({
  getOrderById: jest.fn((storeId: string, orderId: string) => {
    const baseOrder = {
      id: 'order-123',
      bsimUserId: 'user-123',
      status: 'completed',
      total: 5000,
      items: [],
    };
    if (orderId === 'order-123') return Promise.resolve(baseOrder);
    if (orderId === 'guest-order') return Promise.resolve({ ...baseOrder, id: 'guest-order', bsimUserId: 'guest' });
    return Promise.resolve(null);
  }),
  getOrdersByUserId: jest.fn().mockResolvedValue([{
    id: 'order-123',
    bsimUserId: 'user-123',
    status: 'completed',
    total: 5000,
    items: [],
  }]),
  getOrderItems: jest.fn().mockReturnValue([]),
  getOrderPaymentDetails: jest.fn().mockReturnValue({}),
}));

// Mock the theme helper
jest.mock('../../helpers/theme', () => ({
  generateThemeCSS: jest.fn().mockReturnValue('/* theme css */'),
}));

// Create test app
const createTestApp = (sessionData: any = {}) => {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', 'src/views');

  // Mock session middleware
  app.use((req, res, next) => {
    req.session = createMockSession(sessionData) as any;
    next();
  });

  // Mock render to just return the template name and data
  app.use((req, res, next) => {
    res.render = ((view: string, options: any = {}) => {
      res.json({ view, options });
    }) as any;
    next();
  });

  app.use('/', pageRoutes);
  return app;
};

describe('Page Routes', () => {
  describe('GET /', () => {
    it('should render home page', async () => {
      const app = createTestApp();
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('homepage');
    });

    it('should pass isAuthenticated: false when not logged in', async () => {
      const app = createTestApp();
      const response = await request(app).get('/');

      expect(response.body.options.isAuthenticated).toBe(false);
    });

    it('should pass isAuthenticated: true when logged in', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123', name: 'Test User' },
      });
      const response = await request(app).get('/');

      expect(response.body.options.isAuthenticated).toBe(true);
    });

    it('should pass userInfo when logged in', async () => {
      const userInfo = { sub: 'user-123', name: 'Test User' };
      const app = createTestApp({ userInfo });
      const response = await request(app).get('/');

      expect(response.body.options.userInfo).toEqual(userInfo);
    });
  });

  describe('GET /login', () => {
    it('should render login page when not authenticated', async () => {
      const app = createTestApp();
      const response = await request(app).get('/login');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('login');
    });

    it('should redirect to /profile when already authenticated', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });
      const response = await request(app).get('/login');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/profile');
    });

    it('should pass providers list to template', async () => {
      const app = createTestApp();
      const response = await request(app).get('/login');

      expect(response.body.options.providers).toBeDefined();
      expect(response.body.options.providers).toHaveLength(1);
      expect(response.body.options.providers[0].id).toBe('bsim');
    });
  });

  describe('GET /profile', () => {
    it('should redirect to /login when not authenticated', async () => {
      const app = createTestApp();
      const response = await request(app).get('/profile');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    it('should render profile when authenticated', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123', name: 'Test User' },
        tokenSet: { access_token: 'token123' },
        providerId: 'bsim',
      });
      const response = await request(app).get('/profile');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('profile');
    });

    it('should pass userInfo, tokenSet, and providerId to template', async () => {
      const userInfo = { sub: 'user-123', name: 'Test User' };
      const tokenSet = { access_token: 'token123' };
      const providerId = 'bsim';

      const app = createTestApp({ userInfo, tokenSet, providerId });
      const response = await request(app).get('/profile');

      expect(response.body.options.userInfo).toEqual(userInfo);
      expect(response.body.options.tokenSet).toEqual(tokenSet);
      expect(response.body.options.providerId).toBe(providerId);
    });
  });

  describe('GET /kenok', () => {
    it('should redirect to /login when not authenticated', async () => {
      const app = createTestApp();
      const response = await request(app).get('/kenok');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    it('should render kenok page when authenticated', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        tokenSet: { access_token: 'token123' },
      });
      const response = await request(app).get('/kenok');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('kenok');
    });

    it('should pass userInfo and tokenSet to template', async () => {
      const userInfo = { sub: 'user-123', name: 'Test User' };
      const tokenSet = { access_token: 'token123', scope: 'openid profile' };

      const app = createTestApp({ userInfo, tokenSet });
      const response = await request(app).get('/kenok');

      expect(response.body.options.userInfo).toEqual(userInfo);
      expect(response.body.options.tokenSet).toEqual(tokenSet);
    });
  });

  describe('GET /demo', () => {
    it('should render demo page', async () => {
      const app = createTestApp();
      const response = await request(app).get('/demo');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('demo');
    });

    it('should pass isAuthenticated: false when not logged in', async () => {
      const app = createTestApp();
      const response = await request(app).get('/demo');

      expect(response.body.options.isAuthenticated).toBe(false);
    });

    it('should pass isAuthenticated: true when logged in', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });
      const response = await request(app).get('/demo');

      expect(response.body.options.isAuthenticated).toBe(true);
    });
  });

  describe('GET /store', () => {
    it('should render store page', async () => {
      const app = createTestApp();
      const response = await request(app).get('/store');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('store');
    });

    it('should pass products to template', async () => {
      const app = createTestApp();
      const response = await request(app).get('/store');

      expect(response.body.options.products).toBeDefined();
      expect(response.body.options.products).toHaveLength(2);
    });

    it('should pass store branding', async () => {
      const app = createTestApp();
      const response = await request(app).get('/store');

      expect(response.body.options.store).toBeDefined();
      expect(response.body.options.store.name).toBe('Test Store');
    });

    it('should pass cartCount', async () => {
      const app = createTestApp({
        cart: [
          { productId: 'product-1', quantity: 2 },
          { productId: 'product-2', quantity: 3 },
        ],
      });
      const response = await request(app).get('/store');

      expect(response.body.options.cartCount).toBe(5);
    });
  });

  describe('GET /checkout', () => {
    it('should render checkout page', async () => {
      const app = createTestApp();
      const response = await request(app).get('/checkout');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('checkout');
    });

    it('should pass wsim configuration', async () => {
      const app = createTestApp();
      const response = await request(app).get('/checkout');

      expect(response.body.options.wsimEnabled).toBe(true);
      expect(response.body.options.wsimPopupUrl).toBe('https://wsim.example.com/popup');
      expect(response.body.options.wsimApiUrl).toBe('https://wsim.example.com/api');
    });

    it('should pass payment settings', async () => {
      const app = createTestApp();
      const response = await request(app).get('/checkout');

      expect(response.body.options.paymentSettings).toBeDefined();
      expect(response.body.options.paymentSettings.bankPaymentEnabled).toBe(true);
      expect(response.body.options.paymentSettings.walletPopupEnabled).toBe(true);
    });
  });

  describe('GET /order-confirmation/:orderId', () => {
    it('should render order confirmation for owner', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });
      const response = await request(app).get('/order-confirmation/order-123');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('order-confirmation');
    });

    it('should render order confirmation for guest order without login', async () => {
      const app = createTestApp({});
      const response = await request(app).get('/order-confirmation/guest-order');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('order-confirmation');
    });

    it('should return 404 for non-existent order', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });
      const response = await request(app).get('/order-confirmation/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should redirect to login for non-guest order when not authenticated', async () => {
      const app = createTestApp({});
      const response = await request(app).get('/order-confirmation/order-123');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    it('should return 403 when user does not own the order', async () => {
      const app = createTestApp({
        userInfo: { sub: 'different-user' },
      });
      const response = await request(app).get('/order-confirmation/order-123');

      expect(response.status).toBe(403);
    });
  });

  describe('GET /orders', () => {
    it('should redirect to login when not authenticated', async () => {
      const app = createTestApp();
      const response = await request(app).get('/orders');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    it('should render orders page when authenticated', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });
      const response = await request(app).get('/orders');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('orders');
    });

    it('should pass orders to template', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });
      const response = await request(app).get('/orders');

      expect(response.body.options.orders).toBeDefined();
    });
  });

  describe('GET /orders/:orderId', () => {
    it('should redirect to login when not authenticated', async () => {
      const app = createTestApp();
      const response = await request(app).get('/orders/order-123');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    it('should render order detail for owner', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });
      const response = await request(app).get('/orders/order-123');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('order-detail');
    });

    it('should return 404 for non-existent order', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });
      const response = await request(app).get('/orders/nonexistent');

      expect(response.status).toBe(404);
    });

    it('should return 403 when user does not own the order', async () => {
      const app = createTestApp({
        userInfo: { sub: 'different-user' },
      });
      const response = await request(app).get('/orders/order-123');

      expect(response.status).toBe(403);
    });
  });

  describe('GET /wsim-diagnostic', () => {
    it('should render wsim diagnostic page', async () => {
      const app = createTestApp();
      const response = await request(app).get('/wsim-diagnostic');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('wsim-diagnostic');
    });

    it('should pass wsim configuration', async () => {
      const app = createTestApp();
      const response = await request(app).get('/wsim-diagnostic');

      expect(response.body.options.wsimEnabled).toBe(true);
      expect(response.body.options.wsimApiUrl).toBe('https://wsim.example.com/api');
      expect(response.body.options.wsimApiKey).toBe('test-api-key');
    });
  });

  describe('GET /login with returnTo', () => {
    it('should pass returnTo to template', async () => {
      const app = createTestApp();
      const response = await request(app).get('/login?returnTo=/checkout');

      expect(response.body.options.returnTo).toBe('/checkout');
    });

    it('should ignore invalid returnTo (not starting with /)', async () => {
      const app = createTestApp();
      const response = await request(app).get('/login?returnTo=http://evil.com');

      expect(response.body.options.returnTo).toBe('');
    });

    it('should redirect to returnTo when already authenticated', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });
      const response = await request(app).get('/login?returnTo=/checkout');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/checkout');
    });
  });
});
