import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import {
  getOrCreateStore,
  getStoreBranding,
  updateStoreBranding,
  getPaymentMethodSettings,
  updatePaymentMethodSettings,
} from '../services/store';
import * as productService from '../services/product';
import * as orderService from '../services/order';
import * as adminService from '../services/admin';
import { capturePayment, voidPayment, refundPayment } from '../services/payment';
import { upload, deleteUploadedFile } from '../services/upload';
import { getAllThemes, getTheme } from '../config/themes';
import type { Store } from '@prisma/client';

const router = Router();

// Store reference (cached for request lifecycle)
let currentStore: Store | null = null;

async function ensureStore(): Promise<Store> {
  if (!currentStore) {
    currentStore = await getOrCreateStore();
  }
  return currentStore;
}

// Admin authentication middleware
async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Check if admin is enabled
  if (!config.adminEnabled) {
    res.status(403).render('error', {
      title: 'Admin Disabled',
      message: 'Admin functionality is disabled',
      isAuthenticated: false,
      cartCount: 0,
    });
    return;
  }

  // Check if user is authenticated
  const userInfo = req.session.userInfo;
  if (!userInfo) {
    // Redirect to login with return URL
    req.session.adminReturnTo = req.originalUrl;
    res.redirect('/login?admin=true');
    return;
  }

  // Check if user has admin access (env-based or database-based)
  const userEmail = (userInfo.email as string)?.toLowerCase();

  try {
    const store = await ensureStore();
    const hasAccess = await adminService.isAdmin(store.id, userEmail);

    if (!hasAccess) {
      res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have admin access. Contact an administrator.',
        isAuthenticated: true,
        userInfo,
        cartCount: req.session.cart?.length || 0,
      });
      return;
    }
  } catch (err) {
    // If DB is unavailable, fall back to env-based check only
    console.warn('[Admin] Database check failed, using env-based auth only:', err);
    if (config.adminEmails.length > 0 && !config.adminEmails.includes(userEmail)) {
      res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have admin access. Contact an administrator.',
        isAuthenticated: true,
        userInfo,
        cartCount: req.session.cart?.length || 0,
      });
      return;
    }
  }

  next();
}

// Apply admin middleware to all routes
router.use(requireAdmin);

// Helper to get common view data
function getViewData(req: Request) {
  return {
    isAuthenticated: true,
    userInfo: req.session.userInfo,
    cartCount: req.session.cart?.length || 0,
    isAdmin: true,
  };
}

// =============================================================================
// Admin Dashboard
// =============================================================================

router.get('/', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const [productStats, orderStats, allOrders] = await Promise.all([
      productService.getProductStats(store.id),
      orderService.getOrderStats(store.id),
      orderService.getAllOrders(store.id),
    ]);

    const recentOrders = allOrders.slice(0, 5);

    res.render('admin/dashboard', {
      ...getViewData(req),
      title: 'Admin Dashboard',
      productStats,
      orderStats,
      recentOrders,
      formatPrice: productService.formatPrice,
      getOrderItems: orderService.getOrderItems,
      getOrderPaymentDetails: orderService.getOrderPaymentDetails,
    });
  } catch (error) {
    console.error('[Admin] Dashboard error:', error);
    res.status(500).render('error', {
      ...getViewData(req),
      title: 'Error',
      message: 'Failed to load dashboard data',
    });
  }
});

// =============================================================================
// Product Management
// =============================================================================

router.get('/products', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const [products, categories] = await Promise.all([
      productService.getAllProducts(store.id, true), // Include inactive
      productService.getCategories(store.id),
    ]);

    res.render('admin/products', {
      ...getViewData(req),
      title: 'Manage Products',
      products,
      categories,
      formatPrice: productService.formatPrice,
    });
  } catch (error) {
    console.error('[Admin] Products list error:', error);
    res.status(500).render('error', {
      ...getViewData(req),
      title: 'Error',
      message: 'Failed to load products',
    });
  }
});

router.get('/products/new', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const categories = await productService.getCategories(store.id);

    res.render('admin/product-form', {
      ...getViewData(req),
      title: 'Add Product',
      product: null,
      categories,
      isEdit: false,
    });
  } catch (error) {
    console.error('[Admin] New product form error:', error);
    res.status(500).render('error', {
      ...getViewData(req),
      title: 'Error',
      message: 'Failed to load product form',
    });
  }
});

router.post('/products', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const { name, description, price, currency, category, image } = req.body;

    // Convert price from dollars to cents
    const priceInCents = Math.round(parseFloat(price) * 100);

    await productService.createProduct(store.id, {
      name,
      description,
      price: priceInCents,
      currency: currency || 'CAD',
      category,
      image: image || undefined,
    });

    res.redirect('/admin/products?success=created');
  } catch (error) {
    console.error('[Admin] Create product error:', error);
    res.redirect('/admin/products?error=create_failed');
  }
});

router.get('/products/:id/edit', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const [product, categories] = await Promise.all([
      productService.getProductById(store.id, req.params.id),
      productService.getCategories(store.id),
    ]);

    if (!product) {
      res.redirect('/admin/products?error=notfound');
      return;
    }

    res.render('admin/product-form', {
      ...getViewData(req),
      title: 'Edit Product',
      product,
      categories,
      isEdit: true,
    });
  } catch (error) {
    console.error('[Admin] Edit product form error:', error);
    res.redirect('/admin/products?error=load_failed');
  }
});

router.post('/products/:id', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const { name, description, price, currency, category, image } = req.body;

    // Convert price from dollars to cents
    const priceInCents = Math.round(parseFloat(price) * 100);

    const updated = await productService.updateProduct(store.id, req.params.id, {
      name,
      description,
      price: priceInCents,
      currency: currency || 'CAD',
      category,
      image: image || undefined,
    });

    if (!updated) {
      res.redirect('/admin/products?error=notfound');
      return;
    }

    res.redirect('/admin/products?success=updated');
  } catch (error) {
    console.error('[Admin] Update product error:', error);
    res.redirect('/admin/products?error=update_failed');
  }
});

router.post('/products/:id/toggle', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const product = await productService.toggleProductActive(store.id, req.params.id);

    if (!product) {
      res.redirect('/admin/products?error=notfound');
      return;
    }

    res.redirect('/admin/products?success=toggled');
  } catch (error) {
    console.error('[Admin] Toggle product error:', error);
    res.redirect('/admin/products?error=toggle_failed');
  }
});

router.post('/products/:id/delete', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const deleted = await productService.deleteProduct(store.id, req.params.id);

    if (!deleted) {
      res.redirect('/admin/products?error=notfound');
      return;
    }

    res.redirect('/admin/products?success=deleted');
  } catch (error) {
    console.error('[Admin] Delete product error:', error);
    res.redirect('/admin/products?error=delete_failed');
  }
});

// =============================================================================
// Order Management
// =============================================================================

router.get('/orders', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const [orders, stats] = await Promise.all([
      orderService.getAllOrders(store.id),
      orderService.getOrderStats(store.id),
    ]);

    res.render('admin/orders', {
      ...getViewData(req),
      title: 'Manage Orders',
      orders,
      stats,
      formatPrice: productService.formatPrice,
      getOrderItems: orderService.getOrderItems,
      getOrderPaymentDetails: orderService.getOrderPaymentDetails,
    });
  } catch (error) {
    console.error('[Admin] Orders list error:', error);
    res.status(500).render('error', {
      ...getViewData(req),
      title: 'Error',
      message: 'Failed to load orders',
    });
  }
});

router.get('/orders/:id', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const order = await orderService.getOrderById(store.id, req.params.id);

    if (!order) {
      res.redirect('/admin/orders?error=notfound');
      return;
    }

    res.render('admin/order-detail', {
      ...getViewData(req),
      title: `Order ${order.id}`,
      order,
      formatPrice: productService.formatPrice,
      getOrderItems: orderService.getOrderItems,
      getOrderPaymentDetails: orderService.getOrderPaymentDetails,
    });
  } catch (error) {
    console.error('[Admin] Order detail error:', error);
    res.redirect('/admin/orders?error=load_failed');
  }
});

router.post('/orders/:id/capture', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const order = await orderService.getOrderById(store.id, req.params.id);

    if (!order) {
      res.redirect('/admin/orders?error=notfound');
      return;
    }

    const paymentDetails = orderService.getOrderPaymentDetails(order);
    if (!paymentDetails?.transactionId) {
      res.redirect('/admin/orders?error=notfound');
      return;
    }

    if (order.status !== 'authorized') {
      res.redirect(`/admin/orders/${order.id}?error=invalid_status`);
      return;
    }

    const result = await capturePayment(paymentDetails.transactionId);
    if (result.status === 'captured') {
      // NSIM returns capturedAmount in dollars, convert to cents for storage
      // Fall back to order subtotal if capturedAmount not returned
      const capturedAmountDollars = result.capturedAmount ?? (order.subtotal / 100);
      const capturedAmountCents = Math.round(capturedAmountDollars * 100);
      await orderService.setOrderCaptured(store.id, order.id, capturedAmountCents);
      res.redirect(`/admin/orders/${order.id}?success=captured`);
    } else {
      res.redirect(`/admin/orders/${order.id}?error=capture_failed`);
    }
  } catch (error) {
    console.error('[Admin] Capture error:', error);
    res.redirect(`/admin/orders/${req.params.id}?error=capture_error`);
  }
});

router.post('/orders/:id/void', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const order = await orderService.getOrderById(store.id, req.params.id);

    if (!order) {
      res.redirect('/admin/orders?error=notfound');
      return;
    }

    const paymentDetails = orderService.getOrderPaymentDetails(order);
    if (!paymentDetails?.transactionId) {
      res.redirect('/admin/orders?error=notfound');
      return;
    }

    if (order.status !== 'authorized') {
      res.redirect(`/admin/orders/${order.id}?error=invalid_status`);
      return;
    }

    const result = await voidPayment(paymentDetails.transactionId);
    if (result.status === 'voided') {
      await orderService.setOrderVoided(store.id, order.id);
      res.redirect(`/admin/orders/${order.id}?success=voided`);
    } else {
      res.redirect(`/admin/orders/${order.id}?error=void_failed`);
    }
  } catch (error) {
    console.error('[Admin] Void error:', error);
    res.redirect(`/admin/orders/${req.params.id}?error=void_error`);
  }
});

router.post('/orders/:id/refund', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const order = await orderService.getOrderById(store.id, req.params.id);

    if (!order) {
      res.redirect('/admin/orders?error=notfound');
      return;
    }

    const paymentDetails = orderService.getOrderPaymentDetails(order);
    if (!paymentDetails?.transactionId) {
      res.redirect('/admin/orders?error=notfound');
      return;
    }

    if (order.status !== 'captured') {
      res.redirect(`/admin/orders/${order.id}?error=invalid_status`);
      return;
    }

    const reason = req.body.reason || 'Admin refund';
    const amount = order.subtotal / 100; // Convert cents to dollars for API

    const result = await refundPayment(paymentDetails.transactionId, amount, reason);
    if (result.status === 'refunded') {
      await orderService.setOrderRefunded(store.id, order.id, order.subtotal);
      res.redirect(`/admin/orders/${order.id}?success=refunded`);
    } else {
      res.redirect(`/admin/orders/${order.id}?error=refund_failed`);
    }
  } catch (error) {
    console.error('[Admin] Refund error:', error);
    res.redirect(`/admin/orders/${req.params.id}?error=refund_error`);
  }
});

// =============================================================================
// Settings (placeholder for future)
// =============================================================================

router.get('/settings', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const admins = await adminService.getAllAdmins(store.id);
    const superAdmins = adminService.getSuperAdminEmails();

    res.render('admin/settings', {
      ...getViewData(req),
      title: 'Settings',
      config: {
        appBaseUrl: config.appBaseUrl,
        paymentApiUrl: config.paymentApiUrl,
        merchantId: config.merchantId,
        adminEmails: config.adminEmails,
      },
      admins,
      superAdmins,
      store,
    });
  } catch (error) {
    console.error('[Admin] Settings error:', error);
    res.status(500).render('error', {
      ...getViewData(req),
      title: 'Error',
      message: 'Failed to load settings',
    });
  }
});

// =============================================================================
// Store Branding
// =============================================================================

router.get('/branding', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const branding = await getStoreBranding(store.id);
    const themes = getAllThemes();
    const currentTheme = getTheme(branding?.themePreset || 'default');

    res.render('admin/branding', {
      ...getViewData(req),
      title: 'Store Branding',
      store,
      branding,
      themes,
      currentTheme,
      query: req.query,
    });
  } catch (error) {
    console.error('[Admin] Branding error:', error);
    res.status(500).render('error', {
      ...getViewData(req),
      title: 'Error',
      message: 'Failed to load branding settings',
    });
  }
});

router.post(
  '/branding',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'heroImage', maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const store = await ensureStore();
      const { name, tagline, description, themePreset, envBadge } = req.body;
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

      // Get current branding to check for existing files
      const currentBranding = await getStoreBranding(store.id);

      const updateData: {
        name?: string;
        tagline?: string | null;
        description?: string | null;
        themePreset?: string;
        logoUrl?: string | null;
        heroImageUrl?: string | null;
        envBadge?: string | null;
      } = {
        name: name || store.name,
        tagline: tagline || null,
        description: description || null,
        themePreset: themePreset || 'default',
        envBadge: envBadge ? envBadge.charAt(0).toUpperCase() : null,
      };

      // Handle logo upload
      if (files?.logo?.[0]) {
        // Delete old logo if exists
        if (currentBranding?.logoUrl) {
          deleteUploadedFile(currentBranding.logoUrl);
        }
        updateData.logoUrl = `/uploads/logos/${files.logo[0].filename}`;
      }

      // Handle hero image upload
      if (files?.heroImage?.[0]) {
        // Delete old hero if exists
        if (currentBranding?.heroImageUrl) {
          deleteUploadedFile(currentBranding.heroImageUrl);
        }
        updateData.heroImageUrl = `/uploads/heroes/${files.heroImage[0].filename}`;
      }

      // Handle logo removal
      if (req.body.removeLogo === 'true' && currentBranding?.logoUrl) {
        deleteUploadedFile(currentBranding.logoUrl);
        updateData.logoUrl = null;
      }

      // Handle hero removal
      if (req.body.removeHero === 'true' && currentBranding?.heroImageUrl) {
        deleteUploadedFile(currentBranding.heroImageUrl);
        updateData.heroImageUrl = null;
      }

      await updateStoreBranding(store.id, updateData);

      // Clear cached store to pick up changes
      currentStore = null;

      res.redirect('/admin/branding?success=updated');
    } catch (error) {
      console.error('[Admin] Branding update error:', error);
      res.redirect('/admin/branding?error=update_failed');
    }
  }
);

// =============================================================================
// Payment Methods Configuration
// =============================================================================

router.get('/payment-methods', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const settings = await getPaymentMethodSettings(store.id);

    res.render('admin/payment-methods', {
      ...getViewData(req),
      title: 'Payment Methods',
      settings,
      wsimConfigured: config.wsimEnabled,
      wsimMobileConfigured: config.wsimEnabled && !!config.wsimMobileApiUrl,
      bankConfigured: !!config.paymentApiUrl,
      query: req.query,
    });
  } catch (error) {
    console.error('[Admin] Payment methods error:', error);
    res.status(500).render('error', {
      ...getViewData(req),
      title: 'Error',
      message: 'Failed to load payment method settings',
    });
  }
});

router.post('/payment-methods', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();

    // Parse checkbox values (present = true, absent = false)
    // Only consider methods that are actually configured
    const bankPaymentEnabled = config.paymentApiUrl ? req.body.bankPaymentEnabled === 'true' : false;
    const walletRedirectEnabled = config.wsimEnabled ? req.body.walletRedirectEnabled === 'true' : false;
    const walletPopupEnabled = config.wsimEnabled ? req.body.walletPopupEnabled === 'true' : false;
    const walletInlineEnabled = config.wsimEnabled ? req.body.walletInlineEnabled === 'true' : false;
    const walletQuickCheckoutEnabled = config.wsimEnabled ? req.body.walletQuickCheckoutEnabled === 'true' : false;
    const walletApiEnabled = config.wsimEnabled ? req.body.walletApiEnabled === 'true' : false;
    // Mobile wallet requires both WSIM enabled and mobile API URL configured
    const walletMobileEnabled = (config.wsimEnabled && config.wsimMobileApiUrl) ? req.body.walletMobileEnabled === 'true' : false;
    // QR payment also requires mobile API URL (uses same backend)
    const qrPaymentEnabled = (config.wsimEnabled && config.wsimMobileApiUrl) ? req.body.qrPaymentEnabled === 'true' : false;

    // Validate at least one method is enabled (only count configured methods)
    // Note: qrPaymentEnabled is desktop-only alternative, not counted as primary payment method
    const anyEnabled = bankPaymentEnabled || walletRedirectEnabled || walletPopupEnabled || walletInlineEnabled || walletQuickCheckoutEnabled || walletApiEnabled || walletMobileEnabled;
    const anyConfigured = !!config.paymentApiUrl || config.wsimEnabled;

    if (anyConfigured && !anyEnabled) {
      res.redirect('/admin/payment-methods?error=at_least_one');
      return;
    }

    await updatePaymentMethodSettings(store.id, {
      bankPaymentEnabled,
      walletRedirectEnabled,
      walletPopupEnabled,
      walletInlineEnabled,
      walletQuickCheckoutEnabled,
      walletApiEnabled,
      walletMobileEnabled,
      qrPaymentEnabled,
    });

    // Clear cached store to pick up changes
    currentStore = null;

    res.redirect('/admin/payment-methods?success=updated');
  } catch (error) {
    console.error('[Admin] Payment methods update error:', error);
    res.redirect('/admin/payment-methods?error=update_failed');
  }
});

// =============================================================================
// API Endpoints for AJAX operations
// =============================================================================

router.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const [productStats, orderStats] = await Promise.all([
      productService.getProductStats(store.id),
      orderService.getOrderStats(store.id),
    ]);

    res.json({
      products: productStats,
      orders: orderStats,
    });
  } catch (error) {
    console.error('[Admin] Stats API error:', error);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

export default router;
