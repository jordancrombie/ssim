/**
 * Agent Webhooks Router
 * Handles token revocation webhooks from WSIM for immediate cache invalidation
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config/env';
import {
  invalidateTokenByHash,
  invalidateTokensByAgentId,
  getCacheStats,
} from '../services/wsim-agent';

const router = Router();

/**
 * Verify WSIM webhook signature
 * Signature format: t=<timestamp>,v1=<signature>
 */
function verifySignature(req: Request): boolean {
  const signature = req.headers['x-wsim-signature'] as string;
  if (!signature) {
    console.warn('[Agent Webhook] Missing x-wsim-signature header');
    return false;
  }

  // Parse signature parts
  const parts = signature.split(',');
  const timestampPart = parts.find((p) => p.startsWith('t='));
  const signaturePart = parts.find((p) => p.startsWith('v1='));

  if (!timestampPart || !signaturePart) {
    console.warn('[Agent Webhook] Invalid signature format');
    return false;
  }

  const timestamp = parseInt(timestampPart.replace('t=', ''), 10);
  const expectedSig = signaturePart.replace('v1=', '');

  // Reject if timestamp is too old (5 minute tolerance)
  const now = Date.now();
  if (now - timestamp > 5 * 60 * 1000) {
    console.warn('[Agent Webhook] Signature timestamp too old');
    return false;
  }

  // Reject if timestamp is in the future (with small tolerance for clock skew)
  if (timestamp > now + 60 * 1000) {
    console.warn('[Agent Webhook] Signature timestamp in the future');
    return false;
  }

  // Compute expected signature
  const body = JSON.stringify(req.body);
  const computedSig = crypto
    .createHmac('sha256', config.wsimWebhookSecret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSig, 'hex'),
      Buffer.from(computedSig, 'hex')
    );
  } catch {
    // If buffers have different lengths, comparison fails
    return false;
  }
}

/**
 * POST /api/agent/webhooks/token-revoked
 * Handle token revocation webhook from WSIM
 *
 * Payload:
 * {
 *   "event": "token.revoked",
 *   "timestamp": "2024-01-22T10:30:00.000Z",
 *   "data": {
 *     "token_hash": "sha256-hash-of-token",
 *     "agent_id": "agent_abc123",
 *     "reason": "explicit_revocation" | "agent_deactivated" | "owner_revoked"
 *   }
 * }
 */
router.post('/token-revoked', (req: Request, res: Response) => {
  // Check if webhook secret is configured
  if (!config.wsimWebhookSecret) {
    console.warn('[Agent Webhook] Webhook secret not configured, rejecting request');
    return res.status(503).json({
      error: 'webhook_not_configured',
      message: 'Webhook secret not configured',
    });
  }

  // Verify signature
  if (!verifySignature(req)) {
    console.warn('[Agent Webhook] Invalid signature');
    return res.status(401).json({
      error: 'invalid_signature',
      message: 'Webhook signature verification failed',
    });
  }

  const { event, data, timestamp } = req.body;

  // Validate event type
  if (event !== 'token.revoked') {
    console.log(`[Agent Webhook] Ignoring unknown event type: ${event}`);
    return res.status(200).json({ received: true, ignored: true });
  }

  // Validate required data
  if (!data || (!data.token_hash && !data.agent_id)) {
    console.warn('[Agent Webhook] Missing required data fields');
    return res.status(400).json({
      error: 'invalid_payload',
      message: 'Missing token_hash or agent_id in data',
    });
  }

  console.log(
    `[Agent Webhook] Token revocation received: agent=${data.agent_id}, reason=${data.reason}, timestamp=${timestamp}`
  );

  let invalidated = false;

  // Invalidate by token hash if provided
  if (data.token_hash) {
    invalidated = invalidateTokenByHash(data.token_hash) || invalidated;
  }

  // Also invalidate all tokens for the agent (catches any tokens not in the hash)
  if (data.agent_id) {
    const count = invalidateTokensByAgentId(data.agent_id);
    invalidated = count > 0 || invalidated;
  }

  const stats = getCacheStats();
  console.log(
    `[Agent Webhook] Cache after invalidation: ${stats.tokenCount} tokens, ${stats.hashCount} hashes`
  );

  res.status(200).json({
    received: true,
    invalidated,
    cache_stats: stats,
  });
});

/**
 * GET /api/agent/webhooks/health
 * Health check for webhook endpoint
 */
router.get('/health', (req: Request, res: Response) => {
  const stats = getCacheStats();
  res.json({
    status: 'ok',
    webhook_configured: !!config.wsimWebhookSecret,
    cache_stats: stats,
  });
});

export default router;
