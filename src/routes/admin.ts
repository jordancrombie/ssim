import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  toggleProductActive,
  getProductStats,
  formatPrice,
  getCategories,
} from '../data/products';
import {
  getAllOrders,
  getOrderById,
  getOrderStats,
  setOrderCaptured,
  setOrderVoided,
  setOrderRefunded,
} from '../data/orders';
import { capturePayment, voidPayment, refundPayment } from '../services/payment';

const router = Router();

// Admin authentication middleware
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
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

  // Check if user email is in admin list (if configured)
  const userEmail = (userInfo.email as string)?.toLowerCase();
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

router.get('/', (req: Request, res: Response) => {
  const productStats = getProductStats();
  const orderStats = getOrderStats();
  const recentOrders = getAllOrders().slice(0, 5);

  res.render('admin/dashboard', {
    ...getViewData(req),
    title: 'Admin Dashboard',
    productStats,
    orderStats,
    recentOrders,
    formatPrice,
  });
});

// =============================================================================
// Product Management
// =============================================================================

router.get('/products', (req: Request, res: Response) => {
  const products = getAllProducts(true); // Include inactive
  const categories = getCategories();

  res.render('admin/products', {
    ...getViewData(req),
    title: 'Manage Products',
    products,
    categories,
    formatPrice,
  });
});

router.get('/products/new', (req: Request, res: Response) => {
  const categories = getCategories();

  res.render('admin/product-form', {
    ...getViewData(req),
    title: 'Add Product',
    product: null,
    categories,
    isEdit: false,
  });
});

router.post('/products', (req: Request, res: Response) => {
  const { name, description, price, currency, category, image } = req.body;

  // Convert price from dollars to cents
  const priceInCents = Math.round(parseFloat(price) * 100);

  createProduct({
    name,
    description,
    price: priceInCents,
    currency: currency || 'CAD',
    category,
    image: image || undefined,
  });

  res.redirect('/admin/products?success=created');
});

router.get('/products/:id/edit', (req: Request, res: Response) => {
  const product = getProductById(req.params.id);
  if (!product) {
    res.redirect('/admin/products?error=notfound');
    return;
  }

  const categories = getCategories();

  res.render('admin/product-form', {
    ...getViewData(req),
    title: 'Edit Product',
    product,
    categories,
    isEdit: true,
  });
});

router.post('/products/:id', (req: Request, res: Response) => {
  const { name, description, price, currency, category, image } = req.body;

  // Convert price from dollars to cents
  const priceInCents = Math.round(parseFloat(price) * 100);

  const updated = updateProduct(req.params.id, {
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
});

router.post('/products/:id/toggle', (req: Request, res: Response) => {
  const product = toggleProductActive(req.params.id);
  if (!product) {
    res.redirect('/admin/products?error=notfound');
    return;
  }

  res.redirect('/admin/products?success=toggled');
});

router.post('/products/:id/delete', (req: Request, res: Response) => {
  const deleted = deleteProduct(req.params.id);
  if (!deleted) {
    res.redirect('/admin/products?error=notfound');
    return;
  }

  res.redirect('/admin/products?success=deleted');
});

// =============================================================================
// Order Management
// =============================================================================

router.get('/orders', (req: Request, res: Response) => {
  const orders = getAllOrders();
  const stats = getOrderStats();

  res.render('admin/orders', {
    ...getViewData(req),
    title: 'Manage Orders',
    orders,
    stats,
    formatPrice,
  });
});

router.get('/orders/:id', (req: Request, res: Response) => {
  const order = getOrderById(req.params.id);
  if (!order) {
    res.redirect('/admin/orders?error=notfound');
    return;
  }

  res.render('admin/order-detail', {
    ...getViewData(req),
    title: `Order ${order.id}`,
    order,
    formatPrice,
  });
});

router.post('/orders/:id/capture', async (req: Request, res: Response) => {
  const order = getOrderById(req.params.id);
  if (!order || !order.paymentDetails?.transactionId) {
    res.redirect('/admin/orders?error=notfound');
    return;
  }

  if (order.status !== 'authorized') {
    res.redirect(`/admin/orders/${order.id}?error=invalid_status`);
    return;
  }

  try {
    const result = await capturePayment(order.paymentDetails.transactionId);
    if (result.status === 'captured') {
      setOrderCaptured(order.id, result.capturedAmount);
      res.redirect(`/admin/orders/${order.id}?success=captured`);
    } else {
      res.redirect(`/admin/orders/${order.id}?error=capture_failed`);
    }
  } catch (error) {
    console.error('[Admin] Capture error:', error);
    res.redirect(`/admin/orders/${order.id}?error=capture_error`);
  }
});

router.post('/orders/:id/void', async (req: Request, res: Response) => {
  const order = getOrderById(req.params.id);
  if (!order || !order.paymentDetails?.transactionId) {
    res.redirect('/admin/orders?error=notfound');
    return;
  }

  if (order.status !== 'authorized') {
    res.redirect(`/admin/orders/${order.id}?error=invalid_status`);
    return;
  }

  try {
    const result = await voidPayment(order.paymentDetails.transactionId);
    if (result.status === 'voided') {
      setOrderVoided(order.id);
      res.redirect(`/admin/orders/${order.id}?success=voided`);
    } else {
      res.redirect(`/admin/orders/${order.id}?error=void_failed`);
    }
  } catch (error) {
    console.error('[Admin] Void error:', error);
    res.redirect(`/admin/orders/${order.id}?error=void_error`);
  }
});

router.post('/orders/:id/refund', async (req: Request, res: Response) => {
  const order = getOrderById(req.params.id);
  if (!order || !order.paymentDetails?.transactionId) {
    res.redirect('/admin/orders?error=notfound');
    return;
  }

  if (order.status !== 'captured') {
    res.redirect(`/admin/orders/${order.id}?error=invalid_status`);
    return;
  }

  const reason = req.body.reason || 'Admin refund';
  const amount = order.subtotal / 100; // Convert cents to dollars for API

  try {
    const result = await refundPayment(order.paymentDetails.transactionId, amount, reason);
    if (result.status === 'refunded') {
      setOrderRefunded(order.id, order.subtotal);
      res.redirect(`/admin/orders/${order.id}?success=refunded`);
    } else {
      res.redirect(`/admin/orders/${order.id}?error=refund_failed`);
    }
  } catch (error) {
    console.error('[Admin] Refund error:', error);
    res.redirect(`/admin/orders/${order.id}?error=refund_error`);
  }
});

// =============================================================================
// Settings (placeholder for future)
// =============================================================================

router.get('/settings', (req: Request, res: Response) => {
  res.render('admin/settings', {
    ...getViewData(req),
    title: 'Settings',
    config: {
      appBaseUrl: config.appBaseUrl,
      paymentApiUrl: config.paymentApiUrl,
      merchantId: config.merchantId,
      adminEmails: config.adminEmails,
    },
  });
});

// =============================================================================
// API Endpoints for AJAX operations
// =============================================================================

router.get('/api/stats', (req: Request, res: Response) => {
  const productStats = getProductStats();
  const orderStats = getOrderStats();

  res.json({
    products: productStats,
    orders: orderStats,
  });
});

export default router;
