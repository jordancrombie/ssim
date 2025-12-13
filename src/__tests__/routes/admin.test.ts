import express from 'express';
import request from 'supertest';
import adminRoutes from '../../routes/admin';
import { createMockSession } from '../mocks/mockSession';

// Mock the config
jest.mock('../../config/env', () => ({
  config: {
    adminEnabled: true,
    adminEmails: ['admin@example.com'],
    appBaseUrl: 'http://localhost:3005',
    paymentApiUrl: 'https://payment.banksim.ca',
    merchantId: 'merchant-123',
    wsimEnabled: true,
    paymentApiKey: 'test-api-key',
  },
}));

// Mock the store service
const mockStore = {
  id: 'store-123',
  name: 'Test Store',
  domain: 'test.store.com',
  bankPaymentEnabled: true,
  walletRedirectEnabled: true,
  walletPopupEnabled: true,
  walletInlineEnabled: true,
  walletQuickCheckoutEnabled: true,
  walletApiEnabled: true,
};

jest.mock('../../services/store', () => ({
  getOrCreateStore: jest.fn().mockResolvedValue({
    id: 'store-123',
    name: 'Test Store',
    domain: 'test.store.com',
  }),
  getStoreBranding: jest.fn().mockResolvedValue({
    name: 'Test Store',
    tagline: 'Best store ever',
    description: 'A great store',
    logoUrl: null,
    heroImageUrl: null,
    themePreset: 'default',
    envBadge: 'D',
  }),
  updateStoreBranding: jest.fn().mockResolvedValue({
    id: 'store-123',
    name: 'Test Store',
    domain: 'test.store.com',
  }),
  getPaymentMethodSettings: jest.fn().mockResolvedValue({
    bankPaymentEnabled: true,
    walletRedirectEnabled: true,
    walletPopupEnabled: true,
    walletInlineEnabled: true,
    walletQuickCheckoutEnabled: true,
    walletApiEnabled: true,
  }),
  updatePaymentMethodSettings: jest.fn().mockResolvedValue({
    id: 'store-123',
    name: 'Test Store',
    domain: 'test.store.com',
  }),
}));

// Mock product service
const mockProducts = [
  { id: 'product-1', name: 'Product 1', price: 1000, active: true, category: 'Electronics' },
  { id: 'product-2', name: 'Product 2', price: 2000, active: false, category: 'Books' },
];

jest.mock('../../services/product', () => ({
  getAllProducts: jest.fn().mockResolvedValue([
    { id: 'product-1', name: 'Product 1', price: 1000, active: true },
    { id: 'product-2', name: 'Product 2', price: 2000, active: false },
  ]),
  getProductById: jest.fn((storeId: string, productId: string) => {
    if (productId === 'product-1') {
      return Promise.resolve({ id: 'product-1', name: 'Product 1', price: 1000, active: true });
    }
    return Promise.resolve(null);
  }),
  getCategories: jest.fn().mockResolvedValue(['Electronics', 'Books', 'Clothing']),
  getProductStats: jest.fn().mockResolvedValue({ total: 10, active: 8 }),
  createProduct: jest.fn().mockResolvedValue({ id: 'product-new', name: 'New Product' }),
  updateProduct: jest.fn((storeId: string, productId: string, data: any) => {
    if (productId === 'product-1') {
      return Promise.resolve({ id: 'product-1', ...data });
    }
    return Promise.resolve(null);
  }),
  toggleProductActive: jest.fn((storeId: string, productId: string) => {
    if (productId === 'product-1') {
      return Promise.resolve({ id: 'product-1', active: false });
    }
    return Promise.resolve(null);
  }),
  deleteProduct: jest.fn((storeId: string, productId: string) => {
    return Promise.resolve(productId === 'product-1');
  }),
  formatPrice: jest.fn((cents: number) => `$${(cents / 100).toFixed(2)}`),
}));

// Mock order service
const mockOrders: Record<string, any> = {
  'order-1': {
    id: 'order-1',
    status: 'authorized',
    subtotal: 1000,
    paymentDetails: { transactionId: 'txn-123' },
  },
  'order-captured': {
    id: 'order-captured',
    status: 'captured',
    subtotal: 2000,
    paymentDetails: { transactionId: 'txn-456' },
  },
};

jest.mock('../../services/order', () => ({
  getAllOrders: jest.fn().mockResolvedValue([
    { id: 'order-1', status: 'authorized', subtotal: 1000 },
    { id: 'order-2', status: 'captured', subtotal: 2000 },
  ]),
  getOrderById: jest.fn((storeId: string, orderId: string) => {
    return Promise.resolve(mockOrders[orderId] || null);
  }),
  getOrderStats: jest.fn().mockResolvedValue({
    total: 50,
    authorized: 5,
    captured: 40,
    revenue: 50000,
  }),
  getOrderItems: jest.fn().mockReturnValue([]),
  getOrderPaymentDetails: jest.fn((order: any) => order?.paymentDetails || null),
  setOrderCaptured: jest.fn().mockResolvedValue(undefined),
  setOrderVoided: jest.fn().mockResolvedValue(undefined),
  setOrderRefunded: jest.fn().mockResolvedValue(undefined),
}));

// Mock admin service
jest.mock('../../services/admin', () => ({
  isAdmin: jest.fn((storeId: string, email: string) => {
    return Promise.resolve(email === 'admin@example.com');
  }),
  getAllAdmins: jest.fn().mockResolvedValue([
    { id: 'admin-1', email: 'admin@example.com', role: 'admin', isActive: true },
  ]),
  getSuperAdminEmails: jest.fn().mockReturnValue(['admin@example.com']),
}));

// Mock payment service
jest.mock('../../services/payment', () => ({
  capturePayment: jest.fn().mockResolvedValue({ status: 'captured', capturedAmount: 1000 }),
  voidPayment: jest.fn().mockResolvedValue({ status: 'voided' }),
  refundPayment: jest.fn().mockResolvedValue({ status: 'refunded' }),
}));

// Mock upload service
jest.mock('../../services/upload', () => ({
  upload: {
    fields: jest.fn().mockReturnValue((req: any, res: any, next: any) => next()),
  },
  deleteUploadedFile: jest.fn(),
}));

// Mock themes
jest.mock('../../config/themes', () => ({
  getAllThemes: jest.fn().mockReturnValue([
    { id: 'default', name: 'Default', primary: '#7c3aed' },
    { id: 'amazon', name: 'Amazon', primary: '#ff9900' },
  ]),
  getTheme: jest.fn().mockReturnValue({ id: 'default', name: 'Default', primary: '#7c3aed' }),
}));

import * as storeService from '../../services/store';
import * as productService from '../../services/product';
import * as orderService from '../../services/order';
import * as paymentService from '../../services/payment';

// Create test app with admin session
const createTestApp = (sessionData: any = {}) => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.set('view engine', 'ejs');
  app.set('views', 'src/views');

  // Mock render to avoid needing actual EJS templates
  app.use((req, res, next) => {
    res.render = jest.fn((view: string, options?: any) => {
      res.json({ view, ...options });
    }) as any;
    next();
  });

  // Mock session middleware
  app.use((req, res, next) => {
    req.session = createMockSession(sessionData) as any;
    next();
  });

  app.use('/admin', adminRoutes);
  return app;
};

// Create app with admin user session
const createAdminApp = (overrides: any = {}) => {
  return createTestApp({
    userInfo: {
      sub: 'user-123',
      email: 'admin@example.com',
      name: 'Admin User',
    },
    ...overrides,
  });
};

describe('Admin Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requireAdmin middleware', () => {
    it('should redirect to login when not authenticated', async () => {
      const app = createTestApp({});
      const response = await request(app).get('/admin');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login?admin=true');
    });

    it('should deny access for non-admin users', async () => {
      const app = createTestApp({
        userInfo: {
          sub: 'user-456',
          email: 'regular@example.com',
          name: 'Regular User',
        },
      });

      const response = await request(app).get('/admin');

      expect(response.status).toBe(403);
      expect(response.body.view).toBe('error');
      expect(response.body.message).toContain('do not have admin access');
    });

    it('should allow access for admin users', async () => {
      const app = createAdminApp();
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/dashboard');
    });
  });

  describe('GET /admin (Dashboard)', () => {
    it('should render dashboard with stats', async () => {
      const app = createAdminApp();
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/dashboard');
      expect(response.body.productStats).toBeDefined();
      expect(response.body.orderStats).toBeDefined();
      expect(response.body.recentOrders).toBeDefined();
    });
  });

  describe('Product Management', () => {
    describe('GET /admin/products', () => {
      it('should list all products', async () => {
        const app = createAdminApp();
        const response = await request(app).get('/admin/products');

        expect(response.status).toBe(200);
        expect(response.body.view).toBe('admin/products');
        expect(response.body.products).toBeDefined();
        expect(response.body.categories).toBeDefined();
      });
    });

    describe('GET /admin/products/new', () => {
      it('should render new product form', async () => {
        const app = createAdminApp();
        const response = await request(app).get('/admin/products/new');

        expect(response.status).toBe(200);
        expect(response.body.view).toBe('admin/product-form');
        expect(response.body.isEdit).toBe(false);
        expect(response.body.product).toBeNull();
      });
    });

    describe('POST /admin/products', () => {
      it('should create a new product', async () => {
        const app = createAdminApp();
        const response = await request(app)
          .post('/admin/products')
          .send({
            name: 'New Product',
            description: 'A new product',
            price: '19.99',
            currency: 'CAD',
            category: 'Electronics',
          });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/products?success=created');
        expect(productService.createProduct).toHaveBeenCalledWith(
          'store-123',
          expect.objectContaining({
            name: 'New Product',
            price: 1999, // Converted to cents
          })
        );
      });
    });

    describe('GET /admin/products/:id/edit', () => {
      it('should render edit form for existing product', async () => {
        const app = createAdminApp();
        const response = await request(app).get('/admin/products/product-1/edit');

        expect(response.status).toBe(200);
        expect(response.body.view).toBe('admin/product-form');
        expect(response.body.isEdit).toBe(true);
        expect(response.body.product).toBeDefined();
      });

      it('should redirect for non-existent product', async () => {
        const app = createAdminApp();
        const response = await request(app).get('/admin/products/non-existent/edit');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/products?error=notfound');
      });
    });

    describe('POST /admin/products/:id', () => {
      it('should update existing product', async () => {
        const app = createAdminApp();
        const response = await request(app)
          .post('/admin/products/product-1')
          .send({
            name: 'Updated Product',
            price: '29.99',
          });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/products?success=updated');
      });

      it('should redirect for non-existent product', async () => {
        const app = createAdminApp();
        const response = await request(app)
          .post('/admin/products/non-existent')
          .send({ name: 'Updated' });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/products?error=notfound');
      });
    });

    describe('POST /admin/products/:id/toggle', () => {
      it('should toggle product active status', async () => {
        const app = createAdminApp();
        const response = await request(app).post('/admin/products/product-1/toggle');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/products?success=toggled');
      });

      it('should redirect for non-existent product', async () => {
        const app = createAdminApp();
        const response = await request(app).post('/admin/products/non-existent/toggle');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/products?error=notfound');
      });
    });

    describe('POST /admin/products/:id/delete', () => {
      it('should delete product', async () => {
        const app = createAdminApp();
        const response = await request(app).post('/admin/products/product-1/delete');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/products?success=deleted');
      });

      it('should redirect for non-existent product', async () => {
        const app = createAdminApp();
        const response = await request(app).post('/admin/products/non-existent/delete');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/products?error=notfound');
      });
    });
  });

  describe('Order Management', () => {
    describe('GET /admin/orders', () => {
      it('should list all orders', async () => {
        const app = createAdminApp();
        const response = await request(app).get('/admin/orders');

        expect(response.status).toBe(200);
        expect(response.body.view).toBe('admin/orders');
        expect(response.body.orders).toBeDefined();
        expect(response.body.stats).toBeDefined();
      });
    });

    describe('GET /admin/orders/:id', () => {
      it('should show order details', async () => {
        const app = createAdminApp();
        const response = await request(app).get('/admin/orders/order-1');

        expect(response.status).toBe(200);
        expect(response.body.view).toBe('admin/order-detail');
        expect(response.body.order).toBeDefined();
      });

      it('should redirect for non-existent order', async () => {
        const app = createAdminApp();
        const response = await request(app).get('/admin/orders/non-existent');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/orders?error=notfound');
      });
    });

    describe('POST /admin/orders/:id/capture', () => {
      it('should capture authorized order', async () => {
        const app = createAdminApp();
        const response = await request(app).post('/admin/orders/order-1/capture');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/orders/order-1?success=captured');
        expect(paymentService.capturePayment).toHaveBeenCalledWith('txn-123');
      });

      it('should fail for non-existent order', async () => {
        const app = createAdminApp();
        const response = await request(app).post('/admin/orders/non-existent/capture');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/orders?error=notfound');
      });

      it('should fail for already captured order', async () => {
        const app = createAdminApp();
        const response = await request(app).post('/admin/orders/order-captured/capture');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/orders/order-captured?error=invalid_status');
      });
    });

    describe('POST /admin/orders/:id/void', () => {
      it('should void authorized order', async () => {
        const app = createAdminApp();
        const response = await request(app).post('/admin/orders/order-1/void');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/orders/order-1?success=voided');
        expect(paymentService.voidPayment).toHaveBeenCalledWith('txn-123');
      });

      it('should fail for captured order', async () => {
        const app = createAdminApp();
        const response = await request(app).post('/admin/orders/order-captured/void');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/orders/order-captured?error=invalid_status');
      });
    });

    describe('POST /admin/orders/:id/refund', () => {
      it('should refund captured order', async () => {
        const app = createAdminApp();
        const response = await request(app)
          .post('/admin/orders/order-captured/refund')
          .send({ reason: 'Customer request' });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/orders/order-captured?success=refunded');
        expect(paymentService.refundPayment).toHaveBeenCalledWith('txn-456', 20, 'Customer request');
      });

      it('should fail for authorized (not captured) order', async () => {
        const app = createAdminApp();
        const response = await request(app).post('/admin/orders/order-1/refund');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/orders/order-1?error=invalid_status');
      });
    });
  });

  describe('Settings', () => {
    describe('GET /admin/settings', () => {
      it('should render settings page', async () => {
        const app = createAdminApp();
        const response = await request(app).get('/admin/settings');

        expect(response.status).toBe(200);
        expect(response.body.view).toBe('admin/settings');
        expect(response.body.config).toBeDefined();
        expect(response.body.admins).toBeDefined();
      });
    });
  });

  describe('Branding', () => {
    describe('GET /admin/branding', () => {
      it('should render branding page', async () => {
        const app = createAdminApp();
        const response = await request(app).get('/admin/branding');

        expect(response.status).toBe(200);
        expect(response.body.view).toBe('admin/branding');
        expect(response.body.branding).toBeDefined();
        expect(response.body.themes).toBeDefined();
      });
    });

    describe('POST /admin/branding', () => {
      it('should update branding', async () => {
        const app = createAdminApp();
        const response = await request(app)
          .post('/admin/branding')
          .send({
            name: 'Updated Store',
            tagline: 'New tagline',
            themePreset: 'amazon',
            envBadge: 'P',
          });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/branding?success=updated');
        expect(storeService.updateStoreBranding).toHaveBeenCalled();
      });
    });
  });

  describe('Payment Methods', () => {
    describe('GET /admin/payment-methods', () => {
      it('should render payment methods page', async () => {
        const app = createAdminApp();
        const response = await request(app).get('/admin/payment-methods');

        expect(response.status).toBe(200);
        expect(response.body.view).toBe('admin/payment-methods');
        expect(response.body.settings).toBeDefined();
        expect(response.body.wsimConfigured).toBe(true);
        expect(response.body.bankConfigured).toBe(true);
      });
    });

    describe('POST /admin/payment-methods', () => {
      it('should update payment method settings', async () => {
        const app = createAdminApp();
        const response = await request(app)
          .post('/admin/payment-methods')
          .send({
            bankPaymentEnabled: 'true',
            walletRedirectEnabled: 'true',
            walletPopupEnabled: 'false',
            walletInlineEnabled: 'true',
            walletQuickCheckoutEnabled: 'true',
            walletApiEnabled: 'true',
          });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/payment-methods?success=updated');
        expect(storeService.updatePaymentMethodSettings).toHaveBeenCalledWith(
          'store-123',
          expect.objectContaining({
            bankPaymentEnabled: true,
            walletRedirectEnabled: true,
            walletPopupEnabled: false,
          })
        );
      });

      it('should reject when no payment method is enabled', async () => {
        const app = createAdminApp();
        const response = await request(app)
          .post('/admin/payment-methods')
          .send({
            bankPaymentEnabled: 'false',
            walletRedirectEnabled: 'false',
            walletPopupEnabled: 'false',
            walletInlineEnabled: 'false',
            walletQuickCheckoutEnabled: 'false',
            walletApiEnabled: 'false',
          });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/admin/payment-methods?error=at_least_one');
      });
    });
  });

  describe('API Endpoints', () => {
    describe('GET /admin/api/stats', () => {
      it('should return stats JSON', async () => {
        const app = createAdminApp();
        const response = await request(app).get('/admin/api/stats');

        expect(response.status).toBe(200);
        expect(response.body.products).toBeDefined();
        expect(response.body.orders).toBeDefined();
      });
    });
  });
});
