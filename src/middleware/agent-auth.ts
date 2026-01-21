/**
 * Agent Authentication Middleware
 * Validates WSIM agent tokens and attaches agent context to requests
 * Part of SimToolBox Agent Commerce Protocol (SACP)
 */

import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { introspectAgentToken, AgentContext } from '../services/wsim-agent';

// Extend Express Request to include agent context
declare global {
  namespace Express {
    interface Request {
      agent?: AgentContext;
      storeId?: string;
    }
  }
}

// Simple in-memory rate limiting (per Q20: 1000 req/min per agent)
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Clean rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > 60000) {
      rateLimitMap.delete(key);
    }
  }
}, 60000);

/**
 * Check rate limit for an agent
 * Returns true if request is allowed, false if rate limited
 */
function checkRateLimit(agentId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(agentId);

  if (!entry || now - entry.windowStart > 60000) {
    // New window
    rateLimitMap.set(agentId, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= config.agentRateLimitPerMinute) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Agent authentication middleware
 * Validates Bearer token against WSIM and attaches agent context
 */
export async function authenticateAgent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Check if agent API is enabled
  if (!config.agentApiEnabled && process.env.WSIM_AGENT_MOCK !== 'true') {
    res.status(503).json({
      error: 'agent_api_disabled',
      message: 'Agent API is not enabled for this store',
    });
    return;
  }

  // Extract Bearer token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'missing_token',
      message: 'Authorization header with Bearer token required',
    });
    return;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  if (!token) {
    res.status(401).json({
      error: 'invalid_token',
      message: 'Token is empty',
    });
    return;
  }

  try {
    // Introspect token with WSIM (uses cache per Q18)
    const agentContext = await introspectAgentToken(token);

    if (!agentContext || !agentContext.valid) {
      res.status(401).json({
        error: 'invalid_token',
        message: 'Token is invalid or expired',
      });
      return;
    }

    // Check rate limit (per Q20: 1000 req/min per agent)
    if (!checkRateLimit(agentContext.agentId)) {
      res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Too many requests. Please slow down.',
        retryAfter: 60,
      });
      return;
    }

    // Attach agent context to request
    req.agent = agentContext;

    console.log(
      `[Agent Auth] Request from agent ${agentContext.agentId} (owner: ${agentContext.ownerId})`
    );

    next();
  } catch (error) {
    console.error('[Agent Auth] Error during authentication:', error);
    res.status(500).json({
      error: 'authentication_error',
      message: 'Failed to authenticate agent token',
    });
  }
}

/**
 * Optional agent authentication middleware
 * Allows requests without token but attaches context if present
 * Useful for endpoints like product catalog that work for both agents and humans
 */
export async function optionalAgentAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  // No auth header - continue without agent context
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  // Has auth header - validate it
  const token = authHeader.substring(7);

  if (token) {
    try {
      const agentContext = await introspectAgentToken(token);
      if (agentContext && agentContext.valid) {
        req.agent = agentContext;
      }
    } catch (error) {
      console.warn('[Agent Auth] Optional auth failed:', error);
      // Continue without agent context
    }
  }

  next();
}

/**
 * Middleware to ensure store context is set
 * Must be used after store initialization
 */
export function requireStoreContext(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.storeId) {
    res.status(500).json({
      error: 'store_context_missing',
      message: 'Store context not initialized',
    });
    return;
  }
  next();
}
