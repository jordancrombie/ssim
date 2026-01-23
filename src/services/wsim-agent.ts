/**
 * WSIM Agent Client Service
 * Handles token introspection and agent identity verification for SACP
 */

import crypto from 'crypto';
import { config } from '../config/env';

/**
 * Agent context returned from WSIM token introspection
 */
export interface AgentContext {
  valid: boolean;
  agentId: string;
  agentName: string;
  ownerId: string;
  ownerEmail?: string;
  permissions: string[];
  spendingLimits: {
    perTransaction: number;
    daily: number;
    dailyUsed: number;
  };
  expiresAt: string;
}

/**
 * Cached token entry
 */
interface TokenCacheEntry {
  context: AgentContext;
  cachedAt: number;
  tokenHash: string;
}

// In-memory token cache (per Q18: 60-second TTL approved)
const tokenCache = new Map<string, TokenCacheEntry>();

// Reverse lookup: hash -> token (for webhook-based invalidation)
const hashToTokenMap = new Map<string, string>();

/**
 * Compute SHA-256 hash of a token
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Clean expired entries from cache
 */
function cleanExpiredCache(): void {
  const now = Date.now();
  const ttlMs = config.agentTokenCacheTtl * 1000;

  for (const [token, entry] of tokenCache.entries()) {
    if (now - entry.cachedAt > ttlMs) {
      hashToTokenMap.delete(entry.tokenHash);
      tokenCache.delete(token);
    }
  }
}

// Clean cache periodically (every 5 minutes)
setInterval(cleanExpiredCache, 5 * 60 * 1000);

/**
 * Check if a cached token is still valid
 */
function getCachedToken(token: string): AgentContext | null {
  const entry = tokenCache.get(token);
  if (!entry) {
    return null;
  }

  const ttlMs = config.agentTokenCacheTtl * 1000;
  if (Date.now() - entry.cachedAt > ttlMs) {
    tokenCache.delete(token);
    return null;
  }

  return entry.context;
}

/**
 * Cache a token introspection result
 */
function cacheToken(token: string, context: AgentContext): void {
  const tokenHashValue = hashToken(token);
  tokenCache.set(token, {
    context,
    cachedAt: Date.now(),
    tokenHash: tokenHashValue,
  });
  // Store reverse lookup for webhook-based invalidation
  hashToTokenMap.set(tokenHashValue, token);
}

/**
 * Invalidate a cached token (e.g., on revocation webhook)
 */
export function invalidateToken(token: string): void {
  const entry = tokenCache.get(token);
  if (entry) {
    hashToTokenMap.delete(entry.tokenHash);
  }
  tokenCache.delete(token);
  console.log('[WSIM Agent] Token invalidated from cache');
}

/**
 * Invalidate a token by its hash (called from WSIM revocation webhook)
 */
export function invalidateTokenByHash(tokenHashValue: string): boolean {
  const token = hashToTokenMap.get(tokenHashValue);
  if (token) {
    tokenCache.delete(token);
    hashToTokenMap.delete(tokenHashValue);
    console.log('[WSIM Agent] Token invalidated by hash');
    return true;
  }
  return false;
}

/**
 * Invalidate all tokens for a specific agent (called from WSIM revocation webhook)
 */
export function invalidateTokensByAgentId(agentId: string): number {
  let count = 0;
  for (const [token, entry] of tokenCache.entries()) {
    if (entry.context.agentId === agentId) {
      hashToTokenMap.delete(entry.tokenHash);
      tokenCache.delete(token);
      count++;
    }
  }
  if (count > 0) {
    console.log(`[WSIM Agent] Invalidated ${count} token(s) for agent ${agentId}`);
  }
  return count;
}

/**
 * Get cache statistics (for debugging/monitoring)
 */
export function getCacheStats(): { tokenCount: number; hashCount: number } {
  return {
    tokenCount: tokenCache.size,
    hashCount: hashToTokenMap.size,
  };
}

/**
 * Introspect an agent token with WSIM
 * Uses caching per Q18 (60-second TTL approved)
 * Implements retry with exponential backoff per Q21
 */
export async function introspectAgentToken(
  token: string,
  retries = 3
): Promise<AgentContext | null> {
  // Check cache first
  const cached = getCachedToken(token);
  if (cached) {
    console.log('[WSIM Agent] Token found in cache');
    return cached;
  }

  // In mock mode, return mock data for development
  if (process.env.WSIM_AGENT_MOCK === 'true') {
    return getMockAgentContext(token);
  }

  const introspectUrl = `${config.wsimAgentApiUrl}/oauth/introspect`;
  const credentials = Buffer.from(
    `${config.wsimIntrospectionClientId}:${config.wsimIntrospectionClientSecret}`
  ).toString('base64');

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(introspectUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${credentials}`,
        },
        body: `token=${encodeURIComponent(token)}`,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 400) {
          // Invalid token - not a retry-able error
          console.log('[WSIM Agent] Token introspection returned invalid');
          return null;
        }
        throw new Error(`WSIM introspection failed: ${response.status}`);
      }

      const data = await response.json() as {
        active: boolean;
        agent_id: string;
        agent_name?: string;
        owner_id: string;
        owner_email?: string;
        permissions?: string[];
        spending_limits?: {
          per_transaction?: number;
          daily?: number;
          daily_used?: number;
        };
        exp?: number;
      };

      if (!data.active) {
        console.log('[WSIM Agent] Token is not active');
        return null;
      }

      const context: AgentContext = {
        valid: true,
        agentId: data.agent_id,
        agentName: data.agent_name || 'Unknown Agent',
        ownerId: data.owner_id,
        ownerEmail: data.owner_email,
        permissions: data.permissions || [],
        spendingLimits: {
          perTransaction: data.spending_limits?.per_transaction || 0,
          daily: data.spending_limits?.daily || 0,
          dailyUsed: data.spending_limits?.daily_used || 0,
        },
        expiresAt: data.exp ? new Date(data.exp * 1000).toISOString() : '',
      };

      // Cache the result
      cacheToken(token, context);
      console.log(`[WSIM Agent] Token validated for agent: ${context.agentId}`);

      return context;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[WSIM Agent] Introspection attempt ${attempt + 1} failed:`,
        lastError.message
      );

      // Exponential backoff per Q21
      if (attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed - check cache one more time (might have been populated by another request)
  const fallbackCached = getCachedToken(token);
  if (fallbackCached) {
    console.log('[WSIM Agent] Using cached token after retry failures');
    return fallbackCached;
  }

  console.error('[WSIM Agent] All introspection attempts failed:', lastError?.message);
  return null;
}

/**
 * Mock agent context for development/testing
 */
function getMockAgentContext(token: string): AgentContext {
  // Parse mock token format: mock_agent_<agentId>_<ownerId>
  const parts = token.split('_');
  const agentId = parts[2] || 'mock-agent-001';
  const ownerId = parts[3] || 'mock-owner-001';

  console.log(`[WSIM Agent] Returning mock context for agent: ${agentId}`);

  return {
    valid: true,
    agentId,
    agentName: `Mock Agent ${agentId}`,
    ownerId,
    ownerEmail: `${ownerId}@example.com`,
    permissions: ['products:read', 'cart:write', 'checkout:write'],
    spendingLimits: {
      perTransaction: 10000, // $100.00
      daily: 50000, // $500.00
      dailyUsed: 0,
    },
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
}

/**
 * Request a payment token from WSIM for an agent checkout
 */
export interface PaymentTokenRequest {
  merchantId: string;
  amount: number;
  currency: string;
  sessionId: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  callbackUrl?: string;
}

export interface PaymentTokenResponse {
  success: boolean;
  paymentToken?: string;
  stepUpRequired?: boolean;
  stepUpId?: string;
  error?: string;
}

/**
 * Request a payment token from WSIM
 * May return immediate approval or require step-up authorization
 */
export async function requestPaymentToken(
  agentToken: string,
  request: PaymentTokenRequest
): Promise<PaymentTokenResponse> {
  // In mock mode, return mock data
  if (process.env.WSIM_AGENT_MOCK === 'true') {
    return getMockPaymentTokenResponse(request);
  }

  const paymentTokenUrl = `${config.wsimAgentApiUrl}/payments/token`;

  try {
    const response = await fetch(paymentTokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agentToken}`,
      },
      body: JSON.stringify({
        merchant_id: request.merchantId,
        amount: request.amount,
        currency: request.currency,
        session_id: request.sessionId,
        items: request.items,
        callback_url: request.callbackUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[WSIM Agent] Payment token request failed:', error);
      return {
        success: false,
        error: `Payment token request failed: ${response.status}`,
      };
    }

    const data = await response.json() as {
      step_up_required?: boolean;
      step_up_id?: string;
      payment_token?: string;
    };

    if (data.step_up_required) {
      return {
        success: false,
        stepUpRequired: true,
        stepUpId: data.step_up_id,
      };
    }

    return {
      success: true,
      paymentToken: data.payment_token,
    };
  } catch (error) {
    console.error('[WSIM Agent] Payment token request error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Mock payment token response for development
 */
function getMockPaymentTokenResponse(
  request: PaymentTokenRequest
): PaymentTokenResponse {
  // Simulate step-up for amounts over $50 (5000 cents)
  if (request.amount > 5000) {
    return {
      success: false,
      stepUpRequired: true,
      stepUpId: `stepup_${Date.now()}`,
    };
  }

  return {
    success: true,
    paymentToken: `mock_payment_token_${Date.now()}`,
  };
}
