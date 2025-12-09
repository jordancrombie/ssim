import { Router, Request, Response } from 'express';
import { getProvider, getAllProviders, generateState, generateNonce, generateCodeVerifier, generateCodeChallenge } from '../config/oidc';
import { config } from '../config/env';
import '../types/session';
import { getOrCreateStore, getOrCreateStoreUser, getStoreUserByBsimId, updateConsentedScopes, hasConsentedToScopes, getValidWsimJwt } from '../services/store';
import type { Store } from '@prisma/client';

// Cookie name for remembering the user's BSIM ID
const BSIM_USER_COOKIE = 'ssim_bsim_user';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 1 year

// Store reference (initialized on first request)
let currentStore: Store | null = null;

async function ensureStore(): Promise<Store> {
  if (!currentStore) {
    currentStore = await getOrCreateStore();
  }
  return currentStore;
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

  // Store returnTo URL if provided
  const returnTo = req.query.returnTo as string;
  if (returnTo && returnTo.startsWith('/')) {
    req.session.returnTo = returnTo;
  }

  // Build authorization URL parameters
  const authParams: Record<string, string> = {
    scope: provider.config.scopes,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Request JWT access token for Open Banking API access
    resource: config.openbankingBaseUrl,
  };

  // Check if this is a returning user who has already consented
  // If so, we can skip the consent screen by passing prompt=login
  // Use a timeout to avoid blocking login if DB is slow/unavailable
  const bsimUserId = req.cookies?.[BSIM_USER_COOKIE];
  if (bsimUserId) {
    try {
      const checkReturningUser = async () => {
        const store = await ensureStore();
        const existingUser = await getStoreUserByBsimId(store.id, bsimUserId);

        if (existingUser) {
          const requestedScopes = provider.config.scopes.split(' ');
          if (hasConsentedToScopes(existingUser, requestedScopes)) {
            // User has already consented to these scopes - skip consent screen
            authParams.prompt = 'login';
            authParams.login_hint = existingUser.email;
            console.log(`[Auth] Returning user ${existingUser.email} - skipping consent (already approved scopes)`);
          }
        }
      };

      // Timeout after 2 seconds to avoid blocking login
      await Promise.race([
        checkReturningUser(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 2000))
      ]);
    } catch (err) {
      // Database error or timeout - proceed without consent optimization
      console.warn('[Auth] Could not check returning user (proceeding with normal login):', err instanceof Error ? err.message : err);
    }
  }

  const authUrl = provider.client.authorizationUrl(authParams);

  console.log('Authorization URL:', authUrl);

  // Ensure session is saved before redirecting to avoid race condition
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).json({ error: 'Failed to save session' });
    }
    res.redirect(authUrl);
  });
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

    console.log('[SSIM] Exchanging authorization code for tokens...');
    const tokenSet = await provider.client.callback(redirectUri, params, {
      state: oidcState,
      nonce: oidcNonce,
      code_verifier: codeVerifier,
    });
    console.log('[SSIM] Token exchange successful');
    console.log('[SSIM] Access token (first 50 chars):', tokenSet.access_token?.substring(0, 50));
    console.log('[SSIM] Access token length:', tokenSet.access_token?.length);

    // Get user info from ID token claims instead of userinfo endpoint
    // When using resource indicators, the access token is audience-restricted
    // to the resource server (Open Banking API), not the userinfo endpoint
    const idTokenClaims = tokenSet.claims();
    console.log('[SSIM] ID Token claims:', idTokenClaims);

    // Use ID token claims as user info
    const userInfo = {
      sub: idTokenClaims.sub,
      name: idTokenClaims.name,
      given_name: idTokenClaims.given_name,
      family_name: idTokenClaims.family_name,
      email: idTokenClaims.email,
      email_verified: idTokenClaims.email_verified,
    };
    console.log('[SSIM] User info from ID token:', userInfo);

    // Store in session
    req.session.userInfo = userInfo as Record<string, unknown>;
    req.session.tokenSet = {
      access_token: tokenSet.access_token,
      id_token: tokenSet.id_token,
      refresh_token: tokenSet.refresh_token,
      expires_at: tokenSet.expires_at,
      scope: tokenSet.scope,
    };

    // Persist user to database
    try {
      const store = await ensureStore();
      const storeUser = await getOrCreateStoreUser(
        store.id,
        userInfo.sub as string,
        userInfo.email as string,
        userInfo.name as string | undefined
      );

      // Store the database user ID in session
      req.session.storeUserId = storeUser.id;

      // Update consented scopes (the scopes they just approved)
      const currentScopes = tokenSet.scope?.split(' ') || [];
      if (currentScopes.length > 0) {
        // Merge with any previously consented scopes
        const allScopes = [...new Set([...storeUser.consentedScopes, ...currentScopes])];
        await updateConsentedScopes(storeUser.id, allScopes);
      }

      // If user has a valid WSIM JWT stored, add it to session for checkout page
      const wsimJwt = getValidWsimJwt(storeUser);
      if (wsimJwt) {
        req.session.wsimJwt = wsimJwt;
        req.session.wsimJwtExp = storeUser.wsimJwtExp?.getTime();
      }

      console.log(`[Auth] User persisted: ${storeUser.email} (ID: ${storeUser.id})`);

      // Set a persistent cookie with the BSIM user ID for returning user detection
      // This allows us to skip consent on subsequent logins
      res.cookie(BSIM_USER_COOKIE, userInfo.sub, {
        maxAge: COOKIE_MAX_AGE,
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
      });
    } catch (dbError) {
      // Log but don't fail auth if DB is unavailable
      console.error('[Auth] Failed to persist user to database:', dbError);
    }

    // Clear temporary OIDC state
    delete req.session.oidcState;
    delete req.session.oidcNonce;
    delete req.session.codeVerifier;

    // Redirect to returnTo URL if set, otherwise profile page
    const returnTo = req.session.returnTo;
    delete req.session.returnTo;
    res.redirect(returnTo || '/profile');
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
