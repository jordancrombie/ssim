import { Router, Request, Response } from 'express';
import { getAllProviders } from '../config/oidc';
import { config } from '../config/env';
import { getOrCreateStore } from '../services/store';
import * as productService from '../services/product';
import * as orderService from '../services/order';
import type { Store } from '@prisma/client';
import '../types/session';

const router = Router();

// Store reference (cached for request lifecycle)
let currentStore: Store | null = null;

async function ensureStore(): Promise<Store> {
  if (!currentStore) {
    currentStore = await getOrCreateStore();
  }
  return currentStore;
}

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
    const returnTo = req.query.returnTo as string;
    return res.redirect(returnTo && returnTo.startsWith('/') ? returnTo : '/profile');
  }

  const providers = getAllProviders();
  const returnTo = req.query.returnTo as string;
  res.render('login', { providers, returnTo: returnTo && returnTo.startsWith('/') ? returnTo : '' });
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
router.get('/store', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const products = await productService.getAllProducts(store.id);
    const isAuthenticated = !!req.session.userInfo;
    res.render('store', {
      products,
      formatPrice: productService.formatPrice,
      isAuthenticated,
      userInfo: req.session.userInfo,
      cartCount: getCartCount(req),
    });
  } catch (error) {
    console.error('[Pages] Store error:', error);
    res.status(500).render('error', { message: 'Failed to load store' });
  }
});

// Checkout page
router.get('/checkout', (req: Request, res: Response) => {
  const isAuthenticated = !!req.session.userInfo;
  res.render('checkout', {
    isAuthenticated,
    userInfo: req.session.userInfo,
    cartCount: getCartCount(req),
    wsimEnabled: config.wsimEnabled,
    wsimPopupUrl: config.wsimPopupUrl,
    wsimApiUrl: config.wsimApiUrl,
    wsimApiKey: config.wsimApiKey,
  });
});

// Order confirmation page
router.get('/order-confirmation/:orderId', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const { orderId } = req.params;
    const order = await orderService.getOrderById(store.id, orderId);

    if (!order) {
      return res.status(404).render('error', { message: 'Order not found' });
    }

    const isAuthenticated = !!req.session.userInfo;

    // Allow viewing if:
    // 1. User is authenticated and owns the order, OR
    // 2. Order was a guest wallet payment (bsimUserId === 'guest')
    const isGuestOrder = order.bsimUserId === 'guest';
    const isOwner = req.session.userInfo?.sub === order.bsimUserId;

    if (!isGuestOrder && !isOwner) {
      // Not a guest order and user doesn't own it - require login
      if (!req.session.userInfo) {
        return res.redirect('/login');
      }
      return res.status(403).render('error', { message: 'Not authorized' });
    }

    res.render('order-confirmation', {
      order,
      formatPrice: productService.formatPrice,
      getOrderItems: orderService.getOrderItems,
      getOrderPaymentDetails: orderService.getOrderPaymentDetails,
      isAuthenticated,
      cartCount: getCartCount(req),
    });
  } catch (error) {
    console.error('[Pages] Order confirmation error:', error);
    res.status(500).render('error', { message: 'Failed to load order' });
  }
});

// Order history page
router.get('/orders', async (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.redirect('/login');
  }

  try {
    const store = await ensureStore();
    const bsimUserId = req.session.userInfo.sub as string;
    const orders = await orderService.getOrdersByUserId(store.id, bsimUserId);

    res.render('orders', {
      orders,
      formatPrice: productService.formatPrice,
      getOrderItems: orderService.getOrderItems,
      getOrderPaymentDetails: orderService.getOrderPaymentDetails,
      isAuthenticated: true,
      cartCount: getCartCount(req),
    });
  } catch (error) {
    console.error('[Pages] Orders error:', error);
    res.status(500).render('error', { message: 'Failed to load orders' });
  }
});

// Order detail page
router.get('/orders/:orderId', async (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.redirect('/login');
  }

  try {
    const store = await ensureStore();
    const { orderId } = req.params;
    const order = await orderService.getOrderById(store.id, orderId);

    if (!order) {
      return res.status(404).render('error', { message: 'Order not found' });
    }

    // Verify the order belongs to this user
    if (order.bsimUserId !== req.session.userInfo.sub) {
      return res.status(403).render('error', { message: 'Not authorized' });
    }

    res.render('order-detail', {
      order,
      formatPrice: productService.formatPrice,
      getOrderItems: orderService.getOrderItems,
      getOrderPaymentDetails: orderService.getOrderPaymentDetails,
      isAuthenticated: true,
      cartCount: getCartCount(req),
    });
  } catch (error) {
    console.error('[Pages] Order detail error:', error);
    res.status(500).render('error', { message: 'Failed to load order' });
  }
});

// WSIM API Diagnostic page - for debugging CORS/session issues
router.get('/wsim-diagnostic', (req: Request, res: Response) => {
  res.render('wsim-diagnostic', {
    wsimEnabled: config.wsimEnabled,
    wsimApiUrl: config.wsimApiUrl,
    wsimApiKey: config.wsimApiKey,
  });
});

export default router;
