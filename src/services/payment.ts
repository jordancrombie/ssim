import { config } from '../config/env';

export interface AuthorizeParams {
  merchantId: string;
  amount: number;
  currency: string;
  cardToken: string;
  walletCardToken?: string;  // For wallet payments - used by NSIM for routing
  orderId: string;
}

export interface AuthorizeResult {
  transactionId: string;
  status: 'authorized' | 'declined' | 'failed';
  authorizationCode?: string;
  timestamp?: string;
  message?: string;
  declineReason?: string;
}

export interface CaptureResult {
  transactionId: string;
  status: 'captured' | 'failed';
  capturedAmount?: number;
  timestamp?: string;
  message?: string;
}

export interface VoidResult {
  transactionId: string;
  status: 'voided' | 'failed';
  timestamp?: string;
  message?: string;
}

export interface RefundResult {
  transactionId: string;
  status: 'refunded' | 'failed';
  refundedAmount?: number;
  timestamp?: string;
  message?: string;
}

const API_BASE = `${config.paymentApiUrl}/api/v1/payments`;

async function makePaymentRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Add API key if configured
  if (config.paymentApiKey) {
    headers['X-API-Key'] = config.paymentApiKey;
  }

  console.log(`[PaymentService] ${method} ${url}`);

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json() as Record<string, unknown>;

  // For authorize endpoint, return the response even if it's a decline (400 status)
  // This allows proper handling of declined payments
  if (!response.ok && endpoint === '/authorize' && data.status === 'declined') {
    console.log('[PaymentService] Payment declined:', data);
    return data as T;
  }

  if (!response.ok) {
    console.error('[PaymentService] API error:', response.status, data);
    const message = (data.message as string) || (data.error as string) || `Payment API error: ${response.status}`;
    throw new Error(message);
  }

  console.log('[PaymentService] Response:', data);
  return data as T;
}

export async function authorizePayment(params: AuthorizeParams): Promise<AuthorizeResult> {
  // Convert amount from cents to dollars (NSIM expects decimal dollars, not cents)
  const amountInDollars = params.amount / 100;

  const body: Record<string, unknown> = {
    merchantId: params.merchantId,
    amount: amountInDollars,
    currency: params.currency,
    cardToken: params.cardToken,
    orderId: params.orderId,
  };

  // Include wallet routing token if present (for wallet payments)
  if (params.walletCardToken) {
    body.walletCardToken = params.walletCardToken;
  }

  return makePaymentRequest<AuthorizeResult>('/authorize', 'POST', body);
}

export async function capturePayment(
  transactionId: string,
  amount?: number
): Promise<CaptureResult> {
  const body: Record<string, unknown> = {};
  if (amount !== undefined) {
    body.amount = amount;
  }

  return makePaymentRequest<CaptureResult>(
    `/${transactionId}/capture`,
    'POST',
    Object.keys(body).length > 0 ? body : undefined
  );
}

export async function voidPayment(transactionId: string): Promise<VoidResult> {
  return makePaymentRequest<VoidResult>(`/${transactionId}/void`, 'POST');
}

export async function refundPayment(
  transactionId: string,
  amount: number,
  reason: string
): Promise<RefundResult> {
  return makePaymentRequest<RefundResult>(`/${transactionId}/refund`, 'POST', {
    amount,
    reason,
  });
}

export async function getPaymentStatus(transactionId: string): Promise<{
  transactionId: string;
  status: string;
  amount: number;
  currency: string;
}> {
  return makePaymentRequest(`/${transactionId}`, 'GET');
}

// Webhook registration types and functions
export interface WebhookRegistrationParams {
  merchantId: string;
  endpoint: string;
  events: string[];
  secret?: string;
}

export interface WebhookRegistrationResult {
  id: string;
  merchantId: string;
  url: string;
  events: string[];
  secret?: string;
  createdAt: string;
}

const WEBHOOK_API_BASE = `${config.paymentApiUrl}/api/v1/webhooks`;

async function makeWebhookRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${WEBHOOK_API_BASE}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Add API key if configured
  if (config.paymentApiKey) {
    headers['X-API-Key'] = config.paymentApiKey;
  }

  console.log(`[WebhookService] ${method} ${url}`);

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    console.error('[WebhookService] API error:', response.status, data);
    const message = (data.message as string) || (data.error as string) || `Webhook API error: ${response.status}`;
    throw new Error(message);
  }

  console.log('[WebhookService] Response:', data);
  return data as T;
}

export async function registerWebhook(params: WebhookRegistrationParams): Promise<WebhookRegistrationResult> {
  return makeWebhookRequest<WebhookRegistrationResult>('', 'POST', {
    merchantId: params.merchantId,
    url: params.endpoint,  // NSIM expects 'url' field
    events: params.events,
    secret: params.secret,
  });
}

export async function listWebhooks(merchantId: string): Promise<WebhookRegistrationResult[]> {
  return makeWebhookRequest<WebhookRegistrationResult[]>(`?merchantId=${encodeURIComponent(merchantId)}`, 'GET');
}

export async function deleteWebhook(webhookId: string): Promise<void> {
  await makeWebhookRequest(`/${webhookId}`, 'DELETE');
}
