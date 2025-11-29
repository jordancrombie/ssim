import { Router, Request, Response } from 'express';
import { getProvider, getAllProviders, generateState, generateNonce, generateCodeVerifier, generateCodeChallenge } from '../config/oidc';
import { config } from '../config/env';

declare module 'express-session' {
  interface SessionData {
    oidcState?: string;
    oidcNonce?: string;
    codeVerifier?: string;
    providerId?: string;
    userInfo?: Record<string, unknown>;
    tokenSet?: {
      access_token?: string;
      id_token?: string;
      refresh_token?: string;
      expires_at?: number;
      scope?: string;
    };
  }
}

const router = Router();

// List available OIDC providers
router.get('/providers', (req: Request, res: Response) => {
  const providers = getAllProviders();
  res.json({ providers });
});

// Initiate login with a specific provider
router.get('/login/:providerId', async (req: Request, res: Response) => {
  const { providerId } = req.params;
  const provider = getProvider(providerId);

  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Store in session for callback verification
  req.session.oidcState = state;
  req.session.oidcNonce = nonce;
  req.session.codeVerifier = codeVerifier;
  req.session.providerId = providerId;

  const authUrl = provider.client.authorizationUrl({
    scope: provider.config.scopes,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  res.redirect(authUrl);
});

// Handle OIDC callback
router.get('/callback/:providerId', async (req: Request, res: Response) => {
  const { providerId } = req.params;
  const provider = getProvider(providerId);

  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const { oidcState, oidcNonce, codeVerifier } = req.session;

  if (!oidcState || !codeVerifier) {
    return res.status(400).json({ error: 'Invalid session state' });
  }

  try {
    const params = provider.client.callbackParams(req);
    const redirectUri = `${config.appBaseUrl}/auth/callback/${providerId}`;

    const tokenSet = await provider.client.callback(redirectUri, params, {
      state: oidcState,
      nonce: oidcNonce,
      code_verifier: codeVerifier,
    });

    // Get user info from the provider
    const userInfo = await provider.client.userinfo(tokenSet.access_token!);

    // Store in session
    req.session.userInfo = userInfo as Record<string, unknown>;
    req.session.tokenSet = {
      access_token: tokenSet.access_token,
      id_token: tokenSet.id_token,
      refresh_token: tokenSet.refresh_token,
      expires_at: tokenSet.expires_at,
      scope: tokenSet.scope,
    };

    // Clear temporary OIDC state
    delete req.session.oidcState;
    delete req.session.oidcNonce;
    delete req.session.codeVerifier;

    // Redirect to profile page to display info
    res.redirect('/profile');
  } catch (error) {
    console.error('OIDC callback error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Logout - performs RP-Initiated Logout if provider supports it
router.get('/logout', (req: Request, res: Response) => {
  const providerId = req.session.providerId;
  const idToken = req.session.tokenSet?.id_token;

  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
    }

    // If we have provider info, try to do RP-Initiated Logout
    if (providerId && idToken) {
      const provider = getProvider(providerId);
      if (provider) {
        const endSessionEndpoint = provider.client.issuer.metadata.end_session_endpoint;
        if (endSessionEndpoint) {
          // Redirect to the provider's logout endpoint
          const logoutUrl = new URL(endSessionEndpoint);
          logoutUrl.searchParams.set('id_token_hint', idToken);
          logoutUrl.searchParams.set('post_logout_redirect_uri', config.appBaseUrl);
          return res.redirect(logoutUrl.toString());
        }
      }
    }

    // Fallback: just redirect to home
    res.redirect('/');
  });
});

// Get current user info (API endpoint)
router.get('/me', (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({
    userInfo: req.session.userInfo,
    tokenSet: req.session.tokenSet,
    providerId: req.session.providerId,
  });
});

export default router;
