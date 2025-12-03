import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config/env';
import {
  getOrderByTransactionId,
  setOrderAuthorized,
  setOrderCaptured,
  setOrderVoided,
  setOrderRefunded,
  setOrderDeclined,
  setOrderFailed,
} from '../data/orders';

const router = Router();

// Webhook event types from NSIM
type WebhookEventType =
  | 'payment.authorized'
  | 'payment.captured'
  | 'payment.voided'
  | 'payment.refunded'
  | 'payment.declined'
  | 'payment.expired'
  | 'payment.failed';

interface WebhookPayload {
  id: string;
  type: WebhookEventType;
  timestamp: string;
  data: {
    transactionId: string;
    merchantId: string;
    amount: number;
    currency: string;
    status: string;
    orderId?: string;
    authorizationCode?: string;
    declineReason?: string;
    failureReason?: string;
    refundedAmount?: number;
    capturedAmount?: number;
  };
}

/**
 * Verify webhook signature using HMAC-SHA256
 * Signature format: sha256=<hex-encoded-hmac>
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) {
    console.error('[Webhook] Missing signature header');
    return false;
  }

  // Extract the hash from "sha256=<hash>" format
  const parts = signature.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    console.error('[Webhook] Invalid signature format');
    return false;
  }

  const expectedSignature = parts[1];
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(computedSignature, 'hex')
    );
  } catch {
    console.error('[Webhook] Signature comparison failed');
    return false;
  }
}

/**
 * Middleware to verify webhook signature
 */
function webhookSignatureMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const signature = req.headers['x-webhook-signature'] as string | undefined;
  const rawBody = req.body;

  // Need raw body for signature verification
  // Express should be configured to preserve raw body for this route
  const bodyString = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);

  if (!config.webhookSecret) {
    console.warn('[Webhook] No webhook secret configured, skipping signature verification');
    return next();
  }

  if (!verifyWebhookSignature(bodyString, signature, config.webhookSecret)) {
    console.error('[Webhook] Invalid signature');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  console.log('[Webhook] Signature verified successfully');
  next();
}

/**
 * Handle payment.authorized event
 */
function handlePaymentAuthorized(data: WebhookPayload['data']): void {
  console.log('[Webhook] Payment authorized:', data.transactionId);

  if (data.orderId) {
    // Order might already be authorized from synchronous response
    // This is a backup/confirmation
    const order = getOrderByTransactionId(data.transactionId);
    if (order && order.status === 'pending') {
      setOrderAuthorized(
        order.id,
        data.transactionId,
        data.authorizationCode || '',
        '' // cardToken not available in webhook
      );
    }
  }
}

/**
 * Handle payment.captured event
 */
function handlePaymentCaptured(data: WebhookPayload['data']): void {
  console.log('[Webhook] Payment captured:', data.transactionId);

  const order = getOrderByTransactionId(data.transactionId);
  if (order && order.status === 'authorized') {
    setOrderCaptured(order.id, data.capturedAmount);
  }
}

/**
 * Handle payment.voided event
 */
function handlePaymentVoided(data: WebhookPayload['data']): void {
  console.log('[Webhook] Payment voided:', data.transactionId);

  const order = getOrderByTransactionId(data.transactionId);
  if (order && order.status === 'authorized') {
    setOrderVoided(order.id);
  }
}

/**
 * Handle payment.refunded event
 */
function handlePaymentRefunded(data: WebhookPayload['data']): void {
  console.log('[Webhook] Payment refunded:', data.transactionId);

  const order = getOrderByTransactionId(data.transactionId);
  if (order && order.status === 'captured' && data.refundedAmount !== undefined) {
    setOrderRefunded(order.id, data.refundedAmount);
  }
}

/**
 * Handle payment.declined event
 */
function handlePaymentDeclined(data: WebhookPayload['data']): void {
  console.log('[Webhook] Payment declined:', data.transactionId, data.declineReason);

  const order = getOrderByTransactionId(data.transactionId);
  if (order && order.status === 'pending') {
    setOrderDeclined(order.id);
  }
}

/**
 * Handle payment.expired event
 */
function handlePaymentExpired(data: WebhookPayload['data']): void {
  console.log('[Webhook] Payment expired:', data.transactionId);

  const order = getOrderByTransactionId(data.transactionId);
  if (order && order.status === 'authorized') {
    // Treat expired authorizations as voided
    setOrderVoided(order.id);
  }
}

/**
 * Handle payment.failed event
 */
function handlePaymentFailed(data: WebhookPayload['data']): void {
  console.log('[Webhook] Payment failed:', data.transactionId, data.failureReason);

  const order = getOrderByTransactionId(data.transactionId);
  if (order && (order.status === 'pending' || order.status === 'authorized')) {
    setOrderFailed(order.id);
  }
}

/**
 * Main webhook endpoint
 * POST /webhooks/payment
 */
router.post('/payment', webhookSignatureMiddleware, (req: Request, res: Response) => {
  const payload = req.body as WebhookPayload;

  console.log('[Webhook] Received event:', payload.type, 'ID:', payload.id);

  try {
    // Verify merchantId matches our configured merchant
    if (payload.data.merchantId !== config.merchantId) {
      console.warn('[Webhook] Merchant ID mismatch:', payload.data.merchantId);
      // Still acknowledge receipt to prevent retries
      return res.status(200).json({ received: true, ignored: true });
    }

    // Route to appropriate handler based on event type
    switch (payload.type) {
      case 'payment.authorized':
        handlePaymentAuthorized(payload.data);
        break;
      case 'payment.captured':
        handlePaymentCaptured(payload.data);
        break;
      case 'payment.voided':
        handlePaymentVoided(payload.data);
        break;
      case 'payment.refunded':
        handlePaymentRefunded(payload.data);
        break;
      case 'payment.declined':
        handlePaymentDeclined(payload.data);
        break;
      case 'payment.expired':
        handlePaymentExpired(payload.data);
        break;
      case 'payment.failed':
        handlePaymentFailed(payload.data);
        break;
      default:
        console.warn('[Webhook] Unknown event type:', payload.type);
    }

    // Always return 200 quickly to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[Webhook] Error processing event:', error);
    // Still return 200 to prevent retries for processing errors
    // The event has been received, we just couldn't process it
    res.status(200).json({ received: true, error: 'Processing error' });
  }
});

/**
 * Health check for webhook endpoint
 * GET /webhooks/health
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', endpoint: 'webhooks' });
});

export default router;
