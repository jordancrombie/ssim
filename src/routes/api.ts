import { Router, Request, Response } from 'express';

const router = Router();

const OPENBANKING_BASE_URL = 'https://openbanking.banksim.ca';

// Fetch accounts from Open Banking API
router.get('/accounts', async (req: Request, res: Response) => {
  if (!req.session.userInfo || !req.session.tokenSet?.access_token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const sub = req.session.userInfo.sub as string;
  if (!sub) {
    return res.status(400).json({ error: 'No user subject (sub) found in claims' });
  }

  try {
    // Debug: Log token info (first 50 chars only for security)
    const token = req.session.tokenSet.access_token;
    console.log('Access token (first 50 chars):', token?.substring(0, 50));
    console.log('Token length:', token?.length);

    // Try to decode JWT payload (if it's a JWT)
    if (token && token.split('.').length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        console.log('Token payload:', JSON.stringify(payload, null, 2));
      } catch (e) {
        console.log('Could not decode token as JWT');
      }
    } else {
      console.log('Token is not a JWT (opaque token)');
    }

    const response = await fetch(`${OPENBANKING_BASE_URL}/users/${sub}/accounts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Open Banking API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'Open Banking API error',
        status: response.status,
        details: errorText,
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Failed to fetch accounts:', error);
    res.status(500).json({
      error: 'Failed to fetch accounts',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
