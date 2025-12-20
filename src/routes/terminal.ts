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
