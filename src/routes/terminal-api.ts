/**
 * Terminal API Routes
 *
 * API endpoints for ESP32 hardware terminals.
 * These endpoints are called by the terminal firmware, not the browser.
 *
 * IMPORTANT: All endpoints validate that terminals belong to THIS instance's store.
 * This ensures proper isolation when multiple SSIM instances share a database.
 */

import { Router, Request, Response } from 'express';
import { config } from '../config/env';
import * as terminalService from '../services/terminal';
import { getOrCreateStore } from '../services/store';
import type { Store } from '@prisma/client';

const router = Router();

// Store reference (cached for process lifecycle)
let currentStore: Store | null = null;

async function ensureStore(): Promise<Store> {
  if (!currentStore) {
    currentStore = await getOrCreateStore();
  }
  return currentStore;
}

/**
 * POST /api/terminal/pair
 * Complete terminal pairing with a 6-digit code
 *
 * Called by ESP32 terminal during initial setup.
 * Only accepts pairing codes created by THIS SSIM instance's store.
 */
router.post('/pair', async (req: Request, res: Response) => {
  try {
    const { pairingCode, deviceInfo } = req.body;

    // Validate request
    if (!pairingCode) {
      return res.status(400).json({
        success: false,
        error: 'Pairing code is required',
      });
    }

    // Validate pairing code format (6 digits)
    const cleanCode = pairingCode.toString().replace(/\s/g, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid pairing code format',
      });
    }

    // Get this instance's store - pairing codes are store-scoped
    const store = await ensureStore();

    // Complete pairing - only accepts codes from THIS store
    const result = await terminalService.completePairing(store.id, cleanCode, {
      model: deviceInfo?.model,
      firmwareVersion: deviceInfo?.firmwareVersion,
      macAddress: deviceInfo?.macAddress,
    });

    if (!result) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired pairing code',
      });
    }

    // Return terminal config
    res.json({
      success: true,
      terminalId: result.terminal.id,
      apiKey: result.apiKey,
      config: {
        wsEndpoint: `${config.appBaseUrl.replace('http', 'ws')}/terminal/ws`,
        heartbeatInterval: 30000, // 30 seconds
        reconnectDelay: 5000,     // 5 seconds
      },
    });

    console.log(`[Terminal API] Terminal paired: ${result.terminal.name} (${result.terminal.id}) for store ${store.name}`);
  } catch (error) {
    console.error('[Terminal API] Pairing error:', error);
    res.status(500).json({
      success: false,
      error: 'Pairing failed',
    });
  }
});

/**
 * GET /api/terminal/config
 * Get terminal configuration
 *
 * Called by ESP32 terminal to get updated config.
 * Requires API key authentication.
 * Only returns config for terminals belonging to THIS store.
 */
router.get('/config', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required',
      });
    }

    const terminal = await terminalService.getTerminalByApiKey(apiKey);
    if (!terminal) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key',
      });
    }

    // Verify terminal belongs to THIS store
    const store = await ensureStore();
    if (terminal.storeId !== store.id) {
      console.warn(`[Terminal API] Terminal ${terminal.id} belongs to store ${terminal.storeId}, not ${store.id}`);
      return res.status(401).json({
        success: false,
        error: 'Terminal not registered with this store',
      });
    }

    res.json({
      success: true,
      terminalId: terminal.id,
      name: terminal.name,
      config: {
        wsEndpoint: `${config.appBaseUrl.replace('http', 'ws')}/terminal/ws`,
        heartbeatInterval: 30000,
        reconnectDelay: 5000,
      },
    });
  } catch (error) {
    console.error('[Terminal API] Config error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get config',
    });
  }
});

/**
 * POST /api/terminal/heartbeat
 * Terminal heartbeat (for HTTP fallback when WebSocket is not used)
 *
 * Requires API key authentication.
 * Only accepts heartbeats from terminals belonging to THIS store.
 */
router.post('/heartbeat', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required',
      });
    }

    const terminal = await terminalService.getTerminalByApiKey(apiKey);
    if (!terminal) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key',
      });
    }

    // Verify terminal belongs to THIS store
    const store = await ensureStore();
    if (terminal.storeId !== store.id) {
      console.warn(`[Terminal API] Heartbeat rejected: Terminal ${terminal.id} belongs to store ${terminal.storeId}, not ${store.id}`);
      return res.status(401).json({
        success: false,
        error: 'Terminal not registered with this store',
      });
    }

    // Update terminal status
    const clientIp = req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0];
    await terminalService.updateTerminalStatus(terminal.id, 'online', clientIp);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Terminal API] Heartbeat error:', error);
    res.status(500).json({
      success: false,
      error: 'Heartbeat failed',
    });
  }
});

/**
 * GET /api/terminal/payment/pending
 * Check for pending payments (for HTTP polling fallback)
 *
 * Requires API key authentication.
 * Only returns payments for terminals belonging to THIS store.
 */
router.get('/payment/pending', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required',
      });
    }

    const terminal = await terminalService.getTerminalByApiKey(apiKey);
    if (!terminal) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key',
      });
    }

    // Verify terminal belongs to THIS store
    const store = await ensureStore();
    if (terminal.storeId !== store.id) {
      console.warn(`[Terminal API] Payment pending rejected: Terminal ${terminal.id} belongs to store ${terminal.storeId}, not ${store.id}`);
      return res.status(401).json({
        success: false,
        error: 'Terminal not registered with this store',
      });
    }

    // Get pending payment for this terminal
    const activePayments = terminalService.getActivePayments(terminal.storeId);
    const pendingPayment = activePayments.find(p => p.terminalId === terminal.id);

    if (!pendingPayment) {
      return res.json({
        success: true,
        hasPending: false,
      });
    }

    res.json({
      success: true,
      hasPending: true,
      payment: {
        paymentId: pendingPayment.paymentId,
        qrData: pendingPayment.qrCodeUrl,
        amount: pendingPayment.amount,
        currency: pendingPayment.currency,
        reference: pendingPayment.reference,
        expiresAt: pendingPayment.expiresAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Terminal API] Payment pending error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check pending payments',
    });
  }
});

export default router;
