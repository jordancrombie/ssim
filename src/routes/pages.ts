import { Router, Request, Response } from 'express';
import { getAllProviders } from '../config/oidc';
import { config } from '../config/env';
import { getAllProducts, formatPrice } from '../data/products';
import { getOrderById, getOrdersByUserId } from '../data/orders';
import '../types/session';

const router = Router();

// Helper to get cart count
function getCartCount(req: Request): number {
  const cart = req.session.cart || [];
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}

// Home page
router.get('/', (req: Request, res: Response) => {
  const isAuthenticated = !!req.session.userInfo;
  res.render('home', {
    isAuthenticated,
    userInfo: req.session.userInfo,
  });
});

// Login page with provider selection
router.get('/login', (req: Request, res: Response) => {
  if (req.session.userInfo) {
    return res.redirect('/profile');
  }

  const providers = getAllProviders();
  res.render('login', { providers });
});

// Profile page (shows OIDC info after login)
router.get('/profile', (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.redirect('/login');
  }

  res.render('profile', {
    userInfo: req.session.userInfo,
    tokenSet: req.session.tokenSet,
    providerId: req.session.providerId,
  });
});

// KENOK page (Open Banking integration)
router.get('/kenok', (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.redirect('/login');
  }

  res.render('kenok', {
    userInfo: req.session.userInfo,
    tokenSet: req.session.tokenSet,
  });
});

// Store page
router.get('/store', (req: Request, res: Response) => {
  const products = getAllProducts();
  const isAuthenticated = !!req.session.userInfo;
  res.render('store', {
    products,
    formatPrice,
    isAuthenticated,
    userInfo: req.session.userInfo,
    cartCount: getCartCount(req),
  });
});

// Checkout page
router.get('/checkout', (req: Request, res: Response) => {
  const isAuthenticated = !!req.session.userInfo;
  res.render('checkout', {
    isAuthenticated,
    userInfo: req.session.userInfo,
    cartCount: getCartCount(req),
    wsimEnabled: config.wsimEnabled,
  });
});

// Order confirmation page
router.get('/order-confirmation/:orderId', (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.redirect('/login');
  }

  const { orderId } = req.params;
  const order = getOrderById(orderId);

  if (!order) {
    return res.status(404).render('error', { message: 'Order not found' });
  }

  // Verify the order belongs to this user
  if (order.userId !== req.session.userInfo.sub) {
    return res.status(403).render('error', { message: 'Not authorized' });
  }

  res.render('order-confirmation', {
    order,
    formatPrice,
    isAuthenticated: true,
    cartCount: getCartCount(req),
  });
});

// Order history page
router.get('/orders', (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.redirect('/login');
  }

  const userId = req.session.userInfo.sub as string;
  const orders = getOrdersByUserId(userId);

  res.render('orders', {
    orders,
    formatPrice,
    isAuthenticated: true,
    cartCount: getCartCount(req),
  });
});

// Order detail page
router.get('/orders/:orderId', (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.redirect('/login');
  }

  const { orderId } = req.params;
  const order = getOrderById(orderId);

  if (!order) {
    return res.status(404).render('error', { message: 'Order not found' });
  }

  // Verify the order belongs to this user
  if (order.userId !== req.session.userInfo.sub) {
    return res.status(403).render('error', { message: 'Not authorized' });
  }

  res.render('order-detail', {
    order,
    formatPrice,
    isAuthenticated: true,
    cartCount: getCartCount(req),
  });
});

export default router;
