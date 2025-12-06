import { Router, Request, Response } from 'express';
import { config } from '../config/env';
import { authorizePayment } from '../services/payment';
import { setOrderAuthorized, setOrderDeclined, setOrderFailed, createOrder } from '../data/orders';
import { getProductById } from '../data/products';
import { OrderItem } from '../models/order';
import '../types/session';

const router = Router();

/**
 * WSIM Merchant API Proxy Routes
 *
 * These routes proxy requests to WSIM's Merchant API, forwarding the user's
 * session cookies for authentication while adding our API key.
 *
 * This enables SSIM to build a custom card selection UI while still using
 * WSIM for wallet authentication and card token generation.
 */

/**
 * GET /api/wsim/auth-check
 * Check if user is authenticated with WSIM
 */
router.get('/auth-check', async (req: Request, res: Response) => {
  try {
    if (!config.wsimApiKey) {
      return res.json({ authenticated: false, error: 'WSIM API not configured' });
    }

    const response = await fetch(`${config.wsimApiUrl}/user`, {
      headers: {
        'x-api-key': config.wsimApiKey,
        'Cookie': req.headers.cookie || '',
      },
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[WSIM API] Auth check error:', error);
    res.json({ authenticated: false });
  }
});

/**
 * GET /api/wsim/cards
 * Get user's enrolled wallet cards
 */
router.get('/cards', async (req: Request, res: Response) => {
  try {
    if (!config.wsimApiKey) {
      return res.status(503).json({ error: 'WSIM API not configured' });
    }

    const response = await fetch(`${config.wsimApiUrl}/cards`, {
      headers: {
        'x-api-key': config.wsimApiKey,
        'Cookie': req.headers.cookie || '',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json(error);
    }

    res.json(await response.json());
  } catch (error) {
    console.error('[WSIM API] Cards error:', error);
    res.status(500).json({ error: 'Failed to fetch cards' });
  }
});

/**
 * POST /api/wsim/payment/initiate
 * Start payment and get WebAuthn challenge for passkey authentication
 */
router.post('/payment/initiate', async (req: Request, res: Response) => {
  const { cardId, amount, currency = 'CAD' } = req.body;

  if (!cardId || !amount) {
    return res.status(400).json({ error: 'Missing cardId or amount' });
  }

  try {
    if (!config.wsimApiKey) {
      return res.status(503).json({ error: 'WSIM API not configured' });
    }

    const response = await fetch(`${config.wsimApiUrl}/payment/initiate`, {
      method: 'POST',
      headers: {
        'x-api-key': config.wsimApiKey,
        'Content-Type': 'application/json',
        'Cookie': req.headers.cookie || '',
      },
      body: JSON.stringify({
        cardId,
        amount,
        currency,
        merchantName: 'SSIM Store',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('[WSIM API] Payment initiate error:', error);
      return res.status(response.status).json(error);
    }

    const data = await response.json() as { paymentId: string };
    console.log(`[WSIM API] Payment initiated: ${data.paymentId}`);
    res.json(data);
  } catch (error) {
    console.error('[WSIM API] Payment initiate error:', error);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

/**
 * POST /api/wsim/payment/confirm
 * Verify passkey and get payment tokens
 */
router.post('/payment/confirm', async (req: Request, res: Response) => {
  const { paymentId, passkeyResponse } = req.body;

  if (!paymentId || !passkeyResponse) {
    return res.status(400).json({ error: 'Missing paymentId or passkeyResponse' });
  }

  try {
    if (!config.wsimApiKey) {
      return res.status(503).json({ error: 'WSIM API not configured' });
    }

    const response = await fetch(`${config.wsimApiUrl}/payment/confirm`, {
      method: 'POST',
      headers: {
        'x-api-key': config.wsimApiKey,
        'Content-Type': 'application/json',
        'Cookie': req.headers.cookie || '',
      },
      body: JSON.stringify({
        paymentId,
        passkeyResponse,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('[WSIM API] Payment confirm error:', error);
      return res.status(response.status).json(error);
    }

    const data = await response.json();
    console.log(`[WSIM API] Payment confirmed, tokens received`);
    res.json(data);
  } catch (error) {
    console.error('[WSIM API] Payment confirm error:', error);
    res.status(500).json({ error: 'Passkey verification failed' });
  }
});

/**
 * POST /api/wsim/payment/complete
 * Complete payment with NSIM using the tokens from WSIM
 */
router.post('/payment/complete', async (req: Request, res: Response) => {
  const { walletCardToken, cardToken, cardLast4, cardBrand } = req.body;

  if (!cardToken) {
    return res.status(400).json({ error: 'Missing cardToken' });
  }

  // Get cart from session
  const cart = req.session.cart || [];
  if (cart.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  // Convert cart items to order items with proper structure
  const orderItems: OrderItem[] = [];
  let subtotal = 0;

  for (const cartItem of cart) {
    const product = getProductById(cartItem.productId);
    if (!product) {
      return res.status(400).json({ error: `Product not found: ${cartItem.productId}` });
    }

    const itemSubtotal = product.price * cartItem.quantity;
    orderItems.push({
      productId: cartItem.productId,
      productName: product.name,
      quantity: cartItem.quantity,
      unitPrice: product.price,
      subtotal: itemSubtotal,
    });
    subtotal += itemSubtotal;
  }

  // Create order
  const userId = req.session.userInfo?.sub as string || 'guest';
  const order = createOrder({
    userId,
    items: orderItems,
    subtotal,
    currency: 'CAD',
  });

  console.log(`[WSIM API] Processing API payment for order ${order.id}, amount: ${order.subtotal} cents`);

  try {
    const authResult = await authorizePayment({
      merchantId: config.merchantId,
      amount: order.subtotal,
      currency: order.currency,
      cardToken,
      walletCardToken,
      orderId: order.id,
    });

    if (authResult.status === 'authorized') {
      setOrderAuthorized(
        order.id,
        authResult.transactionId,
        authResult.authorizationCode || '',
        cardToken,
        'wallet',
        walletCardToken
      );

      // Clear cart
      req.session.cart = [];

      console.log(`[WSIM API] Payment authorized for order ${order.id}, txn: ${authResult.transactionId}`);

      res.json({
        success: true,
        orderId: order.id,
        transactionId: authResult.transactionId,
        redirectUrl: `/order-confirmation/${order.id}`,
      });
    } else if (authResult.status === 'declined') {
      setOrderDeclined(order.id);
      console.log(`[WSIM API] Payment declined for order ${order.id}: ${authResult.declineReason}`);
      res.status(400).json({
        error: 'Payment declined',
        reason: authResult.declineReason,
      });
    } else {
      setOrderFailed(order.id);
      console.log(`[WSIM API] Payment failed for order ${order.id}`);
      res.status(500).json({ error: 'Payment failed' });
    }
  } catch (error) {
    console.error('[WSIM API] Payment complete error:', error);
    setOrderFailed(order.id);
    res.status(500).json({ error: 'Payment processing failed' });
  }
});

export default router;
