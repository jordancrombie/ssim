import { Router, Request, Response } from 'express';
import { Issuer, Client, generators } from 'openid-client';
import { config } from '../config/env';
import { getOrCreateStore, getPaymentMethodSettings } from '../services/store';
import * as productService from '../services/product';
import * as orderService from '../services/order';
import { authorizePayment, capturePayment, voidPayment, refundPayment } from '../services/payment';
import type { Store, Order } from '@prisma/client';
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

/**
 * Ensure URL uses HTTPS protocol
 * This prevents 301 redirect issues when HTTP URLs are accidentally configured
 */
function ensureHttps(url: string): string {
  if (url.startsWith('http://')) {
    const httpsUrl = url.replace('http://', 'https://');
    console.warn(`[Payment] Upgrading HTTP URL to HTTPS: ${url} -> ${httpsUrl}`);
    return httpsUrl;
  }
  return url;
}

// Store payment OIDC clients (initialized on first use)
let paymentClient: Client | null = null;
let wsimClient: Client | null = null;

async function getPaymentClient() {
  if (!paymentClient) {
    const authUrl = ensureHttps(config.paymentAuthUrl);
    console.log('[Payment] Discovering payment auth issuer:', authUrl);
    const issuer = await Issuer.discover(authUrl);
    paymentClient = new issuer.Client({
      client_id: config.paymentClientId,
      client_secret: config.paymentClientSecret,
      redirect_uris: [`${config.appBaseUrl}/payment/callback`],
      response_types: ['code'],
    });
  }
  return paymentClient;
}

async function getWsimClient() {
  if (!wsimClient && config.wsimEnabled && config.wsimAuthUrl) {
    const wsimAuthUrl = ensureHttps(config.wsimAuthUrl);
    console.log('[Payment] Discovering WSIM issuer:', wsimAuthUrl);
    const issuer = await Issuer.discover(wsimAuthUrl);
    wsimClient = new issuer.Client({
      client_id: config.wsimClientId,
      client_secret: config.wsimClientSecret,
      redirect_uris: [`${config.appBaseUrl}/payment/wallet-callback`],
      response_types: ['code'],
    });
  }
  return wsimClient;
}

// Initiate payment - creates order and redirects to BSIM or WSIM auth
router.post('/initiate', async (req: Request, res: Response) => {
  const { provider = 'bank' } = req.body; // 'bank' or 'wallet'

  // For bank payments, require BSIM authentication
  // For wallet payments, WSIM handles authentication - no BSIM login required
  if (provider !== 'wallet' && !req.session.userInfo) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Validate provider - check env config
  if (provider === 'wallet' && !config.wsimEnabled) {
    return res.status(400).json({ error: 'Wallet payments are not enabled' });
  }

  const cart = req.session.cart || [];
  if (cart.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  try {
    const store = await ensureStore();

    // Check store payment method settings
    const paymentSettings = await getPaymentMethodSettings(store.id);

    if (provider === 'bank' && !paymentSettings.bankPaymentEnabled) {
      return res.status(400).json({ error: 'Bank payments are disabled for this store' });
    }

    if (provider === 'wallet' && !paymentSettings.walletRedirectEnabled) {
      return res.status(400).json({ error: 'Wallet redirect payments are disabled for this store' });
    }

    // Build order items from cart
    const orderItems: orderService.OrderItem[] = [];
    let subtotal = 0;

    for (const cartItem of cart) {
      const product = await productService.getProductById(store.id, cartItem.productId);
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

    // Create order - for wallet payments, use 'guest' if not authenticated
    const bsimUserId = req.session.userInfo?.sub as string || 'guest';
    const order = await orderService.createOrder(store.id, {
      bsimUserId,
      items: orderItems,
      subtotal,
      currency: 'CAD',
    });

    console.log('[Payment] Created order:', order.id, 'Total:', productService.formatPrice(subtotal), 'Provider:', provider);

    // Generate PKCE and state
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    // Store payment state in session (including provider)
    req.session.paymentState = {
      orderId: order.id,
      state,
      nonce,
      codeVerifier,
      provider: provider as 'bank' | 'wallet',
    };

    let authUrl: string;

    if (provider === 'wallet') {
      // Use WSIM for wallet payments
      const client = await getWsimClient();
      if (!client) {
        throw new Error('WSIM client not available');
      }

      // Build authorization URL with payment claims
      // Include resource parameter to request JWT access token
      authUrl = client.authorizationUrl({
        scope: 'openid payment:authorize',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        resource: 'urn:wsim:payment-api',
        claims: JSON.stringify({
          payment: {
            amount: (order.subtotal / 100).toFixed(2),
            currency: order.currency,
            merchantId: config.merchantId,
            orderId: order.id,
          }
        }),
      });

      console.log('[Payment] Redirecting to WSIM auth:', authUrl);
    } else {
      // Use BSIM for bank payments (existing flow)
      const client = await getPaymentClient();

      // Build authorization URL with payment scope
      // Use prompt=consent to always show card selection (don't reuse previous card)
      authUrl = client.authorizationUrl({
        scope: 'openid payment:authorize',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'consent',
      });

      console.log('[Payment] Redirecting to BSIM auth:', authUrl);
    }

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

  try {
    const store = await ensureStore();

    // Check for error from auth server
    if (req.query.error) {
      console.error('[Payment] Auth error:', req.query.error, req.query.error_description);
      const order = await orderService.getOrderById(store.id, orderId);
      if (order) {
        await orderService.setOrderDeclined(store.id, orderId);
      }
      return res.redirect(`/checkout?error=${req.query.error}`);
    }

    const order = await orderService.getOrderById(store.id, orderId);
    if (!order) {
      console.error('[Payment] Order not found:', orderId);
      return res.redirect('/checkout?error=order_not_found');
    }

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
      // Update order with payment details (bank payment)
      await orderService.setOrderAuthorized(
        store.id,
        order.id,
        authResult.transactionId,
        authResult.authorizationCode || '',
        cardToken,
        'bank'
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
      await orderService.setOrderDeclined(store.id, order.id);
      // Pass the decline reason to the checkout page
      const reason = encodeURIComponent(authResult.declineReason || 'Payment declined');
      console.log('[Payment] Payment declined:', authResult.declineReason);
      res.redirect(`/checkout?error=payment_declined&reason=${reason}`);
    } else {
      await orderService.setOrderFailed(store.id, order.id);
      res.redirect(`/checkout?error=payment_failed`);
    }
  } catch (error) {
    console.error('[Payment] Callback error:', error);
    const errorMsg = error instanceof Error ? encodeURIComponent(error.message) : 'payment_error';
    res.redirect(`/checkout?error=payment_error&reason=${errorMsg}`);
  }
});

// Wallet payment callback - handles WSIM OAuth response
router.get('/wallet-callback', async (req: Request, res: Response) => {
  const paymentState = req.session.paymentState;

  if (!paymentState) {
    console.error('[Payment] No payment state in session');
    return res.redirect('/checkout?error=invalid_state');
  }

  // Verify this is a wallet payment
  if (paymentState.provider !== 'wallet') {
    console.error('[Payment] Expected wallet provider, got:', paymentState.provider);
    return res.redirect('/checkout?error=invalid_state');
  }

  const { orderId, state, nonce, codeVerifier } = paymentState;

  // Verify state
  if (req.query.state !== state) {
    console.error('[Payment] State mismatch');
    return res.redirect('/checkout?error=state_mismatch');
  }

  try {
    const store = await ensureStore();

    // Check for error from auth server
    if (req.query.error) {
      console.error('[Payment] WSIM auth error:', req.query.error, req.query.error_description);
      const order = await orderService.getOrderById(store.id, orderId);
      if (order) {
        await orderService.setOrderDeclined(store.id, orderId);
      }
      return res.redirect(`/checkout?error=${req.query.error}`);
    }

    const order = await orderService.getOrderById(store.id, orderId);
    if (!order) {
      console.error('[Payment] Order not found:', orderId);
      return res.redirect('/checkout?error=order_not_found');
    }
    const client = await getWsimClient();
    if (!client) {
      throw new Error('WSIM client not available');
    }

    // Exchange code for tokens
    const params = client.callbackParams(req);
    const redirectUri = `${config.appBaseUrl}/payment/wallet-callback`;

    console.log('[Payment] Exchanging WSIM authorization code for tokens...');
    const tokenSet = await client.callback(redirectUri, params, {
      state,
      nonce,
      code_verifier: codeVerifier,
    }, {
      // Pass resource parameter to token endpoint for JWT access token
      exchangeBody: {
        resource: 'urn:wsim:payment-api',
      },
    });

    console.log('[Payment] WSIM token exchange successful');

    // Extract tokens from JWT access token
    const accessToken = tokenSet.access_token;
    if (!accessToken) {
      throw new Error('No access token received from WSIM');
    }

    // Log the token for debugging
    console.log('[Payment] WSIM access token (first 100 chars):', accessToken.substring(0, 100));
    console.log('[Payment] WSIM access token parts:', accessToken.split('.').length);

    // Decode JWT to get wallet_card_token and card_token (underscore notation!)
    let walletCardToken: string | undefined;
    let cardToken: string | undefined;

    if (accessToken.split('.').length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
        console.log('[Payment] WSIM JWT payload:', JSON.stringify(payload, null, 2));

        // Note: WSIM uses underscore notation for token claims
        walletCardToken = payload.wallet_card_token;
        cardToken = payload.card_token;

        if (walletCardToken && cardToken) {
          console.log('[Payment] Extracted wallet_card_token and card_token from WSIM JWT');
        } else {
          console.warn('[Payment] Missing tokens in WSIM JWT - wallet_card_token:', !!walletCardToken, 'card_token:', !!cardToken);
        }
      } catch (e) {
        console.error('[Payment] Could not decode WSIM access token as JWT:', e);
        throw new Error('Invalid token format from WSIM');
      }
    } else {
      throw new Error('WSIM access token is not a valid JWT');
    }

    if (!walletCardToken || !cardToken) {
      throw new Error('Missing wallet tokens in WSIM response');
    }

    // Extract user identity from ID token if user is not already authenticated
    // This allows wallet-only authentication flow
    if (!req.session.userInfo && tokenSet.id_token) {
      try {
        const idTokenClaims = tokenSet.claims();
        console.log('[Payment] WSIM ID Token claims:', idTokenClaims);

        // Create user session from WSIM identity
        req.session.userInfo = {
          sub: idTokenClaims.sub,
          name: idTokenClaims.name,
          given_name: idTokenClaims.given_name,
          family_name: idTokenClaims.family_name,
          email: idTokenClaims.email,
          email_verified: idTokenClaims.email_verified,
        } as Record<string, unknown>;

        console.log('[Payment] Created user session from WSIM auth for user:', idTokenClaims.sub);
      } catch (e) {
        console.warn('[Payment] Could not extract user identity from WSIM ID token:', e);
        // Continue without user session - payment can still proceed
      }
    }

    // Clear payment state
    delete req.session.paymentState;

    // Authorize payment via NSIM API with BOTH tokens
    console.log('[Payment] Authorizing wallet payment via NSIM...');
    const authResult = await authorizePayment({
      merchantId: config.merchantId,
      amount: order.subtotal,
      currency: order.currency,
      cardToken,
      walletCardToken,  // For NSIM routing
      orderId: order.id,
    });

    if (authResult.status === 'authorized') {
      // Update order with payment details (wallet payment)
      await orderService.setOrderAuthorized(
        store.id,
        order.id,
        authResult.transactionId,
        authResult.authorizationCode || '',
        cardToken,
        'wallet',
        walletCardToken
      );

      // Clear cart after successful payment
      req.session.cart = [];

      console.log('[Payment] Wallet payment authorized:', authResult.transactionId);

      req.session.save((err) => {
        if (err) {
          console.error('[Payment] Session save error:', err);
        }
        res.redirect(`/order-confirmation/${order.id}`);
      });
    } else if (authResult.status === 'declined') {
      await orderService.setOrderDeclined(store.id, order.id);
      const reason = encodeURIComponent(authResult.declineReason || 'Payment declined');
      console.log('[Payment] Wallet payment declined:', authResult.declineReason);
      res.redirect(`/checkout?error=payment_declined&reason=${reason}`);
    } else {
      await orderService.setOrderFailed(store.id, order.id);
      res.redirect(`/checkout?error=payment_failed`);
    }
  } catch (error) {
    console.error('[Payment] Wallet callback error:', error);
    const errorMsg = error instanceof Error ? encodeURIComponent(error.message) : 'payment_error';
    res.redirect(`/checkout?error=payment_error&reason=${errorMsg}`);
  }
});

// Popup payment completion - receives cardToken from WSIM popup
router.post('/popup-complete', async (req: Request, res: Response) => {
  const { cardToken, cardLast4, cardBrand } = req.body;

  if (!cardToken) {
    return res.status(400).json({ error: 'Card token is required' });
  }

  const cart = req.session.cart || [];
  if (cart.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  try {
    const store = await ensureStore();

    // Build order items from cart
    const orderItems: orderService.OrderItem[] = [];
    let subtotal = 0;

    for (const cartItem of cart) {
      const product = await productService.getProductById(store.id, cartItem.productId);
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

    // Create order - use 'guest' if not authenticated (wallet-only flow)
    const bsimUserId = req.session.userInfo?.sub as string || 'guest';
    const order = await orderService.createOrder(store.id, {
      bsimUserId,
      items: orderItems,
      subtotal,
      currency: 'CAD',
    });

    console.log('[Payment] Popup flow - Created order:', order.id, 'Total:', productService.formatPrice(subtotal));
    console.log('[Payment] Popup flow - Card:', cardBrand, '****' + cardLast4);
    // Authorize payment via NSIM API with cardToken only (no walletCardToken for popup flow)
    console.log('[Payment] Popup flow - Authorizing payment via NSIM...');
    const authResult = await authorizePayment({
      merchantId: config.merchantId,
      amount: order.subtotal,
      currency: order.currency,
      cardToken,
      orderId: order.id,
    });

    if (authResult.status === 'authorized') {
      // Update order with payment details (popup wallet payment)
      await orderService.setOrderAuthorized(
        store.id,
        order.id,
        authResult.transactionId,
        authResult.authorizationCode || '',
        cardToken,
        'wallet' // Mark as wallet payment
      );

      // Clear cart after successful payment
      req.session.cart = [];

      console.log('[Payment] Popup payment authorized:', authResult.transactionId);

      req.session.save((err) => {
        if (err) {
          console.error('[Payment] Session save error:', err);
        }
        res.json({
          success: true,
          orderId: order.id,
          transactionId: authResult.transactionId,
          redirectUrl: `/order-confirmation/${order.id}`,
        });
      });
    } else if (authResult.status === 'declined') {
      await orderService.setOrderDeclined(store.id, order.id);
      console.log('[Payment] Popup payment declined:', authResult.declineReason);
      res.status(400).json({
        success: false,
        error: 'payment_declined',
        reason: authResult.declineReason || 'Payment declined',
      });
    } else {
      await orderService.setOrderFailed(store.id, order.id);
      res.status(500).json({
        success: false,
        error: 'payment_failed',
        reason: 'Payment processing failed',
      });
    }
  } catch (error) {
    console.error('[Payment] Popup payment error:', error);
    res.status(500).json({
      success: false,
      error: 'payment_error',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Capture payment (for authorized orders)
router.post('/capture/:orderId', async (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { orderId } = req.params;
  const { amount } = req.body;

  try {
    const store = await ensureStore();
    const order = await orderService.getOrderById(store.id, orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.bsimUserId !== req.session.userInfo.sub) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (order.status !== 'authorized') {
      return res.status(400).json({ error: 'Order is not authorized' });
    }

    const paymentDetails = orderService.getOrderPaymentDetails(order);
    if (!paymentDetails?.transactionId) {
      return res.status(400).json({ error: 'No transaction to capture' });
    }

    const result = await capturePayment(paymentDetails.transactionId, amount);

    if (result.status === 'captured') {
      await orderService.setOrderCaptured(store.id, orderId, amount);
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

  try {
    const store = await ensureStore();
    const order = await orderService.getOrderById(store.id, orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.bsimUserId !== req.session.userInfo.sub) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (order.status !== 'authorized') {
      return res.status(400).json({ error: 'Order is not authorized' });
    }

    const paymentDetails = orderService.getOrderPaymentDetails(order);
    if (!paymentDetails?.transactionId) {
      return res.status(400).json({ error: 'No transaction to void' });
    }

    const result = await voidPayment(paymentDetails.transactionId);

    if (result.status === 'voided') {
      await orderService.setOrderVoided(store.id, orderId);
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

  try {
    const store = await ensureStore();
    const order = await orderService.getOrderById(store.id, orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.bsimUserId !== req.session.userInfo.sub) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (order.status !== 'captured') {
      return res.status(400).json({ error: 'Order is not captured' });
    }

    const paymentDetails = orderService.getOrderPaymentDetails(order);
    if (!paymentDetails?.transactionId) {
      return res.status(400).json({ error: 'No transaction to refund' });
    }

    const result = await refundPayment(paymentDetails.transactionId, amount, reason || 'Customer refund');

    if (result.status === 'refunded') {
      await orderService.setOrderRefunded(store.id, orderId, amount);
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
