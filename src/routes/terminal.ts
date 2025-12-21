import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { getOrCreateStore } from '../services/store';
import * as adminService from '../services/admin';
import * as terminalService from '../services/terminal';
import type { Store } from '@prisma/client';

const router = Router();

// Store reference (cached for request lifecycle)
let currentStore: Store | null = null;

async function ensureStore(): Promise<Store> {
  if (!currentStore) {
    currentStore = await getOrCreateStore();
  }
  return currentStore;
}

// ============================================
// PUBLIC ROUTES (no auth required)
// These must be defined BEFORE the requireAdmin middleware
// ============================================

/**
 * GET /terminal/payment-complete - Handle return from WSIM after mobile payment
 * This is a PUBLIC route - user returns here after paying via mwsim app
 *
 * Query params from mwsim:
 * - mwsim_return: The WSIM payment request ID (mwsim appends this)
 * - requestId: Alternative param name (fallback)
 * - status: Payment status if provided directly
 */
router.get('/payment-complete', async (req: Request, res: Response) => {
  // mwsim uses 'mwsim_return' parameter containing the requestId
  const requestId = (req.query.mwsim_return || req.query.requestId) as string | undefined;
  let status = req.query.status as string | undefined;

  console.log('[Terminal] Payment complete return:', {
    mwsim_return: req.query.mwsim_return,
    requestId: req.query.requestId,
    status,
    resolvedRequestId: requestId,
  });

  try {
    // If we have a requestId but no status, query WSIM for the actual status
    if (requestId && !status && config.wsimMobileApiUrl && config.wsimApiKey) {
      try {
        console.log('[Terminal] Querying WSIM for payment status...');
        const wsimResponse = await fetch(
          `${config.wsimMobileApiUrl}/${requestId}/status`,
          {
            method: 'GET',
            headers: {
              'X-API-Key': config.wsimApiKey,
            },
          }
        );

        if (wsimResponse.ok) {
          const wsimData = await wsimResponse.json() as { status: string };
          status = wsimData.status;
          console.log('[Terminal] WSIM status:', status);
        } else {
          console.warn('[Terminal] WSIM status query failed:', wsimResponse.status);
        }
      } catch (wsimError) {
        console.error('[Terminal] Failed to query WSIM status:', wsimError);
      }
    }

    // Find the terminal payment session by WSIM request ID
    const paymentSession = requestId
      ? terminalService.getPaymentSessionByWsimRequestId(requestId)
      : null;

    if (!paymentSession) {
      console.warn('[Terminal] Payment session not found for requestId:', requestId);
      // Still show a generic success page - the payment may have completed
      return res.render('terminal/payment-complete', {
        title: 'Payment Complete',
        success: status === 'approved',
        status: status || 'unknown',
        requestId,
        paymentId: null,
        amount: null,
        message: status === 'approved'
          ? 'Your payment has been processed successfully.'
          : 'Payment was not completed.',
      });
    }

    // Update payment session status based on WSIM response
    // IMPORTANT: Only update and notify if status is changing (prevents duplicate notifications)
    const previousStatus = paymentSession.status;

    if (status === 'approved') {
      if (previousStatus === 'approved') {
        // Payment was already approved - skip duplicate notification
        console.log(`[Terminal] Payment ${paymentSession.paymentId} already approved, skipping duplicate notification`);
      } else {
        terminalService.updatePaymentStatus(paymentSession.paymentId, 'approved');

        // Notify terminal via WebSocket that payment is complete
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const wsModule = require('../services/terminal-websocket');
          if (wsModule.sendToTerminal) {
            wsModule.sendToTerminal(paymentSession.terminalId, {
              type: 'payment_complete',
              payload: {
                paymentId: paymentSession.paymentId,
                status: 'approved',
              },
            });
            console.log(`[Terminal] Notified terminal ${paymentSession.terminalId} of payment completion`);
          }
        } catch (wsError) {
          console.error('[Terminal] Failed to notify terminal:', wsError);
        }
      }
    } else if (status === 'declined' && previousStatus !== 'declined') {
      terminalService.updatePaymentStatus(paymentSession.paymentId, 'declined');
    } else if (status === 'cancelled' && previousStatus !== 'cancelled') {
      terminalService.updatePaymentStatus(paymentSession.paymentId, 'cancelled');
    } else if (status === 'expired' && previousStatus !== 'expired') {
      terminalService.updatePaymentStatus(paymentSession.paymentId, 'expired');
    }

    // Render success/failure page
    res.render('terminal/payment-complete', {
      title: status === 'approved' ? 'Payment Successful' : 'Payment Not Completed',
      success: status === 'approved',
      status,
      requestId,
      paymentId: paymentSession.paymentId,
      amount: paymentSession.amount,
      currency: paymentSession.currency,
      reference: paymentSession.reference,
      message: status === 'approved'
        ? 'Thank you! Your payment has been processed successfully.'
        : status === 'declined'
        ? 'Your payment was declined. Please try again or use a different payment method.'
        : status === 'cancelled'
        ? 'Payment was cancelled.'
        : 'Payment session expired. Please try again.',
    });
  } catch (error) {
    console.error('[Terminal] Error handling payment complete:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred while processing your payment.',
      isAuthenticated: false,
      cartCount: 0,
    });
  }
});

// ============================================
// ADMIN ROUTES (auth required below)
// ============================================

// Admin authentication middleware (same as admin.ts)
async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!config.adminEnabled) {
    res.status(403).render('error', {
      title: 'Admin Disabled',
      message: 'Admin functionality is disabled',
      isAuthenticated: false,
      cartCount: 0,
    });
    return;
  }

  const userInfo = req.session.userInfo;
  if (!userInfo) {
    req.session.adminReturnTo = req.originalUrl;
    res.redirect('/login?admin=true');
    return;
  }

  const userEmail = (userInfo.email as string)?.toLowerCase();

  try {
    const store = await ensureStore();
    const hasAccess = await adminService.isAdmin(store.id, userEmail);

    if (!hasAccess) {
      res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have admin access. Contact an administrator.',
        isAuthenticated: true,
        userInfo,
        cartCount: req.session.cart?.length || 0,
      });
      return;
    }
  } catch (err) {
    console.warn('[Terminal] Database check failed, using env-based auth only:', err);
    if (config.adminEmails.length > 0 && !config.adminEmails.includes(userEmail)) {
      res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have admin access. Contact an administrator.',
        isAuthenticated: true,
        userInfo,
        cartCount: req.session.cart?.length || 0,
      });
      return;
    }
  }

  next();
}

// Apply admin auth to all routes
router.use(requireAdmin);

/**
 * GET /terminal - Terminal payment interface
 * Allows merchants to initiate QR code payments on connected terminals
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const userInfo = req.session.userInfo;

    // Get all terminals for this store
    const terminals = await terminalService.getTerminals(store.id);

    // Get any active payment sessions (for status display)
    const activePayments = await terminalService.getActivePayments(store.id);

    res.render('terminal/index', {
      title: 'Terminal Payment',
      currentPage: 'terminal',
      userInfo,
      terminals,
      activePayments,
      store,
    });
  } catch (error) {
    console.error('[Terminal] Error loading terminal page:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load terminal page',
      isAuthenticated: true,
      userInfo: req.session.userInfo,
      cartCount: req.session.cart?.length || 0,
    });
  }
});

/**
 * POST /terminal/payment - Initiate a payment on a terminal
 */
router.post('/payment', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const { terminalId, amount, reference } = req.body;

    // Validate input
    if (!terminalId) {
      return res.status(400).json({ error: 'Terminal ID is required' });
    }

    const amountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Verify terminal belongs to this store and is online
    const terminal = await terminalService.getTerminal(terminalId);
    if (!terminal || terminal.storeId !== store.id) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    if (terminal.status !== 'online') {
      return res.status(400).json({ error: 'Terminal is offline' });
    }

    // Initiate payment via terminal service
    const payment = await terminalService.initiatePayment({
      storeId: store.id,
      terminalId,
      amount: amountCents,
      currency: 'CAD',
      reference: reference || undefined,
      storeName: store.name,
    });

    res.json({
      success: true,
      paymentId: payment.paymentId,
      status: payment.status,
    });
  } catch (error) {
    console.error('[Terminal] Error initiating payment:', error);
    res.status(500).json({
      error: 'Failed to initiate payment',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /terminal/payment/:id/cancel - Cancel a pending payment
 */
router.post('/payment/:id/cancel', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const { id } = req.params;

    await terminalService.cancelPayment(store.id, id);

    res.json({ success: true });
  } catch (error) {
    console.error('[Terminal] Error cancelling payment:', error);
    res.status(500).json({
      error: 'Failed to cancel payment',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /terminal/payment/:id/status - Get payment status (for polling)
 */
router.get('/payment/:id/status', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const { id } = req.params;

    const status = await terminalService.getPaymentStatus(store.id, id);

    if (!status) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json(status);
  } catch (error) {
    console.error('[Terminal] Error getting payment status:', error);
    res.status(500).json({
      error: 'Failed to get payment status',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
