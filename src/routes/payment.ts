import { Router, Request, Response } from 'express';
import { Issuer, Client, generators } from 'openid-client';
import { config } from '../config/env';
import { getProductById, formatPrice } from '../data/products';
import { createOrder, getOrderById, setOrderAuthorized, setOrderCaptured, setOrderVoided, setOrderRefunded, setOrderFailed, setOrderDeclined } from '../data/orders';
import { OrderItem } from '../models/order';
import { authorizePayment, capturePayment, voidPayment, refundPayment } from '../services/payment';
import '../types/session';

const router = Router();

// Store payment OIDC client (initialized on first use)
let paymentClient: Client | null = null;

async function getPaymentClient() {
  if (!paymentClient) {
    console.log('[Payment] Discovering payment auth issuer:', config.paymentAuthUrl);
    const issuer = await Issuer.discover(config.paymentAuthUrl);
    paymentClient = new issuer.Client({
      client_id: config.paymentClientId,
      client_secret: config.paymentClientSecret,
      redirect_uris: [`${config.appBaseUrl}/payment/callback`],
      response_types: ['code'],
    });
  }
  return paymentClient;
}

// Initiate payment - creates order and redirects to BSIM auth
router.post('/initiate', async (req: Request, res: Response) => {
  // Require authentication
  if (!req.session.userInfo) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const cart = req.session.cart || [];
  if (cart.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  // Build order items from cart
  const orderItems: OrderItem[] = [];
  let subtotal = 0;

  for (const cartItem of cart) {
    const product = getProductById(cartItem.productId);
    if (!product) {
      return res.status(400).json({ error: `Product ${cartItem.productId} not found` });
    }

    const itemSubtotal = product.price * cartItem.quantity;
    orderItems.push({
      productId: product.id,
      productName: product.name,
      quantity: cartItem.quantity,
      unitPrice: product.price,
      subtotal: itemSubtotal,
    });
    subtotal += itemSubtotal;
  }

  // Create order
  const userId = req.session.userInfo.sub as string;
  const order = createOrder({
    userId,
    items: orderItems,
    subtotal,
    currency: 'CAD',
  });

  console.log('[Payment] Created order:', order.id, 'Total:', formatPrice(subtotal));

  try {
    const client = await getPaymentClient();

    // Generate PKCE and state
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    // Store payment state in session
    req.session.paymentState = {
      orderId: order.id,
      state,
      nonce,
      codeVerifier,
    };

    // Build authorization URL with payment scope
    // Use prompt=consent to always show card selection (don't reuse previous card)
    const authUrl = client.authorizationUrl({
      scope: 'openid payment:authorize',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'consent',
    });

    console.log('[Payment] Redirecting to payment auth:', authUrl);

    // Save session before responding
    req.session.save((err) => {
      if (err) {
        console.error('[Payment] Session save error:', err);
        return res.status(500).json({ error: 'Failed to save session' });
      }

      res.json({ redirectUrl: authUrl, orderId: order.id });
    });
  } catch (error) {
    console.error('[Payment] Failed to initiate payment:', error);
    setOrderFailed(order.id);
    res.status(500).json({
      error: 'Failed to initiate payment',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Payment OAuth callback - exchange code for card token and authorize payment
router.get('/callback', async (req: Request, res: Response) => {
  const paymentState = req.session.paymentState;

  if (!paymentState) {
    console.error('[Payment] No payment state in session');
    return res.redirect('/checkout?error=invalid_state');
  }

  const { orderId, state, nonce, codeVerifier } = paymentState;

  // Verify state
  if (req.query.state !== state) {
    console.error('[Payment] State mismatch');
    return res.redirect('/checkout?error=state_mismatch');
  }

  // Check for error from auth server
  if (req.query.error) {
    console.error('[Payment] Auth error:', req.query.error, req.query.error_description);
    const order = getOrderById(orderId);
    if (order) {
      setOrderDeclined(orderId);
    }
    return res.redirect(`/checkout?error=${req.query.error}`);
  }

  const order = getOrderById(orderId);
  if (!order) {
    console.error('[Payment] Order not found:', orderId);
    return res.redirect('/checkout?error=order_not_found');
  }

  try {
    const client = await getPaymentClient();

    // Exchange code for tokens
    const params = client.callbackParams(req);
    const redirectUri = `${config.appBaseUrl}/payment/callback`;

    console.log('[Payment] Exchanging authorization code for tokens...');
    const tokenSet = await client.callback(redirectUri, params, {
      state,
      nonce,
      code_verifier: codeVerifier,
    });

    console.log('[Payment] Token exchange successful');

    // Extract card_token from JWT access token
    const accessToken = tokenSet.access_token;
    if (!accessToken) {
      throw new Error('No access token received');
    }

    // Decode JWT to get card_token (assuming it's in the payload)
    let cardToken: string | undefined;
    if (accessToken.split('.').length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
        console.log('[Payment] JWT payload:', JSON.stringify(payload, null, 2));
        cardToken = payload.card_token;
        if (cardToken) {
          console.log('[Payment] Extracted card_token from JWT');
        } else {
          console.log('[Payment] No card_token in JWT payload, using access token as card token');
          cardToken = accessToken;
        }
      } catch (e) {
        console.log('[Payment] Could not decode access token as JWT, using as card token');
        cardToken = accessToken;
      }
    } else {
      cardToken = accessToken;
    }

    if (!cardToken) {
      throw new Error('No card token available');
    }

    // Clear payment state (don't store card token - always let user select fresh)
    delete req.session.paymentState;
    delete req.session.cardToken;

    // Authorize payment via NSIM API
    console.log('[Payment] Authorizing payment via NSIM...');
    const authResult = await authorizePayment({
      merchantId: config.merchantId,
      amount: order.subtotal,
      currency: order.currency,
      cardToken,
      orderId: order.id,
    });

    if (authResult.status === 'authorized') {
      // Update order with payment details
      setOrderAuthorized(
        order.id,
        authResult.transactionId,
        authResult.authorizationCode || '',
        cardToken
      );

      // Clear cart after successful payment
      req.session.cart = [];

      console.log('[Payment] Payment authorized:', authResult.transactionId);

      req.session.save((err) => {
        if (err) {
          console.error('[Payment] Session save error:', err);
        }
        res.redirect(`/order-confirmation/${order.id}`);
      });
    } else if (authResult.status === 'declined') {
      setOrderDeclined(order.id);
      // Pass the decline reason to the checkout page
      const reason = encodeURIComponent(authResult.declineReason || 'Payment declined');
      console.log('[Payment] Payment declined:', authResult.declineReason);
      res.redirect(`/checkout?error=payment_declined&reason=${reason}`);
    } else {
      setOrderFailed(order.id);
      res.redirect(`/checkout?error=payment_failed`);
    }
  } catch (error) {
    console.error('[Payment] Callback error:', error);
    setOrderFailed(orderId);
    const errorMsg = error instanceof Error ? encodeURIComponent(error.message) : 'payment_error';
    res.redirect(`/checkout?error=payment_error&reason=${errorMsg}`);
  }
});

// Capture payment (for authorized orders)
router.post('/capture/:orderId', async (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { orderId } = req.params;
  const { amount } = req.body;

  const order = getOrderById(orderId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  if (order.userId !== req.session.userInfo.sub) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  if (order.status !== 'authorized') {
    return res.status(400).json({ error: 'Order is not authorized' });
  }

  if (!order.paymentDetails?.transactionId) {
    return res.status(400).json({ error: 'No transaction to capture' });
  }

  try {
    const result = await capturePayment(order.paymentDetails.transactionId, amount);

    if (result.status === 'captured') {
      setOrderCaptured(orderId, amount);
      res.json({ success: true, status: 'captured' });
    } else {
      res.status(400).json({ error: 'Capture failed', status: result.status });
    }
  } catch (error) {
    console.error('[Payment] Capture error:', error);
    res.status(500).json({
      error: 'Capture failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Void payment (for authorized but not captured orders)
router.post('/void/:orderId', async (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { orderId } = req.params;

  const order = getOrderById(orderId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  if (order.userId !== req.session.userInfo.sub) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  if (order.status !== 'authorized') {
    return res.status(400).json({ error: 'Order is not authorized' });
  }

  if (!order.paymentDetails?.transactionId) {
    return res.status(400).json({ error: 'No transaction to void' });
  }

  try {
    const result = await voidPayment(order.paymentDetails.transactionId);

    if (result.status === 'voided') {
      setOrderVoided(orderId);
      res.json({ success: true, status: 'voided' });
    } else {
      res.status(400).json({ error: 'Void failed', status: result.status });
    }
  } catch (error) {
    console.error('[Payment] Void error:', error);
    res.status(500).json({
      error: 'Void failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Refund payment (for captured orders)
router.post('/refund/:orderId', async (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { orderId } = req.params;
  const { amount, reason } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  const order = getOrderById(orderId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  if (order.userId !== req.session.userInfo.sub) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  if (order.status !== 'captured') {
    return res.status(400).json({ error: 'Order is not captured' });
  }

  if (!order.paymentDetails?.transactionId) {
    return res.status(400).json({ error: 'No transaction to refund' });
  }

  try {
    const result = await refundPayment(order.paymentDetails.transactionId, amount, reason || 'Customer refund');

    if (result.status === 'refunded') {
      setOrderRefunded(orderId, amount);
      res.json({ success: true, status: 'refunded' });
    } else {
      res.status(400).json({ error: 'Refund failed', status: result.status });
    }
  } catch (error) {
    console.error('[Payment] Refund error:', error);
    res.status(500).json({
      error: 'Refund failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
