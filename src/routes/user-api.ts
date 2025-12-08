import { Router, Request, Response } from 'express';
import { updateWsimJwt, clearWsimJwt } from '../services/store';
import '../types/session';

const router = Router();

/**
 * Save WSIM JWT token to user's database record
 * Called from checkout page after successful wallet authentication
 */
router.post('/wsim-token', async (req: Request, res: Response) => {
  const { storeUserId } = req.session;

  if (!storeUserId) {
    // User not logged in or DB not available - just acknowledge
    // The token is still stored in localStorage on the client
    return res.json({ success: true, persisted: false, reason: 'no_user_session' });
  }

  const { token, expiresIn } = req.body;

  if (!token || !expiresIn) {
    return res.status(400).json({ error: 'Missing token or expiresIn' });
  }

  try {
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    await updateWsimJwt(storeUserId, token, expiresAt);

    // Also update session
    req.session.wsimJwt = token;
    req.session.wsimJwtExp = expiresAt.getTime();

    console.log(`[UserAPI] WSIM JWT persisted for user ${storeUserId}`);
    res.json({ success: true, persisted: true });
  } catch (error) {
    console.error('[UserAPI] Failed to persist WSIM JWT:', error);
    res.json({ success: true, persisted: false, reason: 'db_error' });
  }
});

/**
 * Clear WSIM JWT token from user's database record
 * Called on logout or when token is invalid
 */
router.delete('/wsim-token', async (req: Request, res: Response) => {
  const { storeUserId } = req.session;

  if (!storeUserId) {
    return res.json({ success: true });
  }

  try {
    await clearWsimJwt(storeUserId);
    delete req.session.wsimJwt;
    delete req.session.wsimJwtExp;
    res.json({ success: true });
  } catch (error) {
    console.error('[UserAPI] Failed to clear WSIM JWT:', error);
    res.status(500).json({ error: 'Failed to clear token' });
  }
});

/**
 * Get user's stored WSIM JWT if valid
 * Used by checkout page to check for Quick Checkout availability
 */
router.get('/wsim-token', (req: Request, res: Response) => {
  const { wsimJwt, wsimJwtExp } = req.session;

  if (!wsimJwt || !wsimJwtExp) {
    return res.json({ hasToken: false });
  }

  if (Date.now() > wsimJwtExp) {
    return res.json({ hasToken: false, reason: 'expired' });
  }

  res.json({
    hasToken: true,
    token: wsimJwt,
    expiresAt: wsimJwtExp,
  });
});

export default router;
